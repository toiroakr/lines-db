import { describe, it, expect } from 'vitest';
import { rangeOfPath, syntaxErrors } from './json-ranges';

const marked = (text: string, keys: string[]) => {
  const { from, to } = rangeOfPath(text, keys);
  return text.slice(from, to);
};

describe('rangeOfPath', () => {
  it('points at the value the keys lead to, through objects and arrays', () => {
    expect(marked('[{"name":"a","quantity":-1,}]', ['0', 'quantity'])).toBe('-1');
  });

  it('points at the first character of the deepest value found when a key is missing', () => {
    expect(marked('{"source":"web"}', ['device'])).toBe('{');
  });

  it('points at the whole document for an issue about the value itself', () => {
    expect(marked('5', [])).toBe('5');
  });
});

describe('syntaxErrors', () => {
  it('finds nothing wrong with trailing commas or comments', () => {
    expect(syntaxErrors('[1, 2, /* more */]')).toEqual([]);
  });

  it('marks the character an error is at, so it can be underlined', () => {
    const text = '[1 2]';
    const [error] = syntaxErrors(text);

    expect(text.slice(error.from, error.to)).toBe('2');
    expect(error.message).toBe('Comma expected');
  });

  it('marks the last character for an error at the end of the text, which has no width', () => {
    const text = '[1, 2';
    const [error] = syntaxErrors(text);

    expect(text.slice(error.from, error.to)).toBe('2');
  });
});
