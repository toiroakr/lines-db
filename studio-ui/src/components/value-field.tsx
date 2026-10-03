import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { Braces, ListTree, Plus, X } from 'lucide-react';
import { Input, TextLines } from '@/components/ui/input';
import { Tooltip } from '@/components/ui/tooltip';
import { JsonEditor } from '@/components/json-editor';
import type { Issue, JsonValue, NestedLeeway } from '@/lib/types';
import { segmentKey } from '@/lib/check';
import { readJsonc } from '@/lib/json-ranges';
import { emptyLike, issuesAt, issuesUnder, removeIn, setIn, shapeOf, type Path, type Shape } from '@/lib/json-shape';
import { parseInput } from '@/lib/values';
import { cn } from '@/lib/utils';

export interface ValueFieldProps {
  /** Where the value is in the row, beginning with its column */
  path: Path;
  value: JsonValue;
  /** The issues of the column, by their paths in the row */
  issues: Issue[];
  readOnly?: boolean;
  /** What the schema takes of each object inside the column's value, as the column lists it */
  leeway?: Record<string, NestedLeeway>;
  onChange: (value: JsonValue) => void;
  /** Told whether every field inside the value holds text it can read, as the value handed on is the last one read */
  onValidity?: (valid: boolean) => void;
}

const nameOf = (path: Path) => path.join('.');
/** The path inside the column's value as its leeway is listed by, with list indexes as `*` */
const patternOf = (path: Path) =>
  path
    .slice(1)
    .map((segment) =>
      typeof segment === 'number'
        ? '*'
        : segment.replace(/[%.*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`),
    )
    .join('.');
/** Where an issue is inside the value at the path, as its message is prefixed with */
const within = (issue: Issue, path: Path) => (issue.path ?? []).slice(path.length).map(segmentKey).join('.');

/** Told by each field inside a value whether it holds text it can read */
const Validity = createContext<(id: string, valid: boolean) => void>(() => {});

function useValidity(valid: boolean) {
  const report = useContext(Validity);
  const id = useId();
  useEffect(() => {
    report(id, valid);
    return () => report(id, true);
  }, [report, id, valid]);
}

export function ValueField({ onValidity, ...props }: ValueFieldProps) {
  const invalid = useRef(new Set<string>());
  const told = useRef(onValidity);
  told.current = onValidity;
  const report = useCallback((id: string, valid: boolean) => {
    const was = invalid.current.size === 0;
    if (valid) invalid.current.delete(id);
    else invalid.current.add(id);
    const now = invalid.current.size === 0;
    if (now !== was) told.current?.(now);
  }, []);
  if (!onValidity) return <Value {...props} />;
  return (
    <Validity.Provider value={report}>
      <Value {...props} />
    </Validity.Provider>
  );
}

/**
 * A JSON value as fields: a field per scalar, a block per map or list, and a JSON editor for what the
 * form cannot show. Its shape is read once, so typing `12` into a text field does not turn it into a number
 */
function Value(props: ValueFieldProps) {
  const [shape, setShape] = useState<Shape>(() => shapeOf(props.value));
  const make = (next: JsonValue) => {
    setShape(shapeOf(next));
    props.onChange(next);
  };
  switch (shape) {
    case 'map':
    case 'list':
      return <Block {...props} shape={shape} onReshape={() => setShape(shapeOf(props.value))} />;
    case 'json':
      return <RawJson {...props} />;
    case 'null':
      return <NullValue {...props} onMake={make} />;
    default:
      return <Scalar {...props} shape={shape} />;
  }
}

function IssueList({ issues, path }: { issues: Issue[]; path: Path }) {
  if (issues.length === 0) return null;
  return (
    <ul className="grid gap-0.5 font-mono text-xs text-destructive">
      {issues.map((issue, index) => {
        const where = within(issue, path);
        return <li key={index}>{where ? `${where}: ${issue.message}` : issue.message}</li>;
      })}
    </ul>
  );
}

function Scalar({ path, value, issues, readOnly, onChange, shape }: ValueFieldProps & { shape: Shape }) {
  const name = nameOf(path);
  const own = issuesAt(issues, path);
  const control =
    shape === 'boolean' ? (
      <div role="group" aria-label={name} className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1">
        {[true, false].map((option) => (
          <button
            key={String(option)}
            type="button"
            disabled={readOnly}
            aria-pressed={value === option}
            onClick={() => onChange(option)}
            className={cn(
              'rounded-sm py-0.5 font-mono text-xs',
              value === option ? 'bg-background shadow-sm' : 'text-muted-foreground',
            )}
          >
            {String(option)}
          </button>
        ))}
      </div>
    ) : shape === 'number' ? (
      <NumberInput name={name} value={value} readOnly={readOnly} invalid={own.length > 0} onChange={onChange} />
    ) : (
      <TextLines
        aria-label={name}
        aria-invalid={own.length > 0}
        readOnly={readOnly}
        className="min-h-7 py-1 font-mono text-xs"
        value={typeof value === 'string' ? value : String(value ?? '')}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  return (
    <div className="grid min-w-0 gap-1" data-path={name}>
      {control}
      <IssueList issues={own} path={path} />
    </div>
  );
}

function NumberInput({
  name,
  value,
  readOnly,
  invalid,
  onChange,
}: {
  name: string;
  value: JsonValue;
  readOnly?: boolean;
  invalid: boolean;
  onChange: (value: JsonValue) => void;
}) {
  const [text, setText] = useState(String(value));
  // The number this input last handed on; one arriving otherwise came from elsewhere, such as an item removed before it
  const handed = useRef(value);
  useEffect(() => {
    if (value === handed.current) return;
    handed.current = value;
    setText(String(value));
  }, [value]);
  const parsed = parseInput({ type: 'REAL' }, text);
  useValidity(!('error' in parsed));
  return (
    <>
      <Input
        aria-label={name}
        aria-invalid={invalid || 'error' in parsed}
        inputMode="decimal"
        readOnly={readOnly}
        className="h-7 w-40 font-mono text-xs"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          const read = parseInput({ type: 'REAL' }, event.target.value);
          if ('value' in read) {
            handed.current = read.value;
            onChange(read.value);
          }
        }}
      />
      {'error' in parsed && <p className="text-xs text-destructive">{parsed.error}</p>}
    </>
  );
}

const choices: Array<{ name: string; text: string; value: JsonValue }> = [
  { name: 'text', text: 'text', value: '' },
  { name: 'a number', text: '123', value: 0 },
  { name: 'a boolean', text: 'true/false', value: false },
  { name: 'a map', text: '{ }', value: {} },
  { name: 'a list', text: '[ ]', value: [] },
];

function NullValue({ path, issues, readOnly, onMake }: ValueFieldProps & { onMake: (value: JsonValue) => void }) {
  const name = nameOf(path);
  return (
    <div className="grid gap-1" data-path={name}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-xs text-muted-foreground italic">null</span>
        {!readOnly &&
          choices.map((choice) => (
            <button
              key={choice.name}
              type="button"
              aria-label={`Make ${name} ${choice.name}`}
              className="rounded border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:text-foreground"
              onClick={() => onMake(choice.value)}
            >
              {choice.text}
            </button>
          ))}
      </div>
      <IssueList issues={issuesUnder(issues, path)} path={path} />
    </div>
  );
}

/** A JSON value the form cannot show field by field, edited as JSON in place */
function RawJson({ path, value, issues, readOnly, onChange }: ValueFieldProps) {
  const name = nameOf(path);
  const [error, setError] = useState<string>();
  useValidity(error === undefined);
  const under = issuesUnder(issues, path);
  return (
    <div className="grid min-w-0 gap-1" data-path={name}>
      {readOnly ? (
        <pre className="overflow-auto rounded-md border bg-muted/30 p-2 font-mono text-xs">
          {JSON.stringify(value, null, 2)}
        </pre>
      ) : (
        <JsonEditor
          label={name}
          initial={JSON.stringify(value, null, 2)}
          // Not by their paths in the row: the editor finds an issue by its path inside the value, after one segment
          issues={under.map((issue) => ({ ...issue, path: [name, ...(issue.path ?? []).slice(path.length)] }))}
          autoFocus={false}
          className="max-h-80 min-h-24"
          onChange={(text) => {
            const read = readJsonc(text);
            if ('error' in read) {
              setError(read.error);
              return;
            }
            setError(undefined);
            onChange(read.value as JsonValue);
          }}
        />
      )}
      {error && <p className="text-xs text-destructive">Not valid JSON: {error}</p>}
      <IssueList issues={under} path={path} />
    </div>
  );
}

/** A value for a new key of a map, shaped as the values it holds when they are all of one shape */
function newValueOf(map: Record<string, JsonValue>): JsonValue {
  const values = Object.values(map);
  const shapes = new Set(values.map(shapeOf));
  return shapes.size === 1 ? emptyLike(values[0]) : '';
}

/** A map or a list as a block of fields, which can also be edited as JSON */
function Block(props: ValueFieldProps & { shape: 'map' | 'list'; onReshape: () => void }) {
  const { path, value, issues, readOnly, leeway, onChange, shape } = props;
  // Not offered where the schema refuses it; where it is not known, it is offered and checked on save
  const canAdd = shape === 'list' || leeway?.[patternOf(path)]?.open !== false;
  const canRemove = (key: string | number) =>
    shape === 'list' || leeway?.[patternOf([...path, key])]?.optional !== false;
  const name = nameOf(path);
  const [asJson, setAsJson] = useState(false);
  // Not kept across a switch back from JSON: the fields read the shape of the value again
  const [version, setVersion] = useState(0);
  const [newKey, setNewKey] = useState<string>();

  // Not trusted to be the container the shape was read from: the value made from null arrives a render later
  const list = Array.isArray(value) ? value : [];
  const map = value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const entries: Array<[string | number, JsonValue]> =
    shape === 'list' ? list.map((item, index) => [index, item]) : Object.entries(map);
  const shown = new Set(entries.map(([key]) => String(key)));
  // Not by index: an item shifted into the place of one removed would take over that item's state, such as its JSON editor
  const ids = useRef<number[]>([]);
  const nextId = useRef(0);
  if (ids.current.length !== list.length) ids.current = list.map(() => nextId.current++);
  // Not only its own: an issue about a key it does not have, such as a required one, has no field to show it
  const blockIssues = issuesUnder(issues, path).filter(
    (issue) => issue.path!.length === path.length || !shown.has(segmentKey(issue.path![path.length])),
  );
  const change = (at: Path, next: JsonValue) => onChange(setIn(value, at, next));

  const toggle = (
    <Tooltip content={asJson ? `Edit ${name} as a form` : `Edit ${name} as JSON`}>
      <button
        type="button"
        aria-label={asJson ? `Edit ${name} as a form` : `Edit ${name} as JSON`}
        className="rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        onClick={() => {
          // Not the shape it was opened with: the JSON editor may have made a map a list, or a scalar
          if (asJson) {
            props.onReshape();
            setVersion(version + 1);
          }
          setAsJson(!asJson);
        }}
      >
        {asJson ? <ListTree className="size-3.5" /> : <Braces className="size-3.5" />}
      </button>
    </Tooltip>
  );

  return (
    <div className="relative grid min-w-0 gap-2 rounded-md border bg-muted/20 p-2 pr-7" data-path={name}>
      <div className="absolute top-1.5 right-1.5">{toggle}</div>
      {asJson ? (
        <RawJson {...props} />
      ) : (
        <div key={version} className="grid min-w-0 gap-2.5">
          {entries.length === 0 && (
            <span className="font-mono text-xs text-muted-foreground italic">{shape === 'list' ? '[ ]' : '{ }'}</span>
          )}
          {entries.map(([key, item]) => (
            <div key={shape === 'list' ? ids.current[key as number] : key} className="grid min-w-0 gap-1">
              <div className="flex min-h-4 items-center gap-1">
                <span className="font-mono text-[11px] text-muted-foreground">{key}</span>
                {!readOnly && canRemove(key) && (
                  <button
                    type="button"
                    aria-label={`Remove ${nameOf([...path, key])}`}
                    className="ml-auto text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      if (shape === 'list') ids.current = ids.current.filter((_, index) => index !== key);
                      onChange(removeIn(value, [key]));
                    }}
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
              <ValueField
                path={[...path, key]}
                value={item}
                issues={issues}
                readOnly={readOnly}
                leeway={leeway}
                onChange={(next) => change([key], next)}
              />
            </div>
          ))}
          {!readOnly &&
            canAdd &&
            (newKey !== undefined ? (
              <Input
                autoFocus
                aria-label={`New key in ${name}`}
                placeholder="key, then Enter"
                className="h-7 font-mono text-xs"
                value={newKey}
                onChange={(event) => setNewKey(event.target.value)}
                onBlur={() => setNewKey(undefined)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setNewKey(undefined);
                  if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
                  event.preventDefault();
                  const key = newKey.trim();
                  if (key !== '' && !shown.has(key)) onChange({ ...map, [key]: newValueOf(map) });
                  setNewKey(undefined);
                }}
              />
            ) : (
              <button
                type="button"
                aria-label={shape === 'list' ? `Add an item to ${name}` : `Add a key to ${name}`}
                className="flex items-center gap-1 justify-self-start text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() => {
                  if (shape !== 'list') return setNewKey('');
                  ids.current = [...ids.current, nextId.current++];
                  onChange([...list, emptyLike(list.at(-1))]);
                }}
              >
                <Plus className="size-3" /> {shape === 'list' ? 'item' : 'key'}
              </button>
            ))}
        </div>
      )}
      {!asJson && <IssueList issues={blockIssues} path={path} />}
    </div>
  );
}
