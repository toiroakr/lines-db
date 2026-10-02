import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ValueField } from './value-field';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { Issue, JsonValue } from '@/lib/types';

const field = (value: JsonValue, issues: Issue[] = []) => {
  const onChange = vi.fn();
  render(
    <TooltipProvider>
      <ValueField path={['metadata']} value={value} issues={issues} onChange={onChange} />
    </TooltipProvider>,
  );
  return onChange;
};

describe('ValueField', () => {
  afterEach(cleanup);

  it('shows each key of a map as a field of its own, handing on the map with the key changed', () => {
    const onChange = field({ source: 'web', visits: 3 });

    fireEvent.change(screen.getByRole('textbox', { name: 'metadata.source' }), { target: { value: 'mobile' } });

    expect(onChange).toHaveBeenLastCalledWith({ source: 'mobile', visits: 3 });
  });

  it('reads a number in a map as a number, holding back text that is not one', () => {
    const onChange = field({ visits: 3 });
    const visits = screen.getByRole('textbox', { name: 'metadata.visits' });

    fireEvent.change(visits, { target: { value: '3a' } });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(visits, { target: { value: '4' } });
    expect(onChange).toHaveBeenLastCalledWith({ visits: 4 });
  });

  it('removes a key of a map', async () => {
    const onChange = field({ source: 'web', visits: 3 });

    await userEvent.click(screen.getByRole('button', { name: 'Remove metadata.source' }));

    expect(onChange).toHaveBeenLastCalledWith({ visits: 3 });
  });

  it('adds a key to a map, empty to begin with', async () => {
    const onChange = field({ source: 'web' });

    await userEvent.click(screen.getByRole('button', { name: 'Add a key to metadata' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'New key in metadata' }), 'device{Enter}');

    expect(onChange).toHaveBeenLastCalledWith({ source: 'web', device: '' });
  });

  it('shows each item of a list of maps as a block of its own', () => {
    const onChange = field([{ name: 'Laptop', price: 999 }]);

    fireEvent.change(screen.getByRole('textbox', { name: 'metadata.0.name' }), { target: { value: 'Tablet' } });

    expect(onChange).toHaveBeenLastCalledWith([{ name: 'Tablet', price: 999 }]);
  });

  it('adds an item to a list shaped as the last one, with nothing filled in', async () => {
    const onChange = field([{ name: 'Laptop', price: 999 }]);

    await userEvent.click(screen.getByRole('button', { name: 'Add an item to metadata' }));

    expect(onChange).toHaveBeenLastCalledWith([
      { name: 'Laptop', price: 999 },
      { name: '', price: 0 },
    ]);
  });

  it('removes an item of a list', async () => {
    const onChange = field(['a', 'b']);

    await userEvent.click(screen.getByRole('button', { name: 'Remove metadata.0' }));

    expect(onChange).toHaveBeenLastCalledWith(['b']);
  });

  it('switches a block to a JSON editor, handing on the text once it reads as JSON', async () => {
    const onChange = field({ source: 'web' });

    await userEvent.click(screen.getByRole('button', { name: 'Edit metadata as JSON' }));

    expect(screen.getByRole('textbox', { name: 'metadata' })).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'metadata.source' })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows an issue under the field it is about', () => {
    field({ source: 'web', visits: 3 }, [{ message: 'Too short', path: ['metadata', 'source'] }]);

    const source = screen.getByRole('textbox', { name: 'metadata.source' }).closest('[data-path]')!;
    expect(within(source as HTMLElement).getByText('Too short')).toBeTruthy();
  });

  it('shows on the block an issue about a key it does not have', () => {
    field({ source: 'web' }, [{ message: 'Required', path: ['metadata', 'device'] }]);

    expect(screen.getByText(/device: Required/)).toBeTruthy();
  });

  it('offers what to make a null value into', async () => {
    const onChange = field(null);

    await userEvent.click(screen.getByRole('button', { name: 'Make metadata a map' }));

    expect(onChange).toHaveBeenLastCalledWith({});
  });

  it('sets a boolean in a map from the option pressed', async () => {
    const onChange = field({ gift: true });

    await userEvent.click(screen.getByRole('button', { name: 'false' }));

    expect(onChange).toHaveBeenLastCalledWith({ gift: false });
  });
});
