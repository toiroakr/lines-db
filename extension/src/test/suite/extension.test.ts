import * as assert from 'assert';
import { suite, test } from 'mocha';
import * as vscode from 'vscode';

async function activateExtension(): Promise<vscode.Extension<unknown>> {
  const extension = vscode.extensions.getExtension('lines-db.lines-db-vscode');
  assert.ok(extension, 'Expected extension to be installed');
  await extension.activate();
  assert.ok(extension.isActive, 'Extension should be active after activation');
  return extension;
}

suite('LinesDB Extension', () => {
  test('extension activates', async () => {
    await activateExtension();
  });
});
