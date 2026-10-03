import { useEffect, useRef, useState } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { syntaxHighlighting } from '@codemirror/language';
import { cspNonce, highlight, theme } from '@/components/code-style';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Tabs } from 'radix-ui';
import { fetchSchema, type SchemaDefinition, type SchemaResponse } from '@/lib/api';

/** How the schema of another table is reached: where its link points, and what a plain click on it does */
interface SchemaLinks {
  /** Where the schema of a table opens, or undefined when it has no schema file */
  hrefOf: (table: string) => string | undefined;
  /** Opens the schema as a new history entry, which the back button returns from */
  open: (table: string) => void;
}

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

  return (
    <div ref={host} className="max-h-[70vh] min-h-40 overflow-auto overscroll-none rounded-md border bg-background" />
  );
}

/** A dialog showing the schema file of a table, read when it opens */
export function SchemaDialog({
  table,
  file,
  backTo,
  hrefOf,
  onOpenSchema,
  onClose,
}: {
  table: string;
  file: string;
  /** The table whose schema was open before this one, when a foreign key led here */
  backTo?: string;
  /** Where the schema of another table opens, or undefined when it has no schema file */
  hrefOf: (table: string) => string | undefined;
  /** Opens the schema of another table as a new history entry, which the back button returns from */
  onOpenSchema: (table: string) => void;
  onClose: () => void;
}) {
  const [schema, setSchema] = useState<SchemaResponse | { error: string }>();

  useEffect(() => {
    let current = true;
    setSchema(undefined);
    fetchSchema(table).then(
      (response) => current && setSchema(response),
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
        <div className="flex items-center gap-2">
          {backTo && (
            <Button
              size="icon"
              variant="ghost"
              className="-ml-2 size-7"
              aria-label={`Back to the schema of ${backTo}`}
              title={`Back to the schema of ${backTo}`}
              onClick={() => history.back()}
            >
              <ArrowLeft />
            </Button>
          )}
          <DialogTitle className="font-mono text-sm">{file}</DialogTitle>
        </div>
        <DialogDescription className="text-xs">The schema of {table}</DialogDescription>
        {schema === undefined ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : 'error' in schema ? (
          <p className="text-sm text-destructive">{schema.error}</p>
        ) : (
          // Keyed by table so the tab starts at Definition again, without the dialog and its backdrop being remounted
          <SchemaTabs key={table} schema={schema} file={file} links={{ hrefOf, open: onOpenSchema }} />
        )}
      </DialogContent>
    </Dialog>
  );
}

const tabTrigger =
  'border-b-2 border-transparent px-3 py-1.5 text-sm text-muted-foreground data-[state=active]:border-foreground data-[state=active]:text-foreground';

/** The declared definition first and the code as the file holds it second; only the code for a table not loaded */
function SchemaTabs({ schema, file, links }: { schema: SchemaResponse; file: string; links: SchemaLinks }) {
  if (!schema.definition) return <SchemaViewer source={schema.source} label={file} />;
  return (
    <Tabs.Root defaultValue="definition" className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <Tabs.List className="flex border-b">
        <Tabs.Trigger value="definition" className={tabTrigger}>
          Definition
        </Tabs.Trigger>
        <Tabs.Trigger value="code" className={tabTrigger}>
          Code
        </Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="definition" className="max-h-[70vh] overflow-auto">
        <SchemaDefinitionView definition={schema.definition} links={links} />
      </Tabs.Content>
      <Tabs.Content value="code">
        <SchemaViewer source={schema.source} label={file} />
      </Tabs.Content>
    </Tabs.Root>
  );
}

const heading = 'mb-1.5 text-xs font-medium text-muted-foreground';
const cell = 'px-3 py-1.5 text-left font-mono text-xs';

function SchemaDefinitionView({ definition, links }: { definition: SchemaDefinition; links: SchemaLinks }) {
  const { columns, foreignKeys, indexes } = definition;
  return (
    <div className="grid gap-5">
      <section>
        <h3 className={heading}>Columns</h3>
        <table className="w-full rounded-md border text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              {['Name', 'Type', 'Constraints', 'References'].map((name) => (
                <th key={name} className={cell}>
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {columns.map((column) => {
              const reference = foreignKeys.find((key) => key.column === column.name)?.references;
              const constraints = [
                column.primaryKey && 'primary key',
                column.notNull && 'not null',
                column.unique && 'unique',
              ].filter(Boolean);
              return (
                <tr key={column.name} className="border-b last:border-b-0">
                  <td className={cell}>{column.name}</td>
                  <td className={cell}>
                    {column.type}
                    {column.valueType && <span className="text-muted-foreground"> ({column.valueType})</span>}
                  </td>
                  <td className={cell}>{constraints.join(', ') || '—'}</td>
                  <td className={cell}>
                    {reference ? <TableLink table={reference.table} column={reference.column} links={links} /> : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      {foreignKeys.length > 0 && (
        <section>
          <h3 className={heading}>Foreign keys</h3>
          <ul className="grid gap-1 font-mono text-xs">
            {foreignKeys.map((key) => (
              <li key={key.column}>
                {key.column} → <TableLink table={key.references.table} column={key.references.column} links={links} />
                {key.onDelete && <span className="text-muted-foreground"> · on delete {key.onDelete}</span>}
                {key.onUpdate && <span className="text-muted-foreground"> · on update {key.onUpdate}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {indexes.length > 0 && (
        <section>
          <h3 className={heading}>Indexes</h3>
          <ul className="grid gap-1 font-mono text-xs">
            {indexes.map((index) => (
              <li key={index.name ?? index.columns.join(',')}>
                {index.name ? `${index.name}: ` : ''}({index.columns.join(', ')})
                {index.unique && <span className="text-muted-foreground"> · unique</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** A reference to a column of another table, a link to that table's schema when it has one */
function TableLink({ table, column, links }: { table: string; column: string; links: SchemaLinks }) {
  const href = links.hrefOf(table);
  return href ? (
    <>
      <a
        href={href}
        className="text-primary underline-offset-2 hover:underline"
        onClick={(event) => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          links.open(table);
        }}
      >
        {table}
      </a>
      .{column}
    </>
  ) : (
    <>
      {table}.{column}
    </>
  );
}
