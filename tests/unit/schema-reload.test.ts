import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const library = pathToFileURL(fileURLToPath(new URL('../../lib/dist/index.mjs', import.meta.url))).href;
const internalLibrary = pathToFileURL(fileURLToPath(new URL('../../lib/dist/internal.mjs', import.meta.url))).href;
const studioLibrary = pathToFileURL(fileURLToPath(new URL('../../studio/dist/index.mjs', import.meta.url))).href;

const SCHEMA_USING_RULES = `import { requiredField } from './shared/rules.ts';
import { marker } from 'shared-package';
export const schema = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (data) =>
      data[requiredField] ? { value: data } : { issues: [{ message: requiredField + marker, path: [{ key: requiredField }] }] },
  },
};
`;

const rulesRequiring = (field: string) => `globalThis.rulesEvaluated = (globalThis.rulesEvaluated ?? 0) + 1;
export const requiredField = '${field}';
`;

// Not run in this process: its dynamic imports go through the test runner, not the module loader a program uses
async function readTwice(dataDir: string, between: () => Promise<void>) {
  const script = join(dataDir, 'probe.mjs');
  await writeFile(
    script,
    `import { LinesDB } from '${library}';
import { writeFile } from 'node:fs/promises';
const open = async () => {
  const db = LinesDB.create({ dataDir: ${JSON.stringify(dataDir)} });
  const loaded = await db.initialize();
  if (!loaded.ok) throw loaded.error;
  return db;
};
const emailOnly = { id: 2, email: 'bob@example.com' };
const nameOnly = { id: 3, name: 'Carol' };
const first = await open();
const before = [first.validateRow('users', emailOnly).ok, first.validateRow('users', nameOnly).ok];
const evaluatedFirst = globalThis.rulesEvaluated;
await writeFile(${JSON.stringify(join(dataDir, 'shared', 'rules.ts'))}, ${JSON.stringify(rulesRequiring('email'))});
await writeFile(${JSON.stringify(join(dataDir, 'node_modules', 'shared-package', 'index.js'))}, "globalThis.packageEvaluated = (globalThis.packageEvaluated ?? 0) + 1;\\nexport const marker = ' (changed)';\\n");
const second = await open();
const after = [second.validateRow('users', emailOnly).ok, second.validateRow('users', nameOnly).ok];
console.log(JSON.stringify({
  before,
  after,
  rulesEvaluated: [evaluatedFirst, globalThis.rulesEvaluated],
  packageEvaluated: globalThis.packageEvaluated,
}));
await first.close();
await second.close();
`,
  );
  await between();
  const { stdout } = await run(process.execPath, [script]);
  return JSON.parse(stdout.trim().split('\n').at(-1) as string) as {
    before: boolean[];
    after: boolean[];
    rulesEvaluated: number[];
    packageEvaluated: number;
  };
}

// Runs `body` in a program of its own, after the tables are read once as `db`, and gives what it logs as JSON
async function inProgram<Result>(dataDir: string, body: string): Promise<Result> {
  const script = join(dataDir, 'program.mjs');
  await writeFile(
    script,
    `import { LinesDB } from '${library}';
import { writeFile } from 'node:fs/promises';
const db = LinesDB.create({ dataDir: ${JSON.stringify(dataDir)} });
const loaded = await db.initialize();
if (!loaded.ok) throw loaded.error;
const log = (value) => console.log(JSON.stringify(value));
${body}
await db.close();
`,
  );
  const { stdout } = await run(process.execPath, [script]);
  return JSON.parse(stdout.trim().split('\n').at(-1) as string) as Result;
}

describe('reading the tables again after a file a schema imports changed', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'lines-db-reload-'));
    await mkdir(join(dataDir, 'shared'));
    await mkdir(join(dataDir, 'node_modules', 'shared-package'), { recursive: true });
    await writeFile(
      join(dataDir, 'node_modules', 'shared-package', 'package.json'),
      JSON.stringify({ name: 'shared-package', type: 'module', main: 'index.js' }),
    );
    await writeFile(
      join(dataDir, 'node_modules', 'shared-package', 'index.js'),
      "globalThis.packageEvaluated = (globalThis.packageEvaluated ?? 0) + 1;\nexport const marker = '';\n",
    );
    await writeFile(join(dataDir, 'shared', 'rules.ts'), rulesRequiring('name'));
    await writeFile(join(dataDir, 'users.schema.ts'), SCHEMA_USING_RULES);
    await writeFile(join(dataDir, 'users.jsonl'), '{"id":1,"name":"Alice","email":"alice@example.com"}\n');
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('validates against the project file as it is now', async () => {
    const result = await readTwice(dataDir, async () => {});

    expect(result.before).toEqual([false, true]);
    expect(result.after).toEqual([true, false]);
  });

  it('evaluates a project file once for each time the tables are read, however many schema reads share it', async () => {
    const result = await readTwice(dataDir, async () => {});

    expect(result.rulesEvaluated).toEqual([1, 2]);
  });

  it('keeps a package from node_modules as one module across the reads', async () => {
    const result = await readTwice(dataDir, async () => {});

    expect(result.packageEvaluated).toBe(1);
  });
});

// Not compared as the module loader spells them: on Windows the temporary directory can come as a short 8.3 name
const named = (files: string[]) => Promise.all(files.map((file) => realpath(file)));

describe('noticing a change to a file a schema imports', () => {
  let dataDir: string;
  const rulesPath = () => join(dataDir, 'shared', 'rules.ts');

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'lines-db-dependencies-'));
    await mkdir(join(dataDir, 'shared'));
    await mkdir(join(dataDir, 'node_modules', 'shared-package'), { recursive: true });
    await writeFile(
      join(dataDir, 'node_modules', 'shared-package', 'package.json'),
      JSON.stringify({ name: 'shared-package', type: 'module', main: 'index.js' }),
    );
    await writeFile(join(dataDir, 'node_modules', 'shared-package', 'index.js'), "export const marker = '';\n");
    await writeFile(rulesPath(), rulesRequiring('name'));
    await writeFile(join(dataDir, 'users.schema.ts'), SCHEMA_USING_RULES);
    await writeFile(join(dataDir, 'users.jsonl'), '{"id":1,"name":"Alice","email":"alice@example.com"}\n');
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('reports no change right after the tables were read', async () => {
    const result = await inProgram<{ changed: boolean }>(
      dataDir,
      `const checked = await db.hasExternalChanges();
if (!checked.ok) throw checked.error;
log({ changed: checked.value });`,
    );

    expect(result.changed).toBe(false);
  });

  it('reports a change once a file a schema imports is edited, and names the file', async () => {
    const result = await inProgram<{ changed: boolean; files: string[] }>(
      dataDir,
      `await writeFile(${JSON.stringify(rulesPath())}, ${JSON.stringify(rulesRequiring('email'))});
const checked = await db.hasExternalChanges();
const found = await db.findExternalChanges();
if (!checked.ok) throw checked.error;
if (!found.ok) throw found.error;
log({ changed: checked.value, files: found.value });`,
    );

    expect(result.changed).toBe(true);
    // As the module loader names it, with a link such as the temporary directory of macOS resolved
    expect(await named(result.files)).toContain(await realpath(rulesPath()));
  });

  it('reports no change after its own write, as only an outside edit counts', async () => {
    const result = await inProgram<{ changed: boolean }>(
      dataDir,
      `await db.transaction((tx) => tx.update('users', { name: 'Bob' }, { id: 1 }));
const checked = await db.hasExternalChanges();
if (!checked.ok) throw checked.error;
log({ changed: checked.value });`,
    );

    expect(result.changed).toBe(false);
  });

  it('lists the project files the schemas import, and not the schemas or a package from node_modules', async () => {
    const result = await inProgram<{ files: string[] }>(dataDir, 'log({ files: db.listSchemaDependencies() });');

    expect(await named(result.files)).toContain(await realpath(rulesPath()));
    expect(result.files.some((file) => file.includes('node_modules') || file.endsWith('.schema.ts'))).toBe(false);
  });
});

describe('evaluating only the files that changed', () => {
  let root: string;
  let dataDir: string;
  const rulesPath = () => join(dataDir, 'shared', 'rules.ts');

  const SCHEMA = `import { requiredField } from './shared/rules.ts';
import { other } from './shared/other.ts';
export const schema = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (data) => (data[requiredField] ? { value: data } : { issues: [{ message: other, path: [{ key: requiredField }] }] }),
  },
};
`;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'lines-db-versions-'));
    dataDir = join(root, 'data');
    await mkdir(join(dataDir, 'shared'), { recursive: true });
    await writeFile(rulesPath(), rulesRequiring('name'));
    await writeFile(
      join(dataDir, 'shared', 'other.ts'),
      "globalThis.otherEvaluated = (globalThis.otherEvaluated ?? 0) + 1;\nexport const other = 'other';\n",
    );
    await writeFile(join(dataDir, 'users.schema.ts'), SCHEMA);
    await writeFile(join(dataDir, 'users.jsonl'), '{"id":1,"name":"Alice"}\n');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const readThreeTimesThenEditRules = (
    editedRules: string,
  ) => `const counts = () => ({ rules: globalThis.rulesEvaluated, other: globalThis.otherEvaluated });
const again = async () => {
  const next = LinesDB.create({ dataDir: ${JSON.stringify(dataDir)} });
  const loaded = await next.initialize();
  if (!loaded.ok) throw loaded.error;
  await next.close();
  return counts();
};
const first = counts();
const second = await again();
const third = await again();
await writeFile(${JSON.stringify(rulesPath())}, ${JSON.stringify(editedRules)});
const fourth = await again();
log({ first, second, third, fourth });`;

  it('does not evaluate a file again while it and the files it imports are unchanged', async () => {
    const result = await inProgram<Record<string, { rules: number; other: number }>>(
      dataDir,
      readThreeTimesThenEditRules(rulesRequiring('email')),
    );

    expect([result.first, result.second, result.third]).toEqual([
      { rules: 1, other: 1 },
      { rules: 1, other: 1 },
      { rules: 1, other: 1 },
    ]);
  });

  it('evaluates only the file that changed, among the files a schema imports', async () => {
    const result = await inProgram<Record<string, { rules: number; other: number }>>(
      dataDir,
      readThreeTimesThenEditRules(rulesRequiring('email')),
    );

    expect(result.fourth).toEqual({ rules: 2, other: 1 });
  });

  it('leaves a file outside the package of the schema as one module', async () => {
    const pkg = join(root, 'package-with-schema');
    const data = join(pkg, 'data');
    await mkdir(data, { recursive: true });
    await mkdir(join(root, 'elsewhere'));
    await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: 'package-with-schema', type: 'module' }));
    const outside = join(root, 'elsewhere', 'outside.ts');
    await writeFile(
      outside,
      "globalThis.outsideEvaluated = (globalThis.outsideEvaluated ?? 0) + 1;\nexport const outside = 'a';\n",
    );
    await writeFile(
      join(data, 'users.schema.ts'),
      `import { outside } from '../../elsewhere/outside.ts';
export const schema = { '~standard': { version: 1, vendor: 'test', validate: (data) => ({ value: { ...data, outside } }) } };
`,
    );
    await writeFile(join(data, 'users.jsonl'), '{"id":1}\n');

    const result = await inProgram<{ evaluated: number }>(
      data,
      `await writeFile(${JSON.stringify(outside)}, "globalThis.outsideEvaluated = (globalThis.outsideEvaluated ?? 0) + 1;\\nexport const outside = 'b';\\n");
const next = LinesDB.create({ dataDir: ${JSON.stringify(data)} });
const reloaded = await next.initialize();
if (!reloaded.ok) throw reloaded.error;
await next.close();
log({ evaluated: globalThis.outsideEvaluated });`,
    );

    expect(result.evaluated).toBe(1);
  });
});

describe('the studio telling a page that a file a schema imports changed', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'lines-db-studio-imports-'));
    await mkdir(join(dataDir, 'shared'));
    await writeFile(join(dataDir, 'shared', 'rules.ts'), rulesRequiring('name'));
    await writeFile(
      join(dataDir, 'users.schema.ts'),
      `import { requiredField } from './shared/rules.ts';
export const schema = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (data) => (data[requiredField] ? { value: data } : { issues: [{ message: requiredField, path: [{ key: requiredField }] }] }),
  },
};
`,
    );
    await writeFile(join(dataDir, 'users.jsonl'), '{"id":1,"name":"Alice","email":"alice@example.com"}\n');
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  // Not run in this process: the module hook that finds the files a schema imports does not see imports made through the test runner
  async function changedAfterEach(edits: Array<{ file: string; content: string } | null>): Promise<boolean[]> {
    const script = join(dataDir, 'studio.mjs');
    await writeFile(
      script,
      `import { startStudioServer } from '${studioLibrary}';
import { writeFile } from 'node:fs/promises';
const studio = await startStudioServer({ dataDir: ${JSON.stringify(dataDir)}, port: 0 });
const response = await fetch(studio.url + '/api/events?token=' + studio.token);
const reader = response.body.getReader();
const decoder = new TextDecoder();
const changes = [];
// Kept across the waits below: a read given up on would still take the event that arrives after it
let pending;
for (const edit of ${JSON.stringify(edits)}) {
  let received = '';
  await new Promise((resolve) => setTimeout(resolve, 300));
  if (edit) await writeFile(edit.file, edit.content);
  const deadline = Date.now() + 3000;
  while (!received.includes('event: changed') && Date.now() < deadline) {
    pending ??= reader.read();
    const next = await Promise.race([pending, new Promise((resolve) => setTimeout(() => resolve(null), 500))]);
    if (next) {
      pending = undefined;
      if (!next.done) received += decoder.decode(next.value, { stream: true });
    }
  }
  changes.push(received.includes('event: changed'));
}
console.log(JSON.stringify(changes));
await studio.close();
process.exit(0);
`,
    );
    const { stdout } = await run(process.execPath, [script]);
    return JSON.parse(stdout.trim().split('\n').at(-1) as string) as boolean[];
  }

  const editRules = (field: string) => ({ file: join(dataDir, 'shared', 'rules.ts'), content: rulesRequiring(field) });

  it('tells the page once a file a schema imports is edited, though it is not in a watched directory', async () => {
    expect(await changedAfterEach([editRules('active')])).toEqual([true]);
  }, 15000);

  it('keeps telling the page after it reloaded for an edit', async () => {
    expect(await changedAfterEach([editRules('active'), editRules('email')])).toEqual([true, true]);
  }, 20000);

  it('refuses a save made after a file the edited table schema imports changed, as its primary key may be another column', async () => {
    await writeFile(join(dataDir, 'shared', 'rules.ts'), "export const key = 'id';\n");
    await writeFile(
      join(dataDir, 'users.schema.ts'),
      `import { key } from './shared/rules.ts';
export const schema = { primaryKey: key, '~standard': { version: 1, vendor: 'test', validate: (data) => ({ value: data }) } };
`,
    );
    await writeFile(
      join(dataDir, 'users.jsonl'),
      '{"id":1,"email":"a@example.com"}\n{"id":2,"email":"b@example.com"}\n',
    );
    const script = join(dataDir, 'save.mjs');
    await writeFile(
      script,
      `import { startStudioServer } from '${studioLibrary}';
import { readFile, writeFile } from 'node:fs/promises';
const studio = await startStudioServer({ dataDir: ${JSON.stringify(dataDir)}, port: 0 });
await writeFile(${JSON.stringify(join(dataDir, 'shared', 'rules.ts'))}, "export const key = 'email';\\n");
const response = await fetch(studio.url + '/api/tables/users/rows/' + encodeURIComponent(JSON.stringify(1)), {
  method: 'PATCH',
  headers: { Authorization: 'Bearer ' + studio.token, 'Content-Type': 'application/json' },
  body: JSON.stringify({ changes: { email: 'changed@example.com' } }),
});
const body = await response.json();
console.log(JSON.stringify({ status: response.status, message: body.message, file: await readFile(${JSON.stringify(join(dataDir, 'users.jsonl'))}, 'utf8') }));
await studio.close();
process.exit(0);
`,
    );
    const { stdout } = await run(process.execPath, [script]);
    const result = JSON.parse(stdout.trim().split('\n').at(-1) as string) as {
      status: number;
      message: string;
      file: string;
    };

    expect(result.status).toBe(409);
    expect(result.message).toContain('rules.ts');
    expect(result.file).toBe('{"id":1,"email":"a@example.com"}\n{"id":2,"email":"b@example.com"}\n');
  }, 15000);

  it('tells nothing while nothing is edited', async () => {
    expect(await changedAfterEach([null])).toEqual([false]);
  }, 15000);
});

describe('reading the tables again after a read that failed', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'lines-db-failed-'));
    await mkdir(join(dataDir, 'shared'));
    await writeFile(
      join(dataDir, 'users.schema.ts'),
      `import { requiredField } from './shared/rules.ts';
export const schema = { '~standard': { version: 1, vendor: 'test', validate: (data) => (data[requiredField] ? { value: data } : { issues: [{ message: 'missing', path: [{ key: requiredField }] }] }) } };
`,
    );
    await writeFile(join(dataDir, 'users.jsonl'), '{"id":1,"name":"Alice"}\n');
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('reads a file the schema imports once it is added, though the schema did not change', async () => {
    const script = join(dataDir, 'program.mjs');
    await writeFile(
      script,
      `import { LinesDB } from '${library}';
import { writeFile } from 'node:fs/promises';
const first = LinesDB.create({ dataDir: ${JSON.stringify(dataDir)} });
const failed = await first.initialize();
await writeFile(${JSON.stringify(join(dataDir, 'shared', 'rules.ts'))}, ${JSON.stringify(rulesRequiring('name'))});
const second = LinesDB.create({ dataDir: ${JSON.stringify(dataDir)} });
const retried = await second.initialize();
console.log(JSON.stringify({ failed: !failed.ok, retried: retried.ok }));
process.exit(0);
`,
    );
    const { stdout } = await run(process.execPath, [script]);

    expect(JSON.parse(stdout.trim().split('\n').at(-1) as string)).toEqual({ failed: true, retried: true });
  });
});

describe('edge cases of the versions of the files a schema imports', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lines-db-edges-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function runProgram<Result>(source: string): Promise<Result> {
    const script = join(dir, 'program.mjs');
    await writeFile(script, source);
    const { stdout } = await run(process.execPath, [script]);
    return JSON.parse(stdout.trim().split('\n').at(-1) as string) as Result;
  }

  it('notices an edit made to an imported file while the tables were being read', async () => {
    await mkdir(join(dir, 'shared'));
    await writeFile(
      join(dir, 'shared', 'rules.ts'),
      `import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
appendFileSync(fileURLToPath(import.meta.url), '// edited right after it was read\\n');
export const requiredField = 'name';
`,
    );
    await writeFile(
      join(dir, 'users.schema.ts'),
      `import { requiredField } from './shared/rules.ts';
export const schema = { '~standard': { version: 1, vendor: 'test', validate: (data) => (data[requiredField] ? { value: data } : { issues: [{ message: 'x', path: [{ key: requiredField }] }] }) } };
`,
    );
    await writeFile(join(dir, 'users.jsonl'), '{"id":1,"name":"Alice"}\n');

    const result = await runProgram<{ changed: boolean }>(`import { LinesDB } from '${library}';
const db = LinesDB.create({ dataDir: ${JSON.stringify(dir)} });
const loaded = await db.initialize();
if (!loaded.ok) throw loaded.error;
const checked = await db.hasExternalChanges();
if (!checked.ok) throw checked.error;
console.log(JSON.stringify({ changed: checked.value }));
await db.close();
`);

    expect(result.changed).toBe(true);
  });

  it('gives each file of a cycle the edits of the files it imports through the cycle', async () => {
    await writeFile(join(dir, 'c.mjs'), "export const c = 'c1';\n");
    await writeFile(
      join(dir, 'a.mjs'),
      "import { c } from './c.mjs';\nimport { b } from './b.mjs';\nexport const a = 'a:' + c;\nexport const fromB = () => b;\n",
    );
    await writeFile(join(dir, 'b.mjs'), "import { a } from './a.mjs';\nexport const b = () => 'b:' + a;\n");
    await writeFile(join(dir, 't.schema.mjs'), "import { a } from './a.mjs';\nexport const seen = a;\n");
    await writeFile(join(dir, 's.schema.mjs'), "import { b } from './b.mjs';\nexport const seen = b();\n");

    const result = await runProgram<{
      first: string[];
      edited: string[];
    }>(`import { createSchemaImports } from '${internalLibrary}';
import { writeFile } from 'node:fs/promises';
const read = async () => {
  const imports = createSchemaImports();
  const t = await imports.import(${JSON.stringify(join(dir, 't.schema.mjs'))});
  const s = await imports.import(${JSON.stringify(join(dir, 's.schema.mjs'))});
  return [t.seen, s.seen];
};
const first = await read();
await read();
await writeFile(${JSON.stringify(join(dir, 'c.mjs'))}, "export const c = 'c2';\\n");
const edited = await read();
console.log(JSON.stringify({ first, edited }));
`);

    expect(result.first).toEqual(['a:c1', 'b:a:c1']);
    expect(result.edited).toEqual(['a:c2', 'b:a:c2']);
  });

  it('keeps noticing an edit for a table that was not read again, when another table sharing the file was', async () => {
    await mkdir(join(dir, 'shared'));
    await writeFile(join(dir, 'shared', 'rules.ts'), rulesRequiring('name'));
    for (const table of ['users', 'posts']) {
      await writeFile(
        join(dir, `${table}.schema.ts`),
        `import { requiredField } from './shared/rules.ts';
export const schema = { '~standard': { version: 1, vendor: 'test', validate: (data) => (data[requiredField] ? { value: data } : { issues: [{ message: 'x', path: [{ key: requiredField }] }] }) } };
`,
      );
      await writeFile(join(dir, `${table}.jsonl`), '{"id":1,"name":"a"}\n');
    }

    const result = await runProgram<{ changed: boolean }>(`import { LinesDB } from '${library}';
import { writeFile } from 'node:fs/promises';
const db = LinesDB.create({ dataDir: ${JSON.stringify(dir)} });
const loaded = await db.initialize();
if (!loaded.ok) throw loaded.error;
await writeFile(${JSON.stringify(join(dir, 'shared', 'rules.ts'))}, ${JSON.stringify(rulesRequiring('email'))});
const again = await db.initialize({ tableName: 'users' });
if (!again.ok) throw again.error;
const checked = await db.hasExternalChanges();
if (!checked.ok) throw checked.error;
console.log(JSON.stringify({ changed: checked.value }));
await db.close();
`);

    expect(result.changed).toBe(true);
  });

  it('lists only the files the schema imports now, not the ones it imported before it was edited', async () => {
    await writeFile(join(dir, 'a.mjs'), "export const a = 'a';\n");
    await writeFile(join(dir, 'b.mjs'), "export const b = 'b';\n");
    await writeFile(
      join(dir, 't.schema.mjs'),
      "import { a } from './a.mjs';\nimport { b } from './b.mjs';\nexport const seen = a + b;\n",
    );

    const result = await runProgram<{
      before: string[];
      after: string[];
    }>(`import { createSchemaImports } from '${internalLibrary}';
import { writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
const names = (imports) => [...imports.dependencies().keys()].map((file) => basename(file)).sort();
const read = async () => {
  const imports = createSchemaImports();
  await imports.import(${JSON.stringify(join(dir, 't.schema.mjs'))});
  return imports;
};
const before = names(await read());
await writeFile(${JSON.stringify(join(dir, 't.schema.mjs'))}, "import { a } from './a.mjs';\\nexport const seen = a;\\n");
const after = names(await read());
console.log(JSON.stringify({ before, after }));
`);

    expect(result.before).toEqual(['a.mjs', 'b.mjs']);
    expect(result.after).toEqual(['a.mjs']);
  });

  it('lists no file once the schema stopped importing the last one it imported', async () => {
    await writeFile(join(dir, 'a.mjs'), "export const a = 'a';\n");
    await writeFile(join(dir, 't.schema.mjs'), "import { a } from './a.mjs';\nexport const seen = a;\n");

    const result = await runProgram<{
      before: string[];
      after: string[];
    }>(`import { createSchemaImports } from '${internalLibrary}';
import { writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
const names = (imports) => [...imports.dependencies().keys()].map((file) => basename(file)).sort();
const read = async () => {
  const imports = createSchemaImports();
  await imports.import(${JSON.stringify(join(dir, 't.schema.mjs'))});
  return imports;
};
const before = names(await read());
await writeFile(${JSON.stringify(join(dir, 't.schema.mjs'))}, "export const seen = 'none';\\n");
const after = names(await read());
console.log(JSON.stringify({ before, after }));
`);

    expect(result.before).toEqual(['a.mjs']);
    expect(result.after).toEqual([]);
  });

  it('keeps the files a table imports when reading all the tables stopped at another table that failed', async () => {
    const schema = (imports: string) =>
      `${imports}export const schema = { '~standard': { version: 1, vendor: 'test', validate: (data) => ({ value: data }) } };\n`;
    await writeFile(join(dir, 'a.schema.ts'), schema(''));
    await writeFile(join(dir, 'a.jsonl'), '{"id":1}\n');
    await writeFile(join(dir, 'b.schema.ts'), schema("import { rule } from './helper.ts';\n"));
    await writeFile(join(dir, 'b.jsonl'), '{"id":1}\n');
    await writeFile(join(dir, 'helper.ts'), "export const rule = 'x';\n");

    const result = await runProgram<{
      first: string[];
      afterFailure: string[];
      reported: string[];
    }>(`import { LinesDB } from '${library}';
import { writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
const names = (files) => files.map((file) => basename(file)).sort();
const db = LinesDB.create({ dataDir: ${JSON.stringify(dir)} });
const loaded = await db.initialize();
if (!loaded.ok) throw loaded.error;
const first = names(db.listSchemaDependencies());
await writeFile(${JSON.stringify(join(dir, 'a.schema.ts'))}, "throw new Error('broken');\\n");
await db.initialize();
const afterFailure = names(db.listSchemaDependencies());
await writeFile(${JSON.stringify(join(dir, 'helper.ts'))}, "export const rule = 'changed';\\n");
const found = await db.findExternalChanges();
if (!found.ok) throw found.error;
console.log(JSON.stringify({ first, afterFailure, reported: names(found.value) }));
await db.close();
`);

    expect(result.first).toEqual(['helper.ts']);
    expect(result.afterFailure).toEqual(['helper.ts']);
    expect(result.reported).toContain('helper.ts');
  });

  it('follows an import through a subpath import of the package', async () => {
    await mkdir(join(dir, 'shared'));
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ type: 'module', imports: { '#rules': './shared/rules.ts' } }),
    );
    await writeFile(join(dir, 'shared', 'rules.ts'), rulesRequiring('name'));
    await writeFile(
      join(dir, 'users.schema.ts'),
      `import { requiredField } from '#rules';
export const schema = { '~standard': { version: 1, vendor: 'test', validate: (data) => (data[requiredField] ? { value: data } : { issues: [{ message: 'x', path: [{ key: requiredField }] }] }) } };
`,
    );
    await writeFile(join(dir, 'users.jsonl'), '{"id":1,"name":"Alice","email":"alice@example.com"}\n');

    const result = await runProgram<{ before: boolean; after: boolean }>(`import { LinesDB } from '${library}';
import { writeFile } from 'node:fs/promises';
const open = async () => {
  const db = LinesDB.create({ dataDir: ${JSON.stringify(dir)} });
  const loaded = await db.initialize();
  if (!loaded.ok) throw loaded.error;
  return db;
};
const row = { id: 2, email: 'bob@example.com' };
const before = (await open()).validateRow('users', row).ok;
await writeFile(${JSON.stringify(join(dir, 'shared', 'rules.ts'))}, ${JSON.stringify(rulesRequiring('email'))});
const after = (await open()).validateRow('users', row).ok;
console.log(JSON.stringify({ before, after }));
process.exit(0);
`);

    expect(result).toEqual({ before: false, after: true });
  });
});
