import { describe, it, expect } from 'vitest';
import { tableNameOf } from './hash';

describe('tableNameOf', () => {
  it('reads the table name the hash holds', () => {
    expect(tableNameOf('#order%20items')).toBe('order items');
  });

  it('reads a hash that is not a valid escape as naming no table, so the first table is shown', () => {
    expect(tableNameOf('#%')).toBe('');
  });
});
