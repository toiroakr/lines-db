import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../../lib/bin/cli.mjs', import.meta.url));

const schema = (foreignKeys: unknown[] = []) => `export const schema = {
  '~standard': { version: 1, vendor: 'test', validate: value => ({ value }) },
  primaryKey: 'id',
  foreignKeys: ${JSON.stringify(foreignKeys)}
};`;

describe('validate dataset configuration', () => {
  let root: string;
  let project: string;
  let config: string;

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'lines-db-datasets-')));
    project = join(root, 'project');
    config = join(project, 'lines-db.config.json');
    for (const dir of ['data', 'data/cogs', 'data/sales']) {
      await mkdir(join(project, dir), { recursive: true });
    }
    await writeFile(
      config,
      JSON.stringify({
        schemaDir: './data',
        base: ['./data'],
        datasets: { cogs: ['./data/cogs'], sales: ['./data/sales'] },
      }),
    );
    await writeFile(join(project, 'data/Item.schema.ts'), schema());
    await writeFile(
      join(project, 'data/ItemValuation.schema.ts'),
      schema([{ column: 'itemId', references: { table: 'Item', column: 'id' } }]),
    );
    await writeFile(join(project, 'data/Item.jsonl'), '{"id":1}\n');
    await writeFile(join(project, 'data/cogs/Item.jsonl'), '{"id":2}\n');
    await writeFile(join(project, 'data/cogs/ItemValuation.jsonl'), '{"id":1,"itemId":1}\n');
    await writeFile(join(project, 'data/sales/Item.jsonl'), '{"id":2}\n');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const validate = (args: string[], cwd: string) => run(process.execPath, [cli, 'validate', ...args], { cwd });

  it('defaults to base without reading the conflicting scenario datasets', async () => {
    const { stdout } = await validate([], project);
    expect(stdout).toContain('Item (1 records)');
    expect(stdout).not.toContain('ItemValuation');
  });

  it('combines base with a named dataset and resolves its foreign key', async () => {
    const { stdout } = await validate(['--dataset', 'cogs'], project);
    expect(stdout).toContain('Item (2 records)');
    expect(stdout).toContain('ItemValuation (1 records)');
  });

  it('resolves data and schema paths relative to an explicit config from another directory', async () => {
    const { stdout } = await validate(['--config', config, '--dataset', 'cogs'], root);
    expect(stdout).toContain('Item (2 records)');
    expect(stdout).toContain('All records are valid');
  });

  it('combines all datasets and reports duplicate ids in their source file', async () => {
    await expect(validate(['--all-datasets'], project)).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(join(project, 'data/sales/Item.jsonl')),
    });
  });

  it('reports a foreign key missing from the selected union', async () => {
    await writeFile(join(project, 'data/cogs/ItemValuation.jsonl'), '{"id":1,"itemId":99}\n');
    await expect(validate(['--dataset', 'cogs'], project)).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('ItemValuation.jsonl'),
    });
  });

  it('keeps positional directory and file validation without loading configuration', async () => {
    await writeFile(config, 'not JSON');
    for (const path of ['data', 'data/Item.jsonl']) {
      const { stdout } = await validate([path], project);
      expect(stdout).toContain('All records are valid');
    }
  });

  it.each([
    [['--dataset', 'missing'], "Unknown dataset 'missing'"],
    [['--dataset', 'toString'], "Unknown dataset 'toString'"],
    [['--dataset', 'cogs', '--all-datasets'], 'Use either --dataset or --all-datasets'],
    [['data', '--dataset', 'cogs'], 'cannot be combined'],
    [['data', '--config', 'lines-db.config.json'], 'cannot be combined'],
  ])('rejects invalid selection %j', async (args, message) => {
    await expect(validate(args, project)).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(message),
    });
  });

  it.each([
    'not JSON',
    JSON.stringify({ schemaDir: './data', base: [], datasets: {} }),
    JSON.stringify({ schemaDir: './data', base: ['./data'], datasets: { cogs: [] } }),
    JSON.stringify({ base: ['./data'], datasets: {} }),
    JSON.stringify({ schemaDir: './data', base: ['./data'], datasets: {}, typo: true }),
  ])('rejects malformed configuration %s', async (contents) => {
    await writeFile(config, contents);
    await expect(validate([], project)).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(`Failed to load dataset configuration ${config}`),
    });
  });

  it('reports a missing default configuration with its path', async () => {
    await rm(config);
    await expect(validate([], project)).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(config),
    });
  });

  it('loads overlapping directory paths only once', async () => {
    await writeFile(
      config,
      JSON.stringify({
        schemaDir: './data',
        base: ['./data'],
        datasets: { baseAgain: ['./data/.'] },
      }),
    );
    const { stdout } = await validate(['--dataset', 'baseAgain'], project);
    expect(stdout).toContain('Item (1 records)');
  });
});
