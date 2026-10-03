import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowUpRight, Ban, Eraser, Lock, RotateCcw, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, TextLines } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ValueField } from '@/components/value-field';
import type { Column, Issue, JsonObject, JsonValue, Reference, TableInfo } from '@/lib/types';
import type { Batch } from '@/lib/pending';
import { fieldIssues, issuePath, issuesOf, segmentKey, useLiveCheck, type CheckResult } from '@/lib/check';
import { absentText, editableText, formatValue, isBoolean, isNumber, parseInput, type Parsed } from '@/lib/values';
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
  /** Whether the field can be removed from the row, leaving its value to the schema */
  canUseDefault: boolean;
  canRevert: boolean;
  reference?: Reference;
  onChange: (value: JsonValue) => void;
  onUseDefault: () => void;
  onRevert: () => void;
  onOpenReference?: () => void;
  /** Told whether the text the field shows is the value it handed on, as text it cannot read is not */
  onValidity?: (valid: boolean) => void;
}

/** The text a field shows for a value */
const textOf = (column: Column, value: JsonValue | undefined) =>
  isBoolean(column) ? (typeof value === 'boolean' ? String(value) : '') : editableText(column, value);

/** A small button in the label row of a field */
function FieldAction({
  label,
  className,
  onClick,
  children,
}: {
  label: string;
  className?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        className={cn('rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground', className)}
        onClick={onClick}
      >
        {children}
      </button>
    </Tooltip>
  );
}

/** One field of a row as a form edits it: changes are handed on as soon as they read as the column's type */
export function FormField({
  model,
  checked,
}: {
  model: FieldModel;
  /** What the check of the row as it now is found, which the field shows its own issues of once edited */
  checked?: CheckResult;
}) {
  const { column, value, state, readOnly } = model;
  const json = column.type === 'JSON' && !column.unknown;
  const [text, setText] = useState(() => textOf(column, value));
  // Not kept across a value arriving from elsewhere: the blocks of a JSON value read its shape again
  const [version, setVersion] = useState(0);
  // The value this field last handed on; a value arriving otherwise came from elsewhere, such as the grid
  const handed = useRef(JSON.stringify(value ?? null));
  useEffect(() => {
    if (JSON.stringify(value ?? null) === handed.current) return;
    handed.current = JSON.stringify(value ?? null);
    setText(textOf(column, value));
    setVersion((now) => now + 1);
  }, [value, column]);

  const parsed: Parsed = json ? { value: value ?? null } : parseInput(column, text);
  // Not only a change to a row of the file: a value filled in a new row is checked as it is given
  const edited = state === 'changed' || state === 'set' || (!json && text !== textOf(column, value));
  // Not those of another field: the form shows each under its own field, and those of no field changed above
  const issues = edited ? fieldIssues(column.name, issuesOf(checked)) : model.issues;
  // Not listed under a JSON value: its blocks show those about what they hold
  const listed = json
    ? issues.filter((issue) => !issue.path?.length || segmentKey(issue.path[0]) !== column.name)
    : issues;

  // Not the parse alone: an emptied number field reads as no number, while the value handed on is the last one read
  const [fieldsValid, setFieldsValid] = useState(true);
  // Not kept for a field removed from the row or one that cannot be edited: what it shows is not written
  const valid =
    state === 'reset' || readOnly || (json ? fieldsValid : text === textOf(column, value) || !('error' in parsed));
  const report = useRef(model.onValidity);
  report.current = model.onValidity;
  useEffect(() => report.current?.(valid), [valid]);
  // Not left as unreadable once gone: a field closed with the form, or with another row opened, holds no text
  useEffect(() => () => report.current?.(true), []);

  const handValue = (next: JsonValue) => {
    handed.current = JSON.stringify(next);
    model.onChange(next);
  };
  const hand = (next: string) => {
    setText(next);
    const read = parseInput(column, next);
    if ('value' in read) handValue(read.value);
  };

  return (
    <div className="grid gap-1.5" data-field={column.name}>
      <div className="flex min-h-5 items-center gap-1.5 text-xs">
        <span className="font-mono font-semibold">{column.name}</span>
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
        <span className="ml-auto flex items-center gap-1 [&_svg]:size-3.5">
          {model.reference && model.onOpenReference && value !== undefined && value !== null ? (
            <button
              type="button"
              className="inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground hover:text-foreground"
              aria-label={`Open ${model.reference.table} where ${model.reference.referencedColumn} is ${formatValue(value)}`}
              onClick={model.onOpenReference}
            >
              → {model.reference.table} <ArrowUpRight className="size-3" />
            </button>
          ) : (
            <span className="font-mono text-[10px] text-muted-foreground uppercase">
              {isBoolean(column) ? 'boolean' : column.type.toLowerCase()}
            </span>
          )}
          {!readOnly && model.canRevert && (
            <FieldAction label={`Revert ${column.name}`} onClick={model.onRevert}>
              <RotateCcw />
            </FieldAction>
          )}
          {!readOnly && model.canUseDefault && (column.unknown || column.optional !== false) && state !== 'reset' && (
            <FieldAction
              label={`Remove ${column.name}`}
              className={cn(column.unknown && 'text-destructive')}
              onClick={() => {
                // Not kept for a revert: text it could not read was never handed on, so the row does not hold it
                setText(textOf(column, value));
                setVersion((now) => now + 1);
                model.onUseDefault();
              }}
            >
              {column.unknown ? <Trash2 /> : <Eraser />}
            </FieldAction>
          )}
          {!readOnly && !column.unknown && column.nullable !== false && state !== 'reset' && value !== null && (
            <FieldAction
              label={`Set ${column.name} to null`}
              onClick={() => {
                handValue(null);
                setText('');
                setVersion((now) => now + 1);
              }}
            >
              <Ban />
            </FieldAction>
          )}
        </span>
      </div>
      {state === 'reset' ? (
        <p className="text-xs text-muted-foreground italic line-through">removed</p>
      ) : column.unknown ? (
        <p className="font-mono text-xs break-all text-muted-foreground">{formatValue(value)}</p>
      ) : json ? (
        <ValueField
          key={version}
          path={[column.name]}
          value={value ?? null}
          issues={issues}
          readOnly={readOnly}
          leeway={column.nested}
          onChange={handValue}
          onValidity={setFieldsValid}
        />
      ) : isBoolean(column) ? (
        <div role="group" aria-label={column.name} className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1">
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
      ) : isNumber(column) ? (
        <Input
          className={cn('h-8 font-mono text-xs', state === 'default' && 'text-muted-foreground')}
          aria-label={column.name}
          aria-invalid={'error' in parsed || issues.length > 0}
          inputMode="decimal"
          readOnly={readOnly}
          placeholder={absentText(value)}
          value={text}
          onChange={(event) => hand(event.target.value)}
        />
      ) : (
        <TextLines
          className={cn('font-mono text-xs', state === 'default' && 'text-muted-foreground')}
          aria-label={column.name}
          aria-invalid={'error' in parsed || issues.length > 0}
          readOnly={readOnly}
          placeholder={absentText(value)}
          value={text}
          onChange={(event) => hand(event.target.value)}
        />
      )}
      {'error' in parsed && text !== '' && <p className="text-xs text-destructive">{parsed.error}</p>}
      {listed.length > 0 && (
        <ul className="grid gap-0.5 font-mono text-xs text-destructive">
          {listed.map((issue, index) => (
            <li key={index}>
              {issuePath(issue)}: {issue.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The issues of a row's check that no field it shows has: those about the row, or about a field left as it was */
function RowIssues({ checked, fields }: { checked?: CheckResult; fields: FieldModel[] }) {
  const changed = new Set(
    fields.filter((model) => model.state === 'changed' || model.state === 'set').map((model) => model.column.name),
  );
  const issues = issuesOf(checked).filter((issue) => !issue.path?.length || !changed.has(segmentKey(issue.path[0])));
  if (issues.length === 0) return null;
  return (
    <ul className="grid gap-0.5 rounded-md border border-destructive/30 bg-destructive/5 p-2 font-mono text-xs text-destructive">
      {issues.map((issue, index) => (
        <li key={index}>
          {issuePath(issue)}: {issue.message}
        </li>
      ))}
    </ul>
  );
}

/** A row as the form shows it */
export interface FormRow {
  /** What tells the row from the others, as the title of every new row is the same */
  id: string;
  title: string;
  fields: FieldModel[];
  /** The change saving would send for the row, checked once for all its fields; none while it has no change */
  preview?: Batch;
  /** Why the row cannot be changed, when it cannot */
  readOnlyReason?: string;
}

/** One row as a form: its fields edited side by side with the grid, which stays usable to pick another row */
export function RecordDrawer({ table, row, onClose }: { table: string; row?: FormRow; onClose: () => void }) {
  // Not checked by each field: every field changed would send the same row
  const { result } = useLiveCheck(table, row?.preview);
  const [width, setWidth] = useState(readFormWidth);
  const resize = (next: number) => {
    const clamped = clampWidth(next);
    setWidth(clamped);
    writeFormWidth(clamped);
  };
  return (
    <aside
      aria-label={row?.title ?? 'Row form'}
      style={{ '--form-width': `${width}px` } as CSSProperties}
      className="fixed inset-y-0 right-0 z-30 flex w-full flex-col border-l bg-background shadow-lg sm:w-[28rem] lg:relative lg:z-auto lg:w-(--form-width) lg:shrink-0 lg:shadow-none"
    >
      <ResizeHandle width={width} onResize={resize} />
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <span className="min-w-0 truncate font-mono text-sm font-semibold">{row?.title ?? 'Row form'}</span>
        {/* Not shown on a wide screen: the grid beside it has the button that hides it */}
        <Button
          size="icon"
          variant="ghost"
          className="ml-auto size-7 lg:hidden"
          aria-label="Hide the row form"
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </div>
      {row?.readOnlyReason && (
        <p className="flex items-center gap-1.5 border-b bg-muted/50 px-4 py-2 text-xs text-muted-foreground">
          <Lock className="size-3" /> {row.readOnlyReason}
        </p>
      )}
      {row ? (
        <div key={row.id} className="grid flex-1 content-start gap-4 overflow-y-auto overscroll-none p-4">
          <RowIssues checked={result} fields={row.fields} />
          {row.fields.map((model) => (
            <FormField key={model.column.name} model={model} checked={result} />
          ))}
        </div>
      ) : (
        <p className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
          Click a row to show it here
        </p>
      )}
      <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">
        Changes join the unsaved ones · nothing is written until you save
      </p>
    </aside>
  );
}

export const MIN_FORM_WIDTH = 320;
const DEFAULT_FORM_WIDTH = 448;
/** How much of the screen the grid keeps beside the form */
const GRID_FLOOR = 400;
const RESIZE_STEP = 32;
const WIDTH_KEY = 'lines-db-studio:form-width';

const clampWidth = (width: number) => Math.round(Math.max(MIN_FORM_WIDTH, Math.min(width, innerWidth - GRID_FLOOR)));

function readFormWidth(): number {
  try {
    const stored = Number(localStorage.getItem(WIDTH_KEY));
    if (stored > 0) return clampWidth(stored);
  } catch {
    // Not remembered, so as wide as at first
  }
  return clampWidth(DEFAULT_FORM_WIDTH);
}

function writeFormWidth(width: number): void {
  try {
    localStorage.setItem(WIDTH_KEY, String(width));
  } catch {
    // Not kept for the next visit, which then starts as wide as at first
  }
}

/** The edge of the form between it and the grid, dragged to widen or narrow the form */
function ResizeHandle({ width, onResize }: { width: number; onResize: (width: number) => void }) {
  const drag = useRef<{ x: number; width: number }>(undefined);
  return (
    <div
      role="separator"
      aria-label="Resize the row form"
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={MIN_FORM_WIDTH}
      aria-valuemax={clampWidth(Infinity)}
      tabIndex={0}
      className="absolute inset-y-0 -left-0.5 z-10 hidden w-1 cursor-col-resize touch-none outline-none select-none hover:bg-primary/40 focus-visible:bg-primary/40 lg:block"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        // Not followed on the document: the captured pointer keeps sending its moves here
        event.currentTarget.setPointerCapture?.(event.pointerId);
        drag.current = { x: event.clientX, width };
      }}
      onPointerMove={(event) => {
        if (drag.current) onResize(drag.current.width + drag.current.x - event.clientX);
      }}
      onPointerUp={() => (drag.current = undefined)}
      onPointerCancel={() => (drag.current = undefined)}
      onDoubleClick={() => onResize(DEFAULT_FORM_WIDTH)}
      onKeyDown={(event) => {
        const step = event.key === 'ArrowLeft' ? RESIZE_STEP : event.key === 'ArrowRight' ? -RESIZE_STEP : 0;
        if (step === 0) return;
        event.preventDefault();
        onResize(width + step);
      }}
    />
  );
}

/** A new row filled in field by field before it joins the unsaved changes; the fields left empty are left to the schema */
export function NewRecordDialog({
  table,
  open,
  onClose,
  onAdd,
}: {
  table: TableInfo;
  open: boolean;
  onClose: () => void;
  onAdd: (row: JsonObject) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogTitle className="text-sm">New row in {table.name}</DialogTitle>
        <DialogDescription className="text-xs">
          Fields left empty are left out of the row, for the schema to fill in. Adding the row joins it to the unsaved
          changes.
        </DialogDescription>
        {/* Not kept from one opening to the next: each opening is a new row */}
        {open && <NewRecordFields table={table} onAdd={onAdd} />}
      </DialogContent>
    </Dialog>
  );
}

function NewRecordFields({ table, onAdd }: { table: TableInfo; onAdd: (row: JsonObject) => void }) {
  const [draft, setDraft] = useState<JsonObject>({});
  const [unreadable, setUnreadable] = useState<ReadonlySet<string>>(new Set());
  const preview = (row: JsonObject) => ({ inserts: [row], updates: [], deletes: [] });
  const { result } = useLiveCheck(table.name, preview(draft));
  const fields = table.columns
    .filter((column) => !column.unknown)
    .map((column): FieldModel => {
      const set = Object.hasOwn(draft, column.name);
      return {
        column,
        value: draft[column.name],
        state: set ? 'set' : 'unset',
        readOnly: false,
        issues: [],
        canUseDefault: set,
        canRevert: false,
        onChange: (value) => setDraft((now) => ({ ...now, [column.name]: value })),
        onUseDefault: () =>
          setDraft((now) => {
            const { [column.name]: _removed, ...rest } = now;
            return rest;
          }),
        onRevert: () => undefined,
        onValidity: (valid) =>
          setUnreadable((now) => {
            if (valid !== now.has(column.name)) return now;
            const next = new Set(now);
            if (valid) next.delete(column.name);
            else next.add(column.name);
            return next;
          }),
      };
    });
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (unreadable.size === 0) onAdd(draft);
      }}
    >
      {fields.map((model) => (
        <FormField key={model.column.name} model={model} checked={result} />
      ))}
      <RowIssues checked={result} fields={fields} />
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={unreadable.size > 0}>
          Add
        </Button>
      </div>
    </form>
  );
}
