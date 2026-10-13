import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fillFields } from './fill.js';
import { unwrap } from './result.js';
import type { RowFiller } from './fill.js';
import type { JsonObject } from './types.js';

/** The file a rename onto fails, standing in for a disk that fails partway through the fill */
const failing = vi.hoisted(() => ({
  renameTo: undefined as string | undefined,
  writeTo: undefined as string | undefined,
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rename: (from: string, to: string) =>
      to === failing.renameTo ? Promise.reject(new Error('EIO: i/o error')) : actual.rename(from, to),
    writeFile: ((path: string, ...rest: unknown[]) =>
      path === failing.writeTo
        ? Promise.reject(new Error('EACCES: permission denied'))
        : (actual.writeFile as (...args: unknown[]) => Promise<void>)(path, ...rest)) as typeof actual.writeFile,
  };
});

/**
 * A table whose create-time behavior gives a row an `id` and timestamps, exported as `hook` the way a
 * generated seed schema does, while its validation schema requires `name`
 */
const HOOK_SCHEMA = `let counter = 0;
export const hook = (row) => ({
  id: 'generated-' + ++counter,
  ...row,
  profile: { nickname: row.profile?.nickname },
  createdAt: row.createdAt ?? '2026-01-01T00:00:00.000Z',
  updatedAt: null,
});
export const schema = { '~standard': { version: 1, vendor: 'test', validate: (data) =>
  typeof data.name === 'string' ? { value: hook(data) } : { issues: [{ message: 'Name is required' }] } } };
`;

const useHook = (schemaModule: Record<string, unknown>, { schemaPath }: { schemaPath: string }): RowFiller => {
  if (typeof schemaModule.hook !== 'function') throw new Error(`${schemaPath} does not export \`hook\``);
  return schemaModule.hook as RowFiller;
};

describe('fillFields', () => {
  let dataDir: string;

  const writeTable = async (table: string, lines: string[], schema = HOOK_SCHEMA): Promise<string> => {
    const jsonlPath = join(dataDir, `${table}.jsonl`);
    await writeFile(join(dataDir, `${table}.schema.ts`), schema);
    await writeFile(jsonlPath, lines.length > 0 ? `${lines.join('\n')}\n` : '');
    return jsonlPath;
  };
  const moveToDataset = async (file: string): Promise<string> => {
    const dir = join(dataDir, 'dataset');
    await mkdir(dir);
    const destination = join(dir, basename(file));
    await rename(file, destination);
    return destination;
  };
  const readLines = async (jsonlPath: string) => (await readFile(jsonlPath, 'utf-8')).split('\n');

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'linesdb-fill-'));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('fills each table primary key into the rows that lack it when no fields are named', async () => {
    const jsonlPath = await writeTable('Widget', ['{"name":"second"}', '{"name":"first","note":"kept"}']);

    const result = unwrap(await fillFields({ path: dataDir, loadFiller: useHook }));

    expect(result.filled).toEqual([{ table: 'Widget', file: jsonlPath, fields: ['id'], count: 2 }]);
    expect(await readLines(jsonlPath)).toEqual([
      '{"id":"generated-1","name":"second"}',
      '{"id":"generated-2","name":"first","note":"kept"}',
      '',
    ]);
  });

  it('fills multiple directories against shared schemas in one call', async () => {
    const first = join(dataDir, 'first');
    const second = join(dataDir, 'second');
    await mkdir(first);
    await mkdir(second);
    await writeFile(join(dataDir, 'Widget.schema.ts'), HOOK_SCHEMA);
    const files = [join(first, 'Widget.jsonl'), join(second, 'Widget.jsonl')];
    for (const file of files) await writeFile(file, '{"name":"widget"}\n');

    const result = await fillFields({ path: [first, second] as const, schemaDir: dataDir, loadFiller: useHook });

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.filled).toEqual(
      files.map((file) => ({ table: 'Widget', file, fields: ['id'], count: 1 })),
    );
    for (const file of files) {
      expect(JSON.parse((await readLines(file))[0])).toMatchObject({ name: 'widget', id: expect.any(String) });
    }
  });

  it('keeps the values of a line its filler changed in place, writing only the fields it fills', async () => {
    const jsonlPath = await writeTable('Widget', ['{"name":"a"}']);
    const mutating: RowFiller = (row) => {
      row.name = 'changed';
      return { id: 'generated', ...row };
    };

    unwrap(await fillFields({ path: dataDir, loadFiller: () => mutating }));

    expect(await readLines(jsonlPath)).toEqual(['{"id":"generated","name":"a"}', '']);
  });

  it('fills the first row of a file starting with a byte order mark, and keeps the mark', async () => {
    const jsonlPath = join(dataDir, 'Widget.jsonl');
    await writeFile(join(dataDir, 'Widget.schema.ts'), HOOK_SCHEMA);
    await writeFile(jsonlPath, '\u{feff}{"name":"a"}\n');

    unwrap(await fillFields({ path: dataDir, loadFiller: useHook }));

    expect(await readFile(jsonlPath, 'utf-8')).toBe('\u{feff}{"id":"generated-1","name":"a"}\n');
  });

  it.each([false, true])(
    'restores earlier files after a replacement fails (multiple directories: %s)',
    async (multiple) => {
      const first = await writeTable('Alpha', ['{"name":"a"}']);
      const original = await writeTable('Beta', ['{"name":"b"}']);
      const second = multiple ? await moveToDataset(original) : original;
      failing.renameTo = second;
      try {
        const result = await fillFields({
          path: multiple ? [dataDir, join(dataDir, 'dataset')] : dataDir,
          schemaDir: dataDir,
          loadFiller: useHook,
        });

        expect(result.ok).toBe(false);
      } finally {
        failing.renameTo = undefined;
      }
      expect(await readLines(first)).toEqual(['{"name":"a"}', '']);
      expect(await readLines(second)).toEqual(['{"name":"b"}', '']);
      expect((await readdir(dataDir)).filter((entry) => entry.endsWith('.tmp'))).toEqual([]);
    },
  );

  it('names a file it could not put back after a later replacement failed', async () => {
    const first = await writeTable('Alpha', ['{"name":"a"}']);
    const second = await writeTable('Beta', ['{"name":"b"}']);
    failing.renameTo = second;
    failing.writeTo = first;
    try {
      const result = await fillFields({ path: dataDir, loadFiller: useHook });

      expect(!result.ok && result.error.message).toContain(first);
      expect(!result.ok && (result.error.cause as Error).message).toBe('EIO: i/o error');
    } finally {
      failing.renameTo = undefined;
      failing.writeTo = undefined;
    }
  });

  // Not run on Windows: it has no POSIX file modes
  it.skipIf(process.platform === 'win32')('keeps the permissions of a file it fills', async () => {
    const jsonlPath = await writeTable('Widget', ['{"name":"a"}']);
    await chmod(jsonlPath, 0o600);

    unwrap(await fillFields({ path: dataDir, loadFiller: useHook }));

    expect((await stat(jsonlPath)).mode & 0o777).toBe(0o600);
  });

  it('fills the named fields, leaving a value the row already has alone', async () => {
    const jsonlPath = await writeTable('Widget', [
      '{"name":"dated","createdAt":"2020-01-02T03:04:05.000Z"}',
      '{"name":"undated"}',
    ]);

    const result = unwrap(await fillFields({ path: dataDir, fields: ['id', 'createdAt'], loadFiller: useHook }));

    expect(result.filled).toEqual([{ table: 'Widget', file: jsonlPath, fields: ['id', 'createdAt'], count: 2 }]);
    expect(await readLines(jsonlPath)).toEqual([
      '{"id":"generated-1","name":"dated","createdAt":"2020-01-02T03:04:05.000Z"}',
      '{"id":"generated-2","name":"undated","createdAt":"2026-01-01T00:00:00.000Z"}',
      '',
    ]);
  });

  it('leaves a file that is missing none of the fields untouched', async () => {
    const jsonlPath = await writeTable('Widget', ['{"id":"kept","name":"first"}']);
    const before = await readFile(jsonlPath, 'utf-8');

    const result = unwrap(await fillFields({ path: dataDir, loadFiller: useHook }));

    expect(result.filled).toEqual([]);
    expect(await readFile(jsonlPath, 'utf-8')).toBe(before);
  });

  it('reports a named field no table produces a value for', async () => {
    await writeTable('Widget', ['{"name":"first"}']);

    const result = unwrap(await fillFields({ path: dataDir, fields: ['nope'], loadFiller: useHook }));

    expect(result.filled).toEqual([]);
    expect(result.unproducedFields).toEqual(['nope']);
  });

  it('fills a row its table would reject, as the values are computed without validating', async () => {
    const jsonlPath = await writeTable('Widget', ['{"name":42}', '{"note":"no name yet"}']);

    unwrap(await fillFields({ path: dataDir, loadFiller: useHook }));

    expect(await readLines(jsonlPath)).toEqual([
      '{"id":"generated-1","name":42}',
      '{"id":"generated-2","note":"no name yet"}',
      '',
    ]);
  });

  it('leaves a line that gains nothing byte for byte, line separator included', async () => {
    const jsonlPath = join(dataDir, 'Widget.jsonl');
    await writeFile(join(dataDir, 'Widget.schema.ts'), HOOK_SCHEMA);
    await writeFile(jsonlPath, '{ "id":"kept",  "name":"spaced" }\r\n{"name":"gains an id"}\r\n');

    unwrap(await fillFields({ path: dataDir, loadFiller: useHook }));

    expect(await readFile(jsonlPath, 'utf-8')).toBe(
      '{ "id":"kept",  "name":"spaced" }\r\n{"id":"generated-2","name":"gains an id"}\r\n',
    );
  });

  it('reports the lines that are not JSON objects and leaves them as they were', async () => {
    const jsonlPath = await writeTable('Widget', ['{"name":"first"', '{"name":"second"}', '["not an object"]']);

    const result = unwrap(await fillFields({ path: dataDir, loadFiller: useHook }));

    expect(result.unreadableLines).toEqual([{ file: jsonlPath, lines: [1, 3] }]);
    expect(result.filled).toEqual([{ table: 'Widget', file: jsonlPath, fields: ['id'], count: 1 }]);
    const lines = await readLines(jsonlPath);
    expect(lines[0]).toBe('{"name":"first"');
    expect(lines[2]).toBe('["not an object"]');
  });

  it('keeps an undeclared key named after an Object member', async () => {
    const jsonlPath = await writeTable('Widget', ['{"name":"first","toString":"kept","__proto__":"kept"}']);

    unwrap(await fillFields({ path: dataDir, loadFiller: useHook }));

    expect(Object.keys(JSON.parse((await readLines(jsonlPath))[0]))).toEqual(['id', 'name', 'toString', '__proto__']);
  });

  it.each([false, true])(
    'writes nothing when a filler cannot be built (multiple directories: %s)',
    async (multiple) => {
      const widgetPath = await writeTable('Widget', ['{"name":"widget"}']);
      const gadgetPath = await writeTable(
        'Gadget',
        ['{"name":"gadget"}'],
        HOOK_SCHEMA.replace('export const hook', 'const hook'),
      );
      const target = multiple ? await moveToDataset(gadgetPath) : gadgetPath;
      const widgetBefore = await readFile(widgetPath, 'utf-8');

      const result = await fillFields({
        path: multiple ? [dataDir, join(dataDir, 'dataset')] : dataDir,
        schemaDir: dataDir,
        loadFiller: useHook,
      });

      expect(result.ok).toBe(false);
      expect(!result.ok && result.error.message).toMatch(/Gadget\.schema\.ts does not export `hook`/);
      expect(await readFile(widgetPath, 'utf-8')).toBe(widgetBefore);
      expect(await readFile(target, 'utf-8')).toBe('{"name":"gadget"}\n');
    },
  );

  it.each([false, true])('writes nothing after an outside change (multiple directories: %s)', async (multiple) => {
    const gadgetPath = await writeTable('Gadget', ['{"name":"gadget"}']);
    const widgetPath = await writeTable('Widget', ['{"name":"widget"}']);
    const target = multiple ? await moveToDataset(widgetPath) : widgetPath;
    const editedInEditor = '{"name":"gadget","note":"saved in an editor"}\n';
    const loadFiller = (schemaModule: Record<string, unknown>, context: { tableName: string; schemaPath: string }) => {
      const hook = useHook(schemaModule, context);
      // Gadget is read before Widget, so this edit lands after Gadget was read and before any write
      return context.tableName === 'Widget'
        ? (row: JsonObject) => {
            writeFileSync(gadgetPath, editedInEditor);
            return hook(row);
          }
        : hook;
    };

    const result = await fillFields({
      path: multiple ? [dataDir, join(dataDir, 'dataset')] : dataDir,
      schemaDir: dataDir,
      loadFiller,
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatchObject({ name: 'JsonlConflictError', file: gadgetPath });
    expect(await readFile(gadgetPath, 'utf-8')).toBe(editedInEditor);
    expect(await readFile(target, 'utf-8')).toBe('{"name":"widget"}\n');
  });

  it('leaves an empty object the line holds as it is, as it is a value the file already has', async () => {
    const jsonlPath = await writeTable('Widget', ['{"id":"kept","profile":{}}']);
    const before = await readFile(jsonlPath, 'utf-8');

    const result = unwrap(
      await fillFields({
        path: dataDir,
        fields: ['profile'],
        loadFiller: () => (row) => ({ ...row, profile: { nickname: 'n' } }),
      }),
    );

    expect(result.filled).toEqual([]);
    expect(await readFile(jsonlPath, 'utf-8')).toBe(before);
  });

  it('does not write an empty object for a nested field the row never had', async () => {
    const jsonlPath = await writeTable('Widget', ['{"name":"first"}']);

    const result = unwrap(await fillFields({ path: dataDir, fields: ['id', 'profile'], loadFiller: useHook }));

    expect(result.filled).toEqual([{ table: 'Widget', file: jsonlPath, fields: ['id'], count: 1 }]);
    expect(result.unproducedFields).toEqual(['profile']);
    expect(await readLines(jsonlPath)).toEqual(['{"id":"generated-1","name":"first"}', '']);
  });

  it('fills only the named file when given a .jsonl path', async () => {
    const widgetPath = await writeTable('Widget', ['{"name":"widget"}']);
    const gadgetPath = await writeTable('Gadget', ['{"name":"gadget"}']);

    const result = unwrap(await fillFields({ path: widgetPath, loadFiller: useHook }));

    expect(result.filled.map(({ table }) => table)).toEqual(['Widget']);
    expect(await readFile(gadgetPath, 'utf-8')).toBe('{"name":"gadget"}\n');
  });

  it('reports a table without a schema file, as nothing can compute its values', async () => {
    await writeFile(join(dataDir, 'Loose.jsonl'), '{"name":"loose"}\n');

    const result = unwrap(await fillFields({ path: dataDir, fields: ['id'], loadFiller: useHook }));

    expect(result.tablesWithoutSchema).toEqual(['Loose']);
  });

  it('reports a named field as unproduced when no table has a schema file to produce it', async () => {
    await writeFile(join(dataDir, 'Loose.jsonl'), '{"name":"loose"}\n');

    const result = unwrap(await fillFields({ path: dataDir, fields: ['id'], loadFiller: useHook }));

    expect(result.unproducedFields).toEqual(['id']);
  });

  it('computes the values with the table validation schema when no filler is given, leaving a rejected row as it was', async () => {
    const jsonlPath = await writeTable('Widget', ['{"name":"first"}', '{"note":"no name yet"}']);

    unwrap(await fillFields({ path: dataDir, fields: ['id'] }));

    expect(await readLines(jsonlPath)).toEqual(['{"id":"generated-1","name":"first"}', '{"note":"no name yet"}', '']);
  });

  it('fills an overlapping directory and file only once', async () => {
    const file = await writeTable('Widget', ['{"name":"widget"}']);
    let calls = 0;

    const result = unwrap(
      await fillFields({
        path: [dataDir, file, join(dataDir, '.')],
        loadFiller: () => (row) => ({ id: `generated-${++calls}`, ...row }),
      }),
    );

    expect(calls).toBe(1);
    expect(result.filled).toEqual([{ table: 'Widget', file, fields: ['id'], count: 1 }]);
    expect(await readFile(file, 'utf-8')).toBe('{"id":"generated-1","name":"widget"}\n');
  });

  it('writes nothing in earlier directories when a later filler throws', async () => {
    const first = await writeTable('Alpha', ['{"name":"a"}']);
    const second = await moveToDataset(await writeTable('Beta', ['{"name":"b"}']));

    const result = await fillFields({
      path: [dataDir, join(dataDir, 'dataset')],
      schemaDir: dataDir,
      loadFiller:
        (_, { tableName }) =>
        (row) => {
          if (tableName === 'Beta') throw new Error('Cannot compute Beta');
          return { id: 'filled', ...row };
        },
    });

    expect(!result.ok && result.error.message).toBe('Cannot compute Beta');
    expect(await readFile(first, 'utf-8')).toBe('{"name":"a"}\n');
    expect(await readFile(second, 'utf-8')).toBe('{"name":"b"}\n');
  });

  it('finds schemas next to each file when no shared schema directory is given', async () => {
    const first = await writeTable('Alpha', ['{"name":"a"}']);
    const second = await moveToDataset(await writeTable('Beta', ['{"name":"b"}']));
    await writeFile(join(dataDir, 'dataset', 'Beta.schema.ts'), HOOK_SCHEMA);

    const result = unwrap(await fillFields({ path: [first, second], loadFiller: useHook }));

    expect(result.filled.map(({ file }) => file)).toEqual([first, second]);
    expect(result.tablesWithoutSchema).toEqual([]);
  });

  it('refuses an empty list of paths', async () => {
    const result = await fillFields({ path: [] });

    expect(!result.ok && result.error.message).toBe('No paths to fill. Name at least one path.');
  });

  it('refuses an empty list of fields', async () => {
    await writeTable('Widget', ['{"name":"first"}']);

    const result = await fillFields({ path: dataDir, fields: [], loadFiller: useHook });

    expect(result.ok).toBe(false);
  });
});
