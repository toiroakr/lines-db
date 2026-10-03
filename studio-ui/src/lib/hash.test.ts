import { describe, it, expect } from 'vitest';
import { formatHash, parseHash, schemaOpenedInApp, schemaTrailOf } from './hash';

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

describe('schemaTrailOf', () => {
  it('reads the schemas opened before the one shown from the state of the history entry', () => {
    expect(schemaTrailOf({ schemaTrail: ['orders', 'customers'] })).toEqual(['orders', 'customers']);
  });

  it('keeps a table that appears twice in the trail, as a foreign key can lead back to where it started', () => {
    expect(schemaTrailOf({ schemaTrail: ['a', 'b', 'a'] })).toEqual(['a', 'b', 'a']);
  });

  it.each([null, undefined, 'a', {}, { schemaTrail: 'a' }, { schemaTrail: ['a', 1] }])(
    'reads %j, which is not a trail, as none',
    (state) => {
      expect(schemaTrailOf(state)).toEqual([]);
    },
  );
});

describe('schemaOpenedInApp', () => {
  it('is true for an entry the page pushed to open a schema, as closing it can go back to where it began', () => {
    expect(schemaOpenedInApp({ schemaInApp: true, schemaTrail: [] })).toBe(true);
  });

  it.each([null, undefined, {}, { schemaInApp: false }, { schemaInApp: 'yes' }, 'a'])(
    'is false for %j, an entry the page did not push, as going back from a schema address typed in could leave the page',
    (state) => {
      expect(schemaOpenedInApp(state)).toBe(false);
    },
  );
});
