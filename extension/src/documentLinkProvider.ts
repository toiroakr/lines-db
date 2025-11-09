import * as vscode from "vscode";

/**
 * Provides clickable links for each JSONL line
 */
export class JsonlDocumentLinkProvider implements vscode.DocumentLinkProvider {
  provideDocumentLinks(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): vscode.DocumentLink[] {
    const links: vscode.DocumentLink[] = [];

    for (let i = 0; i < document.lineCount; i++) {
      const line = document.lineAt(i);
      const text = line.text.trim();

      // Skip empty lines
      if (!text) {
        continue;
      }

      // Check if it's valid JSON
      try {
        JSON.parse(text);

        // Create a link for the entire line
        const link = new vscode.DocumentLink(
          line.range,
          vscode.Uri.parse(
            `command:lines-db.editJsonlLine?${encodeURIComponent(
              JSON.stringify([document.uri, i])
            )}`
          )
        );
        link.tooltip = "Click to edit this JSON line";
        links.push(link);
      } catch (error) {
        // Not valid JSON, skip
        continue;
      }
    }

    return links;
  }
}
