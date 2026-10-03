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
  await expect(tables).toHaveText([/^notes\s*1$/, /^products\s*1$/, /^reviews\s*1$/, /^tasks\s*2$/, /^users\s*2$/]);
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

test('deletes a selected row from the JSONL file', async ({ app, screen, browser }) => {
  await app.open('/');
  await screen
    .getByRole('navigation')
    .getByRole('button', /^users/)
    .tap();
  const row = screen.getByRole('row').filter({ hasText: 'grace@example.test' });
  await expect(row).toBeVisible();

  const file = join(await dataDirOf(browser), 'users.jsonl');
  const original = await readFile(file, 'utf8');
  const expected = (await linesOf(file)).filter((line) => line.email !== 'grace@example.test');

  try {
    await row.getByRole('checkbox', 'Select row', { exact: true }).tap();
    await screen.getByRole('button', /^Delete\s*1$/).tap();
    await expect(row.getByRole('button', 'Undo delete', { exact: true })).toBeVisible();
    await app.screenshot('The row marked for deletion');
    await screen.getByRole('button', 'Save 1 change', { exact: true }).tap();
    await expect(screen.getByRole('alert')).toContainText('Saved 1 change(s) to users.jsonl');
    await expect.poll(() => linesOf(file)).toEqual(expected);
    await expect(row).toBeHidden();
  } finally {
    await writeFile(file, original);
  }
});

test('rewrites a failing row once it is fixed, removing the field outside the schema from every row', async ({
  app,
  screen,
  browser,
}) => {
  await app.open('/');
  await screen
    .getByRole('navigation')
    .getByRole('button', /^products/)
    .tap();
  const failing = screen.getByRole('alert').filter({ hasText: 'fail validation' });
  await expect(failing).toContainText('1 row of products fail validation');

  const file = join(await dataDirOf(browser), 'products.jsonl');
  const original = await readFile(file, 'utf8');

  try {
    await screen.getByRole('button', /^Edit price, which fails validation:/).tap();
    await screen.getByRole('textbox', 'price', { exact: true }).fill('5');
    await screen.getByRole('button', 'Set', { exact: true }).tap();
    await screen.getByRole('button', 'Remove legacy from every row', { exact: true }).tap();
    await expect(screen.getByRole('cell').filter({ hasText: 'removed' })).toBeVisible();
    await app.screenshot('The fixed price and legacy marked for removal');
    await screen.getByRole('button', 'Save 1 change', { exact: true }).tap();
    await expect(screen.getByRole('alert')).toContainText('Saved 1 change(s) to products.jsonl');
    await expect.poll(() => linesOf(file)).toEqual([{ id: 1, name: 'Broken widget', price: 5 }]);
    await expect(failing).toBeHidden();
    await expect(screen.getByRole('columnheader').filter({ hasText: 'legacy' })).toBeHidden();
  } finally {
    await writeFile(file, original);
  }
});

test('refuses to save a value the schema rejects, keeping the change', async ({ app, screen, browser }) => {
  await app.open('/');
  await screen
    .getByRole('navigation')
    .getByRole('button', /^users/)
    .tap();
  const row = screen.getByRole('row').filter({ hasText: 'ada@example.test' });
  await expect(row).toBeVisible();

  const file = join(await dataDirOf(browser), 'users.jsonl');
  const original = await readFile(file, 'utf8');

  try {
    await row.getByRole('button', 'Edit email', { exact: true }).tap();
    await screen.getByRole('textbox', 'email', { exact: true }).fill('not-an-email');
    await expect(screen.getByRole('dialog')).toContainText('1 issue');
    await expect(screen.getByRole('dialog')).toContainText('email:');
    await app.screenshot('The cell editor naming the issue');
    await screen.getByRole('button', 'Set', { exact: true }).tap();
    const save = screen.getByRole('button', 'Save 1 change', { exact: true });
    await save.tap();
    await expect(screen.getByRole('alert')).toContainText('email');
    await expect(save).toBeVisible();
    expect(await readFile(file, 'utf8')).toBe(original);
  } finally {
    await writeFile(file, original);
  }
});

test('reloads the table when its file changes on disk', async ({ app, screen, browser }) => {
  await app.open('/');
  await screen
    .getByRole('navigation')
    .getByRole('button', /^users/)
    .tap();
  const row = screen.getByRole('row').filter({ hasText: 'ada@example.test' });
  await expect(row.getByRole('button', 'Edit name', { exact: true })).toHaveText('Ada Lovelace');

  const file = join(await dataDirOf(browser), 'users.jsonl');
  const original = await readFile(file, 'utf8');

  try {
    await writeFile(file, original.replace('Ada Lovelace', 'Ada King'));
    await expect(row.getByRole('button', 'Edit name', { exact: true })).toHaveText('Ada King');
    await app.screenshot('The table reloaded from the changed file');
  } finally {
    await writeFile(file, original);
  }
});

test('saves changes begun before the file changed on disk onto its current rows', async ({ app, screen, browser }) => {
  await app.open('/');
  await screen
    .getByRole('navigation')
    .getByRole('button', /^users/)
    .tap();
  const row = screen.getByRole('row').filter({ hasText: 'ada@example.test' });
  await expect(row).toBeVisible();

  const file = join(await dataDirOf(browser), 'users.jsonl');
  const original = await readFile(file, 'utf8');
  const changed = original.replace('Grace Hopper', 'Grace Brewster');

  try {
    await row.getByRole('button', 'Edit name', { exact: true }).tap();
    await screen.getByRole('textbox', 'name', { exact: true }).fill('Ada Byron');
    await screen.getByRole('button', 'Set', { exact: true }).tap();
    await writeFile(file, changed);
    await expect(screen.getByRole('alert').filter({ hasText: 'The files changed on disk' })).toBeVisible();
    await app.screenshot('The notice that the files changed on disk');
    await screen.getByRole('button', 'Save 1 change', { exact: true }).tap();
    await expect(screen.getByRole('alert')).toContainText('Saved 1 change(s) to users.jsonl');
    await expect.poll(() => readFile(file, 'utf8')).toBe(changed.replace('Ada Lovelace', 'Ada Byron'));
  } finally {
    await writeFile(file, original);
  }
});

test('refuses to save changes to rows addressed by position once the file changed on disk', async ({
  app,
  screen,
  browser,
}) => {
  await app.open('/');
  await screen
    .getByRole('navigation')
    .getByRole('button', /^products/)
    .tap();
  const failing = screen.getByRole('alert').filter({ hasText: 'fail validation' });
  await expect(failing).toBeVisible();

  const file = join(await dataDirOf(browser), 'products.jsonl');
  const original = await readFile(file, 'utf8');
  const changed = original.replace('Broken widget', 'Mended widget');

  try {
    await screen.getByRole('button', /^Edit price, which fails validation:/).tap();
    await screen.getByRole('textbox', 'price', { exact: true }).fill('5');
    await expect(screen.getByRole('dialog')).toContainText('1 issue');
    await screen.getByRole('button', 'Set', { exact: true }).tap();
    await writeFile(file, changed);
    await expect(screen.getByRole('alert').filter({ hasText: 'The files changed on disk' })).toBeVisible();
    const save = screen.getByRole('button', 'Save 1 change', { exact: true });
    await save.tap();
    await expect(
      screen.getByRole('alert').filter({ hasText: 'products.jsonl changed since its rows were read' }),
    ).toBeVisible();
    await app.screenshot('The save refused for the changed file');
    await expect(save).toBeHidden();
    expect(await readFile(file, 'utf8')).toBe(changed);
  } finally {
    await writeFile(file, original);
  }
});

test('marks a value the schema fills in as the default', async ({ app, screen }) => {
  await app.open('/');
  await screen
    .getByRole('navigation')
    .getByRole('button', /^tasks/)
    .tap();
  const row = screen.getByRole('row').filter({ hasText: 'Ship the release' });
  await expect(row.getByRole('button', 'Edit done', { exact: true })).toHaveText(/^false\s*default$/);
  await app.screenshot('The default value of done');
});

test('removes a field from a row, leaving its value to the schema', async ({ app, screen, browser }) => {
  await app.open('/');
  await screen
    .getByRole('navigation')
    .getByRole('button', /^tasks/)
    .tap();
  const row = screen.getByRole('row').filter({ hasText: 'Write the tests' });
  await expect(row.getByRole('button', 'Edit done', { exact: true })).toHaveText('true');

  const file = join(await dataDirOf(browser), 'tasks.jsonl');
  const original = await readFile(file, 'utf8');
  const expected = await linesOf(file);
  delete expected[0].done;

  try {
    await row.getByRole('button', 'Edit done', { exact: true }).tap();
    await screen.getByRole('button', 'Remove field', { exact: true }).tap();
    await expect(row.getByRole('button', 'Edit done', { exact: true })).toHaveText('removed');
    await screen.getByRole('button', 'Save 1 change', { exact: true }).tap();
    await expect(screen.getByRole('alert')).toContainText('Saved 1 change(s) to tasks.jsonl');
    await expect.poll(() => linesOf(file)).toEqual(expected);
    await expect(row.getByRole('button', 'Edit done', { exact: true })).toHaveText(/^false\s*default$/);
    await app.screenshot('The removed field read again as the default');
  } finally {
    await writeFile(file, original);
  }
});

test('discards every unsaved change, leaving the file as it was', async ({ app, screen, browser }) => {
  await app.open('/');
  await screen
    .getByRole('navigation')
    .getByRole('button', /^users/)
    .tap();
  const ada = screen.getByRole('row').filter({ hasText: 'ada@example.test' });
  const grace = screen.getByRole('row').filter({ hasText: 'grace@example.test' });
  await expect(ada).toBeVisible();

  const file = join(await dataDirOf(browser), 'users.jsonl');
  const original = await readFile(file, 'utf8');

  try {
    await ada.getByRole('button', 'Edit name', { exact: true }).tap();
    await screen.getByRole('textbox', 'name', { exact: true }).fill('Ada Byron');
    await screen.getByRole('button', 'Set', { exact: true }).tap();
    await grace.getByRole('checkbox', 'Select row', { exact: true }).tap();
    await screen.getByRole('button', /^Delete\s*1$/).tap();
    const save = screen.getByRole('button', 'Save 2 changes', { exact: true });
    await expect(save).toBeVisible();
    await screen.getByRole('button', 'Discard', { exact: true }).tap();
    await expect(save).toBeHidden();
    await expect(ada.getByRole('button', 'Edit name', { exact: true })).toHaveText('Ada Lovelace');
    await expect(grace.getByRole('checkbox', 'Select row', { exact: true })).toBeVisible();
    await app.screenshot('The table after discarding');
    expect(await readFile(file, 'utf8')).toBe(original);
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

test('shows the declared definition in the Schema dialog, and the schema file source in its Code tab', async ({
  app,
  screen,
}) => {
  await app.open('/');
  await screen
    .getByRole('navigation')
    .getByRole('button', /^users/)
    .tap();
  await screen.getByRole('button', 'Schema', { exact: true }).tap();
  const dialog = screen.getByRole('dialog', 'users.schema.ts');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('cell').filter({ hasText: 'email' })).toBeVisible();
  await app.screenshot('The Schema dialog on its definition');
  await dialog.getByRole('tab', 'Code', { exact: true }).tap();
  const source = await readFile(new URL('../fixtures/users.schema.ts', import.meta.url), 'utf8');
  await expect(dialog.getByLabel('users.schema.ts', { exact: true })).toHaveText(source);
  await app.screenshot('The Schema dialog on its code');
  await dialog.getByRole('button', 'Close', { exact: true }).tap();
  await expect(dialog).toBeHidden();
});

test('follows a foreign key to the schema of the table it references, and back', async ({ app, screen, browser }) => {
  await app.open('/');
  await screen
    .getByRole('navigation')
    .getByRole('button', /^reviews/)
    .tap();
  await screen.getByRole('button', 'Schema', { exact: true }).tap();
  const hash = () => browser.evaluate(async () => location.hash);
  const reviews = screen.getByRole('dialog', 'reviews.schema.ts');
  const users = screen.getByRole('dialog', 'users.schema.ts');
  await expect(reviews).toBeVisible();
  expect(await hash()).toBe('#reviews?schema=reviews');
  await expect(reviews.getByRole('button', /^Back to the schema/)).toHaveCount(0);

  await reviews.getByRole('link', 'users', { exact: true }).first().tap();
  await expect(users).toBeVisible();
  expect(await hash()).toBe('#reviews?schema=users');
  await app.screenshot('The schema reached through a foreign key');

  await users.getByRole('button', 'Back to the schema of reviews', { exact: true }).tap();
  await expect(reviews).toBeVisible();
  expect(await hash()).toBe('#reviews?schema=reviews');

  await reviews.getByRole('link', 'users', { exact: true }).first().tap();
  await expect(users).toBeVisible();
  await browser.evaluate(async () => (history.back(), null));
  await expect(reviews).toBeVisible();
  await browser.evaluate(async () => (history.forward(), null));
  await expect(users).toBeVisible();
  await expect(users.getByRole('button', 'Back to the schema of reviews', { exact: true })).toBeVisible();

  await browser.evaluate(async () => (setTimeout(() => location.reload(), 0), null));
  await expect(users).toBeVisible();
  await expect(users.getByRole('button', 'Back to the schema of reviews', { exact: true })).toBeVisible();
  expect(await hash()).toBe('#reviews?schema=users');
});

test('leaves no schema entry in the history once the dialog is closed after following a foreign key', async ({
  app,
  screen,
  browser,
}) => {
  await app.open('/');
  await screen
    .getByRole('navigation')
    .getByRole('button', /^reviews/)
    .tap();
  await screen.getByRole('button', 'Schema', { exact: true }).tap();
  await screen.getByRole('dialog', 'reviews.schema.ts').getByRole('link', 'users', { exact: true }).first().tap();
  await expect(screen.getByRole('dialog', 'users.schema.ts')).toBeVisible();

  await screen.getByRole('dialog').getByRole('button', 'Close', { exact: true }).tap();
  await expect(screen.getByRole('dialog')).toBeHidden();
  expect(await browser.evaluate(async () => location.hash)).toBe('#reviews');

  await browser.evaluate(async () => (history.back(), null));
  await expect(screen.getByRole('heading', 'notes', { exact: true })).toBeVisible();
  await expect(screen.getByRole('dialog')).toBeHidden();
  expect(await browser.evaluate(async () => location.hash)).not.toContain('schema');
});

test('leaves no schema entry in the history when a schema opened by its address is closed after following a link', async ({
  app,
  screen,
  browser,
}) => {
  await app.open('/');
  await app.open('/#reviews?schema=reviews');
  await expect(screen.getByRole('dialog', 'reviews.schema.ts')).toBeVisible();
  await screen.getByRole('dialog', 'reviews.schema.ts').getByRole('link', 'users', { exact: true }).first().tap();
  await expect(screen.getByRole('dialog', 'users.schema.ts')).toBeVisible();

  await screen.getByRole('dialog').getByRole('button', 'Close', { exact: true }).tap();
  await expect(screen.getByRole('dialog')).toBeHidden();
  expect(await browser.evaluate(async () => location.hash)).toBe('#reviews');

  await browser.evaluate(async () => (history.back(), null));
  await expect(screen.getByRole('heading', 'notes', { exact: true })).toBeVisible();
  await expect(screen.getByRole('dialog')).toBeHidden();
});

test('opens the schema again when history returns to a table it was open on', async ({ app, screen, browser }) => {
  await app.open('/');
  await screen
    .getByRole('navigation')
    .getByRole('button', /^reviews/)
    .tap();
  await screen.getByRole('button', 'Schema', { exact: true }).tap();
  await expect(screen.getByRole('dialog', 'reviews.schema.ts')).toBeVisible();

  await browser.evaluate(async () => ((location.hash = '#users'), null));
  await expect(screen.getByRole('heading', 'users', { exact: true })).toBeVisible();
  await expect(screen.getByRole('dialog')).toBeHidden();

  await browser.evaluate(async () => (history.back(), null));
  await expect(screen.getByRole('dialog', 'reviews.schema.ts')).toBeVisible();
  expect(await browser.evaluate(async () => location.hash)).toBe('#reviews?schema=reviews');
  await screen.getByRole('dialog').getByRole('button', 'Close', { exact: true }).tap();
  await expect(screen.getByRole('heading', 'reviews', { exact: true })).toBeVisible();
});

test('opens and closes the table drawer at 390px', async ({ app, screen, browser }) => {
  await browser.setViewport({ width: 390, height: 844 });
  await app.open('/');
  await expect(screen.getByRole('heading', 'notes', { exact: true })).toBeVisible();
  const navigation = screen.getByRole('navigation');
  await expect(navigation).toBeHidden();
  await screen.getByRole('button', 'Open the table list').tap();
  await expect(navigation).toBeVisible();
  await expect(navigation.getByRole('button')).toHaveCount(5);
  await app.screenshot('The table list open at 390px');
  await screen.getByRole('button', 'Close the table list').tap();
  await expect(navigation).toBeHidden();
  await screen.getByRole('button', 'Open the table list').tap();
  await navigation.getByRole('button', /^users/).tap();
  await expect(screen.getByRole('heading', 'users', { exact: true })).toBeVisible();
  await expect(navigation).toBeHidden();
  expect(await browser.evaluate(() => window.innerWidth)).toBe(390);
});
