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

  it('keeps a second byte order mark in the first line', () => {
    expect(jsonlRecordLines('\u{feff}\u{feff}{"a":1}\n')).toEqual([{ text: '\u{feff}{"a":1}', line: 1 }]);
  });

  it('returns nothing for an empty file', () => {
    expect(jsonlRecordLines('')).toEqual([]);
  });
});
