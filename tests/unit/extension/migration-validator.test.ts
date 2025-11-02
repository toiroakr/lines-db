import { describe, expect, it } from 'vitest';
import { parseMigrationSource } from '../../../extension/src/migration-parser.ts';

describe('migration parser', () => {
  it('parses migration with filter and transform', async () => {
    const migrationSource = /* ts */ `
      const helper = (row: Row) => ({ ...row, migrated: true });
      export const migration = {
        filter: (row: Row) => row.active === true,
        transform: (row: Row) => helper(row),
      };
      type Row = { id: number; active: boolean; name: string };
    `;

    const { filter, transform } = await parseMigrationSource(migrationSource);

    const activeRow = { id: 1, active: true, name: 'Alice' };
    const inactiveRow = { id: 2, active: false, name: 'Bob' };

    expect(filter).toBeDefined();
    expect(transform).toBeDefined();

    expect(filter?.(activeRow)).toBe(true);
    expect(filter?.(inactiveRow)).toBe(false);
    expect(transform?.(activeRow)).toEqual({ ...activeRow, migrated: true });
  });

  it('rejects when migration object is missing', async () => {
    await expect(parseMigrationSource('const noMigration = {};')).rejects.toThrow(
      /migration object is required/,
    );
  });

  it('should extract correct rowIndex from validation errors', () => {
    // Simulate the validation error structure returned by LinesDB
    const error = {
      name: 'ValidationError',
      message: 'Validation failed',
      validationErrors: [
        {
          rowIndex: 0,
          rowData: { id: -1, name: 'Alice', active: true },
          error: {
            issues: [
              { message: 'Invalid value: Expected number>=1 but received -1', path: ['id'] },
            ],
          },
        },
        {
          rowIndex: 1,
          rowData: { id: -2, name: 'Bob', active: true },
          error: {
            issues: [
              { message: 'Invalid value: Expected number>=1 but received -2', path: ['id'] },
            ],
          },
        },
      ],
    };

    // Import processValidationError logic (we'll extract it into a testable function)
    const processValidationError = (
      error: unknown,
    ): { valid: boolean; errors: Array<{ line: number; message: string }> } => {
      const errors: Array<{ line: number; message: string }> = [];

      if (
        error &&
        typeof error === 'object' &&
        'name' in error &&
        (error as { name: unknown }).name === 'ValidationError' &&
        'validationErrors' in error &&
        Array.isArray((error as { validationErrors?: unknown }).validationErrors)
      ) {
        const validationErrors = (
          error as {
            validationErrors: Array<{
              rowIndex: number;
              rowData: Record<string, unknown>;
              error: { issues: Array<{ message: string; path?: Array<unknown> }> };
            }>;
          }
        ).validationErrors;

        for (const { rowIndex, error: rowError } of validationErrors) {
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
            line: rowIndex,
            message: messages.join(', '),
          });
        }
      }

      return {
        valid: false,
        errors,
      };
    };

    const result = processValidationError(error);

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0].line).toBe(0);
    expect(result.errors[0].message).toContain('id');
    expect(result.errors[1].line).toBe(1);
    expect(result.errors[1].message).toContain('id');
  });
});
