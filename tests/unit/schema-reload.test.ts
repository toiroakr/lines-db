import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const library = pathToFileURL(fileURLToPath(new URL('../../lib/dist/index.mjs', import.meta.url))).href;

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
