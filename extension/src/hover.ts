import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class JsonlHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.Hover> {
    // Only provide hover for schema files
    if (!document.fileName.endsWith('.schema.ts')) {
      return null;
    }

    // Get the word at the current position
    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) {
      return null;
    }

    const word = document.getText(wordRange);
    const line = document.lineAt(position.line);

    // Check if we're hovering over "schema" export
    if (word === 'schema' && line.text.includes('export')) {
      const fileName = path.basename(document.fileName);
      const tableName = fileName.replace(/\.schema\.ts$/, '');
      const dataDir = path.dirname(document.fileName);
      const jsonlPath = path.join(dataDir, `${tableName}.jsonl`);

      let recordCount = 0;
      if (fs.existsSync(jsonlPath)) {
        try {
          const content = fs.readFileSync(jsonlPath, 'utf-8');
          const lines = content.split('\n').filter((line) => line.trim().startsWith('{'));
          recordCount = lines.length;
        } catch (_error) {
          // Ignore errors
        }
      }

      const markdown = new vscode.MarkdownString();
      markdown.appendMarkdown(`**LinesDB Schema**\n\n`);
      markdown.appendMarkdown(`- **Table**: \`${tableName}\`\n`);
      markdown.appendMarkdown(`- **JSONL File**: \`${tableName}.jsonl\`\n`);
      if (fs.existsSync(jsonlPath)) {
        markdown.appendMarkdown(`- **Records**: ${recordCount}\n`);
      } else {
        markdown.appendMarkdown(`- **Status**: ⚠️ JSONL file not found\n`);
      }

      return new vscode.Hover(markdown);
    }

    return null;
  }
}
