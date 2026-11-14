import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LinesDB } from './database.js';
import { unwrap } from './result.js';
import type { TableDefs } from './types.js';

const PREFIX_SCHEMA = `export const schema = { '~standard': { version: 1, vendor: 'test', validate: (data) =>
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
