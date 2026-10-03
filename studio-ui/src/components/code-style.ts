import { EditorView } from 'codemirror';
import { HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';

export const cspNonce = () => document.querySelector<HTMLMetaElement>('meta[name="csp-nonce"]')?.content ?? '';

export const highlight = HighlightStyle.define([
  { tag: tags.propertyName, color: 'oklch(0.62 0.15 250)' },
  { tag: tags.string, color: 'oklch(0.62 0.14 150)' },
  { tag: tags.number, color: 'oklch(0.68 0.15 60)' },
  { tag: [tags.bool, tags.null], color: 'oklch(0.62 0.18 320)' },
  { tag: [tags.brace, tags.squareBracket, tags.separator], color: 'var(--muted-foreground)' },
  { tag: [tags.keyword, tags.modifier, tags.operatorKeyword], color: 'oklch(0.6 0.18 300)' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: 'oklch(0.65 0.13 200)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'oklch(0.65 0.14 230)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--muted-foreground)', fontStyle: 'italic' },
  { tag: [tags.regexp, tags.special(tags.string)], color: 'oklch(0.62 0.14 30)' },
]);

export const theme = EditorView.theme({
  '&': { fontSize: '13px', backgroundColor: 'transparent', color: 'var(--foreground)', height: '100%' },
  '.cm-content': { fontFamily: 'var(--font-mono)', caretColor: 'var(--foreground)' },
  '.cm-cursor, .cm-dropCursor': { borderLeft: '2px solid var(--foreground)' },
  '.cm-lintRange-error': {
    backgroundImage: 'none',
    textDecoration: 'underline wavy var(--destructive)',
    textDecorationSkipInk: 'none',
    textUnderlineOffset: '3px',
  },
  // The gutters stick to the left while the code scrolls under them, so a transparent one lets the code show through
  '.cm-gutters': { backgroundColor: 'var(--background)', color: 'var(--muted-foreground)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in oklch, var(--accent) 60%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'color-mix(in oklch, var(--accent) 60%, var(--background))' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'color-mix(in oklch, var(--ring) 35%, transparent)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-tooltip': {
    backgroundColor: 'var(--popover)',
    color: 'var(--popover-foreground)',
    border: '1px solid var(--border)',
  },
});
