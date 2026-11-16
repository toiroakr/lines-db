/**
 * Split JSONL content into the lines that hold a row: one leading byte order mark and each line's
 * trailing carriage return are dropped, and lines that are blank after trimming are skipped.
 * `line` is the 1-based physical line, so skipped lines still count.
 */
export function jsonlRecordLines(content: string): { text: string; line: number }[] {
  const lines = (content.startsWith('\u{feff}') ? content.slice(1) : content).split('\n');
  return lines.flatMap((raw, index) => {
    const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    return text.trim().length === 0 ? [] : [{ text, line: index + 1 }];
  });
}
