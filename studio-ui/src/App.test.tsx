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
