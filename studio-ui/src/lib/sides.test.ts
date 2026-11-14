import { describe, expect, it } from 'vitest';
import { differs, hasTransformed, inputOf, shownOf } from './sides';

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
