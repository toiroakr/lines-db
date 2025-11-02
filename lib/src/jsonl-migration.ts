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
 * If validation fails, the underlying LinesDB error is rethrown so callers can inspect validation details.
 */
export async function ensureTableRowsValid(options: TableValidationOptions): Promise<void> {
  console.log('[ensureTableRowsValid] START');
  console.log('[ensureTableRowsValid] dataDir:', options.dataDir);
  console.log('[ensureTableRowsValid] tableName:', options.tableName);
  console.log('[ensureTableRowsValid] rows count:', options.rows.length);

  const tablePath = join(options.dataDir, `${options.tableName}.jsonl`);
  const overrides = new Map<string, JsonObject[]>([[tablePath, options.rows]]);
  console.log('[ensureTableRowsValid] tablePath:', tablePath);

  let capturedError: Error | null = null;

  // Intercept console.warn to capture validation errors
  const originalWarn = console.warn;
  const warnMessages: string[] = [];
  console.warn = (...args: any[]) => {
    const message = args.join(' ');
    console.log('[ensureTableRowsValid] Captured warn:', message);
    warnMessages.push(message);
    // Check if this is a validation error for our table
    if (
      message.includes(`Failed to load table '${options.tableName}'`) &&
      message.includes('Validation failed')
    ) {
      // Extract the original error from the warn message
      capturedError = new Error(message);
      console.log('[ensureTableRowsValid] Captured validation error!');
    }
  };

  try {
    console.log('[ensureTableRowsValid] Calling JsonlReader.withOverrides');
    await JsonlReader.withOverrides(overrides, async () => {
      console.log('[ensureTableRowsValid] Inside withOverrides callback');
      const db = LinesDB.create({ dataDir: options.dataDir });
      console.log('[ensureTableRowsValid] LinesDB created');
      try {
        console.log('[ensureTableRowsValid] Calling db.initialize()');
        await db.initialize();
        console.log('[ensureTableRowsValid] db.initialize() completed');
      } finally {
        console.log('[ensureTableRowsValid] Calling db.close()');
        await db.close();
      }
    });
    console.log('[ensureTableRowsValid] withOverrides completed');
  } finally {
    // Restore original console.warn
    console.warn = originalWarn;
  }

  console.log('[ensureTableRowsValid] Warnings captured:', warnMessages.length);
  console.log('[ensureTableRowsValid] capturedError:', capturedError ? 'YES' : 'NO');

  if (capturedError) {
    console.log('[ensureTableRowsValid] Throwing captured error');
    throw capturedError;
  }

  console.log('[ensureTableRowsValid] END (success)');
}
