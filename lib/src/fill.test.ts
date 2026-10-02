import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fillFields } from './fill.js';
import { unwrap } from './result.js';
import type { RowFiller } from './fill.js';
import type { JsonObject } from './types.js';

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

  it('keeps the values of a line its filler changed in place, writing only the fields it fills', async () => {
    const jsonlPath = await writeTable('Widget', ['{"name":"a"}']);
    const mutating: RowFiller = (row) => {
      row.name = 'changed';
      return { id: 'generated', ...row };
    };

    unwrap(await fillFields({ path: dataDir, loadFiller: () => mutating }));

    expect(await readLines(jsonlPath)).toEqual(['{"id":"generated","name":"a"}', '']);
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

  it('writes nothing anywhere when the filler of one table cannot be built', async () => {
    const widgetPath = await writeTable('Widget', ['{"name":"widget"}']);
    const gadgetPath = await writeTable(
      'Gadget',
      ['{"name":"gadget"}'],
      HOOK_SCHEMA.replace('export const hook', 'const hook'),
    );
    const widgetBefore = await readFile(widgetPath, 'utf-8');

    const result = await fillFields({ path: dataDir, loadFiller: useHook });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.message).toMatch(/Gadget\.schema\.ts does not export `hook`/);
    expect(await readFile(widgetPath, 'utf-8')).toBe(widgetBefore);
    expect(await readFile(gadgetPath, 'utf-8')).toBe('{"name":"gadget"}\n');
  });

  it('writes nothing anywhere when a file changed on disk after it was read, naming the file', async () => {
    const gadgetPath = await writeTable('Gadget', ['{"name":"gadget"}']);
    const widgetPath = await writeTable('Widget', ['{"name":"widget"}']);
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

    const result = await fillFields({ path: dataDir, loadFiller });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatchObject({ name: 'JsonlConflictError', file: gadgetPath });
    expect(await readFile(gadgetPath, 'utf-8')).toBe(editedInEditor);
    expect(await readFile(widgetPath, 'utf-8')).toBe('{"name":"widget"}\n');
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

  it('refuses an empty list of fields', async () => {
    await writeTable('Widget', ['{"name":"first"}']);

    const result = await fillFields({ path: dataDir, fields: [], loadFiller: useHook });

    expect(result.ok).toBe(false);
  });
});
