import { describe, it, expect, vi, afterEach } from 'vitest';
import { checkChanges, fieldIssues, issuesFor, issuePath } from './check';

describe('issuesFor', () => {
  it('keeps the issues about the edited field and its nested values', () => {
    const issues = [
      { message: 'Too small', path: [{ key: 'age' }] },
      { message: 'Expected string', path: [{ key: 'metadata' }, { key: 'source' }] },
      { message: 'Required', path: ['name'] },
    ];

    expect(issuesFor('metadata', { ok: false, issues })).toEqual([
      { message: 'Expected string', path: [{ key: 'metadata' }, { key: 'source' }] },
    ]);
  });

  it('keeps an issue with no path, as it may be about any field of the row', () => {
    expect(issuesFor('name', { ok: false, issues: [{ message: 'Unique constraint failed' }] })).toEqual([
      { message: 'Unique constraint failed' },
    ]);
  });
});

describe('checkChanges', () => {
  const answer = (status: number, body: unknown) =>
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status }));
  const batch = { inserts: [], updates: [], deletes: [] };
  afterEach(() => vi.restoreAllMocks());

  it('reads a refused change as its issues', async () => {
    answer(200, { ok: false, message: 'Validation failed', issues: [{ message: 'Too small' }] });

    expect(await checkChanges('t', batch, new AbortController().signal)).toEqual({
      ok: false,
      message: 'Validation failed',
      issues: [{ message: 'Too small' }],
    });
  });

  it('reads an error response as a check that could not run, not as a refused change', async () => {
    answer(401, { message: 'Open the URL the server printed' });

    expect(await checkChanges('t', batch, new AbortController().signal)).toEqual({
      ok: false,
      failed: 'Open the URL the server printed',
    });
  });
});

describe('issuesFor with a refusal that only has a message', () => {
  it('reports the message as an issue about the whole row, so the value does not show as valid', () => {
    expect(issuesFor('email', { ok: false, message: 'UNIQUE constraint failed: users.email', issues: [] })).toEqual([
      { message: 'UNIQUE constraint failed: users.email' },
    ]);
  });
});

describe('issuesFor with a failed check', () => {
  it('finds no issues, as the value was not checked', () => {
    expect(issuesFor('name', { ok: false, failed: 'offline' })).toEqual([]);
  });
});

describe('issuePath', () => {
  it('joins the keys of an issue path, with row for an issue about the whole row', () => {
    expect(issuePath({ message: 'x', path: [{ key: 'metadata' }, 'source', 0] })).toBe('metadata.source.0');
    expect(issuePath({ message: 'x' })).toBe('row');
  });
});

describe('fieldIssues', () => {
  const issues = [
    { message: 'Invalid key', path: [{ key: 'items' }, 1, { key: 'hoge' }] },
    { message: 'Unique constraint failed' },
  ];

  it('gives a cell the issues about its field, nested values included', () => {
    expect(fieldIssues('items', issues)).toEqual([issues[0]]);
    expect(fieldIssues('name', issues)).toEqual([]);
  });
});
