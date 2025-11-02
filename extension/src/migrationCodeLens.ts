import * as vscode from 'vscode';
import { MigrationSessionManager } from './migrationSession.js';

export class MigrationCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

  provideCodeLenses(document: vscode.TextDocument): vscode.ProviderResult<vscode.CodeLens[]> {
    const codeLenses: vscode.CodeLens[] = [];

    // Check if this is a migration file
    const session = MigrationSessionManager.getSession(document.uri.fsPath);
    if (!session) {
      return codeLenses;
    }

    // Default to top of the document, fallback if we cannot find the migration export
    let targetRange = new vscode.Range(0, 0, 0, 0);

    // Try to locate the `export const migration` declaration so codelens appears nearby
    const migrationMatch = /export\s+const\s+migration/.exec(document.getText());
    if (migrationMatch) {
      const startPosition = document.positionAt(migrationMatch.index);
      targetRange = new vscode.Range(startPosition.line, 0, startPosition.line, 0);
    }

    // Execute Migration button
    const executeLens = new vscode.CodeLens(targetRange, {
      title: '$(play) Execute Migration',
      command: 'lines-db.executeMigration',
      arguments: [document.uri],
      tooltip: 'Apply migration to the database',
    });
    codeLenses.push(executeLens);

    // Cancel Migration button
    const cancelLens = new vscode.CodeLens(targetRange, {
      title: '$(close) Cancel Migration',
      command: 'lines-db.cancelMigration',
      arguments: [document.uri],
      tooltip: 'Close migration session',
    });
    codeLenses.push(cancelLens);

    // Show preview button if preview is available
    if (session.previewFilePath) {
      const previewLens = new vscode.CodeLens(targetRange, {
        title: '$(eye) Show Preview',
        command: 'lines-db.showMigrationPreview',
        arguments: [document.uri],
        tooltip: 'Show migration preview',
      });
      codeLenses.push(previewLens);
    }

    return codeLenses;
  }

  refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }
}
