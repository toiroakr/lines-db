import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  AlertTriangle,
  CircleAlert,
  Database,
  FileCode,
  KeyRound,
  Menu,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Lock,
  Plus,
  RefreshCw,
  Save,
  Search,
  Sun,
  Table2,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { Tooltip, TooltipProvider } from '@/components/ui/tooltip';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CellEditor } from '@/components/cell-editor';
import { SchemaDialog } from '@/components/schema-viewer';
import { CopyPath } from '@/components/copy-path';
import { NewRecordDialog, RecordDrawer, type FieldModel } from '@/components/record-form';
import { tableNameOf } from '@/lib/hash';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  fetchRows,
  fetchTables,
  keyOf,
  saveChanges,
  toWriteError,
  type RowsResponse,
  type TablesResponse,
} from '@/lib/api';
import {
  addInsert,
  cellChange,
  countChanges,
  emptyPending,
  isDeleted,
  removeInsert,
  resetCell,
  resetField,
  revertCell,
  setCell,
  setInsertCell,
  setOrRevertCell,
  toBatch,
  toggleDelete,
  previewCell,
  markDeleted,
  type Batch,
  type Pending,
} from '@/lib/pending';
import { cellText, formatValue, isBoolean } from '@/lib/values';
import type { Column, Issue, JsonObject, JsonValue, Reference, TableInfo } from '@/lib/types';
import { cn } from '@/lib/utils';
import { fieldIssues, issuePath } from '@/lib/check';
import { eventsUrl } from '@/lib/session';
import { applyTheme, nextTheme, readTheme } from '@/lib/theme';

type Notice = { kind: 'error'; title: string; issues?: Issue[] } | { kind: 'success'; title: string };
type Editing = { row: 'existing'; key: JsonValue; column: string } | { row: 'new'; id: string; column: string };
/** The row the form shows: a row of the file by its key, or a new row by its id */
type OpenRow = { row: 'existing'; key: JsonValue } | { row: 'new'; id: string };
/** A row of another table to open once its rows are read: the one whose column holds the value */
type Opening = { table: string; column: string; value: JsonValue };

const tableFromHash = () => tableNameOf(location.hash);

export function App() {
  const [meta, setMeta] = useState<TablesResponse>();
  const [current, setCurrent] = useState(tableFromHash);
  const [data, setData] = useState<RowsResponse>();
  const [pending, setPending] = useState<Pending>(emptyPending);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Editing>();
  const [filter, setFilter] = useState('');
  const [schemaShown, setSchemaShown] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [openRow, setOpenRow] = useState<OpenRow>();
  const [adding, setAdding] = useState(false);
  const [formShown, setFormShown] = useState(readFormShown);
  const showForm = (shown: boolean) => {
    setFormShown(shown);
    writeFormShown(shown);
  };
  const [opening, setOpening] = useState<Opening>();
  const toggleSidebar = () => {
    setSidebarCollapsed(!sidebarCollapsed);
    writeSidebarCollapsed(!sidebarCollapsed);
  };
  const [tableFilter, setTableFilter] = useState('');
  const [notice, setNotice] = useState<Notice>();
  const [filesChanged, setFilesChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const generation = useRef(0);

  const table = meta?.tables.find((candidate) => candidate.name === current) ?? meta?.tables[0];
  const changeCount = countChanges(pending);
  const dirty = changeCount > 0;

  const stateRef = useRef({ dirty, editing, current, tableName: table?.name });
  stateRef.current = { dirty, editing, current, tableName: table?.name };

  const load = useCallback(async (name?: string) => {
    // Not trusting the order responses arrive in: a slower, older load must not overwrite a newer one
    const id = ++generation.current;
    try {
      const tables = await fetchTables();
      const target = tables.tables.find((candidate) => candidate.name === name) ?? tables.tables[0];
      const rows = target ? await fetchRows(target.name) : undefined;
      if (id !== generation.current) return;
      // Not installed under an edit begun while the rows were read: it would land on rows the user never saw
      if (stateRef.current.dirty || stateRef.current.editing) {
        setFilesChanged(true);
        return;
      }
      setMeta(tables);
      setData(rows);
      // Not kept across a load: a selected key may now name a row the user never saw
      setSelected(new Set());
      setFilesChanged(false);
    } catch (error) {
      if (id !== generation.current) return;
      setNotice({ kind: 'error', title: toWriteError(error).message });
    }
  }, []);

  useEffect(() => {
    void load(current);
  }, [current, load]);

  // Reloaded once nothing is being edited: rows that changed on disk meanwhile were left out until then
  useEffect(() => {
    if (filesChanged && !dirty && !editing) void load(current);
  }, [filesChanged, dirty, editing, current, load]);

  const selectRef = useRef<(name: string) => boolean>(() => false);
  useEffect(() => {
    const onHash = () => {
      if (!selectRef.current(tableFromHash())) {
        history.replaceState(null, '', `#${encodeURIComponent(stateRef.current.tableName ?? '')}`);
      }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const events = new EventSource(eventsUrl());
    let connectedBefore = false;
    const refresh = () => {
      if (stateRef.current.dirty || stateRef.current.editing) setFilesChanged(true);
      else void load(stateRef.current.current);
    };
    // Not only on 'changed': a change made while the stream was down sent no event
    events.addEventListener('open', () => {
      if (connectedBefore) refresh();
      connectedBefore = true;
    });
    events.addEventListener('changed', refresh);
    return () => events.close();
  }, [load]);

  /** Whether the table is now the one shown */
  const selectTable = (name: string): boolean => {
    if (name === table?.name) return true;
    if (dirty) {
      setNotice({
        kind: 'error',
        title: `Save or discard the ${changeCount} unsaved change(s) to ${table?.name} before opening ${name}`,
      });
      return false;
    }
    setPending(emptyPending());
    setData(undefined);
    setSelected(new Set());
    setEditing(undefined);
    setOpenRow(undefined);
    setFilter('');
    setNotice(undefined);
    location.hash = encodeURIComponent(name);
    setCurrent(name);
    return true;
  };
  selectRef.current = selectTable;

  const discard = () => {
    setPending(emptyPending());
    setEditing(undefined);
    setNotice(undefined);
  };

  const save = async () => {
    if (!table) return;
    setEditing(undefined);
    setSaving(true);
    try {
      const { stillFailing = [] } = await saveChanges(table.name, { ...toBatch(pending), revision: data?.revision });
      setPending(emptyPending());
      setSelected(new Set());
      setNotice(
        stillFailing.length > 0
          ? {
              kind: 'error',
              title: `Saved ${changeCount} change(s) to ${table.name}.jsonl, but ${stillFailing.length} edited row(s) still fail validation`,
              issues: stillFailing.flatMap(({ index, issues }) =>
                issues.map((issue) => ({ ...issue, message: `row ${index + 1}: ${issue.message}` })),
              ),
            }
          : { kind: 'success', title: `Saved ${changeCount} change(s) to ${table.name}.jsonl` },
      );
      await load(table.name);
    } catch (error) {
      const failure = toWriteError(error);
      const change = failure.change;
      const where = !change
        ? ''
        : change.key !== undefined
          ? table.invalidRows > 0
            ? ` — row ${Number(change.key) + 1}`
            : ` — ${change.kind} of ${table.primaryKey} ${JSON.stringify(change.key)}`
          : ` — new record #${change.index + 1}`;
      setNotice({
        kind: 'error',
        title: `${failure.message.split('\n')[0].replace(/:$/, '')}${where}`,
        issues: failure.issues,
      });
      if (failure.status === 409) {
        setPending(emptyPending());
        await load(table.name);
      }
    } finally {
      setSaving(false);
    }
  };

  // Not only the rows the filter shows: the field is to leave every line of the file
  const removeFieldEverywhere = (field: string) => {
    const keys = (data?.rows ?? []).flatMap((row, index) => (Object.hasOwn(row, field) ? [index] : []));
    setPending(resetField(pending, keys, field));
  };

  const deleteSelected = () => {
    let next = pending;
    for (const key of selected) next = markDeleted(next, JSON.parse(key) as JsonValue);
    setPending(next);
    setSelected(new Set());
  };

  const rows = useMemo(() => {
    const all =
      data?.rows.map((row, index) => ({
        row,
        index,
        defaulted: data.defaulted[index] ?? [],
        issues: data.issues?.[index] ?? [],
      })) ?? [];
    if (!filter) return all;
    const needle = filter.toLowerCase();
    return all.filter(({ row }) => JSON.stringify(row).toLowerCase().includes(needle));
  }, [data, filter]);

  const openReference = (reference: Reference, value: JsonValue) => {
    if (selectTable(reference.table)) {
      showForm(true);
      setOpening({ table: reference.table, column: reference.referencedColumn, value });
    }
  };

  // Not opened before the rows of that table are read: the row to open is found among them
  useEffect(() => {
    if (!opening || !data || table?.name !== opening.table) return;
    const value = JSON.stringify(opening.value);
    const index = data.rows.findIndex((row) => JSON.stringify(row[opening.column]) === value);
    if (index >= 0) setOpenRow({ row: 'existing', key: rowIdOf(table, data.rows[index], index) });
    else setNotice({ kind: 'error', title: `No row of ${opening.table} has ${opening.column} ${value}` });
    setOpening(undefined);
  }, [opening, data, table]);

  const formRow = table && data && openRow ? formRowOf(table, data, openRow) : undefined;
  // Closed once its row is gone, as after a reload or saving a new row: it would come back on a later row with that key
  useEffect(() => {
    if (openRow && data && !formRow) setOpenRow(undefined);
  }, [openRow, data, formRow]);

  function formRowOf(table: TableInfo, data: RowsResponse, open: OpenRow) {
    const referenceOf = (column: Column, value: JsonValue | undefined) => {
      const reference = table.references.find((candidate) => candidate.column === column.name);
      return reference && value !== undefined
        ? { reference, onOpenReference: () => openReference(reference, value) }
        : {};
    };
    if (open.row === 'new') {
      const insert = pending.inserts.find((candidate) => candidate.id === open.id);
      if (!insert) return undefined;
      const fields = table.columns.map((column): FieldModel => {
        const set = Object.hasOwn(insert.row, column.name);
        return {
          column,
          value: insert.row[column.name],
          state: set ? 'set' : 'unset',
          readOnly: false,
          issues: [],
          preview: (value) => ({ inserts: [{ ...insert.row, [column.name]: value }], updates: [], deletes: [] }),
          canUseDefault: set,
          canRevert: false,
          ...referenceOf(column, insert.row[column.name]),
          onChange: (value) => setPending((now) => setInsertCell(now, insert.id, column.name, value)),
          onUseDefault: () => setPending((now) => setInsertCell(now, insert.id, column.name, undefined)),
          onRevert: () => undefined,
        };
      });
      return { id: JSON.stringify(open), title: `${table.name} · new row`, fields, readOnlyReason: undefined };
    }
    const index = data.rows.findIndex(
      (row, at) => JSON.stringify(rowIdOf(table, row, at)) === JSON.stringify(open.key),
    );
    if (index < 0) return undefined;
    const row = data.rows[index];
    const key = open.key;
    const defaulted = data.defaulted[index] ?? [];
    const issues = data.issues?.[index] ?? [];
    const byIndex = table.invalidRows > 0;
    const writable = byIndex || (!table.readOnlyReason && table.primaryKey !== null);
    const deleted = writable && !byIndex && isDeleted(pending, key);
    const fields = table.columns.map((column): FieldModel => {
      const change = writable ? cellChange(pending, key, column.name) : undefined;
      const value = change?.kind === 'set' ? change.value : row[column.name];
      const isDefault = defaulted.includes(column.name);
      return {
        column,
        value,
        state: change?.kind === 'set' ? 'changed' : change?.kind === 'reset' ? 'reset' : isDefault ? 'default' : 'file',
        readOnly: !writable || deleted || Boolean(column.primaryKey),
        issues: change ? [] : fieldIssues(column.name, issues),
        preview: (next) => ({ ...previewCell(pending, key, column.name, next), revision: data.revision }),
        canUseDefault: byIndex ? Object.hasOwn(row, column.name) : !isDefault || change !== undefined,
        canRevert: change !== undefined,
        ...referenceOf(column, value),
        // Not kept as a change when typed back to what the file holds: the form changes a field a keystroke at a time
        onChange: (next) =>
          setPending((now) => setOrRevertCell(now, key, column.name, next, isDefault ? undefined : row[column.name])),
        onUseDefault: () => setPending((now) => resetCell(now, key, column.name)),
        onRevert: () => setPending((now) => revertCell(now, key, column.name)),
      };
    });
    const title =
      byIndex || !table.primaryKey
        ? `${table.name} · row ${index + 1}`
        : `${table.name} · ${table.primaryKey} ${formatValue(key)}`;
    const readOnlyReason =
      table.readOnlyReason ?? (deleted ? 'Marked to be deleted: undo the delete to change it' : undefined);
    return { id: JSON.stringify(open), title, fields, readOnlyReason };
  }

  const tables = (meta?.tables ?? []).filter((candidate) =>
    candidate.name.toLowerCase().includes(tableFilter.toLowerCase()),
  );

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full">
        {drawerOpen && (
          <div className="fixed inset-0 z-30 bg-black/50 md:hidden" aria-hidden onClick={() => setDrawerOpen(false)} />
        )}
        <aside
          className={cn(
            'fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r bg-sidebar transition-transform md:static md:w-60 md:translate-x-0 md:transition-none',
            // Not only moved off screen when closed: its controls would still take keyboard focus
            drawerOpen ? 'translate-x-0' : 'invisible -translate-x-full md:visible',
            sidebarCollapsed && 'md:hidden',
          )}
          onKeyDown={(event) => event.key === 'Escape' && setDrawerOpen(false)}
        >
          <div className="flex h-12 items-center gap-2 border-b px-4">
            <Database className="size-4 text-muted-foreground" />
            <span className="text-sm font-semibold tracking-tight">lines-db studio</span>
            <Tooltip content="Collapse the sidebar">
              <Button
                size="icon"
                variant="ghost"
                className="ml-auto hidden size-7 md:inline-flex"
                aria-label="Collapse the sidebar"
                onClick={toggleSidebar}
              >
                <PanelLeftClose className="size-4" />
              </Button>
            </Tooltip>
            <Button
              size="icon"
              variant="ghost"
              className="ml-auto size-7 md:hidden"
              aria-label="Close the table list"
              onClick={() => setDrawerOpen(false)}
            >
              <X className="size-4" />
            </Button>
          </div>
          <div className="p-2">
            <div className="relative">
              <Search className="absolute top-2 left-2.5 size-4 text-muted-foreground" />
              <Input
                className="h-8 pl-8"
                placeholder="Search tables"
                aria-label="Search tables"
                value={tableFilter}
                onChange={(event) => setTableFilter(event.target.value)}
              />
            </div>
          </div>
          <nav className="flex-1 overflow-y-auto overscroll-none px-2 pb-2">
            {tables.map((candidate) => (
              <button
                key={candidate.name}
                type="button"
                onClick={() => selectTable(candidate.name) && setDrawerOpen(false)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent',
                  candidate.name === table?.name &&
                    'bg-accent font-medium text-accent-foreground [&>svg:first-child]:text-primary',
                )}
              >
                <Table2 className="size-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate">{candidate.name}</span>
                {candidate.invalidRows > 0 && (
                  <Tooltip content={`${candidate.invalidRows} row(s) fail validation`}>
                    <AlertTriangle className="size-3.5 text-destructive" aria-label="Has rows that fail validation" />
                  </Tooltip>
                )}
                {candidate.readOnlyReason && <Lock className="size-3 text-muted-foreground" />}
                <span className="font-mono text-xs text-muted-foreground tabular-nums">{candidate.rowCount}</span>
              </button>
            ))}
          </nav>
          {meta && <CopyPath path={meta.dataDir} />}
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b px-2 py-2 sm:px-4">
            <Button
              size="icon"
              variant="ghost"
              className="size-7 md:hidden"
              aria-label="Open the table list"
              onClick={() => setDrawerOpen(true)}
            >
              <Menu className="size-4" />
            </Button>
            {sidebarCollapsed && (
              <Tooltip content="Expand the sidebar">
                <Button
                  size="icon"
                  variant="ghost"
                  className="hidden size-7 md:inline-flex"
                  aria-label="Expand the sidebar"
                  onClick={toggleSidebar}
                >
                  <PanelLeftOpen className="size-4" />
                </Button>
              </Tooltip>
            )}
            <h1 className="min-w-0 truncate text-sm font-semibold">{table?.name ?? 'No tables'}</h1>
            {table && (
              <Badge variant="outline">
                {rows.length} of {table.rowCount} rows
              </Badge>
            )}
            <div className="relative order-last w-full sm:order-none sm:ml-4 sm:w-64">
              <Search className="absolute top-2 left-2.5 size-4 text-muted-foreground" />
              <Input
                className="h-8 pl-8"
                placeholder="Filter rows"
                aria-label="Filter rows"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
            </div>
            <div className="ml-auto flex items-center gap-2">
              {table?.schemaFile && (
                <Button size="sm" variant="outline" aria-label="Schema" onClick={() => setSchemaShown(true)}>
                  <FileCode /> <span className="hidden sm:inline">Schema</span>
                </Button>
              )}
              {selected.size > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive"
                  onClick={deleteSelected}
                  disabled={saving}
                >
                  <Trash2 /> <span className="hidden sm:inline">Delete</span> {selected.size}
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={!table || Boolean(table.readOnlyReason) || table.invalidRows > 0 || saving}
                onClick={() => setAdding(true)}
                aria-label="Add record"
              >
                <Plus /> <span className="hidden sm:inline">Add record</span>
              </Button>
              <Tooltip content={dirty ? 'Save or discard the unsaved changes to reload' : 'Reload from the files'}>
                {/* Not the button as the trigger: a disabled button gets no pointer events, so its tooltip would not say why */}
                <span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    aria-label="Reload from the files"
                    onClick={() => {
                      setEditing(undefined);
                      void load(current);
                    }}
                    disabled={saving || dirty}
                  >
                    <RefreshCw className="size-4" />
                  </Button>
                </span>
              </Tooltip>
              <ThemeToggle />
              <Tooltip content={formShown ? 'Hide the row form' : 'Show the row form'}>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  aria-label={formShown ? 'Hide the row form' : 'Show the row form'}
                  aria-pressed={formShown}
                  onClick={() => showForm(!formShown)}
                >
                  {formShown ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
                </Button>
              </Tooltip>
            </div>
          </header>
          {table && (
            <NewRecordDialog
              table={table}
              open={adding}
              onClose={() => setAdding(false)}
              onAdd={(row) => {
                const id = `new-${Date.now()}`;
                setPending((now) => addInsert(now, id, row));
                setOpenRow({ row: 'new', id });
                setAdding(false);
              }}
            />
          )}
          {schemaShown && table?.schemaFile && (
            <SchemaDialog table={table.name} file={table.schemaFile} onClose={() => setSchemaShown(false)} />
          )}

          {dirty && (
            <div
              role="status"
              className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b bg-changed/60 px-2 py-2 text-sm shadow-[inset_0_-1px_0_var(--changed-foreground)] sm:px-4"
            >
              <span className="flex size-6 items-center justify-center rounded-full bg-changed-foreground font-mono text-xs font-semibold text-background tabular-nums">
                {changeCount}
              </span>
              <span>
                <span className="font-medium">
                  Unsaved change{changeCount === 1 ? '' : 's'} to {table?.name}
                </span>
                <span className="hidden text-muted-foreground sm:inline">
                  {' '}
                  — not written to {table?.name}.jsonl until you save
                </span>
              </span>
              <div className="ml-auto flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={discard} disabled={saving}>
                  <Undo2 /> Discard
                </Button>
                <Button
                  size="sm"
                  className="bg-success text-success-foreground hover:bg-success/90"
                  onClick={() => void save()}
                  disabled={saving}
                >
                  <Save /> Save {changeCount} change{changeCount === 1 ? '' : 's'}
                </Button>
              </div>
            </div>
          )}

          <div className="grid gap-2 px-2 empty:hidden sm:px-4 [&>*]:mt-3">
            {table && table.invalidRows > 0 && (
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertTitle>
                  {table.invalidRows} row{table.invalidRows === 1 ? '' : 's'} of {table.name} fail validation
                </AlertTitle>
                <AlertDescription>
                  <p>
                    The table is shown as {table.name}.jsonl holds it. Fix the marked cells and save; adding and
                    deleting rows is off until every row passes.
                  </p>
                </AlertDescription>
              </Alert>
            )}
            {meta && meta.problems.length > 0 && meta.tables.every((candidate) => candidate.invalidRows === 0) && (
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertTitle>Some rows failed validation</AlertTitle>
                <AlertDescription>
                  <ul className="list-inside list-disc font-mono text-xs">
                    {meta.problems.map((problem) => (
                      <li key={problem}>{problem}</li>
                    ))}
                  </ul>
                  <p>Fix them in the files; the studio reloads on its own.</p>
                </AlertDescription>
              </Alert>
            )}
            {table?.readOnlyReason && (
              <Alert variant="warning">
                <Lock />
                <AlertTitle>Read-only</AlertTitle>
                <AlertDescription>{table.readOnlyReason}</AlertDescription>
              </Alert>
            )}
            {filesChanged && (
              <Alert variant="warning">
                <RefreshCw />
                <AlertTitle>The files changed on disk</AlertTitle>
                <AlertDescription>
                  <p>Discard your unsaved changes to see the current rows, or save them if they still apply.</p>
                </AlertDescription>
              </Alert>
            )}
            {notice && (
              <Alert variant={notice.kind === 'error' ? 'destructive' : 'default'}>
                {notice.kind === 'error' ? <AlertTriangle /> : <Save />}
                <AlertTitle className="flex items-start justify-between gap-2">
                  {notice.title}
                  <button type="button" onClick={() => setNotice(undefined)} aria-label="Dismiss">
                    <X className="size-4 opacity-60" />
                  </button>
                </AlertTitle>
                {notice.kind === 'error' && notice.issues && (
                  <AlertDescription>
                    <ul className="list-inside list-disc font-mono text-xs">
                      {notice.issues.map((issue, index) => (
                        <li key={index}>
                          {issuePath(issue)}: {issue.message}
                        </li>
                      ))}
                    </ul>
                  </AlertDescription>
                )}
              </Alert>
            )}
          </div>

          {table && (
            <Grid
              table={table}
              rows={rows}
              pending={pending}
              setPending={setPending}
              selected={selected}
              setSelected={setSelected}
              editing={editing}
              setEditing={setEditing}
              saving={saving}
              revision={data?.revision}
              onRemoveField={removeFieldEverywhere}
              openRow={formShown ? openRow : undefined}
              formShown={formShown}
              onOpenRow={setOpenRow}
              onShowRow={(row) => {
                setEditing(undefined);
                setOpenRow(row);
                showForm(true);
              }}
            />
          )}
        </main>
        {table && formShown && <RecordDrawer table={table.name} row={formRow} onClose={() => showForm(false)} />}
      </div>
    </TooltipProvider>
  );
}

interface GridProps {
  table: TableInfo;
  rows: Array<{ row: JsonObject; index: number; defaulted: string[]; issues: Issue[] }>;
  pending: Pending;
  setPending: (pending: Pending) => void;
  selected: Set<string>;
  setSelected: (selected: Set<string>) => void;
  editing: Editing | undefined;
  setEditing: (editing: Editing | undefined) => void;
  /** Locks the grid: a change made now would be cleared with the ones being saved, without being saved */
  saving: boolean;
  revision?: string;
  /** Removes a field from every row of the table, not only the ones shown */
  onRemoveField: (field: string) => void;
  openRow: OpenRow | undefined;
  /** Whether the form is shown: a click then picks the row it shows, and a double click edits the cell */
  formShown: boolean;
  onOpenRow: (row: OpenRow) => void;
  /** Shows the form with the row in it, from a double click while the form is hidden */
  onShowRow: (row: OpenRow) => void;
}

function Grid({
  table,
  rows,
  pending,
  setPending,
  selected,
  setSelected,
  editing,
  setEditing,
  saving,
  revision,
  onRemoveField,
  openRow,
  formShown: formOpen,
  onOpenRow,
  onShowRow,
}: GridProps) {
  const isOpen = (row: OpenRow) => JSON.stringify(row) === JSON.stringify(openRow);
  const primaryKey = table.primaryKey;
  // Not found by primary key in a table with failing rows: the failing field may be that key
  const byIndex = table.invalidRows > 0;
  const writable = byIndex || (!table.readOnlyReason && primaryKey !== null);
  const selectable = writable && !byIndex;
  const keyOfRow = (row: JsonObject, index: number): JsonValue =>
    byIndex ? index : primaryKey ? keyOf(row, primaryKey) : null;
  const keys = rows.map(({ row, index }) => JSON.stringify(keyOfRow(row, index)));
  const allSelected = keys.length > 0 && keys.every((key) => selected.has(key));

  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(keys));
  const toggleRow = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelected(next);
  };

  return (
    <div
      className={cn('mt-3 min-h-0 flex-1 overflow-auto overscroll-none border-t', saving && 'opacity-60')}
      inert={saving}
    >
      <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-10 bg-header">
          <tr>
            {selectable && (
              <th className={cn('w-10 border-b px-3 py-2', LEAD_HEAD)}>
                <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all rows" />
              </th>
            )}
            {byIndex && <th className={cn('w-10 border-b px-3 py-2', LEAD_HEAD)} aria-label="Validation" />}
            {table.columns.map((column) => (
              <th
                key={column.name}
                className="border-b border-l bg-header px-3 py-2 text-left font-medium first:border-l-0"
              >
                <div className="flex items-center gap-1.5 whitespace-nowrap">
                  {column.primaryKey && <KeyRound className="size-3.5 text-amber-500" />}
                  <span className="font-mono text-xs">{column.name}</span>
                  <span className="text-[10px] font-normal text-muted-foreground uppercase">
                    {isBoolean(column) ? 'boolean' : column.type.toLowerCase()}
                  </span>
                  {column.unknown && (
                    <Tooltip content="The schema refuses this key; a row can only have it removed">
                      <Badge variant="outline" className="border-destructive/50 font-sans text-destructive">
                        not in schema
                      </Badge>
                    </Tooltip>
                  )}
                  {column.unknown && (
                    <Tooltip content={`Remove ${column.name} from every row`}>
                      <button
                        type="button"
                        className="rounded-sm p-0.5 text-destructive hover:bg-destructive/10"
                        aria-label={`Remove ${column.name} from every row`}
                        onClick={() => onRemoveField(column.name)}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </Tooltip>
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pending.inserts.map((insert) => (
            <tr
              key={insert.id}
              className={cn('bg-added/40', isOpen({ row: 'new', id: insert.id }) && 'bg-accent')}
              style={tintOf(isOpen({ row: 'new', id: insert.id }) ? 'var(--accent)' : mix('--added', 40))}
              onClick={formOpen ? () => onOpenRow({ row: 'new', id: insert.id }) : undefined}
              onDoubleClick={formOpen ? undefined : () => onShowRow({ row: 'new', id: insert.id })}
            >
              <td data-lead className={cn('border-b px-3 py-1.5', LEAD)}>
                <Tooltip content="Remove this new row">
                  <button
                    type="button"
                    onClick={() => setPending(removeInsert(pending, insert.id))}
                    aria-label="Remove new row"
                  >
                    <X className="size-4 text-muted-foreground" />
                  </button>
                </Tooltip>
              </td>
              {table.columns.map((column) => (
                <Cell
                  key={column.name}
                  column={column}
                  table={table.name}
                  value={insert.row[column.name]}
                  preview={(value) => ({
                    inserts: [{ ...insert.row, [column.name]: value }],
                    updates: [],
                    deletes: [],
                  })}
                  state={Object.hasOwn(insert.row, column.name) ? 'set' : 'unset'}
                  formOpen={formOpen}
                  isEditing={editing?.row === 'new' && editing.id === insert.id && editing.column === column.name}
                  onOpen={() => setEditing({ row: 'new', id: insert.id, column: column.name })}
                  onClose={() => setEditing(undefined)}
                  canUseDefault
                  canRevert={false}
                  onApply={(value) => {
                    setPending(setInsertCell(pending, insert.id, column.name, value));
                    setEditing(undefined);
                  }}
                  onUseDefault={() => {
                    setPending(setInsertCell(pending, insert.id, column.name, undefined));
                    setEditing(undefined);
                  }}
                  onRevert={() => undefined}
                />
              ))}
            </tr>
          ))}
          {rows.map(({ row, index: rowIndex, defaulted, issues }, index) => {
            const key = keyOfRow(row, rowIndex);
            const rowKey = keys[index];
            const deleted = selectable && isDeleted(pending, key);
            const open: OpenRow = { row: 'existing', key: rowIdOf(table, row, rowIndex) };
            return (
              <tr
                key={rowKey + index}
                className={cn(
                  'group',
                  // Not the lead cell: it covers the cells that scroll under it, which would show through
                  deleted && 'bg-removed/50 line-through [&>td:not([data-lead])]:opacity-70',
                  issues.length > 0 && 'bg-destructive/10',
                  isOpen(open) && 'bg-accent',
                )}
                onClick={formOpen ? () => onOpenRow(open) : undefined}
                onDoubleClick={formOpen ? undefined : () => onShowRow(open)}
                style={tintOf(
                  isOpen(open)
                    ? 'var(--accent)'
                    : issues.length > 0
                      ? mix('--destructive', 10)
                      : deleted
                        ? mix('--removed', 50)
                        : undefined,
                )}
              >
                {byIndex && (
                  <td data-lead className={cn('border-b px-3 py-1.5', LEAD)}>
                    {issues.length > 0 && (
                      <Tooltip
                        content={
                          <ul className="grid gap-0.5 font-mono text-xs">
                            {issues.map((issue, at) => (
                              <li key={at}>
                                {issuePath(issue)}: {issue.message}
                              </li>
                            ))}
                          </ul>
                        }
                      >
                        <button
                          type="button"
                          className="flex rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={`Row ${rowIndex + 1} fails validation: ${describeIssues(issues)}`}
                        >
                          <CircleAlert className="size-4 text-destructive" aria-hidden />
                        </button>
                      </Tooltip>
                    )}
                  </td>
                )}
                {selectable && (
                  <td data-lead className={cn('border-b px-3 py-1.5', LEAD)}>
                    {deleted ? (
                      <Tooltip content="Keep this row">
                        <button
                          type="button"
                          onClick={() => setPending(toggleDelete(pending, key))}
                          aria-label="Undo delete"
                        >
                          <Undo2 className="size-4 text-muted-foreground" />
                        </button>
                      </Tooltip>
                    ) : (
                      <Checkbox
                        checked={selected.has(rowKey)}
                        onCheckedChange={() => toggleRow(rowKey)}
                        aria-label="Select row"
                      />
                    )}
                  </td>
                )}
                {table.columns.map((column) => {
                  const change = writable ? cellChange(pending, key, column.name) : undefined;
                  const value = change?.kind === 'set' ? change.value : row[column.name];
                  return (
                    <Cell
                      key={column.name}
                      column={column}
                      table={table.name}
                      value={value}
                      issues={change ? [] : fieldIssues(column.name, issues)}
                      preview={(next) => ({ ...previewCell(pending, key, column.name, next), revision })}
                      state={
                        change?.kind === 'set'
                          ? 'changed'
                          : change?.kind === 'reset'
                            ? 'reset'
                            : defaulted.includes(column.name)
                              ? 'default'
                              : 'file'
                      }
                      readOnly={!writable || deleted || Boolean(column.primaryKey)}
                      formOpen={formOpen}
                      isEditing={
                        editing?.row === 'existing' &&
                        JSON.stringify(editing.key) === rowKey &&
                        editing.column === column.name
                      }
                      onOpen={() => setEditing({ row: 'existing', key, column: column.name })}
                      onClose={() => setEditing(undefined)}
                      canUseDefault={
                        byIndex
                          ? Object.hasOwn(row, column.name)
                          : !defaulted.includes(column.name) || change !== undefined
                      }
                      canRevert={change !== undefined}
                      onApply={(next) => {
                        setPending(setCell(pending, key, column.name, next));
                        setEditing(undefined);
                      }}
                      onUseDefault={() => {
                        setPending(resetCell(pending, key, column.name));
                        setEditing(undefined);
                      }}
                      onRevert={() => {
                        setPending(revertCell(pending, key, column.name));
                        setEditing(undefined);
                      }}
                    />
                  );
                })}
              </tr>
            );
          })}
          {rows.length === 0 && pending.inserts.length === 0 && (
            <tr>
              <td colSpan={table.columns.length + 1} className="px-4 py-12 text-center text-sm text-muted-foreground">
                No rows
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

type CellState = 'file' | 'default' | 'changed' | 'reset' | 'set' | 'unset';

interface CellProps {
  table: string;
  column: Column;
  value: JsonValue | undefined;
  /** What makes the value fail validation, marked on the cell */
  issues?: Issue[];
  preview: (value: JsonValue) => Batch;
  state: CellState;
  readOnly?: boolean;
  /** Whether a row is open in the form: a click then picks the row, and a double click edits the cell */
  formOpen?: boolean;
  isEditing: boolean;
  onOpen: () => void;
  onClose: () => void;
  canUseDefault: boolean;
  canRevert: boolean;
  onApply: (value: JsonValue) => void;
  onUseDefault: () => void;
  onRevert: () => void;
}

function Cell({
  column,
  value,
  issues = [],
  state,
  readOnly,
  formOpen,
  isEditing,
  onOpen,
  onClose,
  ...editor
}: CellProps) {
  const json = column.type === 'JSON' && !column.unknown;
  const content =
    state === 'reset' ? (
      <span className="text-muted-foreground italic line-through">removed</span>
    ) : state === 'unset' ? (
      <span className="text-muted-foreground italic">default</span>
    ) : value === null ? (
      <span className="text-muted-foreground italic">null</span>
    ) : (
      <span className={cn(state === 'default' && 'text-muted-foreground')}>{cellText(value)}</span>
    );

  const contents = (
    <>
      <span className="truncate">{content}</span>
      {issues.length > 0 && (
        <Tooltip
          content={
            <ul className="grid gap-0.5 font-mono text-xs">
              {issues.map((issue, at) => (
                <li key={at}>
                  {issuePath(issue)}: {issue.message}
                </li>
              ))}
            </ul>
          }
        >
          <CircleAlert className="size-3.5 shrink-0 text-destructive" aria-hidden />
        </Tooltip>
      )}
      {state === 'default' && (
        <Tooltip content="Filled in by the schema; not written in the file">
          <Badge variant="outline" className="font-sans">
            default
          </Badge>
        </Tooltip>
      )}
    </>
  );
  const cell = (
    <td
      className={cn(
        'max-w-80 border-b border-l p-0 font-mono text-xs whitespace-nowrap first:border-l-0',
        !readOnly && 'hover:bg-accent/60',
        (state === 'changed' || state === 'reset') && 'bg-changed/60 shadow-[inset_2px_0_0_var(--changed-foreground)]',
        issues.length > 0 && 'bg-destructive/15 shadow-[inset_0_0_0_1px_var(--destructive)]',
        isEditing && 'ring-2 ring-ring ring-inset',
      )}
    >
      {readOnly ? (
        <div className="flex items-center gap-1.5 px-3 py-1.5">{contents}</div>
      ) : (
        // Not the cell itself: a table cell given a button role would no longer read as part of its row
        <button
          type="button"
          className="flex w-full cursor-pointer items-center gap-1.5 px-3 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          // Not left to the double click alone while the form is shown: a key press makes a click of no count, and no double click
          onClick={(event) => (!formOpen || event.detail === 0) && onOpen()}
          onDoubleClick={formOpen ? onOpen : undefined}
          aria-label={
            issues.length > 0
              ? `Edit ${column.name}, which fails validation: ${describeIssues(issues)}`
              : `Edit ${column.name}`
          }
          aria-haspopup="dialog"
        >
          {contents}
        </button>
      )}
    </td>
  );
  const editorOf = <CellEditor column={column} value={value} initialIssues={issues} onClose={onClose} {...editor} />;

  if (json) {
    return (
      <>
        {cell}
        <Dialog open={isEditing} onOpenChange={(open) => (open ? onOpen() : onClose())}>
          <DialogContent>
            <DialogTitle className="sr-only">Edit {column.name}</DialogTitle>
            <DialogDescription className="sr-only">Edit the JSON value of {column.name}</DialogDescription>
            {editorOf}
          </DialogContent>
        </Dialog>
      </>
    );
  }
  return (
    <Popover open={isEditing} onOpenChange={(open) => (open ? onOpen() : onClose())}>
      <PopoverAnchor asChild>{cell}</PopoverAnchor>
      <PopoverContent onOpenAutoFocus={(event) => event.preventDefault()}>{editorOf}</PopoverContent>
    </Popover>
  );
}

/**
 * What tells a row from the others while it is open in the form: its key, or its index in a table
 * without one or with failing rows, as the grid edits those by index
 */
function rowIdOf(table: TableInfo, row: JsonObject, index: number): JsonValue {
  return table.primaryKey && table.invalidRows === 0 ? keyOf(row, table.primaryKey) : index;
}

/**
 * The cell at the head of a row, kept in view as the grid scrolls sideways. It is opaque, as the cells
 * scroll under it, and takes the tint of its row through a shadow over its background: the row's own
 * background is translucent, and would let them show through
 */
const LEAD = 'sticky left-0 z-[1] border-r bg-background shadow-[inset_0_0_0_9999px_var(--row-tint,transparent)]';
const LEAD_HEAD = 'sticky left-0 z-[2] border-r bg-header';
const mix = (color: string, percent: number) => `color-mix(in oklab, var(${color}) ${percent}%, transparent)`;
const tintOf = (tint: string | undefined) => (tint ? ({ '--row-tint': tint } as CSSProperties) : undefined);

/** The issues as one sentence, for a control whose tooltip lists them */
function describeIssues(issues: Issue[]): string {
  return issues.map((issue) => `${issuePath(issue)}: ${issue.message}`).join('; ');
}

const SIDEBAR_KEY = 'lines-db-studio:sidebar-collapsed';

function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeSidebarCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_KEY, String(collapsed));
  } catch {
    // Not kept for the next visit, which then starts expanded
  }
}

const FORM_KEY = 'lines-db-studio:form-shown';

/** Shown at first on a screen wide enough to keep the grid beside it */
function readFormShown(): boolean {
  try {
    const stored = localStorage.getItem(FORM_KEY);
    if (stored !== null) return stored === 'true';
  } catch {
    // Not remembered, so decided by the width of the screen
  }
  return typeof matchMedia === 'function' && matchMedia('(min-width: 1024px)').matches;
}

function writeFormShown(shown: boolean): void {
  try {
    localStorage.setItem(FORM_KEY, String(shown));
  } catch {
    // Not kept for the next visit, which then decides by the width of the screen
  }
}

/** Switches the colors from those of the system to light, to dark, and back */
function ThemeToggle() {
  const [theme, setTheme] = useState(readTheme);
  const label = `Theme: ${theme === 'system' ? 'as the system' : theme}`;
  return (
    <Tooltip content={label}>
      <Button
        size="icon"
        variant="ghost"
        className="size-7"
        aria-label={label}
        onClick={() => {
          const next = nextTheme(theme);
          applyTheme(next);
          setTheme(next);
        }}
      >
        {theme === 'light' ? (
          <Sun className="size-4" />
        ) : theme === 'dark' ? (
          <Moon className="size-4" />
        ) : (
          <Monitor className="size-4" />
        )}
      </Button>
    </Tooltip>
  );
}
