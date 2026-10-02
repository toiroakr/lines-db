import { useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { linter, lintGutter } from '@codemirror/lint';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

const cspNonce = () => document.querySelector<HTMLMetaElement>('meta[name="csp-nonce"]')?.content ?? '';

const highlight = HighlightStyle.define([
  { tag: tags.propertyName, color: 'oklch(0.62 0.15 250)' },
  { tag: tags.string, color: 'oklch(0.62 0.14 150)' },
  { tag: tags.number, color: 'oklch(0.68 0.15 60)' },
  { tag: [tags.bool, tags.null], color: 'oklch(0.62 0.18 320)' },
  { tag: [tags.brace, tags.squareBracket, tags.separator], color: 'var(--muted-foreground)' },
]);

const theme = EditorView.theme({
  '&': { fontSize: '13px', backgroundColor: 'transparent', color: 'var(--foreground)', height: '100%' },
  '.cm-content': { fontFamily: 'var(--font-mono)', caretColor: 'var(--foreground)' },
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

export interface JsonEditorProps {
  initial: string;
  onChange: (text: string) => void;
  onSubmit: () => void;
}

/** A JSON editor with highlighting and syntax errors marked as you type */
export function JsonEditor({ initial, onChange, onSubmit }: JsonEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const handlers = useRef({ onChange, onSubmit });
  handlers.current = { onChange, onSubmit };

  useEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: initial,
        extensions: [
          EditorView.cspNonce.of(cspNonce()),
          keymap.of([{ key: 'Mod-Enter', run: () => (handlers.current.onSubmit(), true) }]),
          basicSetup,
          json(),
          linter(jsonParseLinter(), { delay: 150 }),
          lintGutter(),
          syntaxHighlighting(highlight),
          theme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) handlers.current.onChange(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.focus();
    return () => view.destroy();
    // Not recreated on prop changes: the editor owns the text once it is open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} className="h-80 overflow-auto rounded-md border bg-muted/30" />;
}
