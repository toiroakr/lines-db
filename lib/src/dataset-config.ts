import { readFile, stat } from 'node:fs/promises';
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
  dataset?: string;
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

  const configPath = resolve(options.config ?? 'lines-db.config.json');
  let config: z.infer<typeof datasetConfigSchema>;
  try {
    config = datasetConfigSchema.parse(JSON.parse(await readFile(configPath, 'utf-8')));
  } catch (error) {
    throw new Error(
      `Failed to load dataset configuration ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let selected: string[] = [];
  if (options.allDatasets) {
    selected = Object.values(config.datasets).flat();
  } else if (options.dataset !== undefined) {
    if (!Object.hasOwn(config.datasets, options.dataset)) {
      throw new Error(
        `Unknown dataset '${options.dataset}'. Available datasets: ${Object.keys(config.datasets).join(', ') || '(none)'}`,
      );
    }
    selected = config.datasets[options.dataset];
  }

  const configDir = dirname(configPath);
  return {
    dataDir: [...new Set([...config.base, ...selected].map((dir) => resolve(configDir, dir)))],
    schemaDir: resolve(configDir, config.schemaDir),
  };
}
