import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isProjectSource, readDeclaredColumns, type DeclaredColumn } from './declared-columns.js';

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

  it('reads the columns of every member of a union, a field a member lacks being optional', async () => {
    expect(byName(await readDeclaredColumns(join(fixtures, 'union.schema.ts'), fixtures))).toEqual([
      { name: 'a', type: 'string', optional: true, nullable: false },
      { name: 'b', type: 'number', optional: true, nullable: false },
      { name: 'kind', type: '"a" | "b"', optional: false, nullable: false },
      { name: 'note', type: 'string', optional: true, nullable: false },
    ]);
  });

  it('reads the schema a file exports again from another file', async () => {
    expect(byName(await readDeclaredColumns(join(fixtures, 'reexport.schema.ts'), fixtures))).toEqual(
      byName(VALIBOT_COLUMNS),
    );
  });

  it('reads from paths relative to the working directory, as a directory given to the CLI is', async () => {
    const relativeTo = (path: string) => relative(process.cwd(), path);

    expect(
      byName(await readDeclaredColumns(relativeTo(join(fixtures, 'zod.schema.ts')), relativeTo(fixtures))),
    ).toEqual(byName(ZOD_COLUMNS));
  });

  it('reads the columns again once a file the schema imports its types from has changed', async () => {
    const dir = await mkdtemp(join(fixtures, 'run-'));
    try {
      const schema = () =>
        `import type { Row } from './row.js';\nexport const schema = { '~standard': { version: 1, vendor: 'test', validate: (data: unknown) => ({ value: data }), types: undefined as unknown as { input: Row; output: unknown } } };\n`;
      await writeFile(join(dir, 'row.ts'), 'export interface Row { id: number }\n');
      await writeFile(join(dir, 'app.schema.ts'), schema());

      expect((await readDeclaredColumns(join(dir, 'app.schema.ts'), dir))?.map((column) => column.name)).toEqual([
        'id',
      ]);

      await new Promise((resolve) => setTimeout(resolve, 20));
      await writeFile(join(dir, 'row.ts'), 'export interface Row { id: number; title: string }\n');

      expect((await readDeclaredColumns(join(dir, 'app.schema.ts'), dir))?.map((column) => column.name)).toEqual([
        'id',
        'title',
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reads nothing from a schema that declares no types, so the columns can be inferred from the rows instead', async () => {
    expect(await readDeclaredColumns(join(fixtures, 'untyped.schema.ts'), fixtures)).toBeUndefined();
  });

  it('reads nothing from a file that does not exist', async () => {
    expect(await readDeclaredColumns(join(fixtures, 'missing.schema.ts'), fixtures)).toBeUndefined();
  });
});

describe('isProjectSource', () => {
  it.each(['/work/app/src/row.ts', 'C:\\work\\app\\src\\row.ts', 'C:/work/app/src/row.ts'])(
    'keeps %s, a file of the project',
    (name) => {
      expect(isProjectSource(name)).toBe(true);
    },
  );

  it.each([
    '/work/app/node_modules/zod/index.d.ts',
    'C:\\work\\app\\node_modules\\zod\\index.d.ts',
    'C:/work/app/node_modules/zod/index.d.ts',
    'bundled:///libs/lib.es5.d.ts',
    'src/row.ts',
  ])('drops %s, which is a library or not a path of the disk', (name) => {
    expect(isProjectSource(name)).toBe(false);
  });
});

// A directory with another TypeScript installed next to zod and valibot: 5, whose flags differ from 6, or 7.1 and later, which has the Corsa API
describe.skipIf(!process.env.LINES_DB_TS_DIR)('readDeclaredColumns with the TypeScript of LINES_DB_TS_DIR', () => {
  it('reads the same columns as it does with TypeScript 6', async () => {
    const dir = await mkdtemp(join(process.env.LINES_DB_TS_DIR!, 'run-'));
    try {
      await cp(fixtures, dir, { recursive: true });
      expect(byName(await readDeclaredColumns(join(dir, 'zod.schema.ts'), dir))).toEqual(byName(ZOD_COLUMNS));
      expect(byName(await readDeclaredColumns(join(dir, 'valibot.schema.ts'), dir))).toEqual(byName(VALIBOT_COLUMNS));
      expect(
        (await readDeclaredColumns(join(dir, 'union.schema.ts'), dir))?.map((column) => column.name).sort(),
      ).toEqual(['a', 'b', 'kind', 'note']);
      expect(byName(await readDeclaredColumns(join(dir, 'reexport.schema.ts'), dir))).toEqual(byName(VALIBOT_COLUMNS));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
