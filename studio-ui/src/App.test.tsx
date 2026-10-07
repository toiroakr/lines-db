import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import type { TableInfo } from '@/lib/types';

const users: TableInfo = {
  name: 'users',
  columns: [
    { name: 'id', type: 'INTEGER', primaryKey: true },
    { name: 'name', type: 'TEXT' },
  ],
  primaryKey: 'id',
  rowCount: 2,
  invalidRows: 0,
  readOnlyReason: null,
  schemaFile: null,
  references: [],
};
const orders: TableInfo = {
  ...users,
  name: 'orders',
  columns: [
    { name: 'id', type: 'INTEGER', primaryKey: true },
    { name: 'customerId', type: 'INTEGER' },
  ],
  rowCount: 1,
  references: [{ column: 'customerId', table: 'users', referencedColumn: 'id' }],
};
const rows: Record<string, unknown> = {
  users: {
    rows: [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ],
    defaulted: [[], []],
  },
  orders: { rows: [{ id: 10, customerId: 2 }], defaulted: [[]] },
};

const json = (body: unknown) => new Response(JSON.stringify(body));
// Not set through location.hash: its hashchange would arrive after the page is up, and switch the table it shows
const showTable = (name: string) => history.replaceState(null, '', `#${name}`);

describe('App', () => {
  beforeEach(() => {
    localStorage.clear();
    showTable('users');
    vi.stubGlobal(
      'EventSource',
      class {
        addEventListener() {}
        close() {}
      },
    );
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/tables') return json({ dataDir: '/data', tables: [users, orders], problems: [] });
      const rowsOf = /\/api\/tables\/(\w+)\/rows/.exec(url);
      if (rowsOf) return json(rows[rowsOf[1]]);
      return json({ ok: true });
    });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const form = () => screen.queryByRole('complementary', { name: /^users · |^orders · |^Row form$/ });
  const showForm = async () => userEvent.click(await screen.findByRole('button', { name: 'Show the row form' }));
  const nameCells = () => screen.findAllByRole('button', { name: 'Edit name' });

  it('keeps failing rows read-only when several data directories are composed', async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      if (String(input) === '/api/tables')
        return json({
          dataDir: '/base, /local',
          tables: [
            {
              ...users,
              columns: users.columns.map((column) => ({ ...column, unknown: column.name === 'name' })),
              invalidRows: 1,
              readOnlyReason: 'This view combines several data directories and is read-only.',
            },
          ],
          problems: [],
        });
      return json({
        ...(rows.users as object),
        issues: { 0: [{ message: 'Name required', path: ['name'] }] },
        revision: 'revision',
      });
    });
    render(<App />);

    await screen.findByText('This view combines several data directories and is read-only.');
    expect(screen.queryAllByRole('button', { name: /^Edit name/ })).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Remove name from every row' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add record' })).toHaveProperty('disabled', true);
  });

  it('edits a cell from a click while the form is hidden', async () => {
    render(<App />);

    await userEvent.click((await nameCells())[1]);

    expect(screen.getAllByRole('textbox', { name: 'name' })).toHaveLength(1);
    expect(form()).toBeNull();
  });

  it('shows the row double-clicked in the form while the form is hidden, closing the cell editor', async () => {
    render(<App />);

    await userEvent.dblClick((await nameCells())[1]);

    expect(form()?.getAttribute('aria-label')).toBe('users · id 2');
    expect(screen.getAllByRole('textbox', { name: 'name' })).toHaveLength(1);
  });

  it('shows the form from the header, waiting for a row to be picked', async () => {
    render(<App />);

    await showForm();

    expect(form()?.getAttribute('aria-label')).toBe('Row form');
  });

  it('shows the row clicked in the form while it is shown, and edits a cell only from a double click', async () => {
    render(<App />);
    await showForm();
    const bob = (await nameCells())[1];

    await userEvent.click(bob);
    expect(form()?.getAttribute('aria-label')).toBe('users · id 2');
    expect(within(form()!).getByRole('textbox', { name: 'name' })).toHaveProperty('value', 'Bob');
    expect(screen.getAllByRole('textbox', { name: 'name' })).toHaveLength(1);

    await userEvent.dblClick(bob);
    expect(screen.getAllByRole('textbox', { name: 'name' })).toHaveLength(2);
  });

  it('shows the row in the form from Enter on a cell while the form is shown, as a click does', async () => {
    render(<App />);
    await showForm();
    const bob = (await nameCells())[1];

    bob.focus();
    await userEvent.keyboard('{Enter}');

    expect(form()?.getAttribute('aria-label')).toBe('users · id 2');
    expect(screen.getAllByRole('textbox', { name: 'name' })).toHaveLength(1);
  });

  it('hides the form from the header again', async () => {
    render(<App />);
    await showForm();

    await userEvent.click(screen.getAllByRole('button', { name: 'Hide the row form' })[0]);

    expect(form()).toBeNull();
  });

  it('adds a change from the form to the unsaved ones, and drops it once typed back to the value of the file', async () => {
    render(<App />);
    await showForm();
    await userEvent.click((await nameCells())[0]);
    const name = within(form()!).getByRole('textbox', { name: 'name' });

    await userEvent.type(name, 'x');
    expect(screen.getByText(/Unsaved change to users/)).toBeTruthy();

    await userEvent.type(name, '{Backspace}');
    expect(screen.queryByText(/Unsaved change/)).toBeNull();
  });

  it('saves no change while a field of the form holds text it cannot read', async () => {
    showTable('orders');
    render(<App />);
    await showForm();
    await userEvent.click((await screen.findAllByRole('button', { name: 'Edit customerId' }))[0]);
    const customerId = within(form()!).getByRole('textbox', { name: 'customerId' });

    await userEvent.clear(customerId);
    await userEvent.type(customerId, '3a');

    expect(screen.getByRole('button', { name: 'Save 1 change' })).toHaveProperty('disabled', true);
  });

  it('shows the value of the file again in the form once the changes are discarded, dropping text it could not read', async () => {
    showTable('orders');
    render(<App />);
    await showForm();
    // Not a change of the field itself: text it cannot read hands nothing on, so another change keeps Discard there
    await userEvent.click(await screen.findByRole('button', { name: 'Add record' }));
    await userEvent.click(
      within(screen.getByRole('dialog', { name: 'New row in orders' })).getByRole('button', { name: 'Add' }),
    );
    await userEvent.click((await screen.findAllByRole('button', { name: 'Edit customerId' }))[1]);
    const customerId = within(form()!).getByRole('textbox', { name: 'customerId' });
    await userEvent.clear(customerId);
    await userEvent.type(customerId, 'x');

    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));

    expect(within(form()!).getByRole('textbox', { name: 'customerId' })).toHaveProperty('value', '2');
  });

  it('opens the row a foreign key refers to, in the table it is in', async () => {
    showTable('orders');
    render(<App />);
    await showForm();
    await userEvent.click((await screen.findAllByRole('button', { name: 'Edit customerId' }))[0]);

    await userEvent.click(within(form()!).getByRole('button', { name: 'Open users where id is 2' }));

    await waitFor(() => expect(form()?.getAttribute('aria-label')).toBe('users · id 2'));
  });

  it('adds a row filled in a dialog to the unsaved changes, at the head of the grid and in the form', async () => {
    render(<App />);
    await showForm();

    await userEvent.click(await screen.findByRole('button', { name: 'Add record' }));
    const dialog = screen.getByRole('dialog', { name: 'New row in users' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'id' }), '3');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'name' }), 'Linus');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText(/Unsaved change to users/)).toBeTruthy();
    expect(screen.getAllByRole('row')[1].textContent).toContain('Linus');
    expect(form()?.getAttribute('aria-label')).toBe('users · new row');
  });
});
