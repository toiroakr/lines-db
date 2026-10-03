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
  await app.screenshot('The sidebar filtered to users');
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
    await expect(screen.getByRole('alert').filter({ hasText: 'Saved' })).toContainText(
      'Saved 1 change(s) to users.jsonl',
    );
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
  await expect(navigation.getByRole('button')).toHaveCount(4);
  await app.screenshot('The table list open at 390px');
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
    await app.screenshot('A name changed in the row form');
    await screen.getByRole('button', 'Save 1 change', { exact: true }).tap();
    await expect(screen.getByRole('alert').filter({ hasText: 'Saved' })).toContainText(
      'Saved 1 change(s) to users.jsonl',
    );
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
    await app.screenshot('A JSON value as fields in the row form');

    await form.getByRole('textbox', 'items.0.quantity', { exact: true }).fill('3');
    await screen.getByRole('button', 'Save 1 change', { exact: true }).tap();
    await expect(screen.getByRole('alert').filter({ hasText: 'Saved' })).toContainText(
      'Saved 1 change(s) to orders.jsonl',
    );
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
  await app.screenshot('The row a foreign key refers to');
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
  await app.screenshot('A row shown in the form from a double click');
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
  await app.screenshot('A line broken with Shift+Enter');
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
  await app.screenshot('A JSON cell edited as fields');

  await editor.getByRole('button', 'Edit items as JSON', { exact: true }).tap();
  await expect(editor.getByRole('textbox', 'items', { exact: true })).toBeVisible();
});

test('adds a row filled in the new row dialog, and saves it to the JSONL file', async ({ app, screen, browser }) => {
  await app.open('/');
  await screen
    .getByRole('navigation')
    .getByRole('button', /^users/)
    .tap();
  const file = join(await dataDirOf(browser), 'users.jsonl');
  const original = await readFile(file, 'utf8');
  const expected = [...(await linesOf(file)), { id: 3, name: 'Linus', email: 'linus@example.test' }];

  try {
    await screen.getByRole('button', 'Add record', { exact: true }).tap();
    const dialog = screen.getByRole('dialog', 'New row in users', { exact: true });
    await dialog.getByRole('textbox', 'id', { exact: true }).fill('3');
    await dialog.getByRole('textbox', 'name', { exact: true }).fill('Linus');
    await expect(dialog).toContainText('email:');
    await app.screenshot('The new row dialog checking the whole row');
    await dialog.getByRole('textbox', 'email', { exact: true }).fill('linus@example.test');
    await dialog.getByRole('button', 'Add', { exact: true }).tap();
    await expect(dialog).toBeHidden();

    await screen.getByRole('button', 'Save 1 change', { exact: true }).tap();
    await expect(screen.getByRole('alert').filter({ hasText: 'Saved' })).toContainText(
      'Saved 1 change(s) to users.jsonl',
    );
    await expect.poll(() => linesOf(file)).toEqual(expected);
  } finally {
    await writeFile(file, original);
  }
});

test('offers null only for a column that can hold it, in the row form and the cell editor', async ({ app, screen }) => {
  await app.open('/');
  await screen
    .getByRole('navigation')
    .getByRole('button', /^orders/)
    .tap();
  await screen.getByRole('button', 'Edit customerId', { exact: true }).tap();
  const form = screen.getByRole('complementary', 'orders · id 1', { exact: true });

  // customerId and items refuse null in the schema. meta takes it there, but every row holds a value
  // in it, so its column is NOT NULL and a null would fail on save. note is nullish and holds a null
  await expect(form.getByRole('button', 'Set customerId to null', { exact: true })).toHaveCount(0);
  await expect(form.getByRole('button', 'Set items to null', { exact: true })).toHaveCount(0);
  await expect(form.getByRole('button', 'Set meta to null', { exact: true })).toHaveCount(0);
  await form.getByRole('textbox', 'note', { exact: true }).fill('gift');
  await expect(form.getByRole('button', 'Set note to null', { exact: true })).toBeVisible();
  await app.screenshot('Set null offered on note only, in the row form');
  await screen.getByRole('button', 'Discard', { exact: true }).tap();

  await screen.getByRole('button', 'Hide the row form', { exact: true }).tap();
  await screen.getByRole('button', 'Edit customerId', { exact: true }).tap();
  await expect(screen.getByRole('textbox', 'customerId', { exact: true })).toBeVisible();
  await expect(screen.getByRole('button', 'Set null', { exact: true })).toHaveCount(0);
  await screen.getByRole('textbox', 'customerId', { exact: true }).press('Escape');

  await screen.getByRole('button', 'Edit note', { exact: true }).tap();
  await expect(screen.getByRole('button', 'Set null', { exact: true })).toBeVisible();
  await app.screenshot('Set null offered in the cell editor of note');
});

test('offers removing a key only where the schema lets it be left out, in the row form, the cell editor and inside JSON', async ({
  app,
  screen,
}) => {
  await app.open('/');
  await screen
    .getByRole('navigation')
    .getByRole('button', /^orders/)
    .tap();
  await screen.getByRole('button', 'Edit customerId', { exact: true }).tap();
  const form = screen.getByRole('complementary', 'orders · id 1', { exact: true });

  // note is nullish, so it can be left out; customerId and items are needed
  await expect(form.getByRole('button', 'Remove note', { exact: true })).toBeVisible();
  await expect(form.getByRole('button', 'Remove customerId', { exact: true })).toHaveCount(0);
  await expect(form.getByRole('button', 'Remove items', { exact: true })).toHaveCount(0);
  // Inside JSON: the name of an item of a strict object is needed; a key of the record meta is not
  await expect(form.getByRole('button', 'Remove items.0.name', { exact: true })).toHaveCount(0);
  await expect(form.getByRole('button', 'Remove meta.source', { exact: true })).toBeVisible();
  await app.screenshot('Removing a key offered on note and meta.source only, in the row form');

  await screen.getByRole('button', 'Hide the row form', { exact: true }).tap();
  await screen.getByRole('button', 'Edit customerId', { exact: true }).tap();
  await expect(screen.getByRole('textbox', 'customerId', { exact: true })).toBeVisible();
  await expect(screen.getByRole('button', 'Remove field', { exact: true })).toHaveCount(0);
  await screen.getByRole('textbox', 'customerId', { exact: true }).press('Escape');

  await screen.getByRole('button', 'Edit note', { exact: true }).tap();
  await expect(screen.getByRole('button', 'Remove field', { exact: true })).toBeVisible();
  await app.screenshot('Remove field offered in the cell editor of note');
});
