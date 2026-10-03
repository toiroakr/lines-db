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

const READ_STATEMENTS = new Set(['SELECT', 'VALUES', 'WITH', 'EXPLAIN']);

// A pragma that takes an argument and only reads: PRAGMA table_info(tags)
const READ_PRAGMAS_WITH_ARGUMENT = new Set([
  'table_info',
  'table_xinfo',
  'table_list',
  'index_list',
  'index_info',
  'index_xinfo',
  'foreign_key_list',
  'foreign_key_check',
  'integrity_check',
  'quick_check',
  'collation_list',
  'database_list',
  'function_list',
  'module_list',
  'pragma_list',
  'compile_options',
]);

// A pragma that reads when bare and sets when given a value or an argument: PRAGMA user_version(5) sets it
const READ_PRAGMAS_BARE = new Set([
  'query_only',
  'user_version',
  'application_id',
  'schema_version',
  'foreign_keys',
  'journal_mode',
  'page_count',
  'page_size',
  'freelist_count',
  'encoding',
  'data_version',
]);

const PRAGMA_NAME = String.raw`(?:\w+|"[^"]*"|'[^']*'|\x60[^\x60]*\x60|\[[^\]]*\])`;
const PRAGMA_STATEMENT = new RegExp(
  String.raw`^PRAGMA\s+(?:${PRAGMA_NAME}\s*\.\s*)?(${PRAGMA_NAME})\s*(\(.*\))?$`,
  'is',
);

/**
 * Whether a statement, as {@link splitStatements} returns it, only reads. Closed by default: whatever is
 * not known to read is refused, so a statement or pragma added to SQLite later is refused too. A WITH
 * can wrap a write, which the read-only mode of the connection is left to refuse
 */
export function isReadOnlyStatement(statement: string): boolean {
  const keyword = /^[A-Za-z]+/.exec(statement)?.[0]?.toUpperCase();
  if (keyword === undefined) return false;
  if (READ_STATEMENTS.has(keyword)) return true;
  if (keyword !== 'PRAGMA') return false;

  const match = PRAGMA_STATEMENT.exec(statement);
  if (!match) return false;
  const name = match[1]!.replace(/^["'`[]|["'`\]]$/g, '').toLowerCase();
  const argument = match[2];
  if (READ_PRAGMAS_WITH_ARGUMENT.has(name)) return true;
  return READ_PRAGMAS_BARE.has(name) && argument === undefined;
}
