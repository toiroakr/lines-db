import * as vscode from 'vscode';
import * as path from 'node:path';
import { TypeScriptTypeExtractor, type FieldInfo } from './typeInfoExtractor.js';
import { getForeignKeys } from './foreignKeyUtils.js';
import {
  getCompletions,
  isInFieldNamePosition,
  extractExistingFields,
  type CompletionResult,
  type FieldInfo as CompletionFieldInfo,
} from './completionLogic.js';

/**
 * JSON context at cursor position
 */
interface JsonContext {
  /** Whether we're completing a field name */
  isFieldName: boolean;
  /** Path to the current nested object (e.g., ['user', 'address']) */
  path: string[];
  /** Existing fields in the current object */
  existingFields: Set<string>;
}

let outputChannel = global.__linesDbOutputChannel;

/**
 * Completion provider for JSONL files with schema support
 */
export class JsonlCompletionProvider implements vscode.CompletionItemProvider {
  private schemaCache = new Map<string, { schema: unknown; timestamp: number }>();
  private fileWatchers = new Map<string, vscode.FileSystemWatcher>();

  constructor() {
    outputChannel = global.__linesDbOutputChannel;
  }

  /**
   * Clear schema cache for a specific file
   */
  private clearSchemaCache(jsonlPath: string): void {
    outputChannel.appendLine('[Completion] Clearing schema cache for: ' + jsonlPath);
    this.schemaCache.delete(jsonlPath);
  }

  /**
   * Watch schema file for changes
   */
  private watchSchemaFile(jsonlPath: string, schemaPath: string): void {
    // Don't create duplicate watchers
    if (this.fileWatchers.has(jsonlPath)) {
      return;
    }

    const watcher = vscode.workspace.createFileSystemWatcher(schemaPath);

    watcher.onDidChange(() => {
      outputChannel.appendLine('[Completion] Schema file changed: ' + schemaPath);
      this.clearSchemaCache(jsonlPath);
    });

    watcher.onDidDelete(() => {
      outputChannel.appendLine('[Completion] Schema file deleted: ' + schemaPath);
      this.clearSchemaCache(jsonlPath);
      const fileWatcher = this.fileWatchers.get(jsonlPath);
      if (fileWatcher) {
        fileWatcher.dispose();
        this.fileWatchers.delete(jsonlPath);
      }
    });

    this.fileWatchers.set(jsonlPath, watcher);
  }

  /**
   * Dispose all watchers
   */
  dispose(): void {
    for (const watcher of this.fileWatchers.values()) {
      watcher.dispose();
    }
    this.fileWatchers.clear();
    this.schemaCache.clear();
  }

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.CompletionItem[] | undefined> {
    try {
      outputChannel.appendLine(
        `[Completion] provideCompletionItems called for ${document.uri.fsPath} at ${position.line}:${position.character}`,
      );

      // Extract type information from schema file
      const fields = await this.loadSchemaTypeInfo(document);
      if (!fields) {
        outputChannel.appendLine('[Completion] No schema type info found');
        return undefined;
      }
      outputChannel.appendLine('[Completion] Type info extracted: ' + fields.length + ' fields');

      // Get current line text
      const line = document.lineAt(position.line).text;
      const cursor = position.character;

      // Convert FieldInfo to CompletionFieldInfo
      const completionFields: CompletionFieldInfo[] = this.flattenFieldsForPath(fields, line, cursor);

      // Get FK values
      const fkValues = await this.getFkValuesMap(document);

      // Use completionLogic to get completions
      const completions = getCompletions(line, cursor, completionFields, fkValues);

      outputChannel.appendLine(`[Completion] Got ${completions.length} completions from logic`);

      // Convert CompletionResult to vscode.CompletionItem
      return this.convertToVscodeCompletionItems(completions, fields, position);
    } catch (error) {
      outputChannel.appendLine('[Completion] Error providing completions: ' + error);
      return undefined;
    }
  }

  /**
   * Flatten fields for the current path
   */
  private flattenFieldsForPath(
    fields: FieldInfo[],
    line: string,
    cursor: number,
  ): CompletionFieldInfo[] {
    const textBeforeCursor = line.substring(0, cursor);
    const path = this.extractPath(textBeforeCursor);
    const currentFields = this.findFieldsForPath(fields, path);

    if (!currentFields) {
      return [];
    }

    return currentFields.map((f) => ({ name: f.name, type: f.type }));
  }

  /**
   * Get FK values map for the current document
   */
  private async getFkValuesMap(document: vscode.TextDocument): Promise<Map<string, string[]>> {
    const fkValues = new Map<string, string[]>();

    try {
      if (!global.__linesDbModule) {
        return fkValues;
      }

      const actualPath = this.getActualJsonlPath(document.uri.fsPath);
      const foreignKeys = await getForeignKeys(actualPath);

      for (const fk of foreignKeys) {
        const currentDir = path.dirname(actualPath);
        const referencedFilePath = path.join(currentDir, `${fk.referencedTable}.jsonl`);

        try {
          await vscode.workspace.fs.stat(vscode.Uri.file(referencedFilePath));
          const records = await global.__linesDbModule.JsonlReader.read(referencedFilePath);

          if (records && records.length > 0) {
            const values: string[] = [];
            for (const record of records) {
              if (
                typeof record === 'object' &&
                record !== null &&
                fk.referencedColumn in record
              ) {
                const value = (record as Record<string, unknown>)[fk.referencedColumn];
                if (typeof value === 'string' || typeof value === 'number') {
                  values.push(String(value));
                }
              }
            }
            if (values.length > 0) {
              fkValues.set(fk.column, values);
            }
          }
        } catch {
          // File not found, skip
        }
      }
    } catch (error) {
      outputChannel.appendLine(`[Completion] Error getting FK values: ${error}`);
    }

    return fkValues;
  }

  /**
   * Convert CompletionResult to vscode.CompletionItem
   */
  private convertToVscodeCompletionItems(
    completions: CompletionResult[],
    fields: FieldInfo[],
    position: vscode.Position,
  ): vscode.CompletionItem[] {
    return completions.map((completion) => {
      // Determine if this is a field name or value completion
      const field = fields.find((f) => f.name === completion.label);
      const isFieldCompletion = field !== undefined;

      const item = new vscode.CompletionItem(
        completion.label,
        isFieldCompletion ? vscode.CompletionItemKind.Field : vscode.CompletionItemKind.Reference,
      );

      item.insertText = new vscode.SnippetString(completion.insertText);

      if (completion.range) {
        const start = new vscode.Position(position.line, completion.range.start);
        const end = new vscode.Position(position.line, completion.range.end);
        item.range = new vscode.Range(start, end);
      }

      if (completion.filterText) {
        item.filterText = completion.filterText;
      }

      // Add field details
      if (field) {
        item.detail = this.formatFieldType(field);

        const doc = new vscode.MarkdownString();
        doc.appendCodeblock(field.name, 'typescript');
        if (field.description) {
          doc.appendText(field.description);
        }
        doc.appendText(`\n\nType: ${this.formatFieldType(field)}`);
        if (field.optional) {
          doc.appendText(' (optional)');
        }
        if (field.nullable) {
          doc.appendText(' (nullable)');
        }
        item.documentation = doc;
      }

      return item;
    });
  }

  /**
   * Load type information from schema file
   */
  private async loadSchemaTypeInfo(
    document: vscode.TextDocument,
  ): Promise<FieldInfo[] | undefined> {
    const jsonlPath = document.uri.fsPath;

    // For temporary edit files, extract original file path
    const actualPath = this.getActualJsonlPath(jsonlPath);

    // Check cache first
    const cached = this.schemaCache.get(actualPath);
    if (cached) {
      outputChannel.appendLine('[Completion] Using cached type info');
      return cached.schema as FieldInfo[];
    }

    // Calculate schema file path
    const dir = path.dirname(actualPath);
    const tableName = path.basename(actualPath, '.jsonl');
    const schemaPath = path.join(dir, `${tableName}.schema.ts`);

    // Check if schema file exists
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(schemaPath));
    } catch {
      outputChannel.appendLine('[Completion] Schema file not found: ' + schemaPath);
      return undefined;
    }

    // Extract type information from schema file
    const fields = await TypeScriptTypeExtractor.extractSchemaType(schemaPath);
    if (!fields) {
      outputChannel.appendLine('[Completion] Failed to extract type info from schema file');
      return undefined;
    }

    // Cache the type info
    this.schemaCache.set(actualPath, { schema: fields, timestamp: Date.now() });
    outputChannel.appendLine('[Completion] Type info cached for: ' + actualPath);

    // Watch schema file for changes
    this.watchSchemaFile(actualPath, schemaPath);

    return fields;
  }

  /**
   * Get actual JSONL path for temp files
   */
  private getActualJsonlPath(filePath: string): string {
    const fileName = path.basename(filePath);

    // Check if this is a temporary edit file
    // Format: .tmp-jsonl-edit-{tableName}-line{lineNumber}.json
    const tempFilePattern = /^\.tmp-jsonl-edit-(.+)-line\d+\.json$/;
    const match = fileName.match(tempFilePattern);

    if (match) {
      // Try to get the original path from TempFileManager
      const tempFileManager = global.__tempFileManager;
      if (tempFileManager) {
        const tempFileInfo = tempFileManager.getTempFileInfo(vscode.Uri.file(filePath));
        if (tempFileInfo) {
          return tempFileInfo.originalUri.fsPath;
        }
      }

      // Fallback: this won't work correctly because temp files are in tmpdir
      // But we keep it for backwards compatibility
      const tableName = match[1];
      const dir = path.dirname(filePath);
      return path.join(dir, `${tableName}.jsonl`);
    }

    return filePath;
  }

  /**
   * Extract the current path in nested objects
   */
  private extractPath(textBeforeCursor: string): string[] {
    const path: string[] = [];
    let depth = 0;
    let currentField = '';
    let inString = false;
    let lastFieldName = '';

    // Parse character by character to track nesting
    for (let i = 0; i < textBeforeCursor.length; i++) {
      const char = textBeforeCursor[i];
      const prevChar = i > 0 ? textBeforeCursor[i - 1] : '';

      // Handle string boundaries
      if (char === '"' && prevChar !== '\\') {
        inString = !inString;
        if (inString) {
          currentField = '';
        } else {
          lastFieldName = currentField;
        }
        continue;
      }

      // Collect field name when inside string
      if (inString) {
        currentField += char;
        continue;
      }

      // Track nesting level
      if (char === '{') {
        depth++;
        if (depth > 1 && lastFieldName) {
          path.push(lastFieldName);
          lastFieldName = '';
        }
      } else if (char === '}') {
        depth--;
        if (path.length > 0) {
          path.pop();
        }
      }
    }

    return path;
  }

  /**
   * Find field info for the given path
   */
  private findFieldsForPath(fields: FieldInfo[], path: string[]): FieldInfo[] | undefined {
    let currentFields = fields;

    for (const segment of path) {
      const field = currentFields.find((f) => f.name === segment);
      if (!field || field.type !== 'object' || !field.nested) {
        return undefined;
      }
      currentFields = field.nested;
    }

    return currentFields;
  }

  /**
   * Format field type for display
   */
  private formatFieldType(field: FieldInfo): string {
    if (field.type === 'array' && field.arrayElementType) {
      return `${this.formatFieldType(field.arrayElementType)}[]`;
    }

    if (field.type === 'object' && field.nested) {
      return 'object';
    }

    if (field.enumValues && field.enumValues.length > 0) {
      return field.enumValues.map((v) => `"${v}"`).join(' | ');
    }

    return field.type;
  }

  /**
   * Create foreign key value completions
   */
  private async createForeignKeyCompletions(
    document: vscode.TextDocument,
    fieldName: string,
    insideQuotes: boolean,
    hasClosingQuote: boolean,
    valueStartPos?: vscode.Position,
    valueEndPos?: vscode.Position,
  ): Promise<vscode.CompletionItem[] | undefined> {
    try {
      if (!global.__linesDbModule) {
        return undefined;
      }

      // Get the actual JSONL path (handle temp files)
      const actualPath = this.getActualJsonlPath(document.uri.fsPath);

      // Get foreign keys for this file
      const foreignKeys = await getForeignKeys(actualPath);
      if (foreignKeys.length === 0) {
        return undefined;
      }

      // Check if current field is a foreign key
      const foreignKey = foreignKeys.find((fk) => fk.column === fieldName);
      if (!foreignKey) {
        return undefined;
      }

      outputChannel.appendLine(
        `[Completion] Field "${fieldName}" is a foreign key referencing ${foreignKey.referencedTable}.${foreignKey.referencedColumn}`,
      );

      // Determine the referenced JSONL file path
      const currentDir = path.dirname(actualPath);
      const referencedFileName = `${foreignKey.referencedTable}.jsonl`;
      const referencedFilePath = path.join(currentDir, referencedFileName);

      // Check if file exists
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(referencedFilePath));
      } catch {
        outputChannel.appendLine(`[Completion] Referenced file not found: ${referencedFilePath}`);
        return undefined;
      }

      // Read records from referenced file
      const records = await global.__linesDbModule.JsonlReader.read(referencedFilePath);
      if (!records || records.length === 0) {
        outputChannel.appendLine('[Completion] No records found in referenced file');
        return undefined;
      }

      outputChannel.appendLine(`[Completion] Found ${records.length} records in referenced file`);

      // Extract unique values from the referenced column
      const referencedColumn = foreignKey.referencedColumn;
      const values = new Set<unknown>();

      for (const record of records) {
        if (typeof record === 'object' && record !== null && referencedColumn in record) {
          const value = (record as Record<string, unknown>)[referencedColumn];
          values.add(value);
        }
      }

      if (values.size === 0) {
        outputChannel.appendLine('[Completion] No values found in referenced column');
        return undefined;
      }

      outputChannel.appendLine(`[Completion] Found ${values.size} unique values`);

      // Create completion items
      const completionItems: vscode.CompletionItem[] = [];

      for (const value of values) {
        const valueStr = String(value);
        const item = new vscode.CompletionItem(valueStr, vscode.CompletionItemKind.Reference);
        item.detail = `FK → ${foreignKey.referencedTable}.${foreignKey.referencedColumn}`;

        // Find the full record for documentation
        const record = records.find((r: any) => r[referencedColumn] === value);
        if (record && typeof record === 'object' && record !== null) {
          const doc = new vscode.MarkdownString();
          doc.appendCodeblock(JSON.stringify(record, null, 2), 'json');
          item.documentation = doc;
        }

        // Set insert text based on quote context
        if (!insideQuotes) {
          // Need to add quotes
          if (typeof value === 'string') {
            item.insertText = `"${value}"`;
          } else {
            item.insertText = String(value);
          }
        } else {
          // Inside quotes
          const valueStr = typeof value === 'string' ? value : String(value);

          // If there's no closing quote, add one
          if (!hasClosingQuote) {
            item.insertText = valueStr + '"';
          } else {
            item.insertText = valueStr;
          }

          // Set the range to replace the current partial value
          if (valueStartPos && valueEndPos) {
            item.range = new vscode.Range(valueStartPos, valueEndPos);
          }
        }

        completionItems.push(item);
      }

      return completionItems;
    } catch (error) {
      outputChannel.appendLine(`[Completion] Error creating foreign key completions: ${error}`);
      return undefined;
    }
  }
}
