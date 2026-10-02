import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('explains the validation problem visible in the products table', async ({ app, agent, screen }) => {
  await app.open('/');
  await agent.act('Open the {table} table and inspect its validation warning without changing any data.', {
    params: { table: 'products' },
  });
  await expect(screen.getByRole('heading', 'products', { exact: true })).toBeVisible();
  await expect(screen.getByRole('button', /^Edit price, which fails validation:/)).toBeVisible();
  await agent.assert(
    'The screen makes clear that a product row fails validation, marks its negative price, and identifies legacy as a field not in the schema.',
  );
});

test('finds a table on a narrow screen with a usable drawer', async ({ app, agent, screen, browser }) => {
  await browser.setViewport({ width: 390, height: 844 });
  await app.open('/');
  await agent.act('Open the table list so you can choose a table.');
  await expect(screen.getByRole('navigation')).toBeVisible();
  await agent.assert(
    'The open table drawer fits the phone viewport and its table names and close button are readable and unobstructed.',
    { vision: true },
  );
  await agent.act('Open the {table} table from the table list.', { params: { table: 'notes' } });
  await expect(screen.getByRole('navigation')).toBeHidden();
  await expect(screen.getByRole('heading', 'notes', { exact: true })).toBeVisible();
});
