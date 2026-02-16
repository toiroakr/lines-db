/**
 * Supported schema file extensions (priority order).
 */
export const SCHEMA_EXTENSIONS = ['.schema.ts', '.schema.mts', '.schema.cts'] as const;

/**
 * Check if a filename is a schema file.
 */
export function isSchemaFile(fileName: string): boolean {
  return SCHEMA_EXTENSIONS.some((ext) => fileName.endsWith(ext));
}

/**
 * Extract table name from a schema filename.
 * e.g., "users.schema.ts" -> "users", "users.schema.mts" -> "users"
 */
export function extractTableNameFromSchema(fileName: string): string | null {
  for (const ext of SCHEMA_EXTENSIONS) {
    if (fileName.endsWith(ext)) {
      return fileName.slice(0, -ext.length);
    }
  }
  return null;
}
