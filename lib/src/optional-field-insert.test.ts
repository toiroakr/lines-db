import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LinesDB } from './database.js';
import { unwrap } from './result.js';
import type { TableDefs } from './types.js';

const ANY_ROW_SCHEMA = `export const schema = { '~standard': { version: 1, vendor: 'test', validate: (data) => ({ value: data }) } };\n`;

const NICK_REQUIRED_SCHEMA = `export const schema = { '~standard': { version: 1, vendor: 'test', validate: (data) =>
  data.nick === undefined ? { issues: [{ message: 'nick is required', path: ['nick'] }] } : { value: data } } };\n`;

describe('LinesDB insert of a row that leaves out a field every existing row holds', () => {
  let dataDir: string;
  let db: LinesDB<TableDefs> | undefined;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'linesdb-optional-field-'));
    await writeFile(
      join(dataDir, 'people.jsonl'),
      '{"id":1,"name":"Alice","nick":"al"}\n{"id":2,"name":"Bob","nick":"bo"}\n',
    );
  });

  afterEach(async () => {
    await db?.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  async function open(schema: string) {
    await writeFile(join(dataDir, 'people.schema.ts'), schema);
    db = LinesDB.create<TableDefs>({ dataDir });
    unwrap(await db.initialize());
  }

  it('stores the row when the schema accepts it without the field', async () => {
    await open(ANY_ROW_SCHEMA);

    unwrap(await db!.transaction((tx) => unwrap(tx.insert('people', { id: 3, name: 'Carol' }))));

    expect(unwrap(db!.findOne('people', { id: 3 }))).toMatchObject({ id: 3, name: 'Carol', nick: null });
    expect(await readFile(join(dataDir, 'people.jsonl'), 'utf-8')).toContain('{"id":3,"name":"Carol","nick":null}');
  });

  it('refuses the row when the schema requires the field', async () => {
    await open(NICK_REQUIRED_SCHEMA);

    const result = await db!.transaction((tx) => unwrap(tx.insert('people', { id: 3, name: 'Carol' })));

    expect(result.ok).toBe(false);
    expect(String(!result.ok && result.error)).toContain('nick is required');
    expect(unwrap(db!.findOne('people', { id: 3 }))).toBeNull();
  });
});
