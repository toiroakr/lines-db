import { useMemo, useState, type KeyboardEvent } from 'react';
import { Check, CircleAlert, LoaderCircle, RotateCcw, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { JsonEditor } from '@/components/json-editor';
import type { Column, JsonValue } from '@/lib/types';
import type { Batch } from '@/lib/pending';
import { issuePath, issuesFor, useLiveCheck } from '@/lib/check';
import { editableText, isBoolean, isNumber, parseInput } from '@/lib/values';
import { cn } from '@/lib/utils';

export interface CellEditorProps {
  table: string;
  column: Column;
  value: JsonValue | undefined;
  /** The changes saving would send if the cell took this value, to check before it is set */
  preview: (value: JsonValue) => Batch;
  /** Offered for an existing row: hands the field back to the schema */
  canUseDefault: boolean;
  /** Offered when the cell has a pending change */
  canRevert: boolean;
  onApply: (value: JsonValue) => void;
  onUseDefault: () => void;
  onRevert: () => void;
  onClose: () => void;
}

export function CellEditor({
  table,
  column,
  value,
  preview,
  canUseDefault,
  canRevert,
  onApply,
  onUseDefault,
  onRevert,
  onClose,
}: CellEditorProps) {
  const initial = useMemo(
    () => (isBoolean(column) ? String(value === true) : editableText(column, value)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [text, setText] = useState(initial);
  const parsed = useMemo(() => parseInput(column, text), [column, text]);
  const edited = text !== initial;
  const { result, checking } = useLiveCheck(table, edited && 'value' in parsed ? preview(parsed.value) : undefined);
  const issues = issuesFor(column.name, result);
  const checkFailed = result && !result.ok && 'failed' in result ? result.failed : undefined;
  const json = column.type === 'JSON';

  const apply = () => {
    if ('value' in parsed) onApply(parsed.value);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') onClose();
    if (!json && event.key === 'Enter') {
      event.preventDefault();
      apply();
    }
  };

  return (
    <div className="grid gap-3" onKeyDown={onKeyDown}>
      <div className="flex items-center gap-2 pr-6">
        <span className="font-mono text-sm font-medium">{column.name}</span>
        <Badge variant="outline">{isBoolean(column) ? 'BOOLEAN' : column.type}</Badge>
        <Status
          edited={edited}
          parseError={'error' in parsed ? parsed.error : undefined}
          checking={checking}
          checkFailed={checkFailed}
          issues={issues.length}
          checked={result !== undefined}
        />
      </div>
      {isBoolean(column) ? (
        <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1">
          {['true', 'false'].map((option) => (
            <button
              key={option}
              type="button"
              autoFocus={text === option}
              onClick={() => setText(option)}
              className={`rounded-sm py-1 font-mono text-xs ${text === option ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}
            >
              {option}
            </button>
          ))}
        </div>
      ) : json ? (
        <JsonEditor initial={initial} issues={issues} onChange={setText} onSubmit={apply} />
      ) : (
        <Input
          autoFocus
          className="font-mono"
          inputMode={isNumber(column) ? 'decimal' : undefined}
          aria-invalid={'error' in parsed || issues.length > 0}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      )}
      {edited && 'error' in parsed && <p className="text-xs text-destructive">{parsed.error}</p>}
      {issues.length > 0 && (
        <ul className="grid gap-1 rounded-md border border-destructive/30 bg-destructive/5 p-2 font-mono text-xs text-destructive">
          {issues.map((issue, index) => (
            <li key={index}>
              {issuePath(issue)}: {issue.message}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" onClick={apply} disabled={'error' in parsed}>
          <Check /> Set
        </Button>
        <Button size="sm" variant="outline" onClick={() => onApply(null)}>
          <X /> Set null
        </Button>
        {canUseDefault && (
          <Button size="sm" variant="outline" onClick={onUseDefault}>
            <Sparkles /> Use default
          </Button>
        )}
        {canRevert && (
          <Button size="sm" variant="ghost" onClick={onRevert}>
            <RotateCcw /> Revert
          </Button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {json ? '⌘↵' : '↵'} to set · Esc to close · nothing is written until you save
      </p>
    </div>
  );
}

function Status({
  edited,
  parseError,
  checking,
  checkFailed,
  issues,
  checked,
}: {
  edited: boolean;
  parseError?: string;
  checking: boolean;
  checkFailed?: string;
  issues: number;
  checked: boolean;
}) {
  if (!edited) return null;
  const [icon, label, tone] = parseError
    ? [<CircleAlert key="i" />, 'Invalid', 'text-destructive']
    : checkFailed && !checking
      ? [<CircleAlert key="i" />, 'Not checked', 'text-muted-foreground']
      : checking || !checked
        ? [<LoaderCircle key="i" className="animate-spin" />, 'Checking', 'text-muted-foreground']
        : issues > 0
          ? [<CircleAlert key="i" />, `${issues} issue${issues === 1 ? '' : 's'}`, 'text-destructive']
          : [<Check key="i" />, 'Valid', 'text-emerald-600 dark:text-emerald-400'];
  return (
    <span
      className={cn('ml-auto flex items-center gap-1 text-xs [&_svg]:size-3.5', tone)}
      aria-live="polite"
      title={checkFailed && `The value could not be checked: ${checkFailed}. Saving still validates it.`}
    >
      {icon}
      {label}
    </span>
  );
}
