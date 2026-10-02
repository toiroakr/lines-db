import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowUpRight, Ban, Eraser, Lock, RotateCcw, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/tooltip';
import { ValueField } from '@/components/value-field';
import type { Column, Issue, JsonValue, Reference } from '@/lib/types';
import type { Batch } from '@/lib/pending';
import { issuePath, issuesFor, segmentKey, useLiveCheck } from '@/lib/check';
import { editableText, formatValue, isBoolean, isNumber, parseInput, type Parsed } from '@/lib/values';
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
export function FormField({ table, model }: { table: string; model: FieldModel }) {
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
  const edited = state === 'changed' || (!json && text !== textOf(column, value));
  const { result } = useLiveCheck(table, edited && 'value' in parsed ? model.preview(parsed.value) : undefined);
  const issues = edited ? issuesFor(column.name, result) : model.issues;
  // Not listed under a JSON value: its blocks show those about what they hold
  const listed = json
    ? issues.filter((issue) => !issue.path?.length || segmentKey(issue.path[0]) !== column.name)
    : issues;

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
          {!readOnly && model.canUseDefault && state !== 'reset' && (
            <FieldAction
              label={`Remove ${column.name}`}
              className={cn(column.unknown && 'text-destructive')}
              onClick={model.onUseDefault}
            >
              {column.unknown ? <Trash2 /> : <Eraser />}
            </FieldAction>
          )}
          {!readOnly && !column.unknown && state !== 'reset' && value !== null && (
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
          onChange={handValue}
        />
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

/** A row as the form shows it */
export interface FormRow {
  title: string;
  fields: FieldModel[];
  /** Why the row cannot be changed, when it cannot */
  readOnlyReason?: string;
}

/** One row as a form: its fields edited side by side with the grid, which stays usable to pick another row */
export function RecordDrawer({ table, row, onClose }: { table: string; row?: FormRow; onClose: () => void }) {
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
        <div key={row.title} className="grid flex-1 content-start gap-4 overflow-y-auto p-4">
          {row.fields.map((model) => (
            <FormField key={model.column.name} table={table} model={model} />
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
