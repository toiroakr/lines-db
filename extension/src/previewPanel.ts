import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

/**
 * Manages the JSONL preview panel
 */
export class JsonlPreviewPanel {
  private static currentPanel: JsonlPreviewPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private currentDocument?: vscode.TextDocument;
  private currentLine: number = 0;
  private isManualNavigation: boolean = false;

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri
  ) {
    this.panel = panel;

    // Set up event handlers
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // Handle messages from the webview
    this.panel.webview.onDidReceiveMessage(
      (message) => {
        switch (message.command) {
          case "navigate":
            this.navigate(message.direction);
            break;
          case "goToLine":
            this.goToLine(message.line);
            break;
          case "editLine":
            this.editCurrentLine();
            break;
        }
      },
      null,
      this.disposables
    );

    // Listen to active editor changes
    vscode.window.onDidChangeActiveTextEditor(
      (editor) => {
        if (editor && this.isJsonlFile(editor.document)) {
          this.currentDocument = editor.document;
          this.updatePreview();
        }
      },
      null,
      this.disposables
    );

    // Listen to document changes
    vscode.workspace.onDidChangeTextDocument(
      (event) => {
        if (
          this.currentDocument &&
          event.document === this.currentDocument
        ) {
          this.updatePreview();
        }
      },
      null,
      this.disposables
    );

    // Listen to selection changes
    vscode.window.onDidChangeTextEditorSelection(
      (event) => {
        if (
          this.currentDocument &&
          event.textEditor.document === this.currentDocument &&
          !this.isManualNavigation
        ) {
          const newLine = event.selections[0].active.line;
          if (newLine !== this.currentLine) {
            this.currentLine = newLine;
            this.updatePreview();
          }
        }
      },
      null,
      this.disposables
    );
  }

  /**
   * Creates or shows the preview panel
   */
  public static createOrShow(extensionUri: vscode.Uri): void {
    const column = vscode.ViewColumn.Beside;

    // If we already have a panel, show it
    if (JsonlPreviewPanel.currentPanel) {
      JsonlPreviewPanel.currentPanel.panel.reveal(column);
      JsonlPreviewPanel.currentPanel.updatePreview();
      return;
    }

    // Create a new panel
    const panel = vscode.window.createWebviewPanel(
      "jsonlPreview",
      "JSONL Preview",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri],
      }
    );

    JsonlPreviewPanel.currentPanel = new JsonlPreviewPanel(panel, extensionUri);
    JsonlPreviewPanel.currentPanel.initializeWithActiveEditor();
  }

  /**
   * Previews a specific line
   */
  public static previewLine(
    extensionUri: vscode.Uri,
    document: vscode.TextDocument,
    lineNumber: number
  ): void {
    JsonlPreviewPanel.createOrShow(extensionUri);
    if (JsonlPreviewPanel.currentPanel) {
      JsonlPreviewPanel.currentPanel.currentDocument = document;
      JsonlPreviewPanel.currentPanel.currentLine = lineNumber;
      JsonlPreviewPanel.currentPanel.updatePreview();
    }
  }

  /**
   * Initializes the panel with the active editor
   */
  private initializeWithActiveEditor(): void {
    const editor = vscode.window.activeTextEditor;
    if (editor && this.isJsonlFile(editor.document)) {
      this.currentDocument = editor.document;
      this.currentLine = editor.selection.active.line;
      this.updatePreview();
    } else {
      this.showMessage("No JSONL file is currently active");
    }
  }

  /**
   * Updates the preview content
   */
  private updatePreview(): void {
    if (!this.currentDocument) {
      return;
    }

    const lineText = this.currentDocument.lineAt(this.currentLine).text.trim();
    let formattedJson: string;
    let originalContent: string = lineText;

    if (!lineText) {
      formattedJson = "Empty line";
    } else {
      try {
        const multilineMarker = "[toiroakr.lines-db.multiline]";
        const parsed = JSON.parse(lineText);
        formattedJson = JSON.stringify(
          parsed,
          (_, value) => {
            // Convert strings containing newlines to arrays
            if (typeof value === "string" && value.includes("\n")) {
              const lines = value.split("\n");
              return [multilineMarker, ...lines];
            }
            return value;
          },
          2
        ).replace(
          new RegExp(`"\\${multilineMarker}",`, "g"),
          `// Displayed as array for multiline string readability`
        );
      } catch (error) {
        formattedJson = `Invalid JSON: ${error}`;
      }
    }

    const html = this.getHtmlContent(
      this.currentLine + 1,
      this.currentDocument.lineCount,
      formattedJson,
      originalContent
    );
    this.panel.webview.html = html;
  }

  /**
   * Navigates to the next or previous line
   */
  private navigate(direction: "prev" | "next"): void {
    if (!this.currentDocument) {
      return;
    }

    const newLine =
      direction === "prev"
        ? Math.max(0, this.currentLine - 1)
        : Math.min(this.currentDocument.lineCount - 1, this.currentLine + 1);

    if (newLine !== this.currentLine) {
      this.isManualNavigation = true;
      this.currentLine = newLine;
      this.updatePreview();

      // Reset manual navigation flag after a short delay
      setTimeout(() => {
        this.isManualNavigation = false;
      }, 500);

      // Move cursor in editor
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document === this.currentDocument) {
        const position = new vscode.Position(this.currentLine, 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(
          new vscode.Range(position, position),
          vscode.TextEditorRevealType.InCenter
        );
      }
    }
  }

  /**
   * Goes to a specific line number
   */
  private goToLine(lineNumber: number): void {
    if (!this.currentDocument) {
      return;
    }

    const line = lineNumber - 1; // Convert to 0-based
    if (line >= 0 && line < this.currentDocument.lineCount) {
      this.isManualNavigation = true;
      this.currentLine = line;
      this.updatePreview();

      // Reset manual navigation flag after a short delay
      setTimeout(() => {
        this.isManualNavigation = false;
      }, 500);

      // Move cursor in editor
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document === this.currentDocument) {
        const position = new vscode.Position(this.currentLine, 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(
          new vscode.Range(position, position),
          vscode.TextEditorRevealType.InCenter
        );
      }
    } else {
      vscode.window.showErrorMessage(
        `Line ${lineNumber} is out of range (1-${this.currentDocument.lineCount})`
      );
    }
  }

  /**
   * Edits the current line
   */
  private editCurrentLine(): void {
    if (!this.currentDocument) {
      return;
    }

    vscode.commands.executeCommand(
      "lines-db.editJsonlLine",
      this.currentDocument.uri,
      this.currentLine
    );
  }

  /**
   * Shows a message in the preview
   */
  private showMessage(message: string): void {
    this.panel.webview.html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body {
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              margin: 0;
              font-family: var(--vscode-font-family);
              color: var(--vscode-foreground);
            }
          </style>
        </head>
        <body>
          <p>${this.escapeHtml(message)}</p>
        </body>
      </html>
    `;
  }

  /**
   * Generates the HTML content for the preview
   */
  private getHtmlContent(
    lineNumber: number,
    totalLines: number,
    content: string,
    originalContent: string
  ): string {
    const templatePath = path.join(
      this.extensionUri.fsPath,
      "dist",
      "preview-template.html"
    );

    let html = fs.readFileSync(templatePath, "utf8");

    // Prepare content based on whether it's valid JSON or an error
    let contentHtml = "";
    const isError = content.startsWith("Invalid") || content.startsWith("Empty");

    if (isError) {
      contentHtml = `<div class="error">${this.escapeHtml(content)}</div>`;
    } else {
      contentHtml = `<pre><code class="language-json">${this.escapeHtml(content)}</code></pre>`;
    }

    // Replace placeholders
    html = html.replace(/{{LINE_NUMBER}}/g, lineNumber.toString());
    html = html.replace(/{{TOTAL_LINES}}/g, totalLines.toString());
    html = html.replace(/<pre><code class="language-json">{{CONTENT}}<\/code><\/pre>/, contentHtml);
    html = html.replace("{{ORIGINAL_CONTENT}}", this.escapeHtml(originalContent));

    // Remove Copy JSON button for errors/empty lines
    if (isError) {
      html = html.replace(/<button class="copy-button"[^>]*>.*?<\/button>/s, '');
    }

    return html;
  }

  /**
   * Escapes HTML special characters
   */
  private escapeHtml(text: string): string {
    const map: { [key: string]: string } = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }

  /**
   * Checks if a document is a JSONL file
   */
  private isJsonlFile(document: vscode.TextDocument): boolean {
    return (
      document.languageId === "jsonl" ||
      document.fileName.endsWith(".jsonl")
    );
  }

  /**
   * Disposes the panel
   */
  private dispose(): void {
    JsonlPreviewPanel.currentPanel = undefined;

    this.panel.dispose();

    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}
