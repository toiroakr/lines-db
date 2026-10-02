import { describe, it, expect } from 'vitest';
import { issuesFor, issuePath } from './check';

describe('issuesFor', () => {
  it('keeps the issues about the edited field and its nested values', () => {
    const issues = [
      { message: 'Too small', path: [{ key: 'age' }] },
      { message: 'Expected string', path: [{ key: 'metadata' }, { key: 'source' }] },
      { message: 'Required', path: ['name'] },
    ];

    expect(issuesFor('metadata', issues)).toEqual([
      { message: 'Expected string', path: [{ key: 'metadata' }, { key: 'source' }] },
    ]);
  });

  it('keeps an issue with no path, as it may be about any field of the row', () => {
    expect(issuesFor('name', [{ message: 'Unique constraint failed' }])).toEqual([
      { message: 'Unique constraint failed' },
    ]);
  });
});

describe('issuePath', () => {
  it('joins the keys of an issue path, with row for an issue about the whole row', () => {
    expect(issuePath({ message: 'x', path: [{ key: 'metadata' }, 'source', 0] })).toBe('metadata.source.0');
    expect(issuePath({ message: 'x' })).toBe('row');
  });
});
