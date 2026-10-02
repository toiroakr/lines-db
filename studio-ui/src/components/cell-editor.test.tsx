import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CellEditor } from './cell-editor';
import type { JsonValue } from '@/lib/types';

describe('CellEditor', () => {
  afterEach(() => cleanup());

  const renderEditor = (value: JsonValue | undefined, canUseDefault: boolean) => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(
      <CellEditor
        table="users"
        column={{ name: 'name', type: 'TEXT' }}
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

  it('names its JSON editor after the field it edits', () => {
    render(
      <CellEditor
        table="users"
        column={{ name: 'tags', type: 'JSON' }}
        value={['a']}
        preview={() => ({ inserts: [], updates: [], deletes: [] })}
        canUseDefault
        canRevert={false}
        onApply={vi.fn()}
        onUseDefault={vi.fn()}
        onRevert={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('textbox', { name: 'tags' })).toBeTruthy();
  });
});
