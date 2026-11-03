import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LinesDB } from './database.js';
import { unwrap } from './result.js';
import type { TableDefs } from './types.js';

describe('LinesDB write of a value into a field no row holds a value in', () => {
  let dataDir: string;
  let db: LinesDB<TableDefs>;
  const file = () => join(dataDir, 'users.jsonl');

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'linesdb-untyped-'));
    await writeFile(
      file(),
      '{"id":1,"name":"a","active":null,"meta":null}\n{"id":2,"name":"b","active":null,"meta":null}\n',
    );
    db = LinesDB.create<TableDefs>({ dataDir });
    unwrap(await db.initialize());
  });

  afterEach(async () => {
    await db.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('writes a boolean back as a boolean', async () => {
    unwrap(await db.transaction((tx) => unwrap(tx.update('users', { active: true }, { id: 1 }))));

    expect(await readFile(file(), 'utf-8')).toBe(
      '{"id":1,"name":"a","active":true,"meta":null}\n{"id":2,"name":"b","active":null,"meta":null}\n',
    );
  });

  it('writes an object and an array back as they are, not as JSON text', async () => {
    unwrap(
      await db.transaction((tx) => {
        unwrap(tx.update('users', { meta: { a: 1 } }, { id: 1 }));
        unwrap(tx.update('users', { meta: ['x'] }, { id: 2 }));
      }),
    );

    expect(await readFile(file(), 'utf-8')).toBe(
      '{"id":1,"name":"a","active":null,"meta":{"a":1}}\n{"id":2,"name":"b","active":null,"meta":["x"]}\n',
    );
  });

  it('writes a boolean back as a boolean when it comes in with an inserted row', async () => {
    unwrap(await db.transaction((tx) => unwrap(tx.insert('users', { id: 3, name: 'c', active: false, meta: null }))));

    expect(await readFile(file(), 'utf-8')).toContain('{"id":3,"name":"c","active":false,"meta":null}');
  });
});
