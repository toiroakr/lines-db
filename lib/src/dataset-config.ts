import { readFile, realpath, stat } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { z } from 'zod';
import type { DatabaseConfig } from './types.js';

const directories = z.array(z.string().min(1)).min(1);
const datasetConfigSchema = z.strictObject({
  schemaDir: z.string().min(1),
  base: directories,
  datasets: z.record(z.string().min(1), directories),
});

interface ValidationOptions {
  path?: string;
  config?: string;
  dataset?: string[];
  allDatasets?: boolean;
}

export async function resolveValidationTarget(
  options: ValidationOptions,
): Promise<DatabaseConfig & { tableName?: string }> {
  if (options.dataset !== undefined && options.allDatasets) {
    throw new Error('Use either --dataset or --all-datasets, not both.');
  }
  if (options.path !== undefined) {
    if (options.config !== undefined || options.dataset !== undefined || options.allDatasets) {
      throw new Error('A file or directory path cannot be combined with dataset configuration options.');
    }
    const stats = await stat(options.path);
    if (stats.isDirectory()) return { dataDir: options.path };
    if (stats.isFile() && options.path.endsWith('.jsonl')) {
      return { dataDir: dirname(options.path), tableName: basename(options.path, '.jsonl') };
    }
    throw new Error(`Invalid path: ${options.path}. Must be a directory or .jsonl file.`);
  }

  return loadDatasetConfig(options.config, {
    datasets: options.allDatasets ? 'all' : options.dataset,
  });
}

export interface DatasetConfigOptions {
  datasets?: string[] | 'all';
}

export async function loadDatasetConfig(
  path = 'lines-db.config.json',
  options: DatasetConfigOptions = {},
): Promise<DatabaseConfig> {
  const configPath = resolve(path);
  let config: z.infer<typeof datasetConfigSchema>;
  try {
    config = datasetConfigSchema.parse(JSON.parse(await readFile(configPath, 'utf-8')));
  } catch (error) {
    throw new Error(
      `Failed to load dataset configuration ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const names = options.datasets === 'all' ? Object.keys(config.datasets) : (options.datasets ?? []);
  const selected = names.flatMap((name) => {
    if (!Object.hasOwn(config.datasets, name)) {
      throw new Error(
        `Unknown dataset '${name}'. Available datasets: ${Object.keys(config.datasets).join(', ') || '(none)'}`,
      );
    }
    return config.datasets[name];
  });

  const configDir = dirname(configPath);
  const schemaDir = resolve(configDir, config.schemaDir);
  try {
    if (!(await stat(schemaDir)).isDirectory()) throw new Error('Expected a directory');
  } catch (error) {
    throw new Error(`Invalid schemaDir ${schemaDir}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const dataDirs = await Promise.all([...config.base, ...selected].map((dir) => realpath(resolve(configDir, dir))));
  return {
    dataDir: [...new Set(dataDirs)],
    schemaDir,
  };
}
