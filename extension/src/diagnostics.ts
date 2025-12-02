import * as vscode from 'vscode';
import * as path from 'path';
import { TempFileManager } from './tempFileManager.js';

// Get LinesDB and SchemaLoader from the workspace module
function getLinesDB() {
  return global.__linesDbModule?.LinesDB;
}

function getSchemaLoader() {
  return global.__linesDbModule?.SchemaLoader;
}

export class DiagnosticsProvider {
  private diagnosticCollection: vscode.DiagnosticCollection;
  private disposables: vscode.Disposable[] = [];

  constructor() {
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection('lines-db');

    // Watch for document changes
    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument((doc) => this.validateDocument(doc)),
    );
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => this.validateDocument(e.document)),
    );
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument((doc) => this.validateDocument(doc)),
    );

    // Watch for schema file saves and revalidate corresponding JSONL files
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument(async (doc) => {
        // Check if this is a schema file
        if (doc.fileName.endsWith('.schema.ts')) {
          await this.revalidateRelatedJsonlFiles(doc);
        }
      }),
    );

    // Validate all open JSONL documents
    vscode.workspace.textDocuments.forEach((doc) => {
      if (doc.languageId === 'jsonl' || doc.fileName.endsWith('.jsonl')) {
        this.validateDocument(doc);
      }
    });
  }

  private async revalidateRelatedJsonlFiles(schemaDocument: vscode.TextDocument) {
    // Extract table name from schema file name (e.g., "users.schema.ts" -> "users")
    const schemaFileName = path.basename(schemaDocument.fileName);
    const tableName = schemaFileName.replace('.schema.ts', '');

    // Find corresponding JSONL file in the same directory
    const dirPath = path.dirname(schemaDocument.fileName);
    const jsonlFileName = `${tableName}.jsonl`;
    const jsonlFilePath = path.join(dirPath, jsonlFileName);

    // Find and validate the JSONL document if it's open
    const jsonlDoc = vscode.workspace.textDocuments.find((doc) => doc.uri.fsPath === jsonlFilePath);

    if (jsonlDoc) {
      // If the JSONL file is open, revalidate it
      await this.validateDocument(jsonlDoc);
    } else {
      // If not open, try to validate all JSONL files in the directory
      // This handles cases where the file isn't open but we still want to update diagnostics
      const openJsonlDocs = vscode.workspace.textDocuments.filter(
        (doc) =>
          (doc.languageId === 'jsonl' || doc.fileName.endsWith('.jsonl')) &&
          path.dirname(doc.uri.fsPath) === dirPath,
      );

      for (const doc of openJsonlDocs) {
        await this.validateDocument(doc);
      }
    }
  }

  private async validateDocument(document: vscode.TextDocument) {
    // Check if this is a temp edit file
    const isTempFile = TempFileManager.isTempFilePattern(document.uri.fsPath);

    // Only validate JSONL files or temp edit files
    if (!isTempFile && document.languageId !== 'jsonl' && !document.fileName.endsWith('.jsonl')) {
      return;
    }

    // Check if diagnostics are enabled
    const config = vscode.workspace.getConfiguration('lines-db');
    if (!config.get<boolean>('enableDiagnostics')) {
      return;
    }

    // Skip validation for preview files (they are validated separately with explicit schema)
    const filePath = document.uri.fsPath;
    if (filePath.includes('.preview.jsonl')) {
      return;
    }

    // Handle temp file validation separately
    if (isTempFile) {
      await this.validateTempFile(document);
      return;
    }

    try {
      const dirPath = path.dirname(filePath);
      const outputChannel = global.__linesDbOutputChannel;
      if (outputChannel) {
        outputChannel.appendLine(`[Diagnostics] Validating ${filePath}`);
      }

      // Validate entire directory to check foreign key constraints
      const Validator = global.__linesDbModule?.Validator;
      if (!Validator) {
        if (outputChannel) {
          outputChannel.appendLine(`[Diagnostics] Validator not available from workspace`);
        }
        return;
      }
      const validator = new Validator({ path: dirPath });
      const result = await validator.validate();

      const diagnostics: vscode.Diagnostic[] = [];

      if (!result.valid) {
        // Filter errors for the current file only
        const fileErrors = result.errors.filter((error) => error.file === filePath);

        for (const error of fileErrors) {
          // Create diagnostics for each validation error
          const line = error.rowIndex; // rowIndex is already 0-based
          const range = new vscode.Range(line, 0, line, Number.MAX_VALUE);

          let message = '';

          // Handle different error types
          if (error.type === 'foreignKey' && error.foreignKeyError) {
            // Foreign key constraint error
            const fk = error.foreignKeyError;
            message = `Foreign key constraint failed: ${fk.column} = ${JSON.stringify(fk.value)} does not exist in ${fk.referencedTable}.${fk.referencedColumn}`;
          } else {
            // Schema validation error
            const messages = error.issues.map((issue) => {
              let pathStr = '';
              if (issue.path && issue.path.length > 0) {
                pathStr = issue.path
                  .map((segment) => {
                    if (typeof segment === 'object' && segment !== null && 'key' in segment) {
                      return String(segment.key);
                    }
                    return String(segment);
                  })
                  .join('.');
                return `${pathStr}: ${issue.message}`;
              }
              return issue.message;
            });
            message = messages.join('\n');
          }

          const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
          diagnostic.source = 'lines-db';
          diagnostics.push(diagnostic);
        }
      }

      this.diagnosticCollection.set(document.uri, diagnostics);
    } catch (error) {
      // If validation fails (e.g., no schema), clear diagnostics for this document only
      const outputChannel = global.__linesDbOutputChannel;
      if (outputChannel) {
        outputChannel.appendLine(`[Diagnostics] Validation error for ${filePath}: ${error}`);
      }
      this.diagnosticCollection.set(document.uri, []);
    }
  }

  /**
   * Validate a temporary edit file
   */
  private async validateTempFile(document: vscode.TextDocument) {
    try {
      // Get the original JSONL file path from TempFileManager
      const tempFileManager = global.__tempFileManager;
      if (!tempFileManager) {
        return;
      }

      const tempFileInfo = tempFileManager.getTempFileInfo(document.uri);
      if (!tempFileInfo) {
        return;
      }

      const originalJsonlPath = tempFileInfo.originalUri.fsPath;

      // Read and parse the temp file content
      const content = document.getText();
      let parsedData: unknown;
      try {
        parsedData = JSON.parse(content);
      } catch (parseError) {
        // If JSON is invalid, show a parse error diagnostic
        const diagnostic = new vscode.Diagnostic(
          new vscode.Range(0, 0, document.lineCount - 1, Number.MAX_VALUE),
          `Invalid JSON: ${parseError}`,
          vscode.DiagnosticSeverity.Error,
        );
        diagnostic.source = 'lines-db';
        this.diagnosticCollection.set(document.uri, [diagnostic]);
        return;
      }

      // Load the schema for the original JSONL file
      const SchemaLoader = getSchemaLoader();
      if (!SchemaLoader) {
        throw new Error('SchemaLoader not available from workspace');
      }
      const schema = (await SchemaLoader.loadSchema(originalJsonlPath)) as {
        '~standard': {
          validate: (data: unknown) => {
            issues?: Array<{ message: string; path?: unknown[] }>;
          };
        };
      };

      // Validate the data against the schema
      const result = schema['~standard'].validate(parsedData);

      // Check if validation is asynchronous (should not be)
      if (result instanceof Promise) {
        throw new Error('Asynchronous validation is not supported.');
      }

      const diagnostics: vscode.Diagnostic[] = [];

      // If there are validation issues, create diagnostics
      if (result.issues && result.issues.length > 0) {
        // Group issues by path to create more targeted diagnostics
        for (const issue of result.issues) {
          // Try to determine the line in the formatted JSON
          let line = 0;
          let message = issue.message;

          if (issue.path && issue.path.length > 0) {
            const pathStr = issue.path
              .map((segment: unknown) => {
                if (typeof segment === 'object' && segment !== null && 'key' in segment) {
                  return String((segment as { key: unknown }).key);
                }
                return String(segment);
              })
              .join('.');

            // Search for the field in the document
            const fieldName = issue.path[issue.path.length - 1];
            const fieldStr =
              typeof fieldName === 'object' && fieldName !== null && 'key' in fieldName
                ? String(fieldName.key)
                : String(fieldName);

            const searchPattern = `"${fieldStr}"`;
            const text = document.getText();
            const index = text.indexOf(searchPattern);
            if (index !== -1) {
              line = document.positionAt(index).line;
            }

            message = `${pathStr}: ${issue.message}`;
          }

          const range = new vscode.Range(line, 0, line, Number.MAX_VALUE);
          const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
          diagnostic.source = 'lines-db';
          diagnostics.push(diagnostic);
        }
      }

      this.diagnosticCollection.set(document.uri, diagnostics);
    } catch (error) {
      // If validation fails (e.g., no schema), clear diagnostics for this document
      this.diagnosticCollection.set(document.uri, []);
      console.error('Failed to validate temp file:', error);
    }
  }

  dispose() {
    this.diagnosticCollection.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
