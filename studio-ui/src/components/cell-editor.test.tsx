import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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
});
