import * as vscode from 'vscode';

/**
 * Provides CodeLens for JSONL file editing features
 * Shows "Show Preview" button on the first line
 */
export class JsonlEditCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

  provideCodeLenses(
    document: vscode.TextDocument,
  ): vscode.CodeLens[] | Thenable<vscode.CodeLens[]> {
    // Only for JSONL files
    if (!document.fileName.endsWith('.jsonl')) {
      return [];
    }

    // Skip preview files
    if (document.fileName.includes('.preview.jsonl')) {
      return [];
    }

    const codeLenses: vscode.CodeLens[] = [];

    // Add "Show Preview" code lens on first line
    if (document.lineCount > 0) {
      const range = new vscode.Range(0, 0, 0, 0);
      const codeLens = new vscode.CodeLens(range, {
        title: '$(eye) Show Preview',
        command: 'lines-db.previewJsonlLine',
        arguments: [document.uri, 0],
      });
      codeLenses.push(codeLens);
    }

    return codeLenses;
  }

  resolveCodeLens(codeLens: vscode.CodeLens): vscode.CodeLens | Thenable<vscode.CodeLens> {
    return codeLens;
  }

  refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }
}
