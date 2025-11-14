import * as vscode from 'vscode';

export class JsonlCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

  provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.CodeLens[]> {
    const codeLenses: vscode.CodeLens[] = [];

    // Only provide code lenses for JSONL files
    if (document.languageId !== 'jsonl' && !document.fileName.endsWith('.jsonl')) {
      return codeLenses;
    }

    // Count total lines (non-empty JSON objects)
    let lineCount = 0;
    for (let i = 0; i < document.lineCount; i++) {
      const line = document.lineAt(i);
      const text = line.text.trim();
      if (text && text.startsWith('{')) {
        lineCount++;
      }
    }

    // Add code lens at the top of the file
    const topOfDocument = new vscode.Range(0, 0, 0, 0);

    // Record count (no command, just display)
    codeLenses.push(
      new vscode.CodeLens(topOfDocument, {
        title: `$(database) ${lineCount} records`,
        command: '',
      }),
    );

    // Show Preview button
    codeLenses.push(
      new vscode.CodeLens(topOfDocument, {
        title: '$(eye) Show Preview',
        command: 'lines-db.previewJsonlLine',
        arguments: [document.uri, 0],
        tooltip: 'Show preview panel',
      }),
    );

    // Sort Columns button
    codeLenses.push(
      new vscode.CodeLens(topOfDocument, {
        title: '$(list-ordered) Sort Columns',
        command: 'lines-db.sortColumns',
        arguments: [document.uri],
        tooltip: 'Sort all rows by column order',
      }),
    );

    // Migrate button
    const migrateLens = new vscode.CodeLens(topOfDocument, {
      title: '$(arrow-right) Migrate',
      command: 'lines-db.migrate',
      tooltip: 'Start migration for this JSONL file',
    });
    codeLenses.push(migrateLens);

    return codeLenses;
  }

  refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }
}
