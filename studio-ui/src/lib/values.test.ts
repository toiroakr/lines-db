import { describe, it, expect } from 'vitest';
import { parseInput, formatValue } from './values';

const column = (type: string, valueType?: 'boolean') => ({ name: 'field', type, valueType });

describe('parseInput', () => {
  it('reads an integer column as a number', () => {
    expect(parseInput(column('INTEGER'), '42')).toEqual({ value: 42 });
  });

  it('refuses text that is not a number for a number column', () => {
    expect(parseInput(column('REAL'), '4x2')).toEqual({ error: 'Enter a number' });
  });

  it('refuses an empty number, as null is set with its own control', () => {
    expect(parseInput(column('INTEGER'), '  ')).toEqual({ error: 'Enter a number' });
  });

  it('keeps an empty string for a text column, which differs from null', () => {
    expect(parseInput(column('TEXT'), '')).toEqual({ value: '' });
  });

  it('parses a JSON column, reporting text that is not JSON', () => {
    expect(parseInput(column('JSON'), '{"a":[1]}')).toEqual({ value: { a: [1] } });
    expect(parseInput(column('JSON'), '{a')).toMatchObject({ error: expect.stringContaining('JSON') });
  });

  it('reads a boolean column from true or false', () => {
    expect(parseInput(column('INTEGER', 'boolean'), 'false')).toEqual({ value: false });
  });
});

describe('formatValue', () => {
  it('shows an object as compact JSON and a string as itself', () => {
    expect(formatValue({ a: 1 })).toBe('{"a":1}');
    expect(formatValue('text')).toBe('text');
  });
});

describe('parseInput with trailing commas', () => {
  it('reads a JSON value whose arrays and objects end with a comma', () => {
    expect(parseInput(column('JSON'), '{"items": [1, 2,],\n}')).toEqual({ value: { items: [1, 2] } });
  });

  it('keeps a comma inside a string', () => {
    expect(parseInput(column('JSON'), '["a,]", "b\\",}",]')).toEqual({ value: ['a,]', 'b",}'] });
  });

  it('reads a JSON value with comments, leaving them out of the value', () => {
    expect(parseInput(column('JSON'), '{\n  // where it came from\n  "source": "web" /* default */\n}')).toEqual({
      value: { source: 'web' },
    });
  });

  it('still refuses a comma with no value before it', () => {
    expect(parseInput(column('JSON'), '[,]')).toHaveProperty('error');
  });
});
