import { describe, it, expect } from 'vitest';
import { toWriteError } from './api';

describe('toWriteError', () => {
  it('keeps an error the server answered with as it is', () => {
    const answered = { status: 409, message: 'users.jsonl changed on disk' };

    expect(toWriteError(answered)).toBe(answered);
  });

  it('reads a request that never reached the server as an error with its message and no status', () => {
    expect(toWriteError(new TypeError('Failed to fetch'))).toEqual({ status: 0, message: 'Failed to fetch' });
  });
});
