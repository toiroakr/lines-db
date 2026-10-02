import { useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { json } from '@codemirror/lang-json';
import { linter, lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import type { Issue } from '@/lib/types';
import { segmentKey } from '@/lib/check';
import { rangeOfPath, syntaxErrors } from '@/lib/json-ranges';

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

/** Read as JSON with comments and trailing commas, as saving reads it */
function parseErrors(view: EditorView): Diagnostic[] {
  return syntaxErrors(view.state.doc.toString()).map((error) => ({ ...error, severity: 'error' as const }));
}

export interface JsonEditorProps {
  initial: string;
  /** Issues about the value, each underlined where its path points inside it */
  issues: Issue[];
  onChange: (text: string) => void;
  onSubmit: () => void;
}

/** A JSON editor with highlighting and syntax errors marked as you type */
export function JsonEditor({ initial, issues, onChange, onSubmit }: JsonEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(undefined);
  const handlers = useRef({ onChange, onSubmit });
  handlers.current = { onChange, onSubmit };

  useEffect(() => {
    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: initial,
        extensions: [
          EditorView.cspNonce.of(cspNonce()),
          keymap.of([{ key: 'Mod-Enter', run: () => (handlers.current.onSubmit(), true) }]),
          basicSetup,
          json(),
          linter(parseErrors, { delay: 150 }),
          lintGutter(),
          syntaxHighlighting(highlight),
          theme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) handlers.current.onChange(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = editor;
    editor.focus();
    return () => editor.destroy();
    // Not recreated on prop changes: the editor owns the text once it is open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Not a lint source: a linter runs only when the text changes, and the issues arrive after it ran
  const issueKey = JSON.stringify(issues);
  useEffect(() => {
    const editor = view.current;
    if (!editor || parseErrors(editor).length > 0) return;
    const diagnostics = issues.map((issue) => ({
      ...rangeOfPath(editor.state.doc.toString(), (issue.path ?? []).slice(1).map(segmentKey)),
      severity: 'error' as const,
      message: issue.message,
    }));
    editor.dispatch(setDiagnostics(editor.state, diagnostics));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueKey]);

  return <div ref={host} className="h-80 overflow-auto rounded-md border bg-muted/30" />;
}
