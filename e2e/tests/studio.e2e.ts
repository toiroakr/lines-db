import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

/** As much of the test's browser as reading the studio's metadata needs */
type Browser = { evaluate<T>(run: () => Promise<T>): Promise<T> };

/** The directory the studio reads the tables from, a copy of the fixtures made for the run */
async function dataDirOf(browser: Browser): Promise<string> {
  return browser.evaluate(async () => {
    const response = await fetch('/api/tables', {
      headers: { Authorization: `Bearer ${sessionStorage.getItem('lines-db-studio:token')}` },
    });
    if (!response.ok) throw new Error(`Could not read studio metadata: ${response.status}`);
    const metadata = await response.json();
    return metadata.dataDir as string;
  });
}

const linesOf = async (file: string) =>
  (await readFile(file, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));

test('lists the fixture tables and filters the sidebar', async ({ app, screen }) => {
  await app.open('/');
  const tables = screen.getByRole('navigation').getByRole('button');
  await expect(tables).toHaveText([/^notes\s*1$/, /^products\s*1$/, /^users\s*2$/]);
  await screen.getByRole('textbox', 'Search tables').fill('users');
  await expect(tables).toHaveCount(1);
  await expect(tables).toContainText('users');
  await app.screenshot('The sidebar filtered to users');
});

test('saves an edited cell to the JSONL file', async ({ app, screen, browser }) => {
  await app.open('/');
  await screen
    .getByRole('navigation')
    .getByRole('button', /^users/)
    .tap();
  const row = screen.getByRole('row').filter({ hasText: 'ada@example.test' });
  await expect(row.getByRole('button', 'Edit name', { exact: true })).toHaveText('Ada Lovelace');

  const file = join(await dataDirOf(browser), 'users.jsonl');
  const original = await readFile(file, 'utf8');
  const expected = await linesOf(file);
  expected[0].name = 'Ada Byron';

  try {
    await row.getByRole('button', 'Edit name', { exact: true }).tap();
    await screen.getByRole('textbox', 'name', { exact: true }).fill('Ada Byron');
    await screen.getByRole('button', 'Set', { exact: true }).tap();
    const save = screen.getByRole('button', 'Save 1 change', { exact: true });
    await expect(save).toBeVisible();
    expect(await readFile(file, 'utf8')).toBe(original);
    await save.tap();
    await expect(screen.getByRole('alert')).toContainText('Saved 1 change(s) to users.jsonl');
    await expect(save).toBeHidden();
    await expect.poll(() => linesOf(file)).toEqual(expected);
    await screen.getByRole('button', 'Reload from the files').tap();
    await expect(row.getByRole('button', 'Edit name', { exact: true })).toHaveText('Ada Byron');
    await app.screenshot('The saved name, read again from the file');
  } finally {
    await writeFile(file, original);
  }
});

test('shows failing cells and fields outside the schema from the file', async ({ app, screen }) => {
  await app.open('/');
  await screen
    .getByRole('navigation')
    .getByRole('button', /^products/)
    .tap();
  await expect(screen.getByRole('alert')).toContainText('1 row of products fail validation');
  await expect(screen.getByRole('button', /^Row 1 fails validation:/)).toBeVisible();
  await expect(screen.getByRole('button', /^Edit price, which fails validation:/)).toHaveText('-5');
  await expect(screen.getByRole('columnheader').filter({ hasText: 'legacy' })).toContainText('not in schema');
  await expect(screen.getByRole('cell').filter({ hasText: 'retired' })).toBeVisible();
  await app.screenshot('The failing row and the field outside the schema');
});

test('shows the schema file source in the Schema dialog', async ({ app, screen }) => {
  await app.open('/');
  await screen
    .getByRole('navigation')
    .getByRole('button', /^users/)
    .tap();
  await screen.getByRole('button', 'Schema', { exact: true }).tap();
  const dialog = screen.getByRole('dialog', 'users.schema.ts');
  await expect(dialog).toBeVisible();
  const source = await readFile(new URL('../fixtures/users.schema.ts', import.meta.url), 'utf8');
  await expect(dialog.getByLabel('users.schema.ts', { exact: true })).toHaveText(source);
  await app.screenshot('The Schema dialog');
  await dialog.getByRole('button', 'Close', { exact: true }).tap();
  await expect(dialog).toBeHidden();
});

test('opens and closes the table drawer at 390px', async ({ app, screen, browser }) => {
  await browser.setViewport({ width: 390, height: 844 });
  await app.open('/');
  await expect(screen.getByRole('heading', 'notes', { exact: true })).toBeVisible();
  const navigation = screen.getByRole('navigation');
  await expect(navigation).toBeHidden();
  await screen.getByRole('button', 'Open the table list').tap();
  await expect(navigation).toBeVisible();
  await expect(navigation.getByRole('button')).toHaveCount(3);
  await app.screenshot('The table list open at 390px');
  await screen.getByRole('button', 'Close the table list').tap();
  await expect(navigation).toBeHidden();
  await screen.getByRole('button', 'Open the table list').tap();
  await navigation.getByRole('button', /^users/).tap();
  await expect(screen.getByRole('heading', 'users', { exact: true })).toBeVisible();
  await expect(navigation).toBeHidden();
  expect(await browser.evaluate(() => window.innerWidth)).toBe(390);
});
