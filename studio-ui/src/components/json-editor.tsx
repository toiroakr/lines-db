import { useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { json } from '@codemirror/lang-json';
import { linter, lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { syntaxHighlighting } from '@codemirror/language';
import type { Issue } from '@/lib/types';
import { segmentKey } from '@/lib/check';
import { rangeOfPath, syntaxErrors } from '@/lib/json-ranges';
import { cspNonce, highlight, theme } from '@/components/code-style';
import { cn } from '@/lib/utils';

/** Read as JSON with comments and trailing commas, as saving reads it */
function parseErrors(view: EditorView): Diagnostic[] {
  return syntaxErrors(view.state.doc.toString()).map((error) => ({ ...error, severity: 'error' as const }));
}

export interface JsonEditorProps {
  /** What the editor is named to assistive technology */
  label: string;
  initial: string;
  /** Issues about the value, each underlined where its path points inside it */
  issues: Issue[];
  onChange: (text: string) => void;
  onSubmit?: () => void;
  /** Whether it takes the focus once open, as when opened to edit the value; on by default */
  autoFocus?: boolean;
  className?: string;
}

/** A JSON editor with highlighting and syntax errors marked as you type */
export function JsonEditor({
  label,
  initial,
  issues,
  onChange,
  onSubmit = () => undefined,
  autoFocus = true,
  className = 'h-80',
}: JsonEditorProps) {
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
          EditorView.contentAttributes.of({ 'aria-label': label }),
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
    if (autoFocus) editor.focus();
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

  return <div ref={host} className={cn('overflow-auto rounded-md border bg-background', className)} />;
}
