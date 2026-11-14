import { describe, it, expect } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LinesDB } from './database.js';
import { unwrap } from './result.js';
import type { TableDefs } from './types.js';

const PREFIX_SCHEMA = `export const schema = { '~standard': { version: 1, vendor: 'test', validate: (data) =>
  ({ value: { ...data, code: 'ORD-' + data.code } }) } };
`;

const PREFIX_SCHEMA_WITH_KEY = `export const schema = { primaryKey: 'id', '~standard': { version: 1, vendor: 'test', validate: (data) =>
  ({ value: { ...data, code: 'ORD-' + data.code } }) } };
`;

/** A small generator with a fixed seed, so a failing sequence can be run again */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

interface Note {
  code: string;
  note: string;
}

// An empty table is written as a single newline, as JsonlWriter does for no rows
const serialize = (notes: Note[]) =>
  notes.length === 0 ? '\n' : notes.map((row) => `${JSON.stringify(row)}\n`).join('');

describe('LinesDB line positions of a table without a primary key', () => {
  it.each(Array.from({ length: 40 }, (_, seed) => seed))(
    'keeps every line as written through a random run of adds, deletes, updates and rollbacks (seed %i)',
    async (seed) => {
      const next = random(seed + 1);
      const dataDir = await mkdtemp(join(tmpdir(), 'linesdb-positions-'));
      let counter = 0;
      const fresh = () => `n${counter++}`;
      let model: Note[] = [
        { code: 'a', note: fresh() },
        { code: 'b', note: fresh() },
        { code: 'c', note: fresh() },
      ];
      await writeFile(join(dataDir, 'notes.jsonl'), serialize(model));
      await writeFile(join(dataDir, 'notes.schema.ts'), PREFIX_SCHEMA);
      let db = LinesDB.create<TableDefs>({ dataDir, writeFilledValues: 'primaryKey' });
      unwrap(await db.initialize());
      const trail: string[] = [];

      try {
        for (let step = 0; step < 8; step++) {
          const pick = model.length > 0 ? model[Math.floor(next() * model.length)] : undefined;
          const operation = Math.floor(next() * 6);
          if (operation === 0 || !pick) {
            const row = { code: `c${counter}`, note: fresh() };
            trail.push(`insert ${row.note}`);
            unwrap(await db.transaction((tx) => unwrap(tx.insert('notes', row))));
            model = [...model, row];
          } else if (operation === 1) {
            trail.push(`delete ${pick.note}`);
            unwrap(await db.transaction((tx) => unwrap(tx.delete('notes', { note: pick.note }))));
            model = model.filter((row) => row !== pick);
          } else if (operation === 2) {
            const note = fresh();
            trail.push(`update ${pick.note} -> ${note}`);
            unwrap(await db.transaction((tx) => unwrap(tx.update('notes', { note }, { note: pick.note }))));
            model = model.map((row) => (row === pick ? { ...row, note } : row));
          } else if (operation === 3) {
            trail.push(`rolled back insert`);
            await db.transaction((tx) => {
              unwrap(tx.insert('notes', { code: 'gone', note: fresh() }));
              throw new Error('stop');
            });
          } else if (operation === 4) {
            trail.push(`rolled back delete ${pick.note}`);
            await db.transaction((tx) => {
              unwrap(tx.delete('notes', { note: pick.note }));
              throw new Error('stop');
            });
          } else {
            trail.push(`delete ${pick.note} then insert in one transaction`);
            const row = { code: `c${counter}`, note: fresh() };
            unwrap(
              await db.transaction((tx) => {
                unwrap(tx.delete('notes', { note: pick.note }));
                unwrap(tx.insert('notes', row));
              }),
            );
            model = [...model.filter((candidate) => candidate !== pick), row];
          }

          expect(await readFile(join(dataDir, 'notes.jsonl'), 'utf-8'), trail.join('; ')).toBe(serialize(model));
        }

        await db.close();
        db = LinesDB.create<TableDefs>({ dataDir, writeFilledValues: 'primaryKey' });
        unwrap(await db.initialize());
        expect(
          unwrap(db.find('notes')).map(({ code, note }) => ({ code, note })),
          trail.join('; '),
        ).toEqual(model.map((row) => ({ code: `ORD-${row.code}`, note: row.note })));
      } finally {
        await db.close();
        await rm(dataDir, { recursive: true, force: true });
      }
    },
  );
});

interface Order {
  id: number;
  code: string;
  note: string;
}

const serializeOrders = (orders: Order[]) =>
  orders.length === 0 ? '\n' : orders.map((row) => `${JSON.stringify(row)}\n`).join('');

describe('LinesDB line positions of a table with a primary key the user can change', () => {
  it.each(Array.from({ length: 40 }, (_, seed) => seed))(
    'keeps every line as written through a random run of adds, deletes, updates, key changes and rollbacks (seed %i)',
    async (seed) => {
      const next = random(seed + 101);
      const dataDir = await mkdtemp(join(tmpdir(), 'linesdb-positions-pk-'));
      let counter = 0;
      let nextId = 10;
      const fresh = () => `n${counter++}`;
      let model: Order[] = [
        { id: 1, code: 'a', note: fresh() },
        { id: 2, code: 'b', note: fresh() },
        { id: 3, code: 'c', note: fresh() },
      ];
      await writeFile(join(dataDir, 'orders.jsonl'), serializeOrders(model));
      await writeFile(join(dataDir, 'orders.schema.ts'), PREFIX_SCHEMA_WITH_KEY);
      let db = LinesDB.create<TableDefs>({ dataDir, writeFilledValues: 'primaryKey' });
      unwrap(await db.initialize());
      const trail: string[] = [];

      try {
        for (let step = 0; step < 8; step++) {
          const pick = model.length > 0 ? model[Math.floor(next() * model.length)] : undefined;
          const operation = Math.floor(next() * 6);
          if (operation === 0 || !pick) {
            const row = { id: nextId++, code: `c${counter}`, note: fresh() };
            trail.push(`insert ${row.id}`);
            unwrap(await db.transaction((tx) => unwrap(tx.insert('orders', row))));
            model = [...model, row];
          } else if (operation === 1) {
            trail.push(`delete ${pick.id}`);
            unwrap(await db.transaction((tx) => unwrap(tx.delete('orders', { id: pick.id }))));
            model = model.filter((row) => row !== pick);
          } else if (operation === 2) {
            const note = fresh();
            trail.push(`update note of ${pick.id}`);
            unwrap(await db.transaction((tx) => unwrap(tx.update('orders', { note }, { id: pick.id }))));
            model = model.map((row) => (row === pick ? { ...row, note } : row));
          } else if (operation === 3) {
            const id = nextId++;
            trail.push(`change key ${pick.id} -> ${id}`);
            unwrap(await db.transaction((tx) => unwrap(tx.update('orders', { id }, { id: pick.id }))));
            model = model.map((row) => (row === pick ? { ...row, id } : row));
          } else if (operation === 4) {
            trail.push(`rolled back delete ${pick.id}`);
            await db.transaction((tx) => {
              unwrap(tx.delete('orders', { id: pick.id }));
              throw new Error('stop');
            });
          } else {
            const id = nextId++;
            trail.push(`change key ${pick.id} -> ${id} and add a row in one transaction`);
            const row = { id: nextId++, code: `c${counter}`, note: fresh() };
            unwrap(
              await db.transaction((tx) => {
                unwrap(tx.update('orders', { id }, { id: pick.id }));
                unwrap(tx.insert('orders', row));
              }),
            );
            model = [...model.map((candidate) => (candidate === pick ? { ...candidate, id } : candidate)), row];
          }

          expect(await readFile(join(dataDir, 'orders.jsonl'), 'utf-8'), trail.join('; ')).toBe(serializeOrders(model));
        }
      } finally {
        await db.close();
        await rm(dataDir, { recursive: true, force: true });
      }
    },
  );
});

describe('LinesDB line positions of a table read from two data directories', () => {
  it.each(Array.from({ length: 30 }, (_, seed) => seed))(
    'keeps each line in its own file through a random run of edits, key changes, adds, deletes and rollbacks (seed %i)',
    async (seed) => {
      const next = random(seed + 201);
      const root = await mkdtemp(join(tmpdir(), 'linesdb-positions-sets-'));
      const local = join(root, 'local');
      await mkdir(local);
      let counter = 0;
      let nextId = 10;
      const fresh = () => `n${counter++}`;
      type Row = { id: number; name: string; dir: 'base' | 'local' };
      let model: Row[] = [
        { id: 5, name: fresh(), dir: 'base' },
        { id: 1, name: fresh(), dir: 'base' },
        { id: 2, name: fresh(), dir: 'local' },
      ];
      const fileOf = (dir: Row['dir']) => join(dir === 'base' ? root : local, 'users.jsonl');
      const expected = (dir: Row['dir']) => {
        const rows = model.filter((row) => row.dir === dir);
        return rows.length === 0 ? '\n' : rows.map(({ id, name }) => `${JSON.stringify({ id, name })}\n`).join('');
      };
      await writeFile(fileOf('base'), expected('base'));
      await writeFile(fileOf('local'), expected('local'));
      await writeFile(
        join(root, 'users.schema.ts'),
        `export const schema = { primaryKey: 'id', '~standard': { version: 1, vendor: 'test', validate: (data) => ({ value: data }) } };\n`,
      );
      const db = LinesDB.create<TableDefs>({
        dataDir: [root, local],
        schemaDir: root,
        writeDataSets: true,
        writeFilledValues: 'primaryKey',
      });
      unwrap(await db.initialize());
      const trail: string[] = [];
      try {
        for (let step = 0; step < 8; step++) {
          const pick = model.length > 0 ? model[Math.floor(next() * model.length)] : undefined;
          const operation = Math.floor(next() * 5);
          if (operation === 0 || !pick) {
            const dir: Row['dir'] = next() < 0.5 ? 'base' : 'local';
            const row = { id: nextId++, name: fresh(), dir };
            trail.push(`insert ${row.id} into ${dir}`);
            unwrap(
              await db.transaction((tx) =>
                unwrap(tx.insert('users', { id: row.id, name: row.name }, { dataDir: dir === 'base' ? root : local })),
              ),
            );
            model = [...model, row];
          } else if (operation === 1) {
            trail.push(`delete ${pick.id}`);
            unwrap(await db.transaction((tx) => unwrap(tx.delete('users', { id: pick.id }))));
            model = model.filter((row) => row !== pick);
          } else if (operation === 2) {
            const name = fresh();
            trail.push(`rename ${pick.id}`);
            unwrap(await db.transaction((tx) => unwrap(tx.update('users', { name }, { id: pick.id }))));
            model = model.map((row) => (row === pick ? { ...row, name } : row));
          } else if (operation === 3) {
            const id = nextId++;
            trail.push(`change key ${pick.id} -> ${id}`);
            unwrap(await db.transaction((tx) => unwrap(tx.update('users', { id }, { id: pick.id }))));
            model = model.map((row) => (row === pick ? { ...row, id } : row));
          } else {
            trail.push(`rolled back delete ${pick.id}`);
            await db.transaction((tx) => {
              unwrap(tx.delete('users', { id: pick.id }));
              throw new Error('stop');
            });
          }
          for (const dir of ['base', 'local'] as const) {
            expect(await readFile(fileOf(dir), 'utf-8'), `${dir}: ${trail.join('; ')}`).toBe(expected(dir));
          }
        }
      } finally {
        await db.close();
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});

describe('LinesDB line positions of a table whose schema transforms its primary key', () => {
  it.each(Array.from({ length: 30 }, (_, seed) => seed))(
    'keeps the key each line holds through a random run of edits, key changes, adds, deletes and rollbacks (seed %i)',
    async (seed) => {
      const next = random(seed + 301);
      const dataDir = await mkdtemp(join(tmpdir(), 'linesdb-positions-pk-out-'));
      let counter = 0;
      const fresh = () => `n${counter++}`;
      let model: Array<{ id: string; note: string }> = [
        { id: 'a', note: fresh() },
        { id: 'b', note: fresh() },
        { id: 'c', note: fresh() },
      ];
      const expected = () => (model.length === 0 ? '\n' : model.map((row) => `${JSON.stringify(row)}\n`).join(''));
      await writeFile(join(dataDir, 'orders.jsonl'), expected());
      await writeFile(
        join(dataDir, 'orders.schema.ts'),
        `export const schema = { primaryKey: 'id', '~standard': { version: 1, vendor: 'test', validate: (data) =>
  ({ value: { ...data, id: String(data.id).startsWith('ORD-') ? data.id : 'ORD-' + data.id } }) } };\n`,
      );
      const db = LinesDB.create<TableDefs>({ dataDir, writeFilledValues: 'primaryKey' });
      unwrap(await db.initialize());
      const trail: string[] = [];
      try {
        for (let step = 0; step < 8; step++) {
          const pick = model.length > 0 ? model[Math.floor(next() * model.length)] : undefined;
          const operation = Math.floor(next() * 5);
          // The key the database holds: the schema prefixes a key the line holds, and keeps one already prefixed
          const key = (row: { id: string }) => (row.id.startsWith('ORD-') ? row.id : `ORD-${row.id}`);
          if (operation === 0 || !pick) {
            const row = { id: `k${counter}`, note: fresh() };
            trail.push(`insert ${row.id}`);
            unwrap(await db.transaction((tx) => unwrap(tx.insert('orders', row))));
            model = [...model, row];
          } else if (operation === 1) {
            trail.push(`delete ${pick.id}`);
            unwrap(await db.transaction((tx) => unwrap(tx.delete('orders', { id: key(pick) }))));
            model = model.filter((row) => row !== pick);
          } else if (operation === 2) {
            const note = fresh();
            trail.push(`update note of ${pick.id}`);
            unwrap(await db.transaction((tx) => unwrap(tx.update('orders', { note }, { id: key(pick) }))));
            model = model.map((row) => (row === pick ? { ...row, note } : row));
          } else if (operation === 3) {
            const id = `m${counter++}`;
            trail.push(`change key ${pick.id} -> ${id}`);
            unwrap(await db.transaction((tx) => unwrap(tx.update('orders', { id: `ORD-${id}` }, { id: key(pick) }))));
            model = model.map((row) => (row === pick ? { ...row, id: `ORD-${id}` } : row));
          } else {
            trail.push(`rolled back delete ${pick.id}`);
            await db.transaction((tx) => {
              unwrap(tx.delete('orders', { id: key(pick) }));
              throw new Error('stop');
            });
          }
          expect(await readFile(join(dataDir, 'orders.jsonl'), 'utf-8'), trail.join('; ')).toBe(expected());
        }
      } finally {
        await db.close();
        await rm(dataDir, { recursive: true, force: true });
      }
    },
  );
});
