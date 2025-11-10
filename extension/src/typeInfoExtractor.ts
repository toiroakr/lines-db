import * as vscode from 'vscode';

/**
 * Field information extracted from TypeScript types
 */
export interface FieldInfo {
  name: string;
  type: string;
  optional?: boolean;
  nullable?: boolean;
  description?: string;
  enumValues?: string[];
  nested?: FieldInfo[];
  arrayElementType?: FieldInfo;
}

/**
 * Extract type information from schema file using VSCode's TypeScript Language Service
 */
export class TypeScriptTypeExtractor {
  /**
   * Extract type information from a schema file using VSCode's TypeScript extension
   */
  static async extractSchemaType(schemaFilePath: string): Promise<FieldInfo[] | undefined> {
    const outputChannel = global.__linesDbOutputChannel!;
    try {
      outputChannel.appendLine('[TypeScriptExtractor] Extracting type info from: ' + schemaFilePath);

      // Open the schema file as a TextDocument
      const uri = vscode.Uri.file(schemaFilePath);
      const document = await vscode.workspace.openTextDocument(uri);

      // Find the position of the exported schema
      const schemaPosition = await this.findSchemaExportPosition(document);
      if (!schemaPosition) {
        outputChannel.appendLine('[TypeScriptExtractor] Could not find schema export');
        return undefined;
      }
      outputChannel.appendLine('[TypeScriptExtractor] Found schema export at line ' + schemaPosition.line);

      // Get hover information at the schema position
      const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
        'vscode.executeHoverProvider',
        uri,
        schemaPosition,
      );

      if (!hovers || hovers.length === 0) {
        outputChannel.appendLine('[TypeScriptExtractor] No hover information available');
        return undefined;
      }

      // Extract type information from hover content
      const hoverContent = this.extractHoverContent(hovers);
      outputChannel.appendLine('[TypeScriptExtractor] Hover content: ' + hoverContent.substring(0, 200));

      // Parse the type information to extract fields
      const fields = this.parseTypeFromHover(hoverContent, outputChannel);
      if (!fields) {
        outputChannel.appendLine('[TypeScriptExtractor] Could not parse type from hover');
        return undefined;
      }

      outputChannel.appendLine('[TypeScriptExtractor] Extracted ' + fields.length + ' fields');
      return fields;
    } catch (error) {
      outputChannel.appendLine('[TypeScriptExtractor] Error: ' + error);
      return undefined;
    }
  }

  /**
   * Find the position of 'export const schema' or 'export default' in the document
   */
  private static async findSchemaExportPosition(
    document: vscode.TextDocument,
  ): Promise<vscode.Position | undefined> {
    const text = document.getText();

    // Look for 'export const schema'
    let match = text.match(/export\s+const\s+schema\s*=/);
    if (match && match.index !== undefined) {
      const pos = document.positionAt(match.index + match[0].indexOf('schema'));
      return pos;
    }

    // Look for 'export default'
    match = text.match(/export\s+default\s+(\w+)/);
    if (match && match.index !== undefined) {
      const pos = document.positionAt(match.index + match[0].indexOf(match[1]));
      return pos;
    }

    return undefined;
  }

  /**
   * Extract text content from hover results
   */
  private static extractHoverContent(hovers: vscode.Hover[]): string {
    const contents: string[] = [];

    for (const hover of hovers) {
      for (const content of hover.contents) {
        if (typeof content === 'string') {
          contents.push(content);
        } else if ('value' in content) {
          contents.push(content.value);
        }
      }
    }

    return contents.join('\n');
  }

  /**
   * Parse type information from hover content
   * Looks for type definitions in the format: { field: type, ... }
   */
  private static parseTypeFromHover(
    hoverContent: string,
    outputChannel: vscode.OutputChannel,
  ): FieldInfo[] | undefined {
    // Try to find a type definition that looks like an object
    // Format: const schema: BiDirectionalSchema<{ ... }, { ... }>
    // or: { id: number; name: string; ... }

    // Look for object type definition in angle brackets or after colon
    const typeMatch = hoverContent.match(/BiDirectionalSchema<[^,]+,\s*({[^}]+})/s) ||
                      hoverContent.match(/:\s*({[^}]+})/s);

    if (!typeMatch) {
      outputChannel.appendLine('[TypeScriptExtractor] No object type found in hover');
      return undefined;
    }

    const objectType = typeMatch[1];
    outputChannel.appendLine('[TypeScriptExtractor] Found object type: ' + objectType.substring(0, 100));

    return this.parseObjectType(objectType, outputChannel);
  }

  /**
   * Parse an object type string like "{ id: number; name: string; }"
   */
  private static parseObjectType(
    objectTypeStr: string,
    outputChannel: vscode.OutputChannel,
  ): FieldInfo[] | undefined {
    const fields: FieldInfo[] = [];

    // Remove outer braces
    const inner = objectTypeStr.replace(/^\s*{\s*/, '').replace(/\s*}\s*$/, '');

    // Split by semicolon or comma (but be careful with nested structures)
    const fieldStrs = this.splitFields(inner);

    for (const fieldStr of fieldStrs) {
      const trimmed = fieldStr.trim();
      if (!trimmed) continue;

      // Parse field: "name: string" or "age?: number"
      const match = trimmed.match(/^(\w+)(\?)?:\s*(.+)$/);
      if (!match) {
        outputChannel.appendLine('[TypeScriptExtractor] Could not parse field: ' + trimmed);
        continue;
      }

      const [, name, optional, typeStr] = match;
      const field = this.parseFieldType(name, typeStr.trim(), !!optional, outputChannel);

      if (field) {
        fields.push(field);
      }
    }

    return fields.length > 0 ? fields : undefined;
  }

  /**
   * Split fields by semicolon/comma, but respect nested braces
   */
  private static splitFields(str: string): string[] {
    const fields: string[] = [];
    let current = '';
    let depth = 0;

    for (let i = 0; i < str.length; i++) {
      const char = str[i];

      if (char === '{') {
        depth++;
      } else if (char === '}') {
        depth--;
      } else if ((char === ';' || char === ',') && depth === 0) {
        if (current.trim()) {
          fields.push(current.trim());
        }
        current = '';
        continue;
      }

      current += char;
    }

    if (current.trim()) {
      fields.push(current.trim());
    }

    return fields;
  }

  /**
   * Parse a field type and create FieldInfo
   */
  private static parseFieldType(
    name: string,
    typeStr: string,
    optional: boolean,
    outputChannel: vscode.OutputChannel,
  ): FieldInfo | undefined {
    // Check for array type: string[]
    if (typeStr.endsWith('[]')) {
      const elementType = typeStr.substring(0, typeStr.length - 2).trim();
      const elementField = this.parseFieldType('element', elementType, false, outputChannel);
      return {
        name,
        type: 'array',
        optional,
        arrayElementType: elementField || { name: 'element', type: 'any' },
      };
    }

    // Check for nested object type: { ... }
    if (typeStr.startsWith('{') && typeStr.endsWith('}')) {
      const nested = this.parseObjectType(typeStr, outputChannel);
      return {
        name,
        type: 'object',
        optional,
        nested: nested || [],
      };
    }

    // Check for union type
    if (typeStr.includes('|')) {
      const types = typeStr.split('|').map(t => t.trim());
      const nullable = types.includes('null');
      const nonNullTypes = types.filter(t => t !== 'null' && t !== 'undefined');

      // Check if all non-null types are string literals (enum)
      const stringLiterals = nonNullTypes.filter(t =>
        (t.startsWith('"') && t.endsWith('"')) ||
        (t.startsWith("'") && t.endsWith("'"))
      );

      if (stringLiterals.length > 0 && stringLiterals.length === nonNullTypes.length) {
        // This is a string literal union (enum)
        const enumValues = stringLiterals.map(s => s.substring(1, s.length - 1));
        return {
          name,
          type: 'enum',
          optional,
          nullable,
          enumValues,
        };
      }

      // Otherwise, use the first non-null type
      if (nonNullTypes.length > 0) {
        return {
          name,
          type: this.normalizeTypeName(nonNullTypes[0]),
          optional,
          nullable,
        };
      }
    }

    // Normalize primitive types
    return {
      name,
      type: this.normalizeTypeName(typeStr),
      optional,
      nullable: false,
    };
  }

  /**
   * Normalize type names (e.g., "string | null" -> "string" with nullable=true)
   */
  private static normalizeTypeName(typeStr: string): string {
    // Check more specific types first (array, object) before primitives
    if (typeStr.includes('[]')) return 'array';
    if (typeStr.includes('{') || typeStr.includes('}')) return 'object';
    if (typeStr.includes('string')) return 'string';
    if (typeStr.includes('number')) return 'number';
    if (typeStr.includes('boolean')) return 'boolean';
    return 'any';
  }
}
