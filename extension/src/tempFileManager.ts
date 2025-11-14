import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

interface TempFileInfo {
  filePath: string;
  originalUri: vscode.Uri;
  lineNumber: number;
}

/**
 * Manages temporary files for editing JSONL lines
 */
export class TempFileManager {
  private tempFiles: Map<string, TempFileInfo> = new Map();
  private saveListener?: vscode.Disposable;
  private closeListener?: vscode.Disposable;

  constructor(private context: vscode.ExtensionContext) {
    this.setupSaveListener();
    this.setupCloseListener();
  }

  /**
   * Creates a temporary JSON file from a JSONL line
   */
  async createTempFile(
    originalUri: vscode.Uri,
    lineNumber: number,
    lineText: string,
  ): Promise<string> {
    // Parse and format the JSON
    let formatted: string;
    try {
      const parsed = JSON.parse(lineText);
      formatted = JSON.stringify(parsed, null, 2);
    } catch (error) {
      throw new Error(`Invalid JSON on line ${lineNumber + 1}: ${error}`);
    }

    // Extract table name from original file
    const originalFileName = path.basename(originalUri.fsPath);
    const tableName = originalFileName.replace('.jsonl', '');

    // Create temp file with pattern: .tmp-jsonl-edit-{tableName}-line{lineNumber}.json
    const tempDir = os.tmpdir();
    const fileName = `.tmp-jsonl-edit-${tableName}-line${lineNumber}.json`;
    const tempFilePath = path.join(tempDir, fileName);

    fs.writeFileSync(tempFilePath, formatted, 'utf8');

    // Store mapping
    this.tempFiles.set(tempFilePath, {
      filePath: tempFilePath,
      originalUri,
      lineNumber,
    });

    return tempFilePath;
  }


  /**
   * Saves the edited content back to the original JSONL file
   */
  async saveToOriginalDocument(tempFilePath: string): Promise<void> {
    const info = this.tempFiles.get(tempFilePath);
    if (!info) {
      return;
    }

    try {
      // Read the edited content
      const editedContent = fs.readFileSync(tempFilePath, 'utf8');
      const parsed = JSON.parse(editedContent);
      const compacted = JSON.stringify(parsed);

      // Update the original document
      const document = await vscode.workspace.openTextDocument(info.originalUri);
      const editor = await vscode.window.showTextDocument(document);

      await editor.edit((editBuilder) => {
        const line = document.lineAt(info.lineNumber);
        editBuilder.replace(line.range, compacted);
      });

      console.log(`Saved changes to ${info.originalUri.fsPath}:${info.lineNumber + 1}`);

      // Close the temp file tab
      const tabs = vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .filter(
          (tab) =>
            tab.input instanceof vscode.TabInputText && tab.input.uri.fsPath === tempFilePath,
        );
      await vscode.window.tabGroups.close(tabs);

      // Delete the temp file
      await this.deleteTempFile(tempFilePath);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to save: ${error}`);
      throw error;
    }
  }

  /**
   * Deletes a temporary file
   */
  async deleteTempFile(tempFilePath: string): Promise<void> {
    try {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
      this.tempFiles.delete(tempFilePath);
      console.log(`Deleted temp file: ${tempFilePath}`);
    } catch (error) {
      console.error(`Failed to delete temp file: ${error}`);
    }
  }

  /**
   * Checks if a file is a temp file managed by this manager
   */
  isTempFile(uri: vscode.Uri): boolean {
    return this.tempFiles.has(uri.fsPath);
  }

  /**
   * Checks if a file path matches the temp file pattern
   */
  static isTempFilePattern(filePath: string): boolean {
    const fileName = path.basename(filePath);
    const tempFilePattern = /^\.tmp-jsonl-edit-(.+)-line\d+\.json$/;
    return tempFilePattern.test(fileName);
  }

  /**
   * Gets the original JSONL file info for a temp file
   */
  getTempFileInfo(uri: vscode.Uri): TempFileInfo | undefined {
    return this.tempFiles.get(uri.fsPath);
  }

  /**
   * Extracts the original JSONL path from a temp file path
   */
  static getOriginalJsonlPath(tempFilePath: string): string | null {
    const fileName = path.basename(tempFilePath);
    const tempFilePattern = /^\.tmp-jsonl-edit-(.+)-line\d+\.json$/;
    const match = fileName.match(tempFilePattern);

    if (match) {
      const tableName = match[1];
      const dir = path.dirname(tempFilePath);
      return path.join(dir, `${tableName}.jsonl`);
    }

    return null;
  }

  /**
   * Sets up listener for temp file saves
   */
  private setupSaveListener(): void {
    this.saveListener = vscode.workspace.onDidSaveTextDocument(async (document) => {
      const filePath = document.uri.fsPath;
      if (this.isTempFile(document.uri)) {
        await this.saveToOriginalDocument(filePath);
      }
    });

    this.context.subscriptions.push(this.saveListener);
  }

  /**
   * Sets up listener for when documents are closed
   */
  private setupCloseListener(): void {
    this.closeListener = vscode.workspace.onDidCloseTextDocument((document) => {
      const filePath = document.uri.fsPath;
      if (this.tempFiles.has(filePath)) {
        this.deleteTempFile(filePath).catch((err) => {
          console.error(`Failed to delete temporary file: ${err}`);
        });
      }
    });

    this.context.subscriptions.push(this.closeListener);
  }

  /**
   * Cleans up all temp files
   */
  dispose(): void {
    const filePaths = Array.from(this.tempFiles.keys());
    for (const filePath of filePaths) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (error) {
        console.error(`Failed to cleanup temp file: ${error}`);
      }
    }
    this.tempFiles.clear();

    if (this.saveListener) {
      this.saveListener.dispose();
    }

    if (this.closeListener) {
      this.closeListener.dispose();
    }
  }
}
