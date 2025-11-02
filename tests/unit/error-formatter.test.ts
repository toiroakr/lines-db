import { describe, it, expect } from 'vitest';
import { ErrorFormatter } from '../../lib/src/error-formatter.js';
import type { ValidationErrorInfo, ForeignKeyErrorInfo } from '../../lib/src/error-formatter.js';

describe('ErrorFormatter', () => {
  describe('formatValidationErrors', () => {
    describe('compact format', () => {
      it('should format errors with 1-based line numbers', () => {
        const formatter = new ErrorFormatter({ verbose: false });
        const errors: ValidationErrorInfo[] = [
          {
            file: '/path/to/users.jsonl',
            rowIndex: 0, // 0-based index (first line)
            issues: [
              {
                message: 'Too small: expected number to be >=10',
                path: [{ key: 'age' }],
              },
            ],
          },
          {
            file: '/path/to/users.jsonl',
            rowIndex: 2, // 0-based index (third line)
            issues: [
              {
                message: 'Too small: expected number to be >=10',
                path: [{ key: 'age' }],
              },
            ],
          },
        ];

        const output = formatter.formatValidationErrors(errors);

        // Should display as line 1 and line 3 (1-based)
        expect(output).toContain('/path/to/users.jsonl:1 • age:');
        expect(output).toContain('/path/to/users.jsonl:3 • age:');
        expect(output).toContain('Too small: expected number to be >=10');
      });

      it('should handle errors on consecutive lines', () => {
        const formatter = new ErrorFormatter({ verbose: false });
        const errors: ValidationErrorInfo[] = [
          {
            file: '/path/to/data.jsonl',
            rowIndex: 0,
            issues: [{ message: 'Error on first line', path: [{ key: 'field' }] }],
          },
          {
            file: '/path/to/data.jsonl',
            rowIndex: 1,
            issues: [{ message: 'Error on second line', path: [{ key: 'field' }] }],
          },
        ];

        const output = formatter.formatValidationErrors(errors);

        expect(output).toContain('/path/to/data.jsonl:1');
        expect(output).toContain('/path/to/data.jsonl:2');
      });
    });

    describe('verbose format', () => {
      it('should format errors with 1-based line numbers', () => {
        const formatter = new ErrorFormatter({ verbose: true });
        const errors: ValidationErrorInfo[] = [
          {
            file: '/path/to/users.jsonl',
            rowIndex: 0, // First line (0-based)
            issues: [
              {
                message: 'Too small: expected number to be >=10',
                path: [{ key: 'age' }],
              },
            ],
          },
        ];

        const output = formatter.formatValidationErrors(errors);

        // Should display as line 1 (1-based)
        expect(output).toContain('/path/to/users.jsonl:1');
        expect(output).toContain('Field: age');
        expect(output).toContain('Error: Too small: expected number to be >=10');
      });

      it('should format multiple errors with correct line numbers', () => {
        const formatter = new ErrorFormatter({ verbose: true });
        const errors: ValidationErrorInfo[] = [
          {
            file: '/path/to/users.jsonl',
            rowIndex: 1, // Second line (0-based)
            issues: [
              {
                message: 'Invalid email',
                path: [{ key: 'email' }],
              },
            ],
          },
          {
            file: '/path/to/users.jsonl',
            rowIndex: 4, // Fifth line (0-based)
            issues: [
              {
                message: 'Too small',
                path: [{ key: 'age' }],
              },
            ],
          },
        ];

        const output = formatter.formatValidationErrors(errors);

        // Should display as line 2 and line 5 (1-based)
        expect(output).toContain('/path/to/users.jsonl:2');
        expect(output).toContain('/path/to/users.jsonl:5');
      });
    });
  });

  describe('formatForeignKeyError', () => {
    describe('compact format', () => {
      it('should format foreign key error with 1-based line number', () => {
        const formatter = new ErrorFormatter({ verbose: false });
        const error: ForeignKeyErrorInfo = {
          file: '/path/to/orders.jsonl',
          rowIndex: 0, // First line (0-based)
          column: 'userId',
          value: 999,
          referencedTable: 'users',
          referencedColumn: 'id',
        };

        const output = formatter.formatForeignKeyError(error);

        // Should display as line 1 (1-based)
        expect(output).toContain('/path/to/orders.jsonl:1');
        expect(output).toContain('Foreign key constraint failed');
      });

      it('should format error on third line correctly', () => {
        const formatter = new ErrorFormatter({ verbose: false });
        const error: ForeignKeyErrorInfo = {
          file: '/path/to/orders.jsonl',
          rowIndex: 2, // Third line (0-based)
          column: 'productId',
          value: 123,
          referencedTable: 'products',
          referencedColumn: 'id',
        };

        const output = formatter.formatForeignKeyError(error);

        // Should display as line 3 (1-based)
        expect(output).toContain('/path/to/orders.jsonl:3');
      });
    });

    describe('verbose format', () => {
      it('should format foreign key error with 1-based line number', () => {
        const formatter = new ErrorFormatter({ verbose: true });
        const error: ForeignKeyErrorInfo = {
          file: '/path/to/orders.jsonl',
          rowIndex: 0, // First line (0-based)
          column: 'userId',
          value: 999,
          referencedTable: 'users',
          referencedColumn: 'id',
        };

        const output = formatter.formatForeignKeyError(error);

        // Should display as line 1 (1-based)
        expect(output).toContain('/path/to/orders.jsonl:1');
        expect(output).toContain('Type: Foreign Key Violation');
      });
    });
  });

  describe('formatErrorHeader', () => {
    it('should format error count with file name', () => {
      const formatter = new ErrorFormatter();
      const output = formatter.formatErrorHeader(2, '/path/to/file.jsonl');

      expect(output).toContain('2 error(s)');
      expect(output).toContain('/path/to/file.jsonl');
    });

    it('should format error count without file name', () => {
      const formatter = new ErrorFormatter();
      const output = formatter.formatErrorHeader(5);

      expect(output).toContain('5 error(s)');
    });
  });
});
