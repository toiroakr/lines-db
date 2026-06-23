#!/usr/bin/env node

// Register amaro for TypeScript schema file support
import { register } from 'node:module';
register('amaro/transform', import.meta.url);

import { TypeGenerator } from './type-generator.js';
import { LinesDB } from './database.js';
import { ErrorFormatter } from './error-formatter.js';
import type { ValidationError, JsonObject } from './types.js';
import { z } from 'zod';
import { arg, defineCommand, runMain } from 'politty';
import { styleText } from 'node:util';
import { writeFile, stat, readdir } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { runInNewContext } from 'node:vm';

const originalEmitWarning = process.emitWarning;
process.emitWarning = (warning, ...args) => {
  if (typeof warning === 'string' && warning.startsWith('SQLite') && args[0] === 'ExperimentalWarning') return;
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

const generateCommand = defineCommand({
  name: 'generate',
  description: 'Generate TypeScript type definitions from schema files',
  args: z.object({
    dataDir: arg(z.string(), {
      positional: true,
      description: 'Directory containing JSONL and schema files',
    }),
    output: arg(z.string().optional(), {
      alias: 'o',
      description: 'Output file path (default: db.ts in dataDir)',
    }),
  }),
  run: async (args) => {
    try {
      const generator = new TypeGenerator({ dataDir: args.dataDir, output: args.output });
      await generator.generate();
      console.log('Type generation completed successfully!');
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  },
});

const validateCommand = defineCommand({
  name: 'validate',
  description: 'Validate JSONL file(s) against schema',
  args: z.object({
    path: arg(z.string(), {
      positional: true,
      description: 'File or directory path to validate',
    }),
    verbose: arg(z.boolean().default(false), {
      alias: 'v',
      description: 'Show verbose error output',
    }),
  }),
  run: async (args) => {
    try {
      const stats = await stat(args.path);
      let dataDir: string;
      let tableName: string | undefined;

      if (stats.isDirectory()) {
        dataDir = args.path;
      } else if (stats.isFile() && args.path.endsWith('.jsonl')) {
        dataDir = dirname(args.path);
        tableName = basename(args.path, '.jsonl');
      } else {
        throw new Error(`Invalid path: ${args.path}. Must be a directory or .jsonl file.`);
      }

      const db = LinesDB.create({ dataDir });
      let result;
      try {
        result = await db.initialize({ tableName, detailedValidate: true });
      } finally {
        await db.close();
      }

      if (!tableName) {
        const formatter = new ErrorFormatter({ verbose: args.verbose });

        for (const tableResult of result.tableResults) {
          if (tableResult.valid && tableResult.warnings.length === 0) {
            console.log(styleText('green', `✓ ${tableResult.tableName} (${tableResult.rowCount} records)`));
          } else if (tableResult.valid && tableResult.warnings.length > 0) {
            for (const warning of tableResult.warnings) {
              console.warn(styleText('yellow', `⚠ ${warning}`));
            }
          } else {
            const fileErrors = tableResult.errors;
            console.error(formatter.formatErrorHeader(fileErrors.length, fileErrors[0]?.file));
            console.error('');

            const validationErrors = fileErrors.filter((e) => e.type !== 'foreignKey' || !e.foreignKeyError);
            const foreignKeyErrors = fileErrors.filter((e) => e.type === 'foreignKey' && e.foreignKeyError);

            if (validationErrors.length > 0) {
              console.error(
                formatter.formatValidationErrors(
                  validationErrors.map((e) => ({
                    file: e.file,
                    rowIndex: e.rowIndex,
                    issues: e.issues,
                  })),
                ),
              );
            }

            for (const error of foreignKeyErrors) {
              if (error.foreignKeyError) {
                console.error(
                  formatter.formatForeignKeyError({
                    file: error.file,
                    rowIndex: error.rowIndex,
                    column: error.foreignKeyError.column,
                    value: error.foreignKeyError.value,
                    referencedTable: error.foreignKeyError.referencedTable,
                    referencedColumn: error.foreignKeyError.referencedColumn,
                  }),
                );
              }
            }

            console.error('');
          }
        }

        if (result.valid) {
          console.log('');
          console.log(styleText('green', '✓ All records are valid'));
          process.exit(0);
        } else {
          process.exit(1);
        }
      } else {
        if (result.warnings.length > 0) {
          for (const warning of result.warnings) {
            console.warn(styleText('yellow', `⚠ ${warning}`));
          }
          console.log('');
        }

        if (result.valid) {
          console.log(styleText('green', '✓ All records are valid'));
          process.exit(0);
        } else {
          const formatter = new ErrorFormatter({ verbose: args.verbose });

          for (const [, fileErrors] of result.errors.reduce((map, error) => {
            const errors = map.get(error.file) || [];
            errors.push(error);
            map.set(error.file, errors);
            return map;
          }, new Map<string, typeof result.errors>())) {
            console.error(formatter.formatErrorHeader(fileErrors.length, fileErrors[0]?.file));
            console.error('');

            const validationErrors = fileErrors.filter((e) => e.type !== 'foreignKey' || !e.foreignKeyError);
            const foreignKeyErrors = fileErrors.filter((e) => e.type === 'foreignKey' && e.foreignKeyError);

            if (validationErrors.length > 0) {
              console.error(
                formatter.formatValidationErrors(
                  validationErrors.map((e) => ({
                    file: e.file,
                    rowIndex: e.rowIndex,
                    issues: e.issues,
                  })),
                ),
              );
            }

            for (const error of foreignKeyErrors) {
              if (error.foreignKeyError) {
                console.error(
                  formatter.formatForeignKeyError({
                    file: error.file,
                    rowIndex: error.rowIndex,
                    column: error.foreignKeyError.column,
                    value: error.foreignKeyError.value,
                    referencedTable: error.foreignKeyError.referencedTable,
                    referencedColumn: error.foreignKeyError.referencedColumn,
                  }),
                );
              }
            }

            console.error('');
          }

          process.exit(1);
        }
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  },
});

const migrateCommand = defineCommand({
  name: 'migrate',
  description: 'Migrate data with transformation function',
  args: z.object({
    path: arg(z.string(), {
      positional: true,
      description: 'File or directory path to migrate',
    }),
    transform: arg(z.string(), {
      positional: true,
      description: 'Transform function (e.g., "(row) => ({ ...row, age: row.age + 1 })")',
    }),
    filter: arg(z.string().optional(), {
      alias: 'f',
      description: 'Filter expression',
    }),
    errorOutput: arg(z.string().optional(), {
      alias: 'e',
      description: 'Output file path for transformed data when migration fails',
    }),
    verbose: arg(z.boolean().default(false), {
      alias: 'v',
      description: 'Show verbose error output',
    }),
  }),
  run: async (args) => {
    try {
      const stats = await stat(args.path);

      if (stats.isDirectory()) {
        await migrateDirectory(args.path, args.transform, {
          filter: args.filter,
          errorOutput: args.errorOutput,
          verbose: args.verbose,
        });
      } else if (stats.isFile() && args.path.endsWith('.jsonl')) {
        await migrateFile(args.path, args.transform, {
          filter: args.filter,
          errorOutput: args.errorOutput,
          verbose: args.verbose,
        });
      } else {
        console.error(`Error: Invalid path: ${args.path}. Must be a directory or .jsonl file.`);
        process.exit(1);
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        console.error(`Error: Path not found: ${args.path}`);
      } else {
        console.error(`Error: ${String(error)}`);
      }
      process.exit(1);
    }
  },
});

const program = defineCommand({
  name: '@toiroakr/lines-db',
  description: 'Database utilities for JSONL files',
  subCommands: {
    generate: generateCommand,
    validate: validateCommand,
    migrate: migrateCommand,
  },
});

runMain(program, { version: '1.0.0' });

/**
 * Migrate all JSONL files in a directory
 */
async function migrateDirectory(
  dirPath: string,
  transformStr: string,
  options: { filter?: string; errorOutput?: string; verbose: boolean },
) {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const jsonlFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map((entry) => entry.name);

  if (jsonlFiles.length === 0) {
    console.error(`Error: No JSONL files found in directory: ${dirPath}`);
    process.exit(1);
  }

  console.log(`Found ${jsonlFiles.length} JSONL file(s) in directory`);

  const db = LinesDB.create({ dataDir: dirPath });
  const initResult = await db.initialize({ detailedValidate: true });

  if (initResult.warnings.length > 0) {
    for (const warning of initResult.warnings) {
      console.warn(styleText('yellow', `⚠ ${warning}`));
    }
  }

  if (!initResult.valid) {
    console.error(`Error: Failed to initialize database due to validation errors:`);
    const formatter = new ErrorFormatter({ verbose: options.verbose });
    for (const error of initResult.errors) {
      console.error(
        formatter.formatValidationErrors([
          {
            file: error.file,
            rowIndex: error.rowIndex,
            issues: error.issues,
          },
        ]),
      );
    }
    await db.close();
    process.exit(1);
  }

  const tableNames = db.getTableNames();
  if (tableNames.length === 0) {
    console.error(`Error: No tables could be loaded from directory: ${dirPath}`);
    await db.close();
    process.exit(1);
  }

  console.log(`Loaded ${tableNames.length} table(s): ${tableNames.join(', ')}\n`);

  try {
    const transform = runInSandbox<unknown>(`(${transformStr})`);

    if (typeof transform !== 'function') {
      console.error('Error: Transform must be a function');
      await db.close();
      process.exit(1);
    }

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

    for (const tableName of tableNames) {
      try {
        console.log(`Processing table '${tableName}'...`);

        const rowsToMigrate = filter ? db.find(tableName, filter as Parameters<typeof db.find>[1]) : db.find(tableName);

        if (rowsToMigrate.length === 0) {
          console.log(`  No rows to migrate`);
          continue;
        }

        console.log(`  Found ${rowsToMigrate.length} row(s) to migrate`);

        const transformedRows = rowsToMigrate.map((row) => transform(row as JsonObject));

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
            console.error(`  Found ${validationError.validationErrors.length} validation error(s):\n`);

            const rowsToMigrate = filter
              ? db.find(tableName, filter as Parameters<typeof db.find>[1])
              : db.find(tableName);

            const errorInfos = validationError.validationErrors.map(({ rowIndex, rowData, error: rowError }) => ({
              file: `${dirPath}/${tableName}.jsonl`,
              rowIndex,
              issues: rowError.issues,
              data: rowData,
              originalData: rowsToMigrate[rowIndex],
            }));

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
  const fileName = filePath.split('/').pop() || '';
  const tableName = fileName.replace('.jsonl', '');

  if (!tableName) {
    console.error('Error: Invalid file path. Must be a .jsonl file');
    process.exit(1);
  }

  const lastSlashIndex = filePath.lastIndexOf('/');
  const dataDir = lastSlashIndex > 0 ? filePath.substring(0, lastSlashIndex) : '.';

  let transform: (row: JsonObject) => JsonObject;
  try {
    const parsedTransform = runInSandbox<unknown>(`(${transformStr})`);
    if (typeof parsedTransform !== 'function') {
      console.error('Error: Transform must be a function');
      process.exit(1);
    }
    transform = parsedTransform as (row: JsonObject) => JsonObject;
  } catch (error) {
    console.error('Error: Failed to parse transform function');
    console.error(`  ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const db = LinesDB.create({ dataDir });
  const initResult = await db.initialize({ tableName, transform, detailedValidate: true });

  if (initResult.warnings.length > 0) {
    for (const warning of initResult.warnings) {
      console.warn(styleText('yellow', `⚠ ${warning}`));
    }
  }

  if (!initResult.valid) {
    console.error(`Error: Failed to initialize database due to validation errors:`);
    const formatter = new ErrorFormatter({ verbose: options.verbose });
    for (const error of initResult.errors) {
      console.error(
        formatter.formatValidationErrors([
          {
            file: error.file,
            rowIndex: error.rowIndex,
            issues: error.issues,
          },
        ]),
      );
    }
    await db.close();
    process.exit(1);
  }

  try {
    let filter: unknown = undefined;
    if (options.filter) {
      try {
        filter = JSON.parse(options.filter);
      } catch {
        filter = runInSandbox(`(${options.filter})`);
      }
    }

    if (filter) {
      let rowsToMigrate;
      try {
        rowsToMigrate = db.find(tableName, filter as Parameters<typeof db.find>[1]);
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

      const transformedRows = rowsToMigrate.map((row) => transform(row as JsonObject));

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
              `\nFound ${validationError.validationErrors.length} validation error(s) in transformed data:\n`,
            );

            const errorInfos = validationError.validationErrors.map(({ rowIndex, rowData, error: rowError }) => ({
              file: filePath,
              rowIndex,
              issues: rowError.issues,
              data: rowData,
              originalData: rowsToMigrate[rowIndex],
            }));

            const formatted = formatter.formatValidationErrors(errorInfos);
            console.error(formatted);
          } else {
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

          if (options.verbose && error.stack) {
            console.error(`\nStack trace:\n${error.stack}`);
          }

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
    } else {
      try {
        const allRows = db.find(tableName);
        console.log(`Migrated ${allRows.length} row(s) in table '${tableName}'`);

        await db.sync(tableName);
        await db.close();

        console.log(`\nMigration completed successfully:`);
        console.log(`  ✓ ${allRows.length} row(s) updated`);
        process.exit(0);
      } catch (error) {
        await db.close();
        console.error('Error: Failed to sync changes to file');
        console.error(`  ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    }
  } catch (error) {
    await db.close();
    throw error;
  }
}
