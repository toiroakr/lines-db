import { access } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Supported schema file extensions, in priority order.
 * The first match wins when discovering schema files.
 */
export const SCHEMA_EXTENSIONS = ['.schema.ts', '.schema.mts', '.schema.cts'] as const;
export type SchemaExtension = (typeof SCHEMA_EXTENSIONS)[number];

/**
 * Map from schema extensions to their JavaScript import counterparts.
 */
const SCHEMA_TO_JS_IMPORT_MAP: Record<string, string> = {
  '.schema.ts': '.schema.js',
  '.schema.mts': '.schema.mjs',
  '.schema.cts': '.schema.cjs',
};

/**
 * Try each supported schema extension and return the full path of the first
 * one that exists on disk. Returns undefined if none is found.
 */
export async function findSchemaFile(
  dir: string,
  tableName: string,
): Promise<string | undefined> {
  for (const ext of SCHEMA_EXTENSIONS) {
    const candidate = join(dir, `${tableName}${ext}`);
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue to next extension
    }
  }
  return undefined;
}

/**
 * Synchronously find a schema file among directory entries.
 * Returns the full path of the first match, or undefined.
 */
export function findSchemaFileInEntries(
  dataDirPath: string,
  tableName: string,
  entries: { isFile(): boolean; name: string }[],
): string | undefined {
  for (const ext of SCHEMA_EXTENSIONS) {
    const candidateName = `${tableName}${ext}`;
    if (entries.some((e) => e.isFile() && e.name === candidateName)) {
      return join(dataDirPath, candidateName);
    }
  }
  return undefined;
}

/**
 * Check if a filename matches any supported schema file pattern.
 */
export function isSchemaFile(fileName: string): boolean {
  return SCHEMA_EXTENSIONS.some((ext) => fileName.endsWith(ext));
}

/**
 * Extract table name from a schema filename.
 * e.g., "users.schema.ts" -> "users", "users.schema.mts" -> "users"
 */
export function extractTableNameFromSchemaFile(fileName: string): string | null {
  for (const ext of SCHEMA_EXTENSIONS) {
    if (fileName.endsWith(ext)) {
      return fileName.slice(0, -ext.length);
    }
  }
  return null;
}

/**
 * Rewrite a TypeScript path to its JavaScript counterpart for ESM imports.
 * ".schema.ts" -> ".schema.js", ".schema.mts" -> ".schema.mjs", ".schema.cts" -> ".schema.cjs"
 */
export function rewriteExtensionForImport(filePath: string): string {
  for (const [tsExt, jsExt] of Object.entries(SCHEMA_TO_JS_IMPORT_MAP)) {
    if (filePath.endsWith(tsExt)) {
      return filePath.slice(0, -tsExt.length) + jsExt;
    }
  }
  return filePath;
}
