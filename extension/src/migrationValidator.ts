import * as fs from 'fs';
import { MigrationSessionManager } from './migrationSession.js';
import { parseMigrationSource, type MigrationRow } from './migration-parser.js';

export type { MigrationRow } from './migration-parser.js';

export interface MigrationValidationResult {
  valid: boolean;
  errors: Array<{
    line: number;
    message: string;
  }>;
  transformedRows?: MigrationRow[];
}

export class MigrationValidator {
  static async validate(migrationFilePath: string): Promise<MigrationValidationResult> {
    const session = MigrationSessionManager.getSession(migrationFilePath);
    if (!session) {
      return {
        valid: false,
        errors: [{ line: 0, message: 'Migration session not found' }],
      };
    }

    try {
      // Read migration file content
      const migrationContent = fs.readFileSync(migrationFilePath, 'utf-8');

      // Parse and extract transform and filter functions
      const { transform, filter } = await this.parseMigrationFile(migrationContent);

      if (!global.__linesDbModule?.JsonlReader) {
        return {
          valid: false,
          errors: [{ line: 0, message: '@toiroakr/lines-db not found in workspace' }],
        };
      }

      const allRows = (await global.__linesDbModule.JsonlReader.read(
        session.originalFilePath,
      )) as MigrationRow[];
      const plan = this.createMigrationPlan(allRows, transform, filter);

      if (plan.transformedRows.length === 0) {
        return {
          valid: true,
          errors: [],
          transformedRows: [],
        };
      }

      try {
        if (global.__linesDbModule?.ensureTableRowsValid) {
          await global.__linesDbModule.ensureTableRowsValid({
            dataDir: session.dataDir,
            tableName: session.tableName,
            rows: plan.updatedRows,
          });
        }
      } catch (validationError) {
        return this.processValidationError(
          validationError,
          plan.transformedRows,
          plan.transformedRowIndices,
        );
      }

      return {
        valid: true,
        errors: [],
        transformedRows: plan.transformedRows,
      };
    } catch (error) {
      // Syntax or evaluation error in migration file
      return {
        valid: false,
        errors: [
          {
            line: 0,
            message: error instanceof Error ? error.message : String(error),
          },
        ],
      };
    }
  }

  static async parseMigrationFile(content: string) {
    return parseMigrationSource(content);
  }

  static createMigrationPlan(
    allRows: MigrationRow[],
    transform: (row: MigrationRow) => MigrationRow,
    filter?: (row: MigrationRow) => boolean,
  ): {
    transformedRows: MigrationRow[];
    updatedRows: MigrationRow[];
    transformedRowIndices: number[]; // Maps transformedRows index to updatedRows index
  } {
    const rowsWithIndex = allRows.map((row, index) => ({ index, row }));
    const targetRows = filter ? rowsWithIndex.filter(({ row }) => filter(row)) : rowsWithIndex;

    const transformedRows: MigrationRow[] = [];
    const updatedRows = allRows.slice();
    const transformedRowIndices: number[] = [];

    for (const { index, row } of targetRows) {
      const base = this.cloneRow(row);
      const transformed = transform(base);
      const finalRow = transformed ?? base;
      transformedRows.push(finalRow);
      updatedRows[index] = finalRow;
      transformedRowIndices.push(index);
    }

    return { transformedRows, updatedRows, transformedRowIndices };
  }

  private static cloneRow(row: MigrationRow): MigrationRow {
    return JSON.parse(JSON.stringify(row)) as MigrationRow;
  }

  static processValidationError(
    error: unknown,
    transformedRows: MigrationRow[],
    transformedRowIndices: number[],
  ): MigrationValidationResult {
    const errors: Array<{ line: number; message: string }> = [];

    if (
      error &&
      typeof error === 'object' &&
      'name' in error &&
      (error as { name: unknown }).name === 'ValidationError' &&
      'validationErrors' in error &&
      Array.isArray((error as { validationErrors?: unknown }).validationErrors)
    ) {
      // Multiple validation errors
      const validationErrors = (
        error as {
          validationErrors: Array<{
            rowIndex: number;
            rowData: MigrationRow;
            error: { issues: Array<{ message: string; path?: Array<unknown> }> };
          }>;
        }
      ).validationErrors;

      for (const { rowIndex, error: rowError } of validationErrors) {
        // Map updatedRows index to transformedRows index
        const transformedIndex = transformedRowIndices.indexOf(rowIndex);

        // Skip if this error is not for a transformed row
        if (transformedIndex === -1) {
          continue;
        }

        const messages = rowError.issues.map((issue) => {
          let pathStr = 'root';
          if (issue.path && issue.path.length > 0) {
            pathStr = issue.path
              .map((segment) => {
                if (typeof segment === 'object' && segment !== null && 'key' in segment) {
                  return String(segment.key);
                }
                return String(segment);
              })
              .join('.');
            return `${pathStr}: ${issue.message}`;
          }
          return issue.message;
        });

        errors.push({
          line: transformedIndex,
          message: messages.join(', '),
        });
      }
    } else if (
      error instanceof Error &&
      (error.message.includes('UNIQUE constraint failed') ||
        error.message.includes('FOREIGN KEY constraint failed') ||
        error.message.includes('NOT NULL constraint failed') ||
        error.message.includes('CHECK constraint failed'))
    ) {
      // SQLite constraint error - mark all rows
      for (let i = 0; i < transformedRows.length; i++) {
        errors.push({
          line: i,
          message: error.message,
        });
      }
    } else {
      // Generic error
      errors.push({
        line: 0,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      valid: false,
      errors,
      transformedRows,
    };
  }
}
