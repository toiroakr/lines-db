import * as vscode from 'vscode';
import * as path from 'path';

export interface ForeignKeyInfo {
  column: string;
  referencedTable: string;
  referencedColumn: string;
}

export interface ForeignKeyContext {
  foreignKey: ForeignKeyInfo;
  value: unknown;
  currentFilePath: string;
}

export interface RecordLocation {
  filePath: string;
  lineNumber: number;
  record: Record<string, unknown>;
}

/**
 * Get foreign key definitions from schema file
 */
export async function getForeignKeys(jsonlFilePath: string): Promise<ForeignKeyInfo[]> {
  try {
    if (!global.__linesDbModule) {
      return [];
    }

    const schema = await global.__linesDbModule.SchemaLoader.loadSchema(jsonlFilePath);
    if (!schema) {
      return [];
    }

    // Type assertion for schema with foreignKeys
    const schemaWithForeignKeys = schema as { foreignKeys?: Array<{ column: string; references: { table: string; column: string } }> };
    if (!schemaWithForeignKeys.foreignKeys) {
      return [];
    }

    return schemaWithForeignKeys.foreignKeys.map((fk) => ({
      column: fk.column,
      referencedTable: fk.references.table,
      referencedColumn: fk.references.column,
    }));
  } catch (error) {
    // Silently fail
    return [];
  }
}

/**
 * Check if cursor position is on a foreign key value
 */
export async function getForeignKeyAtPosition(
  document: vscode.TextDocument,
  position: vscode.Position
): Promise<ForeignKeyContext | null> {
  try {
    const line = document.lineAt(position.line);
    const lineText = line.text.trim();

    if (!lineText || lineText.startsWith('//')) {
      return null;
    }

    // Parse JSON line
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(lineText);
    } catch {
      return null;
    }

    // Get foreign keys for this file
    const foreignKeys = await getForeignKeys(document.uri.fsPath);
    if (foreignKeys.length === 0) {
      return null;
    }

    // Find which foreign key column the cursor is on
    const cursorOffset = document.offsetAt(position);
    const lineStartOffset = document.offsetAt(new vscode.Position(position.line, 0));
    const relativeOffset = cursorOffset - lineStartOffset;

    // Try to determine which property the cursor is on
    for (const fk of foreignKeys) {
      if (!(fk.column in record)) {
        continue;
      }

      const value = record[fk.column];

      // Find the position of this property in the JSON string (both key and value)
      const propertyPattern = new RegExp(
        `"${fk.column}"\\s*:\\s*([^,}]+)`,
        'g'
      );
      const match = propertyPattern.exec(lineText);

      if (match) {
        // Check if cursor is on the key name (including quotes)
        const keyStart = match.index;
        const keyEnd = match.index + `"${fk.column}"`.length;

        // Check if cursor is on the value
        const valueStart = match.index + match[0].indexOf(match[1]);
        const valueEnd = valueStart + match[1].length;

        // Accept cursor on either key or value
        if ((relativeOffset >= keyStart && relativeOffset <= keyEnd) ||
            (relativeOffset >= valueStart && relativeOffset <= valueEnd)) {
          return {
            foreignKey: fk,
            value,
            currentFilePath: document.uri.fsPath,
          };
        }
      }
    }

    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Find the referenced record location
 */
export async function findReferencedRecord(
  context: ForeignKeyContext
): Promise<RecordLocation | null> {
  try {
    if (!global.__linesDbModule) {
      return null;
    }

    // Determine the referenced JSONL file path
    const currentDir = path.dirname(context.currentFilePath);
    const referencedFileName = `${context.foreignKey.referencedTable}.jsonl`;
    const referencedFilePath = path.join(currentDir, referencedFileName);

    // Check if file exists
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(referencedFilePath));
    } catch {
      return null;
    }

    // Read records from referenced file
    const records = await global.__linesDbModule.JsonlReader.read(referencedFilePath);
    if (!records || records.length === 0) {
      return null;
    }

    // Find the matching record
    const referencedColumn = context.foreignKey.referencedColumn;
    const recordIndex = records.findIndex(
      (record: any) => record[referencedColumn] === context.value
    );

    if (recordIndex === -1) {
      return null;
    }

    const matchedRecord = records[recordIndex];
    if (typeof matchedRecord !== 'object' || matchedRecord === null) {
      return null;
    }

    return {
      filePath: referencedFilePath,
      lineNumber: recordIndex,
      record: matchedRecord as Record<string, unknown>,
    };
  } catch (error) {
    return null;
  }
}

/**
 * Format record data as markdown for hover display
 */
export function formatRecordAsMarkdown(
  record: Record<string, unknown>,
  tableName: string,
  primaryKeyColumn: string
): string {
  const primaryKeyValue = record[primaryKeyColumn];
  const lines: string[] = [
    `**${tableName}** (${primaryKeyColumn}: ${JSON.stringify(primaryKeyValue)})`,
    '',
    '---',
    '',
    '```json',
    JSON.stringify(record, null, 2),
    '```',
  ];

  return lines.join('\n');
}
