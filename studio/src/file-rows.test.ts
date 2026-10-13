import { describe, it, expect } from 'vitest';
import { replaceRows } from './file-rows.js';

describe('replaceRows', () => {
  it('writes a row over the line it was read from, counting only the lines that hold a row', () => {
    expect(replaceRows('{"id":1}\n\n{"id":2}\n', new Map([[1, { id: 2, name: 'b' }]]))).toBe(
      '{"id":1}\n\n{"id":2,"name":"b"}\n',
    );
  });

  it('keeps the line endings and byte order mark the file has', () => {
    expect(replaceRows('\u{feff}{"id":1}\r\n{"id":2}\r\n', new Map([[0, { id: 9 }]]))).toBe(
      '\u{feff}{"id":9}\r\n{"id":2}\r\n',
    );
  });
});
