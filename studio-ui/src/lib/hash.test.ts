import { describe, it, expect } from 'vitest';
import { formatHash, parseHash } from './hash';

describe('parseHash', () => {
  it('reads the table name the hash holds', () => {
    expect(parseHash('#order%20items')).toEqual({ table: 'order items', schema: null });
  });

  it('reads a hash that is not a valid escape as naming no table, so the first table is shown', () => {
    expect(parseHash('#%')).toEqual({ table: '', schema: null });
  });

  it('reads the table whose schema is open next to the table shown', () => {
    expect(parseHash('#orders?schema=customers')).toEqual({ table: 'orders', schema: 'customers' });
  });

  it('keeps a table name that holds ? or & whole as long as it is escaped', () => {
    expect(parseHash(`#${encodeURIComponent('a?b')}?schema=${encodeURIComponent('c&d')}`)).toEqual({
      table: 'a?b',
      schema: 'c&d',
    });
  });
});

describe('formatHash', () => {
  it('writes only the table when no schema is open', () => {
    expect(formatHash('order items')).toBe('#order%20items');
  });

  it('writes the open schema after the table, so the location says which schema is open', () => {
    expect(formatHash('orders', 'customers')).toBe('#orders?schema=customers');
  });

  it('is read back by parseHash', () => {
    expect(parseHash(formatHash('a?b', 'c&d'))).toEqual({ table: 'a?b', schema: 'c&d' });
  });
});
