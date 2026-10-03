import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render as renderPlain, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormField, MIN_FORM_WIDTH, NewRecordDialog, RecordDrawer, type FieldModel } from './record-form';
import type { Column, JsonValue } from '@/lib/types';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ReactElement } from 'react';

const render = (ui: ReactElement) => renderPlain(ui, { wrapper: TooltipProvider });

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

  it('breaks a line of text on Shift+Enter only, not on Enter alone', async () => {
    const model = field({ name: 'bio', type: 'TEXT' }, '');
    render(<FormField table="users" model={model} />);
    const bio = screen.getByRole('textbox', { name: 'bio' });

    await userEvent.type(bio, 'a{Enter}b{Shift>}{Enter}{/Shift}c');

    expect(model.onChange).toHaveBeenLastCalledWith('ab\nc');
  });

  it('shows null and a missing value in an empty field, apart from an empty text', () => {
    render(
      <>
        <FormField table="users" model={field({ name: 'nick', type: 'TEXT' }, null)} />
        <FormField table="users" model={field({ name: 'bio', type: 'TEXT' }, undefined, { state: 'unset' })} />
        <FormField table="users" model={field({ name: 'age', type: 'INTEGER' }, null)} />
        <FormField table="users" model={field({ name: 'note', type: 'TEXT' }, '')} />
      </>,
    );

    expect(screen.getByRole('textbox', { name: 'nick' }).getAttribute('placeholder')).toBe('null');
    expect(screen.getByRole('textbox', { name: 'bio' }).getAttribute('placeholder')).toBe('undefined');
    expect(screen.getByRole('textbox', { name: 'age' }).getAttribute('placeholder')).toBe('null');
    expect(screen.getByRole('textbox', { name: 'note' }).getAttribute('placeholder')).toBeNull();
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

describe('FormField of a JSON column', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true })));
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('edits a key inside the value as a field, handing on the whole value', () => {
    const model = field({ name: 'metadata', type: 'JSON' }, { source: 'web', device: 'iOS' });
    render(<FormField table="orders" model={model} />);

    fireEvent.change(screen.getByRole('textbox', { name: 'metadata.source' }), { target: { value: 'mobile' } });

    expect(model.onChange).toHaveBeenLastCalledWith({ source: 'mobile', device: 'iOS' });
  });

  it('shows an issue the row was read with under the key it is about', () => {
    const model = field(
      { name: 'metadata', type: 'JSON' },
      { source: '' },
      {
        issues: [{ message: 'Too short', path: ['metadata', 'source'] }],
      },
    );
    render(<FormField table="orders" model={model} />);

    const source = screen.getByRole('textbox', { name: 'metadata.source' }).closest('[data-path]') as HTMLElement;
    expect(within(source).getByText('Too short')).toBeTruthy();
  });
});

describe('FormField actions', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true })));
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('sets the field to null on request', async () => {
    const model = field({ name: 'name', type: 'TEXT' }, 'Alice');
    render(<FormField table="users" model={model} />);

    await userEvent.click(screen.getByRole('button', { name: 'Set name to null' }));

    expect(model.onChange).toHaveBeenLastCalledWith(null);
  });

  it('offers null and removing the field only as far as the schema lets the field be null or left out', () => {
    const model = field({ name: 'name', type: 'TEXT', nullable: false, optional: false }, 'Alice');
    render(<FormField table="users" model={model} />);

    expect(screen.queryByRole('button', { name: 'Set name to null' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove name' })).toBeNull();
  });

  it('reverts a changed field on request', async () => {
    const model = field({ name: 'name', type: 'TEXT' }, 'Alicia', { state: 'changed', canRevert: true });
    render(<FormField table="users" model={model} />);

    await userEvent.click(screen.getByRole('button', { name: 'Revert name' }));

    expect(model.onRevert).toHaveBeenCalled();
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

  describe('width', () => {
    beforeEach(() => {
      localStorage.clear();
      vi.stubGlobal('innerWidth', 1600);
    });
    afterEach(() => vi.unstubAllGlobals());

    const separator = () => screen.getByRole('separator', { name: 'Resize the row form' });
    const width = () => Number(separator().getAttribute('aria-valuenow'));

    it('widens from the arrow keys on its edge', async () => {
      render(<RecordDrawer table="users" onClose={vi.fn()} />);
      const before = width();

      separator().focus();
      await userEvent.keyboard('{ArrowLeft}');

      expect(width()).toBeGreaterThan(before);
    });

    it('widens as its edge is dragged toward the grid', () => {
      render(<RecordDrawer table="users" onClose={vi.fn()} />);
      const before = width();

      fireEvent.pointerDown(separator(), { button: 0, clientX: 1000, pointerId: 1 });
      fireEvent.pointerMove(separator(), { clientX: 900, pointerId: 1 });
      fireEvent.pointerUp(separator(), { clientX: 900, pointerId: 1 });

      expect(width()).toBe(before + 100);
    });

    it('stays as wide as its minimum however far its edge is dragged the other way', () => {
      render(<RecordDrawer table="users" onClose={vi.fn()} />);

      fireEvent.pointerDown(separator(), { button: 0, clientX: 1000, pointerId: 1 });
      fireEvent.pointerMove(separator(), { clientX: 1590, pointerId: 1 });

      expect(width()).toBe(MIN_FORM_WIDTH);
    });

    it('keeps the width it was given for the next time it is shown', () => {
      const first = render(<RecordDrawer table="users" onClose={vi.fn()} />);
      fireEvent.pointerDown(separator(), { button: 0, clientX: 1000, pointerId: 1 });
      fireEvent.pointerMove(separator(), { clientX: 900, pointerId: 1 });
      fireEvent.pointerUp(separator(), { clientX: 900, pointerId: 1 });
      const given = width();
      first.unmount();

      render(<RecordDrawer table="users" onClose={vi.fn()} />);

      expect(width()).toBe(given);
    });
  });
});

describe('NewRecordDialog', () => {
  const users = {
    name: 'users',
    columns: [
      { name: 'id', type: 'INTEGER', primaryKey: true },
      { name: 'name', type: 'TEXT' },
      { name: 'nick', type: 'TEXT' },
    ],
    primaryKey: 'id',
    rowCount: 0,
    invalidRows: 0,
    readOnlyReason: null,
    schemaFile: null,
    references: [],
  };
  let check: unknown;
  beforeEach(() => {
    check = { ok: true };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(check)));
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('adds a row holding the fields filled in, its key among them, and none it was not given', async () => {
    const onAdd = vi.fn();
    render(<NewRecordDialog table={users} open onClose={vi.fn()} onAdd={onAdd} />);

    fireEvent.change(screen.getByRole('textbox', { name: 'id' }), { target: { value: '3' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'name' }), { target: { value: 'Ada' } });
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(onAdd).toHaveBeenCalledWith({ id: 3, name: 'Ada' });
  });

  it('leaves a field out of the row again on request', async () => {
    const onAdd = vi.fn();
    render(<NewRecordDialog table={users} open onClose={vi.fn()} onAdd={onAdd} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'nick' }), { target: { value: 'A' } });

    await userEvent.click(screen.getByRole('button', { name: 'Remove nick' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(onAdd).toHaveBeenCalledWith({});
  });

  it('says what makes the row fail validation, such as a field it needs and lacks', async () => {
    check = {
      ok: false,
      issues: [{ message: 'Required', path: ['name'] }, { message: 'Too few fields' }],
    };
    render(<NewRecordDialog table={users} open onClose={vi.fn()} onAdd={vi.fn()} />);

    expect(await screen.findByText(/name: Required/)).toBeTruthy();
    expect(screen.getByText(/row: Too few fields/)).toBeTruthy();
  });
});
