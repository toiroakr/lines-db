import * as vscode from "vscode";

/**
 * Provides code actions (lightbulb menu) for JSONL lines
 */
export class JsonlCodeActionProvider implements vscode.CodeActionProvider {
  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    // Get the line at the cursor
    const line = document.lineAt(range.start.line);
    const text = line.text.trim();

    // Skip empty lines
    if (!text) {
      return actions;
    }

    // Check if it's valid JSON
    try {
      JSON.parse(text);

      // Create "Edit JSON line" action
      const editAction = new vscode.CodeAction(
        "Edit JSON line",
        vscode.CodeActionKind.QuickFix
      );
      editAction.command = {
        title: "Edit JSON line",
        command: "lines-db.editJsonlLine",
        arguments: [document.uri, range.start.line],
      };
      actions.push(editAction);

      // Create "Preview JSON line" action
      const previewAction = new vscode.CodeAction(
        "Preview JSON line",
        vscode.CodeActionKind.QuickFix
      );
      previewAction.command = {
        title: "Preview JSON line",
        command: "lines-db.previewJsonlLine",
        arguments: [document.uri, range.start.line],
      };
      actions.push(previewAction);
    } catch (error) {
      // Not valid JSON, don't provide actions
    }

    return actions;
  }
}
