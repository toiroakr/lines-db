import { getNodeValue, parseTree, printParseErrorCode, type Node, type ParseError } from 'jsonc-parser';

/** Comments and trailing commas are allowed: saving writes the value as plain JSON */
const OPTIONS = { allowTrailingComma: true, disallowComments: false };

export interface JsonSyntaxError {
  from: number;
  to: number;
  message: string;
}

/** A range that can be underlined: one with no width covers the character after it, or before it at the end */
export function visibleRange(from: number, to: number, length: number): { from: number; to: number } {
  if (from < to || length === 0) return { from, to };
  return from < length ? { from, to: from + 1 } : { from: length - 1, to: length };
}

/** "CommaExpected" as "Comma expected" */
const describe = (error: ParseError) => {
  const words = printParseErrorCode(error.error).replace(/([a-z])([A-Z])/g, '$1 $2');
  return words.charAt(0) + words.slice(1).toLowerCase();
};

function read(text: string): { tree: Node | undefined; errors: ParseError[] } {
  const errors: ParseError[] = [];
  const tree = parseTree(text, errors, OPTIONS);
  return { tree, errors };
}

/** What keeps the text from being read as JSON with comments and trailing commas */
export function syntaxErrors(text: string): JsonSyntaxError[] {
  const { tree, errors } = read(text);
  if (errors.length === 0 && !tree) return [{ from: 0, to: 0, message: 'Value expected' }];
  return errors.map((error) => ({
    ...visibleRange(error.offset, error.offset + error.length, text.length),
    message: describe(error),
  }));
}

function child(node: Node, key: string): Node | undefined {
  if (node.type === 'object') {
    const property = node.children?.find((candidate) => candidate.children?.[0]?.value === key);
    return property?.children?.[1];
  }
  if (node.type === 'array' && /^\d+$/.test(key)) return node.children?.[Number(key)];
  return undefined;
}

/**
 * Where a value inside the text sits, by the keys leading to it. A path that runs past what the text
 * holds, as for a missing field, points at the first character of the deepest value found.
 */
export function rangeOfPath(text: string, keys: string[]): { from: number; to: number } {
  let node = read(text).tree;
  if (!node) return visibleRange(0, 0, text.length);
  for (const key of keys) {
    const next = child(node, key);
    if (!next) return { from: node.offset, to: node.offset + 1 };
    node = next;
  }
  return { from: node.offset, to: node.offset + node.length };
}

/** The value the text holds, read with comments and trailing commas, or the first thing in the way */
export function readJsonc(text: string): { value: unknown } | { error: string } {
  const [error] = syntaxErrors(text);
  if (!error) return { value: getNodeValue(read(text).tree!) };
  const before = text.slice(0, error.from).split('\n');
  return { error: `${error.message} at line ${before.length} column ${before.at(-1)!.length + 1}` };
}
