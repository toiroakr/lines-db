import * as assert from 'assert';
import { suite, test } from 'mocha';
import * as vscode from 'vscode';
import * as path from 'node:path';

suite('Completion Provider - Quote Handling', () => {
  let document: vscode.TextDocument;

  setup(async () => {
    // Create a temporary JSONL file for testing
    const fixturesPath = path.join(__dirname, '../../../examples/fixtures');
    const usersPath = path.join(fixturesPath, 'users.jsonl');
    document = await vscode.workspace.openTextDocument(usersPath);
  });

  test('should complete field name without quotes: {, |', async () => {
    // Simulate typing: {"id":1,"name":"Alice", |
    const line = '{"id":1,"name":"Alice", ';
    const position = new vscode.Position(0, line.length);

    // Create a text editor with the content
    const editor = await vscode.window.showTextDocument(document);
    await editor.edit((editBuilder) => {
      editBuilder.insert(new vscode.Position(0, 0), line);
    });

    // Get completions
    const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
      'vscode.executeCompletionItemProvider',
      document.uri,
      position,
    );

    // Find the "gender" completion
    const genderCompletion = completions?.items.find((item) => item.label === 'gender');
    assert.ok(genderCompletion, 'Should provide gender completion');

    // Check the insert text
    const insertText = genderCompletion.insertText;
    if (insertText instanceof vscode.SnippetString) {
      // Expected: "gender": "${1}"
      // The field name should be quoted
      assert.ok(
        insertText.value.startsWith('"gender"'),
        `Insert text should start with "gender", got: ${insertText.value}`,
      );
    } else {
      assert.fail('Insert text should be a SnippetString');
    }
  });

  test('should complete field name with opening quote: {, "|', async () => {
    // Simulate typing: {"id":1,"name":"Alice", "|
    const line = '{"id":1,"name":"Alice", "';
    const position = new vscode.Position(0, line.length);

    // Create a text editor with the content
    const editor = await vscode.window.showTextDocument(document);
    await editor.edit((editBuilder) => {
      editBuilder.delete(
        new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, Number.MAX_VALUE)),
      );
      editBuilder.insert(new vscode.Position(0, 0), line);
    });

    // Get completions
    const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
      'vscode.executeCompletionItemProvider',
      document.uri,
      position,
    );

    // Find the "gender" completion
    const genderCompletion = completions?.items.find((item) => item.label === 'gender');
    assert.ok(genderCompletion, 'Should provide gender completion');

    // Check the insert text
    const insertText = genderCompletion.insertText;
    if (insertText instanceof vscode.SnippetString) {
      // Expected: gender": "${1}"
      // Should NOT add opening quote (already present)
      // Should NOT have extra closing quote
      assert.ok(
        !insertText.value.startsWith('"'),
        `Insert text should NOT start with quote when quote already present, got: ${insertText.value}`,
      );

      // Count quotes in insert text
      const quoteCount = (insertText.value.match(/"/g) || []).length;
      // Should have: 1 closing quote for field name + 2 quotes for value = 3 quotes total
      assert.strictEqual(
        quoteCount,
        3,
        `Insert text should have exactly 3 quotes (1 for closing field name, 2 for value), got ${quoteCount}: ${insertText.value}`,
      );
    } else {
      assert.fail('Insert text should be a SnippetString');
    }
  });
});
