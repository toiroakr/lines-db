import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CellEditor } from './cell-editor';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { Column, JsonValue } from '@/lib/types';

describe('CellEditor', () => {
  afterEach(() => cleanup());

  const renderEditor = (value: JsonValue | undefined, canUseDefault: boolean, leeway: Partial<Column> = {}) => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(
      <CellEditor
        table="users"
        column={{ name: 'name', type: 'TEXT', ...leeway }}
        value={value}
        preview={() => ({ inserts: [], updates: [], deletes: [] })}
        canUseDefault={canUseDefault}
        canRevert={false}
        onApply={onApply}
        onUseDefault={vi.fn()}
        onRevert={vi.fn()}
        onClose={onClose}
      />,
    );
    return { onApply, onClose };
  };

  it('shows null and a missing value in an empty field, apart from an empty text', () => {
    renderEditor(null, true);
    expect(screen.getByRole('textbox', { name: 'name' }).getAttribute('placeholder')).toBe('null');
    cleanup();

    renderEditor(undefined, true);
    expect(screen.getByRole('textbox', { name: 'name' }).getAttribute('placeholder')).toBe('undefined');
  });

  it('offers null only for a field the schema lets be null', () => {
    renderEditor('Alice', true, { nullable: false });

    expect(screen.queryByRole('button', { name: /Set null/ })).toBeNull();
  });

  it('offers to remove the field only when the schema lets the key be left out', () => {
    renderEditor('Alice', true, { optional: false });

    expect(screen.queryByRole('button', { name: /Remove field/ })).toBeNull();
  });

  it('closes without a change when the value set is the one the file holds', async () => {
    const { onApply, onClose } = renderEditor('Alice', true);

    await userEvent.click(screen.getByRole('button', { name: /^Set$/ }));

    expect(onApply).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('closes without a change when null is set on a field the file holds as null', async () => {
    const { onApply, onClose } = renderEditor(null, true);

    await userEvent.click(screen.getByRole('button', { name: /Set null/ }));

    expect(onApply).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('sets null on a field the row does not hold yet', async () => {
    const { onApply } = renderEditor(undefined, true);

    await userEvent.click(screen.getByRole('button', { name: /Set null/ }));

    expect(onApply).toHaveBeenCalledWith(null);
  });

  it('sets a value the schema filled in as it is, which writes it to the file', async () => {
    const { onApply } = renderEditor('Guest', false);

    await userEvent.click(screen.getByRole('button', { name: /^Set$/ }));

    expect(onApply).toHaveBeenCalledWith('Guest');
  });

  it('breaks a line of text on Shift+Enter, and sets the text on Enter', async () => {
    const { onApply } = renderEditor('Alice', true);
    const input = screen.getByRole('textbox', { name: 'name' });

    await userEvent.clear(input);
    await userEvent.type(input, 'line one{Shift>}{Enter}{/Shift}line two{Enter}');

    expect(onApply).toHaveBeenCalledWith('line one\nline two');
  });

  it('leaves Enter that confirms an input method composition to the input method', () => {
    const { onApply, onClose } = renderEditor('Alice', true);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Alicia' } });

    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });

    expect(onApply).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('names its text box after the field it edits', () => {
    renderEditor('Alice', true);

    expect(screen.getByRole('textbox', { name: 'name' })).toBeTruthy();
  });

  const renderJson = (value: JsonValue) => {
    const onApply = vi.fn();
    render(
      <TooltipProvider>
        <CellEditor
          table="orders"
          column={{ name: 'metadata', type: 'JSON' }}
          value={value}
          preview={() => ({ inserts: [], updates: [], deletes: [] })}
          canUseDefault
          canRevert={false}
          onApply={onApply}
          onUseDefault={vi.fn()}
          onRevert={vi.fn()}
          onClose={vi.fn()}
        />
      </TooltipProvider>,
    );
    return onApply;
  };

  it('edits a JSON value as a form at first, setting the whole value', async () => {
    const onApply = renderJson({ source: 'web', device: 'iOS' });

    fireEvent.change(screen.getByRole('textbox', { name: 'metadata.source' }), { target: { value: 'mobile' } });
    await userEvent.click(screen.getByRole('button', { name: 'Set' }));

    expect(onApply).toHaveBeenCalledWith({ source: 'mobile', device: 'iOS' });
  });

  it('sets no JSON value while a field inside it holds text it cannot read', async () => {
    const onApply = renderJson({ visits: 3 });

    const visits = screen.getByRole('textbox', { name: 'metadata.visits' });
    fireEvent.change(visits, { target: { value: '4' } });
    fireEvent.change(visits, { target: { value: '4a' } });
    await userEvent.click(screen.getByRole('button', { name: 'Set' }));

    expect(onApply).not.toHaveBeenCalled();
  });

  it('switches a JSON value to a JSON editor named after the field', async () => {
    renderJson({ source: 'web' });

    await userEvent.click(screen.getByRole('button', { name: 'Edit metadata as JSON' }));

    expect(screen.getByRole('textbox', { name: 'metadata' })).toBeTruthy();
  });
});
