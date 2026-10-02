import type { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';

const PUNCTUATION = new Set(['{', '}', '[', ']', ',', ':']);

function valuesOf(node: SyntaxNode): SyntaxNode[] {
  const values: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (!PUNCTUATION.has(child.name)) values.push(child);
  }
  return values;
}

function child(node: SyntaxNode, key: string, state: EditorState): SyntaxNode | undefined {
  if (node.name === 'Object') {
    for (const property of valuesOf(node)) {
      const name = property.getChild('PropertyName');
      if (!name) continue;
      try {
        if (JSON.parse(state.sliceDoc(name.from, name.to)) === key) return property.lastChild ?? undefined;
      } catch {
        continue;
      }
    }
  }
  if (node.name === 'Array' && /^\d+$/.test(key)) return valuesOf(node)[Number(key)];
  return undefined;
}

/**
 * Where a value inside the document sits, by the keys leading to it. A path that runs past what the
 * document holds, as for a missing field, points at the first character of the deepest value found.
 */
export function rangeOfPath(state: EditorState, keys: string[]): { from: number; to: number } {
  let node = syntaxTree(state).topNode.firstChild;
  if (!node) return { from: 0, to: Math.min(1, state.doc.length) };
  for (const key of keys) {
    const next = child(node, key, state);
    if (!next) return { from: node.from, to: Math.min(node.from + 1, node.to) };
    node = next;
  }
  return { from: node.from, to: node.to };
}

/** A range that can be underlined: one with no width covers the character after it, or before it at the end */
export function visibleRange(from: number, to: number, length: number): { from: number; to: number } {
  if (from < to || length === 0) return { from, to };
  return from < length ? { from, to: from + 1 } : { from: length - 1, to: length };
}
