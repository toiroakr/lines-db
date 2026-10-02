import { useEffect, useRef, useState } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { syntaxHighlighting } from '@codemirror/language';
import { cspNonce, highlight, theme } from '@/components/code-style';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { fetchSchema } from '@/lib/api';

/** The source of a schema file, highlighted and read-only */
export function SchemaViewer({ source, label }: { source: string; label: string }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: source,
        extensions: [
          EditorView.cspNonce.of(cspNonce()),
          EditorView.contentAttributes.of({ 'aria-label': label }),
          basicSetup,
          javascript({ typescript: true }),
          syntaxHighlighting(highlight),
          theme,
          EditorState.readOnly.of(true),
        ],
      }),
    });
    return () => view.destroy();
  }, [source, label]);

  return <div ref={host} className="max-h-[70vh] min-h-40 overflow-auto rounded-md border bg-muted/30" />;
}

/** A dialog showing the schema file of a table, read when it opens */
export function SchemaDialog({ table, file, onClose }: { table: string; file: string; onClose: () => void }) {
  const [schema, setSchema] = useState<{ source: string } | { error: string }>();

  useEffect(() => {
    let current = true;
    fetchSchema(table).then(
      ({ source }) => current && setSchema({ source }),
      (error: { message?: string }) =>
        current && setSchema({ error: error.message ?? 'The schema file could not be read' }),
    );
    return () => {
      current = false;
    };
  }, [table]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle className="font-mono text-sm">{file}</DialogTitle>
        <DialogDescription className="text-xs">The schema of {table}, as the file holds it</DialogDescription>
        {schema === undefined ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : 'error' in schema ? (
          <p className="text-sm text-destructive">{schema.error}</p>
        ) : (
          <SchemaViewer source={schema.source} label={file} />
        )}
      </DialogContent>
    </Dialog>
  );
}
