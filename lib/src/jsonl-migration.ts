import { join } from 'node:path';
import type { JsonObject } from './types.js';
import { JsonlReader } from './jsonl-reader.js';
import { LinesDB } from './database.js';

export interface TableValidationOptions {
  dataDir: string;
  tableName: string;
  rows: JsonObject[];
}

/**
 * Validate a table by temporarily supplying in-memory rows while reusing the existing LinesDB validation pipeline.
 * If validation fails, throws an error with validation details.
 */
export async function ensureTableRowsValid(options: TableValidationOptions): Promise<void> {
  const tablePath = join(options.dataDir, `${options.tableName}.jsonl`);
  const overrides = new Map<string, JsonObject[]>([[tablePath, options.rows]]);

  await JsonlReader.withOverrides(overrides, async () => {
    const db = LinesDB.create({ dataDir: options.dataDir });
    try {
      // Initialize only the target table
      const result = await db.initialize({ tableName: options.tableName });

      // If validation failed, throw an error with details
      if (!result.valid) {
        const errorCount = result.errors.length;
        const errorDetails = result.errors
          .map((e) => {
            const issueMessages = e.issues.map((issue) => issue.message).join(', ');
            return `  Row ${e.rowIndex}: ${issueMessages}`;
          })
          .join('\n');

        throw new Error(
          `Validation failed for table '${options.tableName}' (${errorCount} error(s)):\n${errorDetails}`,
        );
      }
    } finally {
      await db.close();
    }
  });
}
