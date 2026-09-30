import { readdir } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import type { TableConfig } from './types.js';

export class DirectoryScanner {
  /**
   * Scan directories for JSONL files and create table configurations.
   * A table found in several directories lists its files in the order the directories are given.
   */
  static async scanDirectory(dataDir: string | readonly string[]): Promise<Map<string, TableConfig>> {
    const dataDirs = typeof dataDir === 'string' ? [dataDir] : dataDir;
    const jsonlPathsByTable = new Map<string, string[]>();

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
          const jsonlPaths = jsonlPathsByTable.get(tableName) ?? [];
          jsonlPaths.push(join(dir, file));
          jsonlPathsByTable.set(tableName, jsonlPaths);
        }
      }
    }

    if (jsonlPathsByTable.size === 0) {
      console.warn(`Warning: No JSONL files found in directory: ${dataDirs.join(', ')}`);
    }

    const tables = new Map<string, TableConfig>();
    for (const [tableName, jsonlPaths] of jsonlPathsByTable) {
      tables.set(tableName, { jsonlPath: jsonlPaths[0], jsonlPaths, autoInferSchema: true });
    }
    return tables;
  }
}
