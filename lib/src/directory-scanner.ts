import { readdir } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import type { TableConfig } from './types.js';

export class DirectoryScanner {
  /**
   * Scan directory for JSONL files and create table configurations
   */
  static async scanDirectory(dataDir: string): Promise<Map<string, TableConfig>> {
    const tables = new Map<string, TableConfig>();

    try {
      const files = await readdir(dataDir);

      for (const file of files) {
        if (extname(file) === '.jsonl') {
          const tableName = basename(file, '.jsonl');
          const jsonlPath = join(dataDir, file);

          tables.set(tableName, {
            jsonlPath,
            autoInferSchema: true,
          });
        }
      }

      if (tables.size === 0) {
        console.warn(`Warning: No JSONL files found in directory: ${dataDir}`);
      }

      return tables;
    } catch (error) {
      throw new Error(
        `Failed to scan directory ${dataDir}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
