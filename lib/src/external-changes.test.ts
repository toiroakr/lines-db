import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LinesDB } from './database.js';
import { unwrap } from './result.js';
import type { TableDefs } from './types.js';

const ACCEPT_ALL_SCHEMA = `export const schema = { '~standard': { version: 1, vendor: 'test', validate: (data) => ({ value: data }) } };\n`;

const NAME_REQUIRED_SCHEMA = `export const schema = { '~standard': { version: 1, vendor: 'test', validate: (data) =>
  data.name ? { value: data } : { issues: [{ message: 'Name is required', path: [{ key: 'name' }] }] } } };
`;

describe('LinesDB.hasExternalChanges', () => {
  let dataDir: string;
  let db: LinesDB<TableDefs>;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'linesdb-external-'));
    await writeFile(join(dataDir, 'users.jsonl'), '{"id":1,"name":"Alice"}\n');
    await writeFile(join(dataDir, 'users.schema.ts'), ACCEPT_ALL_SCHEMA);
    await writeFile(join(dataDir, 'tags.jsonl'), '{"id":1,"label":"a"}\n');
    db = LinesDB.create<TableDefs>({ dataDir });
    unwrap(await db.initialize());
  });

  afterEach(async () => {
    await db.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('reports no change right after the files were read', async () => {
    expect(unwrap(await db.hasExternalChanges())).toBe(false);
  });

  it('reports a change once a JSONL file is edited', async () => {
    await writeFile(join(dataDir, 'users.jsonl'), '{"id":1,"name":"Bob"}\n');

    expect(unwrap(await db.hasExternalChanges())).toBe(true);
  });

  it('reports no change after its own write, as only an outside edit counts', async () => {
    unwrap(await db.transaction((tx) => unwrap(tx.update('users', { name: 'Bob' }, { id: 1 }))));

    expect(unwrap(await db.hasExternalChanges())).toBe(false);
  });

  it('reports a change once a JSONL file is removed', async () => {
    await unlink(join(dataDir, 'tags.jsonl'));

    expect(unwrap(await db.hasExternalChanges())).toBe(true);
  });

  it('reports a change once a JSONL file is added, as it is a table the database lacks', async () => {
    await writeFile(join(dataDir, 'notes.jsonl'), '{"id":1}\n');

    expect(unwrap(await db.hasExternalChanges())).toBe(true);
  });

  it('reports a change once the file of a table left out on load is edited, so the fixed rows can be loaded', async () => {
    await db.close();
    await writeFile(join(dataDir, 'members.schema.ts'), NAME_REQUIRED_SCHEMA);
    await writeFile(join(dataDir, 'members.jsonl'), '{"id":1,"name":""}\n');
    db = LinesDB.create<TableDefs>({ dataDir });
    expect(unwrap(await db.initialize()).valid).toBe(false);
    await writeFile(join(dataDir, 'members.jsonl'), '{"id":1,"name":"Alice"}\n');

    expect(unwrap(await db.hasExternalChanges())).toBe(true);
  });

  it('reports a change once a schema file is edited, as it may validate the rows differently', async () => {
    await writeFile(join(dataDir, 'users.schema.ts'), `${ACCEPT_ALL_SCHEMA}export const primaryKey = 'name';\n`);

    expect(unwrap(await db.hasExternalChanges())).toBe(true);
  });

  it('reports a change once a schema file is added for a table that had none', async () => {
    await writeFile(join(dataDir, 'tags.schema.ts'), ACCEPT_ALL_SCHEMA);

    expect(unwrap(await db.hasExternalChanges())).toBe(true);
  });

  it('reports a change once a schema file is removed', async () => {
    await unlink(join(dataDir, 'users.schema.ts'));

    expect(unwrap(await db.hasExternalChanges())).toBe(true);
  });

  it('lists the files that changed, so a caller can tell which table an outside edit touched', async () => {
    await writeFile(join(dataDir, 'tags.jsonl'), '{"id":1,"label":"b"}\n');
    await writeFile(join(dataDir, 'notes.jsonl'), '{"id":1}\n');

    expect(unwrap(await db.findExternalChanges()).sort()).toEqual(
      [join(dataDir, 'notes.jsonl'), join(dataDir, 'tags.jsonl')].sort(),
    );
  });
});
