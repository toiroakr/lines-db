import { describe, it, expect } from 'vitest';
import { mergeFields } from '../../lib/src/merge-fields.js';

describe('mergeFields', () => {
  it('inserts a field the line did not have where the schema declares it', () => {
    const line = { name: 'Alice' };
    const computed = { id: '018f', name: 'Alice', createdAt: '2026-08-04T00:00:00.000Z' };

    const merged = mergeFields(line, computed, { fields: ['id'] });

    // `id` is declared before `name`, so it lands at the front rather than at the end of the line
    expect(Object.keys(merged)).toEqual(['id', 'name']);
    expect(merged).toEqual({ id: '018f', name: 'Alice' });
  });

  it('leaves a key the line already had where it is', () => {
    const line = { name: 'Alice', id: 'a-1' };
    const computed = { id: 'a-1', name: 'Alice' };

    const merged = mergeFields(line, computed, { fields: ['id'] });

    expect(Object.keys(merged)).toEqual(['name', 'id']);
  });

  it('keeps a key the schema does not declare behind the declared ones', () => {
    const line = { name: 'Alice', note: 'check' };
    const computed = { id: '018f', name: 'Alice', createdAt: '2026-08-04T00:00:00.000Z' };

    const merged = mergeFields(line, computed, { fields: ['id', 'createdAt'] });

    expect(Object.keys(merged)).toEqual(['id', 'name', 'createdAt', 'note']);
  });

  it('takes the declared order from the option when given one', () => {
    const line = { name: 'Alice' };
    // The computed row lists `id` last, but the schema declares it first
    const computed = { name: 'Alice', id: '018f' };

    const merged = mergeFields(line, computed, { fields: ['id'], keyOrder: ['id', 'name'] });

    expect(Object.keys(merged)).toEqual(['id', 'name']);
  });

  it('overwrites a value the line holds when the computed row differs', () => {
    const line = { id: 'a-1', address: '1 Main St, Springfield' };
    const computed = { id: 'a-1', address: '1 MAIN ST, SPRINGFIELD' };

    expect(mergeFields(line, computed, { fields: ['address'] })).toEqual({
      id: 'a-1',
      address: '1 MAIN ST, SPRINGFIELD',
    });
  });

  it('leaves a field the computed row has no value for alone', () => {
    const line = { id: 'a-1', invoiceNumber: 1024 };
    const computed = { id: 'a-1', invoiceNumber: undefined };

    // Writing the missing value would drop the key or null it out; the line keeps what it has
    expect(mergeFields(line, computed, { fields: ['id', 'invoiceNumber'] })).toEqual({
      id: 'a-1',
      invoiceNumber: 1024,
    });
  });

  it('leaves a field the computed row does not have at all alone', () => {
    const line = { id: 'a-1', invoiceNumber: 1024 };

    expect(mergeFields(line, { id: 'a-1' }, { fields: ['id', 'invoiceNumber'] })).toEqual({
      id: 'a-1',
      invoiceNumber: 1024,
    });
  });

  it('does not take a field from Object.prototype', () => {
    const line = { name: 'Alice' };

    // The computed row has neither field of its own, so there is nothing to write for them
    expect(mergeFields(line, { name: 'Alice' }, { fields: ['toString', 'constructor'] })).toEqual({
      name: 'Alice',
    });
  });

  it('writes a field named after an Object member when the computed row owns it', () => {
    const line = { name: 'Alice' };
    const computed = { toString: 'own value', name: 'Alice' };

    const merged = mergeFields(line, computed, { fields: ['toString'] });

    expect(Object.keys(merged)).toEqual(['toString', 'name']);
    expect(merged.toString).toBe('own value');
  });

  it('accepts a set as the declared order', () => {
    const line = { name: 'Alice' };
    const computed = { name: 'Alice', id: '018f' };

    // What the database keeps its recorded field order in
    const merged = mergeFields(line, computed, { fields: ['id'], keyOrder: new Set(['id', 'name']) });

    expect(Object.keys(merged)).toEqual(['id', 'name']);
  });

  it('writes a null the computed row does hold', () => {
    const line = { id: 'a-1', nickname: 'Ali' };
    const computed = { id: 'a-1', nickname: null };

    expect(mergeFields(line, computed, { fields: ['nickname'] })).toEqual({ id: 'a-1', nickname: null });
  });

  it('writes nothing when no field is named', () => {
    const line = { name: 'Alice' };
    const computed = { id: '018f', name: 'Alice' };

    expect(mergeFields(line, computed, { fields: [] })).toEqual({ name: 'Alice' });
  });

  it('keeps a key named after an Object member', () => {
    const line = { name: 'Alice', toString: 'kept', ['__proto__']: 'kept' };
    const computed = { id: '018f', name: 'Alice' };

    const merged = mergeFields(line as Record<string, string>, computed, { fields: ['id'] });

    expect(Object.keys(merged)).toEqual(['id', 'name', 'toString', '__proto__']);
    expect(Object.getOwnPropertyDescriptor(merged, '__proto__')?.value).toBe('kept');
  });

  it('returns a new row rather than editing the line', () => {
    const line = { name: 'Alice' };

    mergeFields(line, { id: '018f', name: 'Alice' }, { fields: ['id'] });

    expect(line).toEqual({ name: 'Alice' });
  });
});
