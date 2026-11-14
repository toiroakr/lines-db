import { describe, expect, it } from 'vitest';
import type { Column } from './types';
import { differs, hasTransformed, inputColumn, inputOf, shownOf } from './sides';

const row = { id: 1, code: 'ORD-a', age: 20 };
const input = { id: 1, code: 'a' };

describe('inputOf', () => {
  it('gives the value the line holds for a field it holds', () => {
    expect(inputOf(row, input, 'code')).toBe('a');
  });

  it('gives the value the schema filled in for a field the line lacks', () => {
    expect(inputOf(row, input, 'age')).toBe(20);
  });

  it('gives the row value when the server sent no input side', () => {
    expect(inputOf(row, undefined, 'code')).toBe('ORD-a');
  });
});

describe('differs', () => {
  it('is true for a field the schema transformed', () => {
    expect(differs(row, input, 'code')).toBe(true);
  });

  it('is false for a field kept as written and for one the schema filled in', () => {
    expect([differs(row, input, 'id'), differs(row, input, 'age')]).toEqual([false, false]);
  });
});

describe('a field only one side has', () => {
  it('differs when the line holds a field the schema removed', () => {
    expect(differs({ id: 1 }, { id: 1, old: 'x' }, 'old')).toBe(true);
  });

  it('differs when the line holds null and the output lacks the field', () => {
    expect(differs({ id: 1 }, { id: 1, note: null }, 'note')).toBe(true);
  });

  it('counts a field only the line holds as a transformation', () => {
    expect(hasTransformed([{ id: 1 }], [{ id: 1, old: 'x' }])).toBe(true);
  });
});

describe('an object whose keys the schema reordered', () => {
  it('does not differ from the same object in the order the line holds', () => {
    expect(differs({ id: 1, meta: { b: 1, a: 2 } }, { id: 1, meta: { a: 2, b: 1 } }, 'meta')).toBe(false);
  });
});

describe('hasTransformed', () => {
  it('is true when some field of some row differs between its sides', () => {
    expect(hasTransformed([row], [input])).toBe(true);
  });

  it('is false when every field is as written, or no input side was sent', () => {
    expect([hasTransformed([{ id: 1 }], [{ id: 1 }]), hasTransformed([row], undefined)]).toEqual([false, false]);
  });
});

describe('shownOf', () => {
  it('shows the input editable when the view is input', () => {
    expect(shownOf(row, input, 'code', 'input')).toEqual({ value: 'a', readOnly: false });
  });

  it('shows the output read-only when the view is output', () => {
    expect(shownOf(row, input, 'code', 'output')).toEqual({ value: 'ORD-a', readOnly: true });
  });

  it('shows the input editable with the output beside it when the view is both and they differ', () => {
    expect(shownOf(row, input, 'code', 'both')).toEqual({ value: 'a', output: 'ORD-a', readOnly: false });
  });

  it('shows no output beside the input when they are the same', () => {
    expect(shownOf(row, input, 'id', 'both')).toEqual({ value: 1, readOnly: false });
  });
});

describe('inputColumn', () => {
  const rows = [{ id: 1, active: true }];
  const boolean: Column = { name: 'active', type: 'INTEGER', valueType: 'boolean' };

  it('keeps a column whose input values are of its type', () => {
    expect(inputColumn(boolean, rows, [{ id: 1, active: false }])).toBe(boolean);
  });

  it('turns a boolean column into text when the lines hold strings, as a schema taking yes and no does', () => {
    expect(inputColumn(boolean, rows, [{ id: 1, active: 'yes' }])).toEqual({ name: 'active', type: 'TEXT' });
  });

  it('turns a number column into text when the lines hold strings', () => {
    const number: Column = { name: 'age', type: 'INTEGER' };

    expect(inputColumn(number, [{ age: 30 }], [{ age: '30' }])).toEqual({ name: 'age', type: 'TEXT' });
  });

  it('turns a text column into JSON when the lines hold other values than strings', () => {
    const text: Column = { name: 'code', type: 'TEXT' };

    expect(inputColumn(text, [{ code: '1' }], [{ code: 1 }])).toEqual({ name: 'code', type: 'JSON' });
  });

  it('turns a number column into JSON when the lines hold both numbers and strings, so a number stays one', () => {
    const number: Column = { name: 'age', type: 'INTEGER' };

    expect(inputColumn(number, [{ age: 30 }, { age: 0 }], [{ age: 30 }, { age: 'auto' }])).toEqual({
      name: 'age',
      type: 'JSON',
    });
  });

  it('keeps a column when no line holds a value for it, or only null', () => {
    expect([inputColumn(boolean, rows, undefined), inputColumn(boolean, rows, [{ id: 1, active: null }])]).toEqual([
      boolean,
      boolean,
    ]);
  });

  it('keeps a JSON column, which takes any value', () => {
    const json: Column = { name: 'meta', type: 'JSON' };

    expect(inputColumn(json, [{ meta: { a: 1 } }], [{ meta: 'x' }])).toBe(json);
  });
});
