import { describe, it, expect } from 'vitest';
import { jsonlRecordLines } from './jsonl-record-lines.js';

describe('jsonlRecordLines', () => {
  it('returns each record line with its 1-based physical line', () => {
    expect(jsonlRecordLines('{"a":1}\n{"a":2}\n')).toEqual([
      { text: '{"a":1}', line: 1 },
      { text: '{"a":2}', line: 2 },
    ]);
  });

  it('skips blank lines but still counts them toward the physical line', () => {
    expect(jsonlRecordLines('\n\n{"a":1}\n\n{"a":2}')).toEqual([
      { text: '{"a":1}', line: 3 },
      { text: '{"a":2}', line: 5 },
    ]);
  });

  it('skips a line that is only whitespace, including a non-breaking space', () => {
    expect(jsonlRecordLines('{"a":1}\n \t\n \n{"a":2}')).toEqual([
      { text: '{"a":1}', line: 1 },
      { text: '{"a":2}', line: 4 },
    ]);
  });

  it('drops the trailing carriage return of each line', () => {
    expect(jsonlRecordLines('{"a":1}\r\n{"a":2}\r\n')).toEqual([
      { text: '{"a":1}', line: 1 },
      { text: '{"a":2}', line: 2 },
    ]);
  });

  it('drops one leading byte order mark', () => {
    expect(jsonlRecordLines('\u{feff}{"a":1}\n')).toEqual([{ text: '{"a":1}', line: 1 }]);
  });

  it('trims ASCII spaces and tabs around a row without a warning', () => {
    expect(jsonlRecordLines('  \t{"a":1} \t\n')).toEqual([{ text: '{"a":1}', line: 1 }]);
  });

  it('trims a non-breaking space around a row and warns with its code point', () => {
    expect(jsonlRecordLines('{"a":1}\n\u00a0{"a":2}\u00a0\n')).toEqual([
      { text: '{"a":1}', line: 1 },
      { text: '{"a":2}', line: 2, warning: 'has U+00A0 around its row, which JSON does not allow' },
    ]);
  });

  it('trims a second byte order mark and warns with its code point', () => {
    expect(jsonlRecordLines('\u{feff}\u{feff}{"a":1}\n')).toEqual([
      { text: '{"a":1}', line: 1, warning: 'has U+FEFF around its row, which JSON does not allow' },
    ]);
  });

  it('lists each distinct stray character once, in the order it first appears', () => {
    expect(jsonlRecordLines('\u2003\u00a0{"a":1}\u00a0\u2003\n')).toEqual([
      { text: '{"a":1}', line: 1, warning: 'has U+2003, U+00A0 around its row, which JSON does not allow' },
    ]);
  });

  it('returns nothing for an empty file', () => {
    expect(jsonlRecordLines('')).toEqual([]);
  });
});
