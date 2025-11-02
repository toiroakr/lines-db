import type { StandardSchemaIssue } from './types.js';
import { styleText } from 'node:util';

export interface ValidationErrorInfo {
  file: string;
  rowIndex: number;
  issues: ReadonlyArray<StandardSchemaIssue>;
  data?: unknown;
  originalData?: unknown;
}

export interface ForeignKeyErrorInfo {
  file: string;
  rowIndex: number;
  column: string;
  value: unknown;
  referencedTable: string;
  referencedColumn: string;
  data?: unknown;
}

export interface ErrorFormatterOptions {
  verbose?: boolean;
}

export class ErrorFormatter {
  private verbose: boolean;

  constructor(options: ErrorFormatterOptions = {}) {
    this.verbose = options.verbose ?? false;
  }

  /**
   * Format validation errors
   */
  formatValidationErrors(errors: ValidationErrorInfo[]): string {
    if (this.verbose) {
      return this.formatValidationErrorsVerbose(errors);
    }
    return this.formatValidationErrorsCompact(errors);
  }

  /**
   * Format foreign key error
   */
  formatForeignKeyError(error: ForeignKeyErrorInfo): string {
    if (this.verbose) {
      return this.formatForeignKeyErrorVerbose(error);
    }
    return this.formatForeignKeyErrorCompact(error);
  }

  /**
   * Format compact (default) validation errors
   */
  private formatValidationErrorsCompact(errors: ValidationErrorInfo[]): string {
    const lines: string[] = [];

    for (const error of errors) {
      for (const issue of error.issues) {
        const fieldPath = this.getFieldPath(issue);
        const line = `${error.file}:${error.rowIndex + 1} • ${fieldPath}: ${issue.message}`;
        lines.push(line);
      }
    }

    return lines.join('\n');
  }

  /**
   * Format verbose validation errors
   */
  private formatValidationErrorsVerbose(errors: ValidationErrorInfo[]): string {
    const blocks: string[] = [];

    for (let i = 0; i < errors.length; i++) {
      const error = errors[i];
      const isLast = i === errors.length - 1;
      const prefix = isLast ? '└─' : '├─';
      const linePrefix = isLast ? '   ' : '│  ';

      const lines: string[] = [`${prefix} ${error.file}:${error.rowIndex + 1}`];

      for (const issue of error.issues) {
        const fieldPath = this.getFieldPath(issue);
        lines.push(`${linePrefix}Field: ${fieldPath}`);
        lines.push(`${linePrefix}Error: ${issue.message}`);
      }

      // Show original data if available (migrate case)
      if (error.originalData !== undefined) {
        lines.push(`${linePrefix}Original data: ${JSON.stringify(error.originalData)}`);
      }

      // Show data
      if (error.data !== undefined) {
        const label = error.originalData !== undefined ? 'Transformed data' : 'Data';
        lines.push(`${linePrefix}${label}: ${JSON.stringify(error.data)}`);
      }

      blocks.push(lines.join('\n'));
    }

    return blocks.join('\n│\n');
  }

  /**
   * Format compact foreign key error
   */
  private formatForeignKeyErrorCompact(error: ForeignKeyErrorInfo): string {
    return `${error.file}:${error.rowIndex + 1} • ${error.column}: Foreign key constraint failed - Referenced value ${JSON.stringify(error.value)} does not exist in ${error.referencedTable}(${error.referencedColumn})`;
  }

  /**
   * Format verbose foreign key error
   */
  private formatForeignKeyErrorVerbose(error: ForeignKeyErrorInfo): string {
    const lines: string[] = [
      `└─ ${error.file}:${error.rowIndex + 1}`,
      `   Type: Foreign Key Violation`,
      `   Field: ${error.column}`,
      `   Value: ${JSON.stringify(error.value)}`,
      `   References: ${error.referencedTable}(${error.referencedColumn})`,
      `   Error: Referenced value does not exist in target table`,
    ];

    if (error.data !== undefined) {
      lines.push(`   Data: ${JSON.stringify(error.data)}`);
    }

    return lines.join('\n');
  }

  /**
   * Get field path from issue
   */
  private getFieldPath(issue: StandardSchemaIssue): string {
    if (!issue.path || issue.path.length === 0) {
      return 'root';
    }

    return issue.path
      .map((segment) => {
        if (typeof segment === 'object' && segment !== null && 'key' in segment) {
          return String(segment.key);
        }
        return String(segment);
      })
      .join('.');
  }

  /**
   * Format error header with count
   */
  formatErrorHeader(count: number, file?: string): string {
    const fileInfo = file ? ` in ${file}` : '';
    return styleText('red', `✗ Found ${count} error(s)${fileInfo}`);
  }

  /**
   * Format migration failure header
   */
  formatMigrationFailureHeader(): string {
    return styleText('red', '\n✗ Migration failed and was rolled back');
  }
}
