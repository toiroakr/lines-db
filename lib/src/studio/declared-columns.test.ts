import { cp, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readDeclaredColumns, type DeclaredColumn } from './declared-columns.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

// Not in the order of the file: the order the type lists its properties in is the API's to choose
const byName = (columns: DeclaredColumn[] | undefined) =>
  columns && [...columns].sort((a, b) => a.name.localeCompare(b.name));

const ZOD_COLUMNS = [
  { name: 'id', type: 'number', optional: false, nullable: false },
  { name: 'name', type: 'string', optional: true, nullable: false },
  { name: 'email', type: 'string', optional: false, nullable: false },
  { name: 'tags', type: 'string[]', optional: true, nullable: false },
  { name: 'role', type: '"admin" | "user"', optional: false, nullable: true },
];
const VALIBOT_COLUMNS = [
  { name: 'id', type: 'number', optional: false, nullable: false },
  { name: 'name', type: 'string', optional: true, nullable: false },
  { name: 'nickname', type: 'string', optional: false, nullable: true },
];

describe('readDeclaredColumns', () => {
  it('reads the columns a zod schema declares, as the file holds them: optional where a default fills them in', async () => {
    expect(byName(await readDeclaredColumns(join(fixtures, 'zod.schema.ts'), fixtures))).toEqual(byName(ZOD_COLUMNS));
  });

  it('reads the columns a valibot schema declares through the same Standard Schema types', async () => {
    expect(byName(await readDeclaredColumns(join(fixtures, 'valibot.schema.ts'), fixtures))).toEqual(
      byName(VALIBOT_COLUMNS),
    );
  });

  it('reads nothing from a schema that declares no types, so the columns can be inferred from the rows instead', async () => {
    expect(await readDeclaredColumns(join(fixtures, 'untyped.schema.ts'), fixtures)).toBeUndefined();
  });

  it('reads nothing from a file that does not exist', async () => {
    expect(await readDeclaredColumns(join(fixtures, 'missing.schema.ts'), fixtures)).toBeUndefined();
  });
});

// A directory with typescript@7.1 or later, which has the Corsa API, installed next to zod and valibot
describe.skipIf(!process.env.LINES_DB_CORSA_DIR)('readDeclaredColumns with the Corsa API of typescript@7.1', () => {
  it('reads the same columns as the compiler API does', async () => {
    const dir = await mkdtemp(join(process.env.LINES_DB_CORSA_DIR!, 'run-'));
    try {
      await cp(fixtures, dir, { recursive: true });
      expect(byName(await readDeclaredColumns(join(dir, 'zod.schema.ts'), dir))).toEqual(byName(ZOD_COLUMNS));
      expect(byName(await readDeclaredColumns(join(dir, 'valibot.schema.ts'), dir))).toEqual(byName(VALIBOT_COLUMNS));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
