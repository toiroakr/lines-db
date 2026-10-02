import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormField, RecordDrawer, type FieldModel } from './record-form';
import type { Column, JsonValue } from '@/lib/types';

const field = (column: Column, value: JsonValue | undefined, overrides: Partial<FieldModel> = {}): FieldModel => ({
  column,
  value,
  state: 'file',
  readOnly: false,
  issues: [],
  preview: () => ({ inserts: [], updates: [], deletes: [] }),
  canUseDefault: true,
  canRevert: false,
  onChange: vi.fn(),
  onUseDefault: vi.fn(),
  onRevert: vi.fn(),
  ...overrides,
});

describe('FormField', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true })));
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('hands each text it is given to the form as the value of the field', () => {
    const model = field({ name: 'name', type: 'TEXT' }, 'Alice');
    render(<FormField table="users" model={model} />);

    fireEvent.change(screen.getByRole('textbox', { name: 'name' }), { target: { value: 'Alicia' } });

    expect(model.onChange).toHaveBeenLastCalledWith('Alicia');
  });

  it('holds back a number it cannot read, and says why', () => {
    const model = field({ name: 'age', type: 'INTEGER' }, 30);
    render(<FormField table="users" model={model} />);

    fireEvent.change(screen.getByRole('textbox', { name: 'age' }), { target: { value: '3a' } });

    expect(model.onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/number/i)).toBeTruthy();
  });

  it('reads a number it is given as a number', () => {
    const model = field({ name: 'age', type: 'INTEGER' }, 30);
    render(<FormField table="users" model={model} />);

    fireEvent.change(screen.getByRole('textbox', { name: 'age' }), { target: { value: '31' } });

    expect(model.onChange).toHaveBeenLastCalledWith(31);
  });

  it('sets a boolean from the option pressed, showing which one holds', async () => {
    const model = field({ name: 'active', type: 'INTEGER', valueType: 'boolean' }, true);
    render(<FormField table="users" model={model} />);

    expect(screen.getByRole('button', { name: 'true' }).getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: 'false' }));

    expect(model.onChange).toHaveBeenLastCalledWith(false);
  });

  it('marks a value the schema filled in, and removes a field the row holds on request', async () => {
    const defaulted = field({ name: 'age', type: 'INTEGER' }, 20, { state: 'default', canUseDefault: false });
    const held = field({ name: 'nick', type: 'TEXT' }, 'Al');
    render(
      <>
        <FormField table="users" model={defaulted} />
        <FormField table="users" model={held} />
      </>,
    );

    expect(screen.getByText('default')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Remove/ })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: /Remove nick/ }));
    expect(held.onUseDefault).toHaveBeenCalled();
  });

  it('opens the row a foreign key refers to', async () => {
    const onOpenReference = vi.fn();
    const model = field({ name: 'owner', type: 'INTEGER' }, 1, {
      reference: { column: 'owner', table: 'owners', referencedColumn: 'id' },
      onOpenReference,
    });
    render(<FormField table="pets" model={model} />);

    await userEvent.click(screen.getByRole('button', { name: 'Open owners where id is 1' }));

    expect(onOpenReference).toHaveBeenCalled();
  });

  it('offers only to remove a field the schema refuses as a key', () => {
    const model = field({ name: 'note', type: 'TEXT', unknown: true }, 'x');
    render(<FormField table="orders" model={model} />);

    expect(screen.queryByRole('textbox', { name: 'note' })).toBeNull();
    expect(screen.getByRole('button', { name: /Remove note/ })).toBeTruthy();
  });

  it('shows a value it cannot change without a way to change it', () => {
    const model = field({ name: 'id', type: 'INTEGER', primaryKey: true }, 1, { readOnly: true });
    render(<FormField table="users" model={model} />);

    expect((screen.getByRole('textbox', { name: 'id' }) as HTMLInputElement).readOnly).toBe(true);
  });

  it('shows a value changed elsewhere, such as a change reverted in the grid', () => {
    const model = field({ name: 'name', type: 'TEXT' }, 'Alicia');
    const { rerender } = render(<FormField table="users" model={model} />);

    rerender(<FormField table="users" model={{ ...model, value: 'Alice' }} />);

    expect((screen.getByRole('textbox', { name: 'name' }) as HTMLInputElement).value).toBe('Alice');
  });
});

describe('RecordDrawer', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true })));
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const fields = [
    field({ name: 'id', type: 'INTEGER', primaryKey: true }, 1),
    field({ name: 'name', type: 'TEXT' }, 'Alice'),
  ];

  it('shows a field for each column of the row, under the name of the row', () => {
    render(<RecordDrawer table="users" row={{ title: 'users id 1', fields }} onClose={vi.fn()} />);

    const drawer = screen.getByRole('complementary', { name: 'users id 1' });
    expect(drawer.querySelectorAll('[data-field]')).toHaveLength(2);
  });

  it('says how to show a row in it, before one is picked', () => {
    render(<RecordDrawer table="users" onClose={vi.fn()} />);

    expect(within(screen.getByRole('complementary', { name: 'Row form' })).getByText(/Click a row/)).toBeTruthy();
  });

  it('hides from its close button', async () => {
    const onClose = vi.fn();
    render(<RecordDrawer table="users" row={{ title: 'users id 1', fields }} onClose={onClose} />);

    await userEvent.click(screen.getByRole('button', { name: 'Hide the row form' }));

    expect(onClose).toHaveBeenCalled();
  });

  it('says why the row cannot be changed, when it cannot', () => {
    render(
      <RecordDrawer table="users" row={{ title: 'users id 1', fields, readOnlyReason: 'Deleted' }} onClose={vi.fn()} />,
    );

    expect(screen.getByText('Deleted')).toBeTruthy();
  });
});
