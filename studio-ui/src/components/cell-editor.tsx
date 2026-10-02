import { useState, type KeyboardEvent } from 'react';
import { CornerDownLeft, RotateCcw, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import type { Column, JsonValue } from '@/lib/types';
import { editableText, isBoolean, isNumber, parseInput } from '@/lib/values';

export interface CellEditorProps {
  column: Column;
  value: JsonValue | undefined;
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
  column,
  value,
  canUseDefault,
  canRevert,
  onApply,
  onUseDefault,
  onRevert,
  onClose,
}: CellEditorProps) {
  const [text, setText] = useState(() => (isBoolean(column) ? String(value === true) : editableText(column, value)));
  const [error, setError] = useState<string>();

  const apply = () => {
    const parsed = parseInput(column, text);
    if ('error' in parsed) setError(parsed.error);
    else onApply(parsed.value);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') onClose();
    if (event.key === 'Enter' && (column.type !== 'JSON' || event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      apply();
    }
  };

  return (
    <div className="grid gap-3" onKeyDown={onKeyDown}>
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm font-medium">{column.name}</span>
        <Badge variant="outline">{isBoolean(column) ? 'BOOLEAN' : column.type}</Badge>
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
      ) : column.type === 'JSON' ? (
        <Textarea
          autoFocus
          value={text}
          spellCheck={false}
          onChange={(event) => setText(event.target.value)}
          rows={6}
        />
      ) : (
        <Input
          autoFocus
          className="font-mono"
          inputMode={isNumber(column) ? 'decimal' : undefined}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setError(undefined);
          }}
        />
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" onClick={apply}>
          <CornerDownLeft /> Apply
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
        {column.type === 'JSON' ? '⌘↵ to apply' : '↵ to apply'} · Esc to close · changes stay pending until saved
      </p>
    </div>
  );
}
