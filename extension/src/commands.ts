import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { MigrationRow } from './migrationValidator.js';

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

export function registerCommands(context: vscode.ExtensionContext) {
  // Get output channel from extension.ts
  const getOutputChannel = () => {
    return (global as any).__linesDbOutputChannel as vscode.OutputChannel | undefined;
  };

  // Validate Command
  context.subscriptions.push(
    vscode.commands.registerCommand('lines-db.validate', async () => {
      const outChan = getOutputChannel();

      // Try to get the currently active file's directory
      const editor = vscode.window.activeTextEditor;
      let validationPath: string;

      if (editor && editor.document.fileName.endsWith('.jsonl')) {
        // Validate the directory containing the current JSONL file
        validationPath = path.dirname(editor.document.uri.fsPath);
      } else {
        // Fall back to dataDir from config
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
          vscode.window.showErrorMessage('No workspace folder opened');
          return;
        }

        const config = vscode.workspace.getConfiguration('lines-db');
        const dataDir = config.get<string>('dataDir') || './data';
        validationPath = path.join(workspaceFolder.uri.fsPath, dataDir);
      }

      try {
        if (!global.__linesDbModule?.Validator) {
          vscode.window.showErrorMessage(
            'LinesDB: @toiroakr/lines-db not found in workspace. Please install it.',
          );
          return;
        }

        const validator = new global.__linesDbModule.Validator({ path: validationPath });
        const result = await validator.validate();

        if (result.valid) {
          vscode.window.showInformationMessage('LinesDB: All records are valid');
        } else {
          if (outChan) {
            outChan.clear();
            outChan.appendLine('=== LinesDB Validation Errors ===');
            outChan.appendLine('');
            outChan.appendLine(`Validation Path: ${validationPath}`);
            outChan.appendLine(`Total Errors: ${result.errors.length}`);
            outChan.appendLine('');

            for (const error of result.errors) {
              outChan.appendLine(`File: ${error.file}`);
              outChan.appendLine(`Table: ${error.tableName}`);
              outChan.appendLine(`Row: ${error.rowIndex}`);

              if (error.type === 'foreignKey' && error.foreignKeyError) {
                const fk = error.foreignKeyError;
                outChan.appendLine(`Type: Foreign Key Constraint Violation`);
                outChan.appendLine(`  Column: ${fk.column}`);
                outChan.appendLine(`  Value: ${JSON.stringify(fk.value)}`);
                outChan.appendLine(`  Referenced: ${fk.referencedTable}.${fk.referencedColumn}`);
              } else {
                outChan.appendLine('Issues:');
                for (const issue of error.issues) {
                  let pathStr = 'root';
                  if (issue.path && issue.path.length > 0) {
                    pathStr = issue.path
                      .map((segment: unknown) => {
                        if (typeof segment === 'object' && segment !== null && 'key' in segment) {
                          return String(segment.key);
                        }
                        return String(segment);
                      })
                      .join('.');
                  }
                  outChan.appendLine(`  - ${pathStr}: ${issue.message}`);
                }
              }
              outChan.appendLine('');
            }
          }

          vscode.window.showErrorMessage(
            `LinesDB: Found ${result.errors.length} validation error(s)`,
          );
        }
      } catch (error) {
        if (outChan) {
          outChan.clear();
          outChan.appendLine('=== LinesDB Validation Error ===');
          outChan.appendLine('');
          outChan.appendLine(`Validation Path: ${validationPath}`);
          outChan.appendLine('');

          if (error instanceof Error) {
            outChan.appendLine(`Error: ${error.message}`);
            if (error.stack) {
              outChan.appendLine('');
              outChan.appendLine('Stack Trace:');
              outChan.appendLine(error.stack);
            }
          } else {
            outChan.appendLine(`Error: ${String(error)}`);
          }
        }

        vscode.window.showErrorMessage(
          `LinesDB: Validation failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }),
  );

  // Migrate Command - Start interactive migration session
  context.subscriptions.push(
    vscode.commands.registerCommand('lines-db.migrate', async () => {
      const outChan = getOutputChannel();
      if (outChan) outChan.appendLine('\n=== Migrate Command Called ===');

      // Get currently active editor
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        if (outChan) outChan.appendLine('ERROR: No file is currently open');
        vscode.window.showErrorMessage('No file is currently open');
        return;
      }

      const document = editor.document;
      const filePath = document.uri.fsPath;
      if (outChan) outChan.appendLine(`Current file: ${filePath}`);

      // Check if the file is a JSONL file
      if (!filePath.endsWith('.jsonl')) {
        if (outChan) outChan.appendLine('ERROR: Current file is not a JSONL file');
        vscode.window.showErrorMessage('Current file is not a JSONL file');
        return;
      }

      // Extract dataDir and table name from file path
      const fileName = path.basename(filePath);
      const dataDirPath = path.dirname(filePath);
      const tableName = fileName.replace('.jsonl', '');
      if (outChan) {
        outChan.appendLine(`Table name: ${tableName}`);
        outChan.appendLine(`Data directory: ${dataDirPath}`);
      }

      try {
        // Import migration session manager
        const { MigrationSessionManager } = await import('./migrationSession.js');

        if (outChan) outChan.appendLine('Creating migration session...');
        // Create migration session
        const migrationFilePath = await MigrationSessionManager.createSession(
          filePath,
          tableName,
          dataDirPath,
        );
        if (outChan) outChan.appendLine(`Migration file created: ${migrationFilePath}`);

        // Open migration file
        if (outChan) outChan.appendLine('Opening migration file...');
        const doc = await vscode.workspace.openTextDocument(migrationFilePath);
        await vscode.window.showTextDocument(doc, {
          preview: false,
          viewColumn: vscode.ViewColumn.Active,
        });
        if (outChan) outChan.appendLine('Migration file opened in editor');

        vscode.window.showInformationMessage(
          'LinesDB: Migration session started. Edit the migration file and save to preview changes.',
        );
      } catch (error) {
        if (outChan) outChan.appendLine(`ERROR: Migration start failed: ${error}`);
        vscode.window.showErrorMessage(
          `LinesDB: Failed to start migration: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }),
  );

  // Execute Migration Command
  context.subscriptions.push(
    vscode.commands.registerCommand('lines-db.executeMigration', async (uri: vscode.Uri) => {
      const { MigrationSessionManager } = await import('./migrationSession.js');
      const { MigrationValidator } = await import('./migrationValidator.js');

      const session = MigrationSessionManager.getSession(uri.fsPath);
      if (!session) {
        vscode.window.showErrorMessage('Migration session not found');
        return;
      }

      const migrationContent = fs.readFileSync(uri.fsPath, 'utf-8');
      const { transform, filter } = await MigrationValidator.parseMigrationFile(migrationContent);

      if (!global.__linesDbModule?.JsonlReader) {
        vscode.window.showErrorMessage(
          'LinesDB: @toiroakr/lines-db not found in workspace. Please install it.',
        );
        return;
      }

      const allRows = (await global.__linesDbModule.JsonlReader.read(
        session.originalFilePath,
      )) as MigrationRow[];
      const plan = MigrationValidator.createMigrationPlan(allRows, transform, filter);

      if (plan.transformedRows.length === 0) {
        vscode.window.showInformationMessage(
          'LinesDB: Migration executed. No rows matched the filter.',
        );
        return;
      }

      // Validate one more time before executing
      try {
        if (global.__linesDbModule?.ensureTableRowsValid) {
          await global.__linesDbModule.ensureTableRowsValid({
            dataDir: session.dataDir,
            tableName: session.tableName,
            rows: plan.updatedRows,
          });
        }
      } catch (validationError) {
        const result = MigrationValidator.processValidationError(
          validationError,
          plan.transformedRows,
          plan.transformedRowIndices,
        );
        const firstError = result.errors[0];
        vscode.window.showErrorMessage(
          `Cannot execute migration: ${firstError ? firstError.message : 'Validation failed'}`,
        );
        return;
      }

      // Confirm execution
      const confirm = await vscode.window.showWarningMessage(
        `Execute migration for ${session.tableName}? This will update ${plan.transformedRows.length} rows.`,
        { modal: true },
        'Execute',
      );

      if (confirm !== 'Execute') {
        return;
      }

      try {
        // Write updated rows back to the original file
        const jsonlContent = plan.updatedRows.map((row) => JSON.stringify(row)).join('\n');
        fs.writeFileSync(session.originalFilePath, jsonlContent, 'utf-8');

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
        MigrationSessionManager.closeSession(uri.fsPath);

        // Close migration file tab
        for (const tabGroup of vscode.window.tabGroups.all) {
          for (const tab of tabGroup.tabs) {
            const tabUri = getTabUri(tab);
            if (tabUri && tabUri.fsPath === uri.fsPath) {
              await vscode.window.tabGroups.close(tab);
            }
          }
        }

        vscode.window.showInformationMessage(
          `LinesDB: Migration completed successfully (${plan.transformedRows.length} rows updated)`,
        );

        // Refresh original file
        const originalDoc = await vscode.workspace.openTextDocument(session.originalFilePath);
        await vscode.window.showTextDocument(originalDoc);
      } catch (error) {
        vscode.window.showErrorMessage(
          `LinesDB: Migration execution failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }),
  );

  // Cancel Migration Command
  context.subscriptions.push(
    vscode.commands.registerCommand('lines-db.cancelMigration', async (uri: vscode.Uri) => {
      const { MigrationSessionManager } = await import('./migrationSession.js');

      const session = MigrationSessionManager.getSession(uri.fsPath);
      if (!session) {
        vscode.window.showErrorMessage('Migration session not found');
        return;
      }

      // Confirm cancellation
      const confirm = await vscode.window.showWarningMessage(
        'Cancel migration? All changes will be lost.',
        { modal: true },
        'Cancel Migration',
      );

      if (confirm !== 'Cancel Migration') {
        return;
      }

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
      MigrationSessionManager.closeSession(uri.fsPath);

      // Close migration file tab
      for (const tabGroup of vscode.window.tabGroups.all) {
        for (const tab of tabGroup.tabs) {
          const tabUri = getTabUri(tab);
          if (tabUri && tabUri.fsPath === uri.fsPath) {
            await vscode.window.tabGroups.close(tab);
          }
        }
      }

      vscode.window.showInformationMessage('LinesDB: Migration cancelled');

      // Return to original file
      const originalDoc = await vscode.workspace.openTextDocument(session.originalFilePath);
      await vscode.window.showTextDocument(originalDoc);
    }),
  );

  // Show Migration Preview Command
  context.subscriptions.push(
    vscode.commands.registerCommand('lines-db.showMigrationPreview', async (uri: vscode.Uri) => {
      const { MigrationSessionManager } = await import('./migrationSession.js');

      const session = MigrationSessionManager.getSession(uri.fsPath);
      if (!session || !session.previewFilePath) {
        vscode.window.showErrorMessage('Preview not available');
        return;
      }

      // Open preview file (below the migration file)
      // First, split editor down to create a group below
      await vscode.commands.executeCommand('workbench.action.splitEditorDown');

      // Open preview in the newly created group below
      const doc = await vscode.workspace.openTextDocument(session.previewFilePath);
      await vscode.window.showTextDocument(doc, {
        preview: true,
        preserveFocus: false,
      });

      // Return focus to migration file (above)
      await vscode.commands.executeCommand('workbench.action.focusPreviousGroup');
    }),
  );

  // Edit JSONL Line Command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'lines-db.editJsonlLine',
      async (uri?: vscode.Uri, lineNumber?: number) => {
        const outChan = getOutputChannel();

        // Get document and line number
        let document: vscode.TextDocument;
        let targetLine: number;

        if (uri && lineNumber !== undefined) {
          // Called from DocumentLink or CodeAction
          document = await vscode.workspace.openTextDocument(uri);
          targetLine = lineNumber;
        } else {
          // Called from command palette
          const editor = vscode.window.activeTextEditor;
          if (!editor) {
            vscode.window.showErrorMessage('No file is currently open');
            return;
          }
          document = editor.document;
          targetLine = editor.selection.active.line;
        }

        // Check if it's a JSONL file
        if (!document.fileName.endsWith('.jsonl')) {
          vscode.window.showErrorMessage('Current file is not a JSONL file');
          return;
        }

        // Get the line text
        const lineText = document.lineAt(targetLine).text.trim();
        if (!lineText) {
          vscode.window.showErrorMessage('Cannot edit empty line');
          return;
        }

        // Validate JSON
        try {
          JSON.parse(lineText);
        } catch (error) {
          vscode.window.showErrorMessage(`Invalid JSON on line ${targetLine + 1}: ${error}`);
          return;
        }

        // Create temp file and open it
        try {
          const tempFileManager = global.__tempFileManager;
          if (!tempFileManager) {
            vscode.window.showErrorMessage('Temp file manager not initialized');
            return;
          }

          const tempFilePath = await tempFileManager.createTempFile(
            document.uri,
            targetLine,
            lineText,
          );

          if (outChan) {
            outChan.appendLine(`Created temp file: ${tempFilePath}`);
            outChan.appendLine(`Editing line ${targetLine + 1} from ${document.uri.fsPath}`);
          }

          // Open temp file
          const tempDoc = await vscode.workspace.openTextDocument(tempFilePath);
          await vscode.window.showTextDocument(tempDoc, {
            preview: false,
            viewColumn: vscode.ViewColumn.Active,
          });

          vscode.window.showInformationMessage(
            'Edit the JSON and save (Cmd+S) to apply changes to the original file',
          );
        } catch (error) {
          vscode.window.showErrorMessage(
            `Failed to create temp file: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      },
    ),
  );

  // Preview JSONL Line Command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'lines-db.previewJsonlLine',
      async (uri?: vscode.Uri, lineNumber?: number) => {
        const { JsonlPreviewPanel } = await import('./previewPanel.js');

        let document: vscode.TextDocument;
        let targetLine: number;

        if (uri && lineNumber !== undefined) {
          document = await vscode.workspace.openTextDocument(uri);
          targetLine = lineNumber;
        } else {
          const editor = vscode.window.activeTextEditor;
          if (!editor) {
            vscode.window.showErrorMessage('No file is currently open');
            return;
          }
          document = editor.document;
          targetLine = editor.selection.active.line;
        }

        if (!document.fileName.endsWith('.jsonl')) {
          vscode.window.showErrorMessage('Current file is not a JSONL file');
          return;
        }

        JsonlPreviewPanel.previewLine(context.extensionUri, document, targetLine);
      },
    ),
  );
}
