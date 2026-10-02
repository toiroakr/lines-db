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
  '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--muted-foreground)', border: 'none' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'color-mix(in oklch, var(--accent) 60%, transparent)' },
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
