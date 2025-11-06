import { JsonValue } from '@toiroakr/lines-db';
import { runInNewContext } from 'node:vm';

export type MigrationRow = Record<string, JsonValue>;

const sandboxConsole = Object.freeze({
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  info: console.info.bind(console),
});

const SANDBOX_GLOBALS = Object.freeze({
  console: sandboxConsole,
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

export interface ParsedMigration {
  transform: (row: MigrationRow) => MigrationRow;
  filter?: (row: MigrationRow) => boolean;
}

export async function parseMigrationSource(content: string): Promise<ParsedMigration> {
  // Remove type imports, type definitions, and comments for evaluation
  let cleanContent = content
    // Remove import statements
    .replace(/import\s+.*?;/g, '')
    // Remove block comments first (before processing types)
    .replace(/\/\*\*[\s\S]*?\*\//g, '')
    // Remove line comments
    .replace(/\/\/.*$/gm, '')
    // Remove type definitions with object literals (multi-line)
    .replace(/type\s+\w+\s*=\s*\{[\s\S]*?\}\s*;/g, '')
    // Remove simple type definitions
    .replace(/type\s+\w+\s*=\s*[^;{]+;/g, '')
    // Remove export keywords
    .replace(/export\s+/g, '');

  // Remove TypeScript type annotations from function signatures
  // Transform: (row: Row): Row => to (row) =>
  cleanContent = cleanContent
    // Remove parameter type annotations: (param: Type) => (param)
    .replace(/\((\w+)\s*:\s*\w+\)/g, '($1)')
    // Remove return type annotations: ): Type => to ) =>
    .replace(/\)\s*:\s*\w+\s*=>/g, ') =>')
    // Remove variable type annotations: const foo: Type = to const foo =
    .replace(/:\s*\w+\s*=/g, ' =');

  const wrappedCode = `
    ${cleanContent}
    if (typeof migration === 'undefined') {
      throw new Error('migration object is required');
    }
    migration;
  `;

  try {
    const sandbox = Object.create(null);
    Object.assign(sandbox, SANDBOX_GLOBALS);
    sandbox.globalThis = sandbox;

    const migration = runInNewContext(wrappedCode, sandbox, { timeout: 1000 });

    if (!migration || typeof migration !== 'object') {
      throw new Error('migration object is required');
    }

    if (!migration.transform || typeof migration.transform !== 'function') {
      throw new Error('migration.transform function is required and must be a function');
    }

    const transform = (row: MigrationRow) => migration.transform(row) as MigrationRow;
    const filter = migration.filter
      ? (row: MigrationRow) => Boolean(migration.filter(row))
      : undefined;

    return { transform, filter };
  } catch (error) {
    throw new Error(
      `Failed to parse migration file: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
