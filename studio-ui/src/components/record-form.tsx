import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Eraser, Lock, RotateCcw, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { JsonEditor } from '@/components/json-editor';
import type { Column, Issue, JsonValue, Reference } from '@/lib/types';
import type { Batch } from '@/lib/pending';
import { issuePath, issuesFor, segmentKey, useLiveCheck } from '@/lib/check';
import { editableText, formatValue, isBoolean, isNumber, parseInput } from '@/lib/values';
import { cn } from '@/lib/utils';

export type FieldState = 'file' | 'default' | 'changed' | 'reset' | 'set' | 'unset';

/** What a form shows of one field of a row, and what it does when the field is changed */
export interface FieldModel {
  column: Column;
  /** The value as the row now holds it, with its unsaved change applied */
  value: JsonValue | undefined;
  state: FieldState;
  readOnly: boolean;
  /** What makes the value fail validation, shown until the field is edited */
  issues: Issue[];
  preview: (value: JsonValue) => Batch;
  /** Whether the field can be removed from the row, leaving its value to the schema */
  canUseDefault: boolean;
  canRevert: boolean;
  reference?: Reference;
  onChange: (value: JsonValue) => void;
  onUseDefault: () => void;
  onRevert: () => void;
  onOpenReference?: () => void;
}

/** The text a field shows for a value */
const textOf = (column: Column, value: JsonValue | undefined) =>
  isBoolean(column) ? (typeof value === 'boolean' ? String(value) : '') : editableText(column, value);

/** One field of a row as a form edits it: changes are handed on as soon as they read as the column's type */
export function FormField({ table, model }: { table: string; model: FieldModel }) {
  const { column, value, state, readOnly } = model;
  const [text, setText] = useState(() => textOf(column, value));
  // The value this field last handed on; a value arriving otherwise came from elsewhere, such as the grid
  const handed = useRef(JSON.stringify(value ?? null));
  useEffect(() => {
    if (JSON.stringify(value ?? null) === handed.current) return;
    handed.current = JSON.stringify(value ?? null);
    setText(textOf(column, value));
  }, [value, column]);

  const parsed = parseInput(column, text);
  const edited = text !== textOf(column, value) || state === 'changed';
  const { result } = useLiveCheck(table, edited && 'value' in parsed ? model.preview(parsed.value) : undefined);
  const issues = edited ? issuesFor(column.name, result) : model.issues;

  const hand = (next: string) => {
    setText(next);
    const read = parseInput(column, next);
    if ('value' in read) {
      handed.current = JSON.stringify(read.value);
      model.onChange(read.value);
    }
  };

  return (
    <div className="grid gap-1.5" data-field={column.name}>
      <div className="flex items-center gap-1.5 text-xs">
        <span className="font-mono font-medium">{column.name}</span>
        <span className="text-[10px] text-muted-foreground uppercase">
          {isBoolean(column) ? 'boolean' : column.type.toLowerCase()}
        </span>
        {state === 'default' && (
          <Badge variant="outline" className="font-sans">
            default
          </Badge>
        )}
        {column.unknown && (
          <Badge variant="outline" className="border-destructive/50 font-sans text-destructive">
            not in schema
          </Badge>
        )}
        {model.reference && model.onOpenReference && value !== undefined && value !== null && (
          <button
            type="button"
            className="ml-auto inline-flex items-center gap-0.5 font-mono text-[11px] text-muted-foreground hover:text-foreground"
            aria-label={`Open ${model.reference.table} where ${model.reference.referencedColumn} is ${formatValue(value)}`}
            onClick={model.onOpenReference}
          >
            {model.reference.table} <ArrowUpRight className="size-3" />
          </button>
        )}
      </div>
      {state === 'reset' ? (
        <p className="text-xs text-muted-foreground italic line-through">removed</p>
      ) : column.unknown ? (
        <p className="font-mono text-xs break-all text-muted-foreground">{formatValue(value)}</p>
      ) : isBoolean(column) ? (
        <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1">
          {['true', 'false'].map((option) => (
            <button
              key={option}
              type="button"
              disabled={readOnly}
              aria-pressed={text === option}
              onClick={() => hand(option)}
              className={cn(
                'rounded-sm py-1 font-mono text-xs',
                text === option ? 'bg-background shadow-sm' : 'text-muted-foreground',
              )}
            >
              {option}
            </button>
          ))}
        </div>
      ) : column.type === 'JSON' ? (
        <JsonField column={column} text={text} readOnly={readOnly} issues={issues} onSet={hand} />
      ) : (
        <Input
          className={cn('h-8 font-mono text-xs', state === 'default' && 'text-muted-foreground')}
          aria-label={column.name}
          aria-invalid={'error' in parsed || issues.length > 0}
          inputMode={isNumber(column) ? 'decimal' : undefined}
          readOnly={readOnly}
          value={text}
          onChange={(event) => hand(event.target.value)}
        />
      )}
      {'error' in parsed && text !== '' && <p className="text-xs text-destructive">{parsed.error}</p>}
      {issues.length > 0 && (
        <ul className="grid gap-0.5 font-mono text-xs text-destructive">
          {issues.map((issue, index) => (
            <li key={index}>
              {issuePath(issue)}: {issue.message}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (model.canRevert || model.canUseDefault || !column.unknown) && (
        <div className="flex flex-wrap gap-1">
          {model.canRevert && (
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={model.onRevert}>
              <RotateCcw /> Revert
            </Button>
          )}
          {model.canUseDefault && state !== 'reset' && (
            <Button
              size="sm"
              variant="ghost"
              className={cn('h-6 px-2 text-xs', column.unknown && 'text-destructive')}
              aria-label={`Remove ${column.name}`}
              onClick={model.onUseDefault}
            >
              {column.unknown ? <Trash2 /> : <Eraser />} Remove field
            </Button>
          )}
          {!column.unknown && state !== 'reset' && value !== null && (
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto h-6 px-2 text-xs text-muted-foreground"
              onClick={() => {
                handed.current = 'null';
                setText('');
                model.onChange(null);
              }}
            >
              <X /> Set null
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** A JSON value shown compact, edited in a dialog: an editor per field would crowd the form */
function JsonField({
  column,
  text,
  readOnly,
  issues,
  onSet,
}: {
  column: Column;
  text: string;
  readOnly: boolean;
  issues: Issue[];
  onSet: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(text);
  const parsed = parseInput(column, draft);
  const set = () => {
    if (!('value' in parsed)) return;
    onSet(JSON.stringify(parsed.value, null, 2));
    setOpen(false);
  };
  return (
    <>
      <button
        type="button"
        disabled={readOnly}
        aria-label={column.name}
        onClick={() => {
          setDraft(text);
          setOpen(true);
        }}
        className="truncate rounded-md border bg-muted/30 px-2 py-1.5 text-left font-mono text-xs hover:bg-accent/60 disabled:cursor-default"
      >
        {text === '' ? <span className="text-muted-foreground italic">null</span> : text.replace(/\s+/g, ' ')}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle className="font-mono text-sm">{column.name}</DialogTitle>
          <DialogDescription className="sr-only">Edit the JSON value of {column.name}</DialogDescription>
          <JsonEditor
            label={column.name}
            initial={draft}
            issues={issues.filter((issue) => !issue.path?.length || segmentKey(issue.path[0]) === column.name)}
            onChange={setDraft}
            onSubmit={set}
          />
          {'error' in parsed && <p className="text-xs text-destructive">{parsed.error}</p>}
          <div className="flex justify-end">
            <Button size="sm" onClick={set} disabled={'error' in parsed}>
              Set
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** One row as a form: its fields edited side by side with the grid, which stays usable to pick another row */
export function RecordDrawer({
  table,
  title,
  fields,
  readOnlyReason,
  onClose,
}: {
  table: string;
  title: string;
  fields: FieldModel[];
  readOnlyReason?: string;
  onClose: () => void;
}) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // Not closed under a dialog or popover: the Escape is for that one
      if (document.querySelector('[role=dialog], [data-radix-popper-content-wrapper]')) return;
      close.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <aside
      aria-label={title}
      className="fixed inset-y-0 right-0 z-30 flex w-full flex-col border-l bg-background shadow-lg sm:w-[28rem] lg:static lg:z-auto lg:shadow-none"
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <span className="min-w-0 truncate font-mono text-sm font-semibold">{title}</span>
        <Button size="icon" variant="ghost" className="ml-auto size-7" aria-label="Close the row" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>
      {readOnlyReason && (
        <p className="flex items-center gap-1.5 border-b bg-muted/50 px-4 py-2 text-xs text-muted-foreground">
          <Lock className="size-3" /> {readOnlyReason}
        </p>
      )}
      <div className="grid flex-1 content-start gap-4 overflow-y-auto p-4">
        {fields.map((model) => (
          <FormField key={model.column.name} table={table} model={model} />
        ))}
      </div>
      <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">
        Changes join the unsaved ones · nothing is written until you save
      </p>
    </aside>
  );
}
