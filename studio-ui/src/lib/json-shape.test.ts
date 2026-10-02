import { describe, it, expect } from 'vitest';
import { emptyLike, issuesAt, issuesUnder, removeIn, setIn, shapeOf } from './json-shape';

describe('shapeOf', () => {
  it('reads each scalar as its own kind', () => {
    expect([true, 1, 'a', null].map(shapeOf)).toEqual(['boolean', 'number', 'string', 'null']);
  });

  it('reads an object of values the form can show as a map', () => {
    expect(shapeOf({ source: 'web', tags: ['a'], nested: { deep: 1 } })).toBe('map');
  });

  it('reads a list of scalars, and a list of maps, as a list', () => {
    expect(shapeOf(['a', 'b'])).toBe('list');
    expect(shapeOf([{ name: 'Laptop' }, { name: 'Mouse' }])).toBe('list');
  });

  it('leaves to a JSON editor a list mixing scalars with maps', () => {
    expect(shapeOf([1, { a: 1 }])).toBe('json');
    expect(shapeOf({ inner: [1, { a: 1 }] })).toBe('json');
  });
});

describe('setIn', () => {
  it('replaces the value at a path, leaving the rest as it was', () => {
    const value = { items: [{ name: 'a', price: 1 }], note: 'x' };

    expect(setIn(value, ['items', 0, 'price'], 2)).toEqual({ items: [{ name: 'a', price: 2 }], note: 'x' });
    expect(value.items[0].price).toBe(1);
  });
});

describe('removeIn', () => {
  it('removes a key from a map', () => {
    expect(removeIn({ a: 1, b: 2 }, ['a'])).toEqual({ b: 2 });
  });

  it('removes an item from a list, closing up the ones after it', () => {
    expect(removeIn({ items: ['a', 'b', 'c'] }, ['items', 1])).toEqual({ items: ['a', 'c'] });
  });
});

describe('emptyLike', () => {
  it('gives an item shaped as the sample, with nothing filled in', () => {
    expect(emptyLike({ name: 'Laptop', quantity: 1, gift: true, tags: ['a'] })).toEqual({
      name: '',
      quantity: 0,
      gift: false,
      tags: [],
    });
  });
});

describe('issuesAt / issuesUnder', () => {
  const issues = [
    { message: 'at name', path: ['items', { key: 0 }, 'name'] },
    { message: 'at item', path: ['items', 0] },
    { message: 'elsewhere', path: ['note'] },
  ];

  it('finds the issues about exactly the value at a path', () => {
    expect(issuesAt(issues, ['items', 0]).map((issue) => issue.message)).toEqual(['at item']);
  });

  it('finds the issues about the value at a path and those inside it', () => {
    expect(issuesUnder(issues, ['items', 0]).map((issue) => issue.message)).toEqual(['at name', 'at item']);
  });
});
