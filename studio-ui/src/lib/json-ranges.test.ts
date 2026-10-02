import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { json } from '@codemirror/lang-json';
import { rangeOfPath, visibleRange } from './json-ranges';

const marked = (doc: string, keys: string[]) => {
  const state = EditorState.create({ doc, extensions: [json()] });
  ensureSyntaxTree(state, doc.length);
  const { from, to } = rangeOfPath(state, keys);
  return doc.slice(from, to);
};

describe('rangeOfPath', () => {
  it('points at the value the keys lead to, through objects and arrays', () => {
    expect(marked('[{"name":"a","quantity":-1}]', ['0', 'quantity'])).toBe('-1');
  });

  it('points at the first character of the deepest value found when a key is missing', () => {
    expect(marked('{"source":"web"}', ['device'])).toBe('{');
  });

  it('points at the whole document for an issue about the value itself', () => {
    expect(marked('5', [])).toBe('5');
  });
});

describe('visibleRange', () => {
  it('widens an error between two characters to the character after it', () => {
    expect(visibleRange(3, 3, 10)).toEqual({ from: 3, to: 4 });
  });

  it('widens an error at the end of the text to its last character', () => {
    expect(visibleRange(10, 10, 10)).toEqual({ from: 9, to: 10 });
  });

  it('keeps a range that already has width', () => {
    expect(visibleRange(2, 5, 10)).toEqual({ from: 2, to: 5 });
  });
});
