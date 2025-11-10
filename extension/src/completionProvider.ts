import * as vscode from 'vscode';
import * as path from 'node:path';
import { TypeScriptTypeExtractor, type FieldInfo } from './typeInfoExtractor.js';
import { hasQuoteBefore, hasQuoteAfter, generateFieldNameInsertText } from './quoteHelper.js';

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

      // Analyze cursor context
      const context = this.analyzeContext(document, position);
      if (!context) {
        outputChannel.appendLine('[Completion] Failed to analyze context');
        return undefined;
      }
      outputChannel.appendLine('[Completion] Context: ' + JSON.stringify(context));

      // Find the relevant field info for the current path
      const fieldInfo = this.findFieldsForPath(fields, context.path);
      if (!fieldInfo) {
        outputChannel.appendLine('[Completion] No field info found for path');
        return undefined;
      }
      outputChannel.appendLine('[Completion] Found field info: ' + fieldInfo.length + ' fields');

      // Generate completion items
      if (context.isFieldName) {
        outputChannel.appendLine('[Completion] Generating field name completions');
        return this.createFieldNameCompletions(
          fieldInfo,
          context.existingFields,
          document,
          position,
        );
      } else {
        outputChannel.appendLine('[Completion] Generating value completions');
        return this.createValueCompletions(fieldInfo, document, position);
      }
    } catch (error) {
      outputChannel.appendLine('[Completion] Error providing completions: ' + error);
      return undefined;
    }
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
   * Analyze the context at the cursor position
   */
  private analyzeContext(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): JsonContext | undefined {
    const line = document.lineAt(position.line).text;
    const beforeCursor = line.substring(0, position.character);

    // Simple heuristic to determine if we're in a field name or value
    // Look for the last unquoted colon
    const isFieldName = this.isInFieldNamePosition(beforeCursor);

    // Extract path and existing fields
    const path = this.extractPath(beforeCursor);
    const existingFields = this.extractExistingFields(beforeCursor);

    return {
      isFieldName,
      path,
      existingFields,
    };
  }

  /**
   * Check if cursor is in a position to complete a field name
   */
  private isInFieldNamePosition(textBeforeCursor: string): boolean {
    // Remove quoted strings to avoid false positives
    const withoutStrings = this.removeQuotedStrings(textBeforeCursor);

    // Count colons and commas after the last opening brace
    const lastBrace = withoutStrings.lastIndexOf('{');
    if (lastBrace === -1) return false;

    const afterBrace = withoutStrings.substring(lastBrace);

    // Check if we're inside quotes
    const quoteCount = (textBeforeCursor.match(/"/g) || []).length;
    const insideQuotes = quoteCount % 2 === 1;

    // If inside quotes after a colon, we're in a value
    const colonIndex = afterBrace.lastIndexOf(':');
    if (colonIndex !== -1 && insideQuotes) {
      const afterColon = afterBrace.substring(colonIndex + 1).trim();
      if (afterColon.length === 0 || afterColon === '"') {
        return false;
      }
    }

    // Otherwise, if inside quotes or after comma/brace, we're in a field name
    return (
      insideQuotes ||
      afterBrace.endsWith(',') ||
      afterBrace.endsWith('{') ||
      /[,{]\s*$/.test(afterBrace)
    );
  }

  /**
   * Remove quoted strings from text
   */
  private removeQuotedStrings(text: string): string {
    return text.replace(/"(?:\\.|[^"\\])*"/g, '""');
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
   * Extract existing fields in the current object
   */
  private extractExistingFields(textBeforeCursor: string): Set<string> {
    const fields = new Set<string>();

    // Find the last opening brace
    const lastBrace = textBeforeCursor.lastIndexOf('{');
    if (lastBrace === -1) return fields;

    const objectText = textBeforeCursor.substring(lastBrace);

    // Extract field names using regex
    const fieldPattern = /"([^"]+)"\s*:/g;
    let match;
    while ((match = fieldPattern.exec(objectText)) !== null) {
      fields.add(match[1]);
    }

    return fields;
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
   * Create completion items for field names
   */
  private createFieldNameCompletions(
    fields: FieldInfo[],
    existingFields: Set<string>,
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] {
    const line = document.lineAt(position.line).text;
    const beforeCursor = line.substring(0, position.character);
    const afterCursor = line.substring(position.character);

    outputChannel.appendLine(
      `[Completion] Field name completion - beforeCursor: "${beforeCursor}", afterCursor: "${afterCursor}"`,
    );

    // Check if there's already a quote before/after the cursor
    const quoteBefore = hasQuoteBefore(beforeCursor);
    const quoteAfter = hasQuoteAfter(afterCursor);

    outputChannel.appendLine(`[Completion] quoteBefore: ${quoteBefore}, quoteAfter: ${quoteAfter}`);

    return fields
      .filter((field) => !existingFields.has(field.name))
      .map((field) => {
        const item = new vscode.CompletionItem(field.name, vscode.CompletionItemKind.Field);

        // Add type information in detail
        item.detail = this.formatFieldType(field);

        // Add documentation
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

        // Generate insert text using helper function
        const insertText = generateFieldNameInsertText(field.name, field.type, quoteBefore);

        item.insertText = new vscode.SnippetString(insertText);

        // Set the range to replace
        if (quoteBefore && !quoteAfter) {
          // Case: "gende| or "gende |
          // We need to replace from the opening quote to cursor
          // Find the last quote position in beforeCursor
          const lastQuoteIndex = beforeCursor.lastIndexOf('"');
          outputChannel.appendLine(
            `[Completion] quoteBefore=true, quoteAfter=false, lastQuoteIndex=${lastQuoteIndex}, position.character=${position.character}`,
          );
          if (lastQuoteIndex !== -1) {
            const start = position.translate(0, -(position.character - lastQuoteIndex));
            const end = position;
            item.range = new vscode.Range(start, end);

            // Set filterText to the partial field name (without quotes)
            // This allows VSCode to match user input with completion items
            const partialFieldName = beforeCursor.substring(lastQuoteIndex + 1);
            item.filterText = partialFieldName;

            outputChannel.appendLine(
              `[Completion] Setting item.range from (${start.line}, ${start.character}) to (${end.line}, ${end.character})`,
            );
            outputChannel.appendLine(
              `[Completion] This will replace: ${beforeCursor.substring(lastQuoteIndex)}`,
            );
            outputChannel.appendLine(`[Completion] filterText set to: "${partialFieldName}"`);
          }
        } else if (quoteBefore && quoteAfter) {
          // Case: "gende|" or "|"
          // We need to replace from the opening quote to the closing quote
          const lastQuoteIndex = beforeCursor.lastIndexOf('"');
          if (lastQuoteIndex !== -1) {
            const start = position.translate(0, -(position.character - lastQuoteIndex));
            const end = position.translate(0, 1); // Include closing quote
            item.range = new vscode.Range(start, end);

            // Set filterText to the partial field name (without quotes)
            const partialFieldName = beforeCursor.substring(lastQuoteIndex + 1);
            item.filterText = partialFieldName;

            outputChannel.appendLine(
              `[Completion] Setting item.range (quoteBefore && quoteAfter) from (${start.line}, ${start.character}) to (${end.line}, ${end.character})`,
            );
            outputChannel.appendLine(`[Completion] filterText set to: "${partialFieldName}"`);
          }
        } else if (!quoteBefore && quoteAfter) {
          // Case: |"
          // Just replace the closing quote
          const start = position;
          const end = position.translate(0, 1);
          item.range = new vscode.Range(start, end);
          outputChannel.appendLine(
            `[Completion] Setting item.range (!quoteBefore && quoteAfter) from (${start.line}, ${start.character}) to (${end.line}, ${end.character})`,
          );
        }
        // If no quotes, use default behavior (replace current word)

        return item;
      });
  }

  /**
   * Create completion items for values
   */
  private createValueCompletions(
    fields: FieldInfo[],
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] | undefined {
    const line = document.lineAt(position.line).text;
    const beforeCursor = line.substring(0, position.character);
    const afterCursor = line.substring(position.character);
    outputChannel.appendLine('[Completion] beforeCursor: ' + beforeCursor);
    outputChannel.appendLine('[Completion] afterCursor: ' + afterCursor);

    // Find the current field name
    const fieldName = this.findCurrentFieldName(beforeCursor);
    outputChannel.appendLine('[Completion] fieldName: ' + (fieldName || 'NOT FOUND'));
    if (!fieldName) {
      return undefined;
    }

    // Find the corresponding field info
    const field = fields.find((f) => f.name === fieldName);
    outputChannel.appendLine(
      '[Completion] field: ' +
        (field
          ? JSON.stringify({ name: field.name, type: field.type, enumValues: field.enumValues })
          : 'NOT FOUND'),
    );
    if (!field) {
      return undefined;
    }

    // Check if cursor is inside quotes
    const quoteCount = (beforeCursor.match(/"/g) || []).length;
    const insideQuotes = quoteCount % 2 === 1;
    outputChannel.appendLine('[Completion] insideQuotes: ' + insideQuotes);

    // Extract current value if any (for filtering)
    let currentValue = '';
    let valueStartPos: vscode.Position | undefined;
    let valueEndPos: vscode.Position | undefined;

    if (insideQuotes) {
      // Find the opening quote
      const lastQuoteIndex = beforeCursor.lastIndexOf('"');
      if (lastQuoteIndex !== -1) {
        currentValue = beforeCursor.substring(lastQuoteIndex + 1);
        valueStartPos = position.translate(0, -(position.character - lastQuoteIndex - 1));

        // Find the closing quote
        const nextQuoteIndex = afterCursor.indexOf('"');
        if (nextQuoteIndex !== -1) {
          valueEndPos = position.translate(0, nextQuoteIndex);
        } else {
          valueEndPos = position;
        }
      }
      outputChannel.appendLine('[Completion] currentValue: "' + currentValue + '"');
      outputChannel.appendLine(
        `[Completion] valueRange: ${valueStartPos ? `(${valueStartPos.line}, ${valueStartPos.character})` : 'none'} to ${valueEndPos ? `(${valueEndPos.line}, ${valueEndPos.character})` : 'none'}`
      );
    }

    // Generate completions based on field type
    if (field.enumValues && field.enumValues.length > 0) {
      outputChannel.appendLine(
        '[Completion] Returning enum completions: ' + field.enumValues.join(', '),
      );
      return this.createEnumCompletions(
        field.enumValues,
        insideQuotes,
        currentValue,
        valueStartPos,
        valueEndPos
      );
    }

    if (field.type === 'boolean') {
      outputChannel.appendLine('[Completion] Returning boolean completions');
      return this.createBooleanCompletions();
    }

    // For other types, return undefined to use default behavior
    outputChannel.appendLine('[Completion] No specific completions for type: ' + field.type);
    return undefined;
  }

  /**
   * Find the current field name being assigned
   */
  private findCurrentFieldName(textBeforeCursor: string): string | undefined {
    // Look for the last field name before a colon
    const match = textBeforeCursor.match(/"([^"]+)"\s*:\s*(?:"[^"]*)?$/);
    return match ? match[1] : undefined;
  }

  /**
   * Create enum value completions
   */
  private createEnumCompletions(
    values: string[],
    insideQuotes: boolean,
    currentValue: string = '',
    valueStartPos?: vscode.Position,
    valueEndPos?: vscode.Position,
  ): vscode.CompletionItem[] {
    return values.map((value) => {
      const item = new vscode.CompletionItem(value, vscode.CompletionItemKind.EnumMember);
      item.detail = 'enum value';

      // If cursor is not inside quotes, wrap the value in quotes
      if (!insideQuotes) {
        item.insertText = `"${value}"`;
      } else {
        // If cursor is inside quotes, just insert the value
        item.insertText = value;

        // Set the range to replace the current partial value
        // VSCode will automatically filter completions based on the text in this range
        if (valueStartPos && valueEndPos) {
          item.range = new vscode.Range(valueStartPos, valueEndPos);
          outputChannel.appendLine(
            `[Completion] Setting enum completion range from (${valueStartPos.line}, ${valueStartPos.character}) to (${valueEndPos.line}, ${valueEndPos.character}) for value "${value}"`
          );
          outputChannel.appendLine(
            `[Completion] VSCode will filter "${value}" against current input "${currentValue}"`
          );
        }
      }

      return item;
    });
  }

  /**
   * Create boolean value completions
   */
  private createBooleanCompletions(): vscode.CompletionItem[] {
    const trueItem = new vscode.CompletionItem('true', vscode.CompletionItemKind.Value);
    const falseItem = new vscode.CompletionItem('false', vscode.CompletionItemKind.Value);

    // Boolean values don't need quotes in JSON
    // So we don't modify insertText based on insideQuotes

    return [trueItem, falseItem];
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
}
