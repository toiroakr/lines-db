const TRIGGER_DEFINITION = /^\s*CREATE\s+(?:TEMP(?:ORARY)?\s+)?TRIGGER\b/i;
const CLOSER: Record<string, string> = { "'": "'", '"': '"', '`': '`', '[': ']' };

/**
 * Split SQL text into its statements at `;`, the way SQLite reads it: a `;` inside a comment or quoted
 * text does not end a statement, and a comment is left out as the whitespace it is
 */
export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let i = 0;
  while (i < sql.length) {
    const char = sql[i]!;
    if (char === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end;
      current += ' ';
    } else if (char === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
      current += ' ';
    } else if (char in CLOSER) {
      // A doubled quote inside is read as a closing one followed by an opening one, which copies the same
      const end = sql.indexOf(CLOSER[char]!, i + 1);
      const stop = end === -1 ? sql.length : end + 1;
      current += sql.slice(i, stop);
      i = stop;
    } else if (char === ';' && !insideTriggerBody(current)) {
      statements.push(current);
      current = '';
      i += 1;
    } else {
      current += char;
      i += 1;
    }
  }
  statements.push(current);
  return statements.map((statement) => statement.trim()).filter((statement) => statement.length > 0);
}

/**
 * Whether a `;` after this text is inside the body of a trigger, which only a `;` followed by `END` and
 * another `;` closes. Only an END right after a `;` counts, as the END of a CASE in the body does not
 */
function insideTriggerBody(statement: string): boolean {
  return TRIGGER_DEFINITION.test(statement) && !/;\s*END$/i.test(statement.trimEnd());
}
