import { readdir } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import type { TableConfig } from './types.js';

export class DirectoryScanner {
  /**
   * Scan directories for JSONL files and create table configurations.
   * A table found in several directories lists its files in the order the directories are given.
   */
  static async scanDirectory(dataDir: string | readonly string[]): Promise<Map<string, TableConfig>> {
    const tables = new Map<string, TableConfig>();
    const dataDirs = typeof dataDir === 'string' ? [dataDir] : dataDir;

    for (const dir of dataDirs) {
      let files: string[];
      try {
        files = await readdir(dir);
      } catch (error) {
        throw new Error(`Failed to scan directory ${dir}: ${error instanceof Error ? error.message : String(error)}`);
      }

      for (const file of files) {
        if (extname(file) === '.jsonl') {
          const tableName = basename(file, '.jsonl');
          const jsonlPath = join(dir, file);
          const existing = tables.get(tableName);

          if (existing) {
            existing.jsonlPaths = [...(existing.jsonlPaths ?? [existing.jsonlPath]), jsonlPath];
          } else {
            tables.set(tableName, {
              jsonlPath,
              jsonlPaths: [jsonlPath],
              autoInferSchema: true,
            });
          }
        }
      }
    }

    if (tables.size === 0) {
      console.warn(`Warning: No JSONL files found in directory: ${dataDirs.join(', ')}`);
    }

    return tables;
  }
}
