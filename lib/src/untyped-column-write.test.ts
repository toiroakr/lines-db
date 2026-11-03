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

  it('keeps a string as a string after a rolled-back write of an object into the same field', async () => {
    const rolledBack = await db.transaction((tx) => {
      unwrap(tx.update('users', { meta: { a: 1 } }, { id: 1 }));
      throw new Error('abort');
    });
    expect(rolledBack.ok).toBe(false);

    unwrap(await db.transaction((tx) => unwrap(tx.update('users', { meta: '123' }, { id: 2 }))));

    expect(await readFile(file(), 'utf-8')).toContain('{"id":2,"name":"b","active":null,"meta":"123"}');
  });

  it('keeps a string as a string after an insert that failed with an object in the same field', async () => {
    const failed = await db.transaction((tx) => unwrap(tx.insert('users', { id: 1, name: 'dup', meta: { a: 1 } })));
    expect(failed.ok).toBe(false);

    unwrap(await db.transaction((tx) => unwrap(tx.update('users', { meta: 'true' }, { id: 1 }))));

    expect(await readFile(file(), 'utf-8')).toContain('"meta":"true"');
  });

  it('keeps a string as a string after an update that matched no row, with an object in the same field', async () => {
    unwrap(await db.transaction((tx) => unwrap(tx.update('users', { meta: { a: 1 } }, { id: 99 }))));

    unwrap(await db.transaction((tx) => unwrap(tx.update('users', { meta: '123' }, { id: 1 }))));

    expect(await readFile(file(), 'utf-8')).toContain('{"id":1,"name":"a","active":null,"meta":"123"}');
  });

  it('keeps a string already written as a string when an object is written into the same field later', async () => {
    unwrap(await db.transaction((tx) => unwrap(tx.update('users', { meta: '123' }, { id: 1 }))));
    unwrap(await db.transaction((tx) => unwrap(tx.update('users', { meta: { a: 1 } }, { id: 2 }))));

    expect(await readFile(file(), 'utf-8')).toBe(
      '{"id":1,"name":"a","active":null,"meta":"123"}\n{"id":2,"name":"b","active":null,"meta":"{\\"a\\":1}"}\n',
    );
  });

  it('writes a boolean back as a boolean when it comes in with an inserted row', async () => {
    unwrap(await db.transaction((tx) => unwrap(tx.insert('users', { id: 3, name: 'c', active: false, meta: null }))));

    expect(await readFile(file(), 'utf-8')).toContain('{"id":3,"name":"c","active":false,"meta":null}');
  });
});
