import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LinesDB, loadDatasetConfig, unwrap, type DatasetConfigOptions } from './index.js';

const schema = `export const schema = {
  '~standard': { version: 1, vendor: 'test', validate: value => ({ value }) },
  primaryKey: 'id'
};`;

describe('loadDatasetConfig', () => {
  let root: string;
  let path: string;

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'lines-db-config-api-')));
    path = join(root, 'lines-db.config.json');
    for (const dir of ['base', 'cogs', 'sales']) await mkdir(join(root, dir));
    await writeFile(
      path,
      JSON.stringify({
        schemaDir: './base',
        base: ['./base'],
        datasets: { cogs: ['./cogs'], sales: ['./sales'] },
      }),
    );
    await writeFile(join(root, 'base/Item.schema.ts'), schema);
    await writeFile(join(root, 'base/Item.jsonl'), '{"id":"base"}\n');
    await writeFile(join(root, 'cogs/Item.jsonl'), '{"id":"cogs"}\n');
    await writeFile(join(root, 'sales/Item.jsonl'), '{"id":"sales"}\n');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it.each<{ options: DatasetConfigOptions; ids: string[] }>([
    { options: {}, ids: ['base'] },
    { options: { datasets: [] }, ids: ['base'] },
    { options: { datasets: ['cogs'] }, ids: ['base', 'cogs'] },
    { options: { datasets: ['sales', 'cogs'] }, ids: ['base', 'sales', 'cogs'] },
    { options: { datasets: 'all' }, ids: ['base', 'cogs', 'sales'] },
    { options: { datasets: ['sales', 'sales'] }, ids: ['base', 'sales'] },
  ])('loads $options as a usable database configuration', async ({ options, ids }) => {
    const config = await loadDatasetConfig(path, options);
    expect(config.schemaDir).toBe(join(root, 'base'));
    const db = LinesDB.create(config);
    try {
      expect(unwrap(await db.initialize({ detailedValidate: true })).valid).toBe(true);
      expect(unwrap(db.query<{ id: string }>('SELECT id FROM Item ORDER BY rowid')).map((row) => row.id)).toEqual(ids);
    } finally {
      unwrap(await db.close());
    }
  });

  it('rejects an unknown name among otherwise valid selections', async () => {
    await expect(loadDatasetConfig(path, { datasets: ['cogs', 'missing'] })).rejects.toThrow(
      "Unknown dataset 'missing'",
    );
  });

  it('deduplicates a base directory selected through an alias', async () => {
    await symlink(join(root, 'base'), join(root, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
    await writeFile(
      path,
      JSON.stringify({
        schemaDir: './base',
        base: ['./base'],
        datasets: { alias: ['./alias'] },
      }),
    );
    expect((await loadDatasetConfig(path, { datasets: ['alias'] })).dataDir).toEqual([join(root, 'base')]);
  });
  it.each(['missing', 'lines-db.config.json'])(
    'rejects invalid schemaDir %s instead of skipping validation',
    async (schemaDir) => {
      await writeFile(path, JSON.stringify({ schemaDir, base: ['./base'], datasets: {} }));
      await expect(loadDatasetConfig(path)).rejects.toThrow('Invalid schemaDir');
    },
  );
});
