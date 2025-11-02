import * as vscode from 'vscode';
import * as path from 'path';

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
    // Only validate JSONL files
    if (document.languageId !== 'jsonl' && !document.fileName.endsWith('.jsonl')) {
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

    try {
      const dirPath = path.dirname(filePath);

      // Dynamically import lines-db to avoid bundling issues
      const { Validator } = await import('lines-db');

      // Validate entire directory to check foreign key constraints
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
            message = messages.join(', ');
          }

          const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
          diagnostic.source = 'lines-db';
          diagnostics.push(diagnostic);
        }
      }

      this.diagnosticCollection.set(document.uri, diagnostics);
    } catch (_error) {
      // If validation fails (e.g., no schema), clear diagnostics for this document only
      this.diagnosticCollection.set(document.uri, []);
    }
  }

  dispose() {
    this.diagnosticCollection.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
