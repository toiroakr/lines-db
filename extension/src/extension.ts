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
import { JsonlCompletionProvider } from './completionProvider';
import { ForeignKeyHoverProvider } from './foreignKeyHover';

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
// Make output channel globally accessible
global.__linesDbOutputChannel = outputChannel;

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
  // Get version from package.json
  const packageJson = require('../package.json');
  const version = packageJson.version || 'unknown';

  outputChannel.appendLine('=== LinesDB Extension Activating ===');
  outputChannel.appendLine(`Version: ${version}`);
  console.log(`LinesDB extension is now active (v${version})`);
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

  // Register Completion provider for JSONL files
  outputChannel.appendLine('Registering CompletionProvider...');
  try {
    const completionProvider = new JsonlCompletionProvider();
    context.subscriptions.push(completionProvider); // Add provider itself for disposal
    context.subscriptions.push(
      vscode.languages.registerCompletionItemProvider(
        { language: 'jsonl' },
        completionProvider,
        '"',
        ':',
        ',',
        '{',
        ' ',
      ),
    );
    outputChannel.appendLine('CompletionProvider registered for JSONL files');

    // Register Completion provider for temporary edit files
    context.subscriptions.push(
      vscode.languages.registerCompletionItemProvider(
        { pattern: '**/.tmp-jsonl-edit-*.json' },
        completionProvider,
        '"',
        ':',
        ',',
        '{',
        ' ',
      ),
    );
    outputChannel.appendLine('CompletionProvider registered for temp files');
  } catch (error) {
    outputChannel.appendLine('ERROR: Failed to register CompletionProvider: ' + error);
    console.error('Failed to register CompletionProvider:', error);
  }

  // Register Foreign Key Hover provider for JSONL files
  outputChannel.appendLine('Registering ForeignKeyHoverProvider...');
  const foreignKeyHoverProvider = new ForeignKeyHoverProvider();
  context.subscriptions.push(
    vscode.languages.registerHoverProvider({ language: 'jsonl' }, foreignKeyHoverProvider),
  );
  outputChannel.appendLine('ForeignKeyHoverProvider registered');

  // Register command for jumping to foreign key record
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'lines-db.jumpToForeignKey',
      async (args: { filePath: string; lineNumber: number }) => {
        try {
          const uri = vscode.Uri.file(args.filePath);
          const document = await vscode.workspace.openTextDocument(uri);
          const position = new vscode.Position(args.lineNumber, 0);
          await vscode.window.showTextDocument(document, {
            selection: new vscode.Range(position, position),
          });
        } catch (error) {
          vscode.window.showErrorMessage(
            `Failed to jump to record: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      },
    ),
  );
  outputChannel.appendLine('Foreign key jump command registered');

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

        // Validate preview file content using LinesDB.initialize
        outputChannel.appendLine('\n--- Validating Preview Content ---');
        outputChannel.appendLine(`Extension version: ${require('../package.json').version}`);
        outputChannel.appendLine(`Number of rows to validate: ${result.transformedRows.length}`);
        outputChannel.appendLine(`DataDir: ${session.dataDir}`);
        outputChannel.appendLine(`TableName: ${session.tableName}`);
        outputChannel.appendLine('Transformed rows:');
        for (let i = 0; i < result.transformedRows.length; i++) {
          outputChannel.appendLine(`  Row ${i}: ${JSON.stringify(result.transformedRows[i])}`);
        }

        let previewValidationSuccess = false;
        try {
          outputChannel.appendLine('Using LinesDB.initialize for validation...');

          // Check if LinesDB module is available
          if (!global.__linesDbModule?.LinesDB || !global.__linesDbModule?.JsonlReader) {
            throw new Error('LinesDB module not available');
          }

          const db = global.__linesDbModule.LinesDB.create({ dataDir: session.dataDir });

          try {
            // Use JsonlReader.withOverrides to temporarily provide transformed rows
            const tablePath = path.join(session.dataDir, `${session.tableName}.jsonl`);
            const overrides = new Map([[tablePath, result.transformedRows]]);

            outputChannel.appendLine(`Table path: ${tablePath}`);
            outputChannel.appendLine('Setting up overrides for validation...');

            await global.__linesDbModule.JsonlReader.withOverrides(overrides, async () => {
              outputChannel.appendLine('Calling db.initialize with detailedValidate...');
              const validationResult = await db.initialize({
                tableName: session.tableName,
                detailedValidate: true
              });

              outputChannel.appendLine(`Validation result: valid=${validationResult.valid}, errors=${validationResult.errors.length}`);

              if (!validationResult.valid) {
                outputChannel.appendLine('Validation failed, generating diagnostics...');
                // ValidationErrorDetail[] から diagnostics を生成
                const diagnostics: vscode.Diagnostic[] = [];

                for (const error of validationResult.errors) {
                  outputChannel.appendLine(`Processing error for rowIndex=${error.rowIndex}, type=${error.type}`);

                  const range = new vscode.Range(error.rowIndex, 0, error.rowIndex, Number.MAX_VALUE);
                  let message = '';

                  if (error.type === 'foreignKey' && error.foreignKeyError) {
                    const fk = error.foreignKeyError;
                    message = `Foreign key constraint failed: ${fk.column} = ${JSON.stringify(fk.value)} does not exist in ${fk.referencedTable}.${fk.referencedColumn}`;
                    outputChannel.appendLine(`  Foreign key error: ${message}`);
                  } else {
                    const messages = error.issues.map((issue: { message: string; path?: unknown[] }) => {
                      if (issue.path && issue.path.length > 0) {
                        const pathStr = issue.path
                          .map((segment: unknown) => typeof segment === 'object' && segment !== null && 'key' in segment
                            ? String((segment as { key: unknown }).key)
                            : String(segment))
                          .join('.');
                        return `${pathStr}: ${issue.message}`;
                      }
                      return issue.message;
                    });
                    message = messages.join(', ');
                    outputChannel.appendLine(`  Schema validation error: ${message}`);
                  }

                  const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
                  diagnostic.source = 'lines-db-migration';
                  diagnostics.push(diagnostic);
                }

                outputChannel.appendLine(`Setting ${diagnostics.length} diagnostics on preview file`);
                outputChannel.appendLine(`Preview URI: ${previewDoc.uri.toString()}`);

                for (let i = 0; i < diagnostics.length; i++) {
                  const diag = diagnostics[i];
                  outputChannel.appendLine(`  Diagnostic ${i}: line=${diag.range.start.line}, message=${diag.message}`);
                }

                MigrationSessionManager.setDiagnostics(previewDoc.uri, diagnostics);

                // Verify diagnostics were set
                const allDiagnostics = vscode.languages.getDiagnostics(previewDoc.uri);
                outputChannel.appendLine(`Verification: getDiagnostics returned ${allDiagnostics.length} diagnostics`);

                throw new Error('Validation failed');
              }
            });

            outputChannel.appendLine('Preview validation: SUCCESS');
            // If validation succeeds, clear diagnostics
            MigrationSessionManager.clearDiagnostics(previewDoc.uri);
            previewValidationSuccess = true;
          } finally {
            outputChannel.appendLine('Closing database...');
            await db.close();
          }
        } catch (validationError) {
          outputChannel.appendLine('Preview validation: FAILED');
          outputChannel.appendLine(`Error: ${validationError}`);
          // Diagnostics are already set if validation failed
          previewValidationSuccess = false;
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
