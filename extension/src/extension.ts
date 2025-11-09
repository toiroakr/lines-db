import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { registerCommands } from './commands';
import { DiagnosticsProvider } from './diagnostics';
import { JsonlCodeLensProvider } from './codeLens';
import { JsonlHoverProvider } from './hover';
import { MigrationSessionManager } from './migrationSession';
import { MigrationCodeLensProvider } from './migrationCodeLens';
import { MigrationValidator } from './migrationValidator';
import { TempFileManager } from './tempFileManager';
import { JsonlDocumentLinkProvider } from './documentLinkProvider';
import { JsonlCodeActionProvider } from './codeActionProvider';

function getTabUri(tab: vscode.Tab): vscode.Uri | undefined {
  const input = tab.input;
  if (!input) {
    return undefined;
  }

  const recordInput = input as Record<string, unknown>;
  const directUri = recordInput.uri;
  if (directUri instanceof vscode.Uri) {
    return directUri;
  }

  const originalUri = recordInput.original;
  if (originalUri instanceof vscode.Uri) {
    return originalUri;
  }

  return undefined;
}

// Create output channel for debugging
const outputChannel = vscode.window.createOutputChannel('LinesDB');

// Intercept ALL console methods at extension startup
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
console.log = (...args: any[]) => {
  const message = args
    .map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a)))
    .join(' ');
  outputChannel.appendLine(`[LOG] ${message}`);
  originalLog(...args);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
console.warn = (...args: any[]) => {
  const message = args
    .map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a)))
    .join(' ');
  outputChannel.appendLine(`[WARN] ${message}`);
  originalWarn(...args);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
console.error = (...args: any[]) => {
  const message = args
    .map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a)))
    .join(' ');
  outputChannel.appendLine(`[ERROR] ${message}`);
  originalError(...args);
};

export async function activate(context: vscode.ExtensionContext) {
  outputChannel.appendLine('=== LinesDB Extension Activating ===');
  console.log('LinesDB extension is now active');
  context.subscriptions.push(outputChannel);

  // Load @toiroakr/lines-db and tsx from workspace
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders && workspaceFolders.length > 0) {
    const workspaceRoot = workspaceFolders[0].uri.fsPath;

    // Try to load @toiroakr/lines-db from workspace
    try {
      // Dynamic require is necessary here to load from user's workspace

      const nodeRequire = require;
      const linesDbPath = nodeRequire.resolve('@toiroakr/lines-db', { paths: [workspaceRoot] });
      outputChannel.appendLine(`Found @toiroakr/lines-db at: ${linesDbPath}`);

      global.__linesDbModule = nodeRequire(linesDbPath);
      outputChannel.appendLine('@toiroakr/lines-db loaded successfully');
    } catch (linesDbError) {
      outputChannel.appendLine(`@toiroakr/lines-db not found in workspace: ${linesDbError}`);
      vscode.window.showWarningMessage(
        'LinesDB extension requires @toiroakr/lines-db to be installed in your workspace. Please run: pnpm add @toiroakr/lines-db',
      );
    }

    // Register tsx for TypeScript schema file support
    try {
      // Dynamic imports are necessary for runtime module loading

      const nodeRequire = require;
      const { register } = await import('node:module');
      const { pathToFileURL } = await import('node:url');

      try {
        // Try to resolve tsx entry point from workspace's node_modules
        const tsxPath = nodeRequire.resolve('tsx', { paths: [workspaceRoot] });
        outputChannel.appendLine(`Found tsx at: ${tsxPath}`);

        // Register tsx using the workspace path as parent URL
        register('tsx', pathToFileURL(workspaceRoot + '/'), { data: {} });
        outputChannel.appendLine('tsx registered successfully');
      } catch (tsxError) {
        outputChannel.appendLine(
          `tsx not found in workspace, TypeScript schemas may not work: ${tsxError}`,
        );
      }
    } catch (error) {
      outputChannel.appendLine(`Failed to register tsx: ${error}`);
    }
  }

  // Make output channel globally accessible
  global.__linesDbOutputChannel = outputChannel;

  // Initialize migration session manager
  outputChannel.appendLine('Initializing MigrationSessionManager...');
  MigrationSessionManager.initialize(context);
  outputChannel.appendLine('MigrationSessionManager initialized');

  // Initialize temp file manager
  outputChannel.appendLine('Initializing TempFileManager...');
  const tempFileManager = new TempFileManager(context);
  global.__tempFileManager = tempFileManager;
  context.subscriptions.push(tempFileManager);
  outputChannel.appendLine('TempFileManager initialized');

  // Register commands
  registerCommands(context);

  // Register diagnostics provider
  const diagnosticsProvider = new DiagnosticsProvider();
  context.subscriptions.push(diagnosticsProvider);

  // Register CodeLens provider for JSONL files
  const codeLensProvider = new JsonlCodeLensProvider();
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ language: 'jsonl' }, codeLensProvider),
  );

  // Register CodeLens provider for migration files
  const migrationCodeLensProvider = new MigrationCodeLensProvider();
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { language: 'typescript' },
      migrationCodeLensProvider,
    ),
  );

  // Register Hover provider for schema files
  const hoverProvider = new JsonlHoverProvider();
  context.subscriptions.push(
    vscode.languages.registerHoverProvider({ pattern: '**/*.schema.ts' }, hoverProvider),
  );

  // Register DocumentLink provider for JSONL files
  const documentLinkProvider = new JsonlDocumentLinkProvider();
  context.subscriptions.push(
    vscode.languages.registerDocumentLinkProvider({ language: 'jsonl' }, documentLinkProvider),
  );

  // Register CodeAction provider for JSONL files
  const codeActionProvider = new JsonlCodeActionProvider();
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider({ language: 'jsonl' }, codeActionProvider),
  );

  // Watch for migration file saves
  const watcher = vscode.workspace.onDidSaveTextDocument(async (document) => {
    outputChannel.appendLine(`\n[File Saved] ${document.uri.fsPath}`);

    // Check if this is a migration file
    const session = MigrationSessionManager.getSession(document.uri.fsPath);
    if (!session) {
      outputChannel.appendLine('  -> Not a migration file, ignoring');
      return;
    }

    outputChannel.appendLine('\n=== Migration File Saved ===');
    outputChannel.appendLine(`File: ${document.uri.fsPath}`);
    outputChannel.appendLine(`Table: ${session.tableName}`);
    outputChannel.appendLine(`Data dir: ${session.dataDir}`);
    outputChannel.appendLine(`Original file: ${session.originalFilePath}`);

    // Validate migration on save
    outputChannel.appendLine('\n--- Starting Validation ---');
    try {
      const result = await MigrationValidator.validate(document.uri.fsPath);
      outputChannel.appendLine(
        `Validation complete: valid=${result.valid}, errors=${result.errors.length}, transformedRows=${result.transformedRows?.length || 0}`,
      );

      // Always clear diagnostics from migration file
      MigrationSessionManager.clearDiagnostics(document.uri);

      // Generate preview if we have transformed rows (even with errors)
      if (result.transformedRows && result.transformedRows.length > 0) {
        outputChannel.appendLine('\n--- Generating Preview File ---');
        const previewFileName = `${session.tableName}.preview.jsonl`;
        const previewFilePath = path.join(os.tmpdir(), previewFileName);
        outputChannel.appendLine(`Preview file path: ${previewFilePath}`);

        const fs = await import('fs');
        const jsonlContent = result.transformedRows.map((row) => JSON.stringify(row)).join('\n');
        outputChannel.appendLine(
          `Writing ${result.transformedRows.length} rows to preview file...`,
        );
        fs.writeFileSync(previewFilePath, jsonlContent, 'utf-8');
        outputChannel.appendLine('Preview file written successfully');

        // Update session
        MigrationSessionManager.updatePreviewPath(document.uri.fsPath, previewFilePath);
        outputChannel.appendLine('Session updated with preview path');

        // Refresh CodeLens to show preview button
        migrationCodeLensProvider.refresh();
        outputChannel.appendLine('CodeLens refreshed');

        // Auto-open preview (below the migration file)
        outputChannel.appendLine('\n--- Opening Preview File ---');
        const previewDoc = await vscode.workspace.openTextDocument(previewFilePath);
        const previewUri = previewDoc.uri;
        outputChannel.appendLine(`Preview document opened: ${previewUri.toString()}`);

        // Check if preview is already open
        let previewAlreadyOpen = false;
        for (const tabGroup of vscode.window.tabGroups.all) {
          for (const tab of tabGroup.tabs) {
            const tabUri = getTabUri(tab);
            if (tabUri && tabUri.fsPath === previewUri.fsPath) {
              previewAlreadyOpen = true;
              break;
            }
          }
          if (previewAlreadyOpen) break;
        }

        if (!previewAlreadyOpen) {
          // First time - split editor down to create a group below
          await vscode.commands.executeCommand('workbench.action.splitEditorDown');

          // Close the duplicated migration file in the lower group
          // (splitEditorDown copies the current file to the new group)
          await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        }

        // Validate preview file content directly with schema
        outputChannel.appendLine('\n--- Validating Preview Content ---');
        outputChannel.appendLine(`Number of rows to validate: ${result.transformedRows.length}`);
        outputChannel.appendLine(`DataDir: ${session.dataDir}`);
        outputChannel.appendLine(`TableName: ${session.tableName}`);
        outputChannel.appendLine('Transformed rows:');
        for (let i = 0; i < result.transformedRows.length; i++) {
          outputChannel.appendLine(`  Row ${i}: ${JSON.stringify(result.transformedRows[i])}`);
        }

        let previewValidationSuccess = false;
        try {
          outputChannel.appendLine('Loading schema file directly...');
          const path = await import('path');
          const schemaPath = path.join(session.dataDir, `${session.tableName}.schema.ts`);
          outputChannel.appendLine(`Schema path: ${schemaPath}`);

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let schema: any;
          try {
            // Try to load the schema file
            const fs = await import('fs');
            const schemaExists = fs.existsSync(schemaPath);
            outputChannel.appendLine(`Schema file exists: ${schemaExists}`);

            if (schemaExists) {
              outputChannel.appendLine('Importing schema...');
              const schemaModule = await import(schemaPath);
              schema = schemaModule.schema || schemaModule.default;
              outputChannel.appendLine(`Schema loaded: ${!!schema}`);
              outputChannel.appendLine(`Schema type: ${typeof schema}`);
              outputChannel.appendLine(`Schema has ~standard: ${'~standard' in schema}`);
            }
          } catch (err) {
            outputChannel.appendLine(`Failed to load schema: ${err}`);
          }

          // If we have a schema, validate directly
          if (schema && '~standard' in schema) {
            outputChannel.appendLine('Validating rows directly with schema...');
            const validationErrors: Array<{
              rowIndex: number;
              rowData: Record<string, unknown>;
              error: { issues: Array<{ message: string; path?: Array<unknown> }> };
            }> = [];

            for (let i = 0; i < result.transformedRows.length; i++) {
              const row = result.transformedRows[i];
              outputChannel.appendLine(`Validating row ${i}: ${JSON.stringify(row)}`);
              const validationResult = schema['~standard'].validate(row);
              outputChannel.appendLine(
                `Row ${i} validation result: ${JSON.stringify(validationResult)}`,
              );

              if (validationResult.issues && validationResult.issues.length > 0) {
                outputChannel.appendLine(
                  `Row ${i}: INVALID - ${validationResult.issues.length} issues`,
                );
                validationErrors.push({
                  rowIndex: i,
                  rowData: row,
                  error: { issues: validationResult.issues },
                });
              } else {
                outputChannel.appendLine(`Row ${i}: VALID`);
              }
            }

            if (validationErrors.length > 0) {
              outputChannel.appendLine(`Total validation errors: ${validationErrors.length}`);
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const error: any = new Error(
                `Validation failed for ${validationErrors.length} row(s)`,
              );
              error.name = 'ValidationError';
              error.validationErrors = validationErrors;
              throw error;
            }
          } else {
            outputChannel.appendLine(
              'No schema found or schema invalid, using ensureTableRowsValid fallback',
            );
            if (global.__linesDbModule?.ensureTableRowsValid) {
              await global.__linesDbModule.ensureTableRowsValid({
                dataDir: session.dataDir,
                tableName: session.tableName,
                rows: result.transformedRows,
              });
            } else {
              outputChannel.appendLine('linesDbModule not available, skipping validation');
            }
          }

          outputChannel.appendLine('Preview validation: SUCCESS');
          // If validation succeeds, clear diagnostics
          MigrationSessionManager.clearDiagnostics(previewDoc.uri);
          previewValidationSuccess = true;
        } catch (validationError) {
          // Process validation errors for transformedRows
          outputChannel.appendLine('Preview validation: FAILED');
          outputChannel.appendLine(`Error type: ${typeof validationError}`);
          outputChannel.appendLine(`Error: ${validationError}`);
          outputChannel.appendLine(`Error name: ${(validationError as any)?.name}`);
          outputChannel.appendLine(
            `Has validationErrors: ${(validationError as any)?.validationErrors !== undefined}`,
          );

          const diagnostics: vscode.Diagnostic[] = [];

          if (
            validationError &&
            typeof validationError === 'object' &&
            'name' in validationError &&
            (validationError as { name: unknown }).name === 'ValidationError' &&
            'validationErrors' in validationError &&
            Array.isArray((validationError as { validationErrors?: unknown }).validationErrors)
          ) {
            outputChannel.appendLine('Validation error structure matches expected format');
            const validationErrors = (
              validationError as {
                validationErrors: Array<{
                  rowIndex: number;
                  rowData: Record<string, unknown>;
                  error: { issues: Array<{ message: string; path?: Array<unknown> }> };
                }>;
              }
            ).validationErrors;

            outputChannel.appendLine(`Number of validation errors: ${validationErrors.length}`);

            for (const { rowIndex, error: rowError } of validationErrors) {
              outputChannel.appendLine(`Processing error for rowIndex=${rowIndex}`);
              outputChannel.appendLine(`  Issues count: ${rowError.issues.length}`);

              const messages = rowError.issues.map((issue) => {
                outputChannel.appendLine(`  Issue: ${JSON.stringify(issue)}`);
                let pathStr = 'root';
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

              const message = messages.join(', ');
              outputChannel.appendLine(`  Combined message: ${message}`);

              const range = new vscode.Range(rowIndex, 0, rowIndex, Number.MAX_VALUE);
              outputChannel.appendLine(`  Range: line ${rowIndex}, col 0 to ${Number.MAX_VALUE}`);

              const diagnostic = new vscode.Diagnostic(
                range,
                message,
                vscode.DiagnosticSeverity.Error,
              );
              diagnostic.source = 'lines-db-migration';
              diagnostics.push(diagnostic);
              outputChannel.appendLine(`  Diagnostic created and added to array`);
            }
          } else {
            outputChannel.appendLine(
              'ERROR: Validation error structure does NOT match expected format',
            );
            outputChannel.appendLine(
              `  Check 1 - is object: ${typeof validationError === 'object'}`,
            );
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            outputChannel.appendLine(`  Check 2 - has name: ${'name' in (validationError as any)}`);
            outputChannel.appendLine(
              `  Check 3 - name is ValidationError: ${(validationError as any)?.name === 'ValidationError'}`,
            );
            outputChannel.appendLine(
              `  Check 4 - has validationErrors: ${'validationErrors' in (validationError as any)}`,
            );
            outputChannel.appendLine(
              `  Check 5 - validationErrors is array: ${Array.isArray((validationError as any)?.validationErrors)}`,
            );
          }

          outputChannel.appendLine(
            `FINAL: Setting ${diagnostics.length} diagnostics on preview file`,
          );
          outputChannel.appendLine(`Preview URI: ${previewDoc.uri.toString()}`);
          outputChannel.appendLine(`Preview URI scheme: ${previewDoc.uri.scheme}`);
          outputChannel.appendLine(`Preview URI fsPath: ${previewDoc.uri.fsPath}`);

          for (let i = 0; i < diagnostics.length; i++) {
            const diag = diagnostics[i];
            outputChannel.appendLine(`  Diagnostic ${i}:`);
            outputChannel.appendLine(`    line=${diag.range.start.line}`);
            outputChannel.appendLine(`    message=${diag.message}`);
            outputChannel.appendLine(`    severity=${diag.severity}`);
            outputChannel.appendLine(`    source=${diag.source}`);
          }

          outputChannel.appendLine('Calling MigrationSessionManager.setDiagnostics...');
          MigrationSessionManager.setDiagnostics(previewDoc.uri, diagnostics);
          outputChannel.appendLine('MigrationSessionManager.setDiagnostics returned');

          // Verify diagnostics were set
          const allDiagnostics = vscode.languages.getDiagnostics(previewDoc.uri);
          outputChannel.appendLine(
            `Verification: getDiagnostics returned ${allDiagnostics.length} diagnostics`,
          );
          for (let i = 0; i < allDiagnostics.length; i++) {
            outputChannel.appendLine(`  Verified diagnostic ${i}: ${allDiagnostics[i].message}`);
          }
        }

        // Open or update preview in the group below
        await vscode.window.showTextDocument(previewDoc, {
          preview: true,
          preserveFocus: false,
          viewColumn: vscode.ViewColumn.Two,
        });

        // Return focus to migration file (above)
        await vscode.commands.executeCommand('workbench.action.focusPreviousGroup');

        // Show validation result message
        if (previewValidationSuccess) {
          vscode.window.showInformationMessage(
            `LinesDB: Migration validated successfully. ${result.transformedRows.length} rows will be updated.`,
          );
        } else {
          vscode.window.showErrorMessage(
            `LinesDB: Migration has validation errors. See preview file.`,
          );
        }
      } else {
        // No transformed rows (e.g., syntax error in migration file)
        vscode.window.showErrorMessage(
          `LinesDB: Migration validation failed with ${result.errors.length} error(s)`,
        );
      }
    } catch (error) {
      vscode.window.showErrorMessage(
        `LinesDB: Validation error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
  context.subscriptions.push(watcher);

  // Watch for tab changes to detect migration file closes
  const tabChangeWatcher = vscode.window.tabGroups.onDidChangeTabs(async (_event) => {
    // Check all migration sessions to see if their tabs are still open
    const allSessions = MigrationSessionManager.getAllSessions();

    const sessionEntries = Array.from(allSessions.entries());
    for (const [migrationFilePath, session] of sessionEntries) {
      // Check if migration file tab still exists
      let migrationTabExists = false;
      for (const tabGroup of vscode.window.tabGroups.all) {
        for (const tab of tabGroup.tabs) {
          const tabUri = getTabUri(tab);
          if (tabUri && tabUri.fsPath === migrationFilePath) {
            migrationTabExists = true;
            break;
          }
        }
        if (migrationTabExists) break;
      }

      // If migration tab was closed, clean up
      if (!migrationTabExists) {
        // Close preview file tab if exists
        if (session.previewFilePath) {
          const previewUri = vscode.Uri.file(session.previewFilePath);
          for (const tabGroup of vscode.window.tabGroups.all) {
            for (const tab of tabGroup.tabs) {
              const tabUri = getTabUri(tab);
              if (tabUri && tabUri.fsPath === previewUri.fsPath) {
                await vscode.window.tabGroups.close(tab);
              }
            }
          }
        }

        // Close session and clean up
        MigrationSessionManager.closeSession(migrationFilePath);
      }
    }
  });
  context.subscriptions.push(tabChangeWatcher);
}

export function deactivate() {
  console.log('LinesDB extension is now deactivated');
}
