#!/usr/bin/env node

// Register tsx for TypeScript schema file support
import { register } from 'node:module';
register('tsx', import.meta.url, { data: {} });

import { TypeGenerator } from './type-generator.js';
import { Validator } from './validator.js';
import { LinesDB } from './database.js';
import { ErrorFormatter } from './error-formatter.js';
import type { ValidationError } from './types.js';
import { Command } from 'commander';
import { styleText } from 'node:util';
import { writeFile, stat, readdir } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const originalEmitWarning = process.emitWarning;
process.emitWarning = (warning, ...args) => {
  if (
    typeof warning === 'string' &&
    warning.startsWith('SQLite') &&
    args[0] === 'ExperimentalWarning'
  )
    return;
  originalEmitWarning(warning, ...(args as any[]));
};

const SANDBOX_GLOBALS = Object.freeze({
  console: Object.freeze({
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console),
  }),
  Math,
  Number,
  String,
  Boolean,
  Date,
  JSON,
  RegExp,
  Array,
  Object,
});

function runInSandbox<T>(expression: string, context: Record<string, unknown> = {}): T {
  const sandbox = Object.create(null);
  Object.assign(sandbox, SANDBOX_GLOBALS, context);
  sandbox.globalThis = sandbox;
  return runInNewContext(expression, sandbox, { timeout: 1000 }) as T;
}

const program = new Command();

program
  .name('@toiroakr/lines-db')
  .description('Database utilities for JSONL files')
  .version('1.0.0');

// Generate command
program
  .command('generate')
  .description('Generate TypeScript type definitions from schema files')
  .argument('<dataDir>', 'Directory containing JSONL and schema files')
  .action(async (dataDir: string) => {
    try {
      const generator = new TypeGenerator({ dataDir });
      await generator.generate();
      console.log('Type generation completed successfully!');
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// Validate command
program
  .command('validate')
  .description('Validate JSONL file(s) against schema')
  .argument('<path>', 'File or directory path to validate')
  .option('-v, --verbose', 'Show verbose error output', false)
  .action(async (path: string, options: { verbose: boolean }) => {
    try {
      const validator = new Validator({ path });
      const result = await validator.validate();

      // Display warnings if any
      if (result.warnings.length > 0) {
        for (const warning of result.warnings) {
          console.warn(styleText('yellow', `⚠ ${warning}`));
        }
        console.log('');
      }

      if (result.valid) {
        console.log('✓ All records are valid');
        process.exit(0);
      } else {
        const formatter = new ErrorFormatter({ verbose: options.verbose });

        // Group errors by file for header
        const errorsByFile = new Map<string, typeof result.errors>();
        for (const error of result.errors) {
          const fileErrors = errorsByFile.get(error.file) || [];
          fileErrors.push(error);
          errorsByFile.set(error.file, fileErrors);
        }

        // Format and display errors
        for (const [file, fileErrors] of errorsByFile) {
          console.error(formatter.formatErrorHeader(fileErrors.length, file));
          console.error('');

          // Separate validation errors and foreign key errors
          const validationErrors = fileErrors.filter(
            (e) => e.type !== 'foreignKey' || !e.foreignKeyError,
          );
          const foreignKeyErrors = fileErrors.filter(
            (e) => e.type === 'foreignKey' && e.foreignKeyError,
          );

          // Format validation errors
          if (validationErrors.length > 0) {
            const formattedValidation = formatter.formatValidationErrors(
              validationErrors.map((e) => ({
                file: e.file,
                rowIndex: e.rowIndex,
                issues: e.issues,
              })),
            );
            console.error(formattedValidation);
          }

          // Format foreign key errors
          for (const error of foreignKeyErrors) {
            if (error.foreignKeyError) {
              const formattedFk = formatter.formatForeignKeyError({
                file: error.file,
                rowIndex: error.rowIndex,
                column: error.foreignKeyError.column,
                value: error.foreignKeyError.value,
                referencedTable: error.foreignKeyError.referencedTable,
                referencedColumn: error.foreignKeyError.referencedColumn,
              });
              console.error(formattedFk);
            }
          }

          console.error('');
        }

        process.exit(1);
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// Migrate command
program
  .command('migrate')
  .description('Migrate data with transformation function')
  .argument('<path>', 'File or directory path to migrate')
  .argument('<transform>', 'Transform function (e.g., "(row) => ({ ...row, age: row.age + 1 })")')
  .option('-f, --filter <expr>', 'Filter expression')
  .option('-e, --errorOutput <path>', 'Output file path for transformed data when migration fails')
  .option('-v, --verbose', 'Show verbose error output', false)
  .action(
    async (
      path: string,
      transformStr: string,
      options: { filter?: string; errorOutput?: string; verbose: boolean },
    ) => {
      try {
        const stats = await stat(path);

        if (stats.isDirectory()) {
          // Migrate all JSONL files in directory
          await migrateDirectory(path, transformStr, options);
        } else if (stats.isFile() && path.endsWith('.jsonl')) {
          // Migrate single file
          await migrateFile(path, transformStr, options);
        } else {
          console.error(`Error: Invalid path: ${path}. Must be a directory or .jsonl file.`);
          process.exit(1);
        }
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          (error as NodeJS.ErrnoException).code === 'ENOENT'
        ) {
          console.error(`Error: Path not found: ${path}`);
        } else {
          console.error(`Error: ${String(error)}`);
        }
        process.exit(1);
      }
    },
  );

/**
 * Migrate all JSONL files in a directory
 */
async function migrateDirectory(
  dirPath: string,
  transformStr: string,
  options: { filter?: string; errorOutput?: string; verbose: boolean },
) {
  // Find all JSONL files in directory
  const entries = await readdir(dirPath, { withFileTypes: true });
  const jsonlFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map((entry) => entry.name);

  if (jsonlFiles.length === 0) {
    console.error(`Error: No JSONL files found in directory: ${dirPath}`);
    process.exit(1);
  }

  console.log(`Found ${jsonlFiles.length} JSONL file(s) in directory`);

  // Initialize database
  const db = LinesDB.create({ dataDir: dirPath });
  await db.initialize();

  const tableNames = db.getTableNames();
  if (tableNames.length === 0) {
    console.error(`Error: No tables could be loaded from directory: ${dirPath}`);
    await db.close();
    process.exit(1);
  }

  console.log(`Loaded ${tableNames.length} table(s): ${tableNames.join(', ')}\n`);

  try {
    // Parse transform function
    const transform = runInSandbox<unknown>(`(${transformStr})`);

    if (typeof transform !== 'function') {
      console.error('Error: Transform must be a function');
      await db.close();
      process.exit(1);
    }

    // Parse filter if provided
    let filter: unknown = undefined;
    if (options.filter) {
      try {
        filter = JSON.parse(options.filter);
      } catch {
        filter = runInSandbox(`(${options.filter})`);
      }
    }

    let totalRowsMigrated = 0;
    let hasErrors = false;

    // Process each table
    for (const tableName of tableNames) {
      try {
        console.log(`Processing table '${tableName}'...`);

        // Get rows to migrate
        const rowsToMigrate = filter
          ? db.find(tableName, filter as Parameters<typeof db.find>[1])
          : db.find(tableName);

        if (rowsToMigrate.length === 0) {
          console.log(`  No rows to migrate`);
          continue;
        }

        console.log(`  Found ${rowsToMigrate.length} row(s) to migrate`);

        // Apply transformation
        const transformedRows = rowsToMigrate.map((row) => transform(row));

        // Perform the migration in a transaction
        await db.transaction(async () => {
          db.batchUpdate(tableName, transformedRows as Parameters<typeof db.batchUpdate>[1], {
            validate: true,
          });
        });

        console.log(`  ✓ ${rowsToMigrate.length} row(s) updated\n`);
        totalRowsMigrated += rowsToMigrate.length;
      } catch (error) {
        hasErrors = true;
        console.error(styleText('red', `  ✗ Failed to migrate table '${tableName}'`));

        const formatter = new ErrorFormatter({ verbose: options.verbose });

        if (error instanceof Error && error.name === 'ValidationError') {
          const validationError = error as ValidationError & {
            validationErrors?: Array<{
              rowIndex: number;
              rowData: unknown;
              pkValue: unknown;
              error: ValidationError;
            }>;
          };

          if (validationError.validationErrors) {
            console.error(
              `  Found ${validationError.validationErrors.length} validation error(s):\n`,
            );

            const rowsToMigrate = filter
              ? db.find(tableName, filter as Parameters<typeof db.find>[1])
              : db.find(tableName);

            const errorInfos = validationError.validationErrors.map(
              ({ rowIndex, rowData, error: rowError }) => ({
                file: `${dirPath}/${tableName}.jsonl`,
                rowIndex,
                issues: rowError.issues,
                data: rowData,
                originalData: rowsToMigrate[rowIndex],
              }),
            );

            const formatted = formatter.formatValidationErrors(errorInfos);
            console.error(formatted);
          }
        } else if (error instanceof Error) {
          console.error(`  ${error.message}`);
        }

        console.error('');
      }
    }

    await db.close();

    if (hasErrors) {
      console.error(styleText('red', `\n✗ Migration completed with errors for some tables`));
      console.log(`Total rows migrated: ${totalRowsMigrated}`);
      process.exit(1);
    } else {
      console.log(styleText('green', `\n✓ Migration completed successfully for all tables`));
      console.log(`Total rows migrated: ${totalRowsMigrated}`);
      process.exit(0);
    }
  } catch (error) {
    await db.close();
    throw error;
  }
}

/**
 * Migrate a single JSONL file
 */
async function migrateFile(
  filePath: string,
  transformStr: string,
  options: { filter?: string; errorOutput?: string; verbose: boolean },
) {
  // Extract table name from file path
  const fileName = filePath.split('/').pop() || '';
  const tableName = fileName.replace('.jsonl', '');

  if (!tableName) {
    console.error('Error: Invalid file path. Must be a .jsonl file');
    process.exit(1);
  }

  // Get directory from file path
  const lastSlashIndex = filePath.lastIndexOf('/');
  const dataDir = lastSlashIndex > 0 ? filePath.substring(0, lastSlashIndex) : '.';

  // Initialize database
  const db = LinesDB.create({ dataDir });
  await db.initialize();

  try {
    // Parse transform function
    const transform = runInSandbox<unknown>(`(${transformStr})`);

    if (typeof transform !== 'function') {
      console.error('Error: Transform must be a function');
      process.exit(1);
    }

    // Parse filter if provided
    let filter: unknown = undefined;
    if (options.filter) {
      try {
        // Try JSON parse first
        filter = JSON.parse(options.filter);
      } catch {
        // Fall back to eval for JavaScript expressions
        filter = runInSandbox(`(${options.filter})`);
      }
    }

    // Get rows to migrate
    let rowsToMigrate;
    try {
      rowsToMigrate = filter
        ? db.find(tableName, filter as Parameters<typeof db.find>[1])
        : db.find(tableName);
    } catch (error) {
      console.error(`Error: Failed to access table '${tableName}'`);
      console.error(`  ${error instanceof Error ? error.message : String(error)}`);
      console.error(`\nThe table may have failed to load during initialization.`);
      console.error(`Check the table's data and schema for any constraint violations.`);
      await db.close();
      process.exit(1);
    }

    console.log(`Found ${rowsToMigrate.length} row(s) to migrate in table '${tableName}'`);

    if (rowsToMigrate.length === 0) {
      console.log('No rows to migrate. Exiting.');
      await db.close();
      process.exit(0);
    }

    // Apply transformation
    const transformedRows = rowsToMigrate.map((row) => transform(row));

    // Perform the migration in a transaction
    try {
      await db.transaction(async () => {
        db.batchUpdate(tableName, transformedRows as Parameters<typeof db.batchUpdate>[1], {
          validate: true,
        });
      });

      await db.close();

      console.log(`\nMigration completed successfully:`);
      console.log(`  ✓ ${rowsToMigrate.length} row(s) updated`);
      process.exit(0);
    } catch (error) {
      await db.close();

      // Write transformed data to error output file if --errorOutput is specified
      if (options.errorOutput) {
        try {
          const jsonlContent = transformedRows.map((row) => JSON.stringify(row)).join('\n');
          await writeFile(options.errorOutput, jsonlContent, 'utf-8');
          console.error(
            styleText(
              'yellow',
              `\n⚠ Transformed data (${transformedRows.length} rows) written to: ${options.errorOutput}`,
            ),
          );
        } catch (writeError) {
          console.error(
            styleText(
              'red',
              `\n✗ Failed to write error output file: ${writeError instanceof Error ? writeError.message : String(writeError)}`,
            ),
          );
        }
      }

      const formatter = new ErrorFormatter({ verbose: options.verbose });
      console.error(formatter.formatMigrationFailureHeader());

      // Display detailed error information
      if (error instanceof Error && error.name === 'ValidationError') {
        const validationError = error as ValidationError & {
          validationErrors?: Array<{
            rowIndex: number;
            rowData: unknown;
            pkValue: unknown;
            error: ValidationError;
          }>;
        };

        // Display all validation errors
        if (validationError.validationErrors) {
          console.error(
            `\nFound ${validationError.validationErrors.length} validation error(s) in transformed data:\n`,
          );

          const errorInfos = validationError.validationErrors.map(
            ({ rowIndex, rowData, error: rowError }) => ({
              file: filePath,
              rowIndex,
              issues: rowError.issues,
              data: rowData,
              originalData: rowsToMigrate[rowIndex],
            }),
          );

          const formatted = formatter.formatValidationErrors(errorInfos);
          console.error(formatted);
        } else {
          // Fallback for single validation error (backward compatibility)
          console.error('\nValidation error:\n');
          const errorInfo = {
            file: filePath,
            rowIndex: 0,
            issues: validationError.issues,
          };
          const formatted = formatter.formatValidationErrors([errorInfo]);
          console.error(formatted);
        }
      } else if (error instanceof Error) {
        console.error(`\n  ${error.message}`);

        // Output stack trace for debugging
        if (options.verbose && error.stack) {
          console.error(`\nStack trace:\n${error.stack}`);
        }

        // Check if it's a SQLite constraint error
        if (
          error.message.includes('UNIQUE constraint failed') ||
          error.message.includes('FOREIGN KEY constraint failed') ||
          error.message.includes('NOT NULL constraint failed') ||
          error.message.includes('CHECK constraint failed')
        ) {
          console.error('\n  This is a SQLite constraint violation.');
          console.error('  Please check your data and schema requirements.');
        }
      } else {
        console.error(`\n  ${String(error)}`);
      }

      console.error('');
      process.exit(1);
    }
  } catch (error) {
    await db.close();
    throw error;
  }
}

program.parse();
