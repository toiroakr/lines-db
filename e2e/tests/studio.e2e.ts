import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('lists the fixture tables and filters the sidebar', async ({ app, screen }) => {
  await app.open('/');
  const tables = screen.getByRole('navigation').getByRole('button');
  await expect(tables).toHaveText([/^notes\s*1$/, /^orders\s*1$/, /^products\s*1$/, /^users\s*2$/]);
  await screen.getByRole('textbox', 'Search tables').fill('users');
  await expect(tables).toHaveCount(1);
  await expect(tables).toContainText('users');
});

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
  const expected = original
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  expected[0].name = 'Ada Byron';

  try {
    // Not with the row form shown, as it is at first on a wide screen: a click then picks the row for it
    await screen.getByRole('button', 'Hide the row form', { exact: true }).tap();
    await row.getByRole('button', 'Edit name', { exact: true }).tap();
    await screen.getByRole('textbox', 'name', { exact: true }).fill('Ada Byron');
    await screen.getByRole('button', 'Set', { exact: true }).tap();
    const save = screen.getByRole('button', 'Save 1 change', { exact: true });
    await expect(save).toBeVisible();
    expect(await readFile(file, 'utf8')).toBe(original);
    await save.tap();
    await expect(screen.getByRole('alert')).toContainText('Saved 1 change(s) to users.jsonl');
    await expect(save).toBeHidden();
    await expect
      .poll(async () =>
        (await readFile(file, 'utf8'))
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line)),
      )
      .toEqual(expected);
    await screen.getByRole('button', 'Reload from the files').tap();
    await expect(row.getByRole('button', 'Edit name', { exact: true })).toHaveText('Ada Byron');
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
  await expect(navigation.getByRole('button')).toHaveCount(4);
  await screen.getByRole('button', 'Close the table list').tap();
  await expect(navigation).toBeHidden();
  await screen.getByRole('button', 'Open the table list').tap();
  await navigation.getByRole('button', /^users/).tap();
  await expect(screen.getByRole('heading', 'users', { exact: true })).toBeVisible();
  await expect(navigation).toBeHidden();
  expect(await browser.evaluate(() => window.innerWidth)).toBe(390);
});

test('saves a change made in the row form to the JSONL file', async ({ app, screen, browser }) => {
  await app.open('/');
  await screen
    .getByRole('navigation')
    .getByRole('button', /^users/)
    .tap();
  const file = join(await dataDirOf(browser), 'users.jsonl');
  const original = await readFile(file, 'utf8');
  const expected = await linesOf(file);
  expected[1].name = 'Grace Brewster Hopper';

  try {
    await screen
      .getByRole('row')
      .filter({ hasText: 'grace@example.test' })
      .getByRole('button', 'Edit name', { exact: true })
      .tap();
    const form = screen.getByRole('complementary', 'users · id 2', { exact: true });
    await expect(form).toBeVisible();
    await form.getByRole('textbox', 'name', { exact: true }).fill('Grace Brewster Hopper');
    await screen.getByRole('button', 'Save 1 change', { exact: true }).tap();
    await expect(screen.getByRole('alert')).toContainText('Saved 1 change(s) to users.jsonl');
    await expect.poll(() => linesOf(file)).toEqual(expected);
  } finally {
    await writeFile(file, original);
  }
});

test('edits a key inside a JSON value as a field of the row form, offering keys only as the schema takes them', async ({
  app,
  screen,
  browser,
}) => {
  await app.open('/');
  await screen
    .getByRole('navigation')
    .getByRole('button', /^orders/)
    .tap();
  const file = join(await dataDirOf(browser), 'orders.jsonl');
  const original = await readFile(file, 'utf8');
  const expected = await linesOf(file);
  expected[0].items[0].quantity = 3;

  try {
    await screen.getByRole('button', 'Edit customerId', { exact: true }).tap();
    const form = screen.getByRole('complementary', 'orders · id 1', { exact: true });
    await expect(form.getByRole('textbox', 'items.0.name', { exact: true })).toHaveValue('Pen');
    // Not offered for an item of a strict object, which takes no key it does not name; offered for a record
    await expect(form.getByRole('button', 'Add a key to items.0', { exact: true })).toHaveCount(0);
    await expect(form.getByRole('button', 'Add a key to meta', { exact: true })).toBeVisible();

    await form.getByRole('textbox', 'items.0.quantity', { exact: true }).fill('3');
    await screen.getByRole('button', 'Save 1 change', { exact: true }).tap();
    await expect(screen.getByRole('alert')).toContainText('Saved 1 change(s) to orders.jsonl');
    await expect.poll(() => linesOf(file)).toEqual(expected);
  } finally {
    await writeFile(file, original);
  }
});

test('opens the row a foreign key refers to from the row form', async ({ app, screen }) => {
  await app.open('/');
  await screen
    .getByRole('navigation')
    .getByRole('button', /^orders/)
    .tap();
  await screen.getByRole('button', 'Edit customerId', { exact: true }).tap();

  await screen.getByRole('button', 'Open users where id is 2', { exact: true }).tap();

  await expect(screen.getByRole('heading', 'users', { exact: true })).toBeVisible();
  await expect(screen.getByRole('complementary', 'users · id 2', { exact: true })).toBeVisible();
});

test('opens a row in the hidden row form with a double click', async ({ app, screen }) => {
  await app.open('/');
  await screen
    .getByRole('navigation')
    .getByRole('button', /^users/)
    .tap();
  await screen.getByRole('button', 'Hide the row form', { exact: true }).tap();
  await expect(screen.getByRole('complementary', 'Row form', { exact: true })).toBeHidden();

  await screen
    .getByRole('row')
    .filter({ hasText: 'ada@example.test' })
    .getByRole('button', 'Edit email', { exact: true })
    .doubleTap();

  await expect(screen.getByRole('complementary', 'users · id 1', { exact: true })).toBeVisible();
});

test('breaks a line of text with Shift+Enter, and none with Enter alone', async ({ app, screen }) => {
  await app.open('/');
  await screen
    .getByRole('navigation')
    .getByRole('button', /^users/)
    .tap();
  await screen.getByRole('button', 'Edit name', { exact: true }).first().tap();
  const name = screen
    .getByRole('complementary', 'users · id 1', { exact: true })
    .getByRole('textbox', 'name', { exact: true });
  await name.fill('Ada');

  await name.press('Enter');
  await name.press('Shift+Enter');
  await name.press('L');

  await expect(name).toHaveValue('Ada\nL');
  await screen.getByRole('button', 'Discard', { exact: true }).tap();
});

test('edits a JSON cell as fields of its own', async ({ app, screen }) => {
  await app.open('/');
  await screen
    .getByRole('navigation')
    .getByRole('button', /^orders/)
    .tap();
  await screen.getByRole('button', 'Hide the row form', { exact: true }).tap();

  await screen.getByRole('button', 'Edit items', { exact: true }).tap();
  const editor = screen.getByRole('dialog');
  await expect(editor.getByRole('textbox', 'items.0.name', { exact: true })).toHaveValue('Pen');

  await editor.getByRole('button', 'Edit items as JSON', { exact: true }).tap();
  await expect(editor.getByRole('textbox', 'items', { exact: true })).toBeVisible();
});
