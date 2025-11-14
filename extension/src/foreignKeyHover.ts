import * as vscode from 'vscode';
import * as path from 'path';
import {
  getForeignKeyAtPosition,
  findReferencedRecord,
  formatRecordAsMarkdown,
} from './foreignKeyUtils';

export class ForeignKeyHoverProvider implements vscode.HoverProvider {
  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
  ): Promise<vscode.Hover | null> {
    try {
      // Check if cursor is on a foreign key value
      const fkContext = await getForeignKeyAtPosition(document, position);
      if (!fkContext) {
        return null;
      }

      // Find the referenced record
      const recordLocation = await findReferencedRecord(fkContext);
      if (!recordLocation) {
        return null;
      }

      // Format the record data
      const tableName = fkContext.foreignKey.referencedTable;
      const primaryKeyColumn = fkContext.foreignKey.referencedColumn;
      const markdown = formatRecordAsMarkdown(recordLocation.record, tableName, primaryKeyColumn);

      // Create a command URI for jumping to the referenced record
      const commandUri = vscode.Uri.parse(
        `command:lines-db.jumpToForeignKey?${encodeURIComponent(
          JSON.stringify({
            filePath: recordLocation.filePath,
            lineNumber: recordLocation.lineNumber,
          }),
        )}`,
      );

      const markdownString = new vscode.MarkdownString(markdown);
      markdownString.isTrusted = true;
      markdownString.supportHtml = true;

      // Add a clickable link to jump to the record
      markdownString.appendMarkdown('\n\n---\n\n');
      markdownString.appendMarkdown(
        `[→ Jump to record in ${path.basename(recordLocation.filePath)}](${commandUri})`,
      );

      return new vscode.Hover(markdownString);
    } catch {
      // Silently fail
      return null;
    }
  }
}
