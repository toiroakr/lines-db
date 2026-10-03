import { randomBytes, timingSafeEqual } from 'node:crypto';
import { watch } from 'node:fs';
import { chmod, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { basename, extname, join, relative, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LinesDB } from '../database.js';
import { ErrorFormatter } from '../error-formatter.js';
import { unwrap } from '../result.js';
import { JsonlReader, hashJsonlContent } from '../jsonl-reader.js';
import { findSchemaFile } from '../schema-extensions.js';
import { readDeclaredColumns } from './declared-columns.js';
import { replaceRows } from './file-rows.js';
import type {
  ColumnDefinition,
  ForeignKeyDefinition,
  JsonlConflictError,
  JsonlParseError,
  JsonObject,
  JsonValue,
  StandardSchemaIssue,
  TableDefs,
  ValidationError,
  ValidationErrorDetail,
  WriteFilledValues,
} from '../types.js';

export interface StudioServerOptions {
  dataDir: string;
  /** Directory holding the built page. Defaults to the one shipped with the package */
  uiDir?: string;
  /** Which values the schema fills in a save writes into the file. Defaults to 'primaryKey' */
  writeFilledValues?: WriteFilledValues;
  host?: string;
  port?: number;
}

export interface StudioServer {
  url: string;
  /** The token every API request presents, generated at start-up and handed to the page */
  token: string;
  close(): Promise<void>;
}

interface Snapshot {
  db: LinesDB<TableDefs>;
  /** Rows that failed validation on load, whose table is therefore left out */
  problems: string[];
  /**
   * The tables left out because rows failed validation, edited in their file instead: the database
   * holds only rows that passed, so a failing row cannot be fixed through it
   */
  invalid: Map<string, InvalidTable>;
}

interface InvalidTable {
  file: string;
  /** The issues of each failing row, by its index among the rows of the file */
  issues: Map<number, StandardSchemaIssue[]>;
}

export async function startStudioServer(options: StudioServerOptions): Promise<StudioServer> {
  const { dataDir } = options;
  const host = options.host ?? '127.0.0.1';
  const uiDir = options.uiDir ?? (await shippedUiDir());
  const token = randomBytes(24).toString('base64url');
  const writeFilledValues = options.writeFilledValues ?? 'primaryKey';
  const load = () => loadSnapshot(dataDir, writeFilledValues);
  let snapshot = await load();

  let queue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(fn: () => Promise<T>): Promise<T> => {
    const result = queue.then(fn);
    queue = result.catch(() => {});
    return result;
  };

  /** Reload the tables when a JSONL file no longer holds what they were read from; true if it did */
  const reloadUnlocked = async (): Promise<void> => {
    const previous = snapshot;
    snapshot = await load();
    await previous.db.close();
  };
  const reloadIfChangedUnlocked = async (): Promise<boolean> => {
    if (!unwrap(await snapshot.db.hasExternalChanges())) return false;
    await reloadUnlocked();
    notifyChanged();
    return true;
  };

  // Not found again on each listing: what the schema takes is the same until the files are read again,
  // and finding it reads the table's file for a sample row
  type Columns = ReturnType<typeof withLeeway<ColumnDefinition>>;
  const leeway = new WeakMap<Snapshot, Map<string, Columns>>();
  const loadedColumnsOf = async (current: Snapshot, name: string): Promise<Columns> => {
    const byTable = leeway.get(current) ?? new Map<string, Columns>();
    leeway.set(current, byTable);
    if (!byTable.has(name)) {
      const [sample] = unwrap(await current.db.findWithDefaults(name));
      const columns = current.db.getSchema(name)?.columns ?? [];
      byTable.set(name, withLeeway(current.db, name, sample?.row as JsonObject | undefined, columns));
    }
    return byTable.get(name)!;
  };
  // Not read on each listing: a table with no foreign keys in the database has them read from its schema
  // file, imported anew each time, and they stay the same until the files are read again
  type References = Awaited<ReturnType<typeof referencesOf>>;
  const references = new WeakMap<Snapshot, Map<string, References>>();
  const referencesFor = async (current: Snapshot, name: string): Promise<References> => {
    const byTable = references.get(current) ?? new Map<string, References>();
    references.set(current, byTable);
    if (!byTable.has(name)) byTable.set(name, await referencesOf(current.db, dataDir, name));
    return byTable.get(name)!;
  };
  // Not found on each listing either for a table whose rows fail validation: finding it validates rows
  const invalidColumns = new WeakMap<Snapshot, Map<string, { columns: Columns; rowCount: number }>>();
  const invalidColumnsOf = async (current: Snapshot, name: string): Promise<{ columns: Columns; rowCount: number }> => {
    const byTable = invalidColumns.get(current) ?? new Map<string, { columns: Columns; rowCount: number }>();
    invalidColumns.set(current, byTable);
    if (!byTable.has(name)) {
      const { file, issues } = current.invalid.get(name)!;
      const rows = unwrap(await JsonlReader.read(file));
      const unknown = unknownFields(current.db, name, rows, issues);
      const inferred = unwrap(JsonlReader.inferSchema(name, rows)).columns;
      // A field no row holds - a required one every row lacks - has no column to fill it in otherwise;
      // its type is unknown, so it is edited as JSON, which takes any value
      const missing = [...new Set([...issues.values()].flat().map(fieldOf))].filter(
        (field): field is string => field !== undefined && !inferred.some((column) => column.name === field),
      );
      const columns = withLeeway(current.db, name, rows.find((_, index) => !issues.has(index)) ?? rows[0], [
        ...inferred,
        ...missing.map((field) => ({ name: field, type: 'JSON' as const, notNull: false, primaryKey: false })),
      ]).map((column) => ({ ...column, primaryKey: false, ...(unknown.has(column.name) ? { unknown: true } : {}) }));
      byTable.set(name, { columns, rowCount: rows.length });
    }
    return byTable.get(name)!;
  };

  const eventClients = new Set<ServerResponse>();
  const notifyChanged = (): void => {
    for (const client of eventClients) client.write('event: changed\ndata: {}\n\n');
  };

  let watchTimer: NodeJS.Timeout | undefined;
  // Not checking on each event: an editor saving a file fires several (a temporary file, then a rename)
  const watcher = watch(dataDir, () => {
    clearTimeout(watchTimer);
    watchTimer = setTimeout(() => {
      // Not reporting the error here: the page asks again on 'changed' and shows the error it gets
      reloadIfChanged().catch(notifyChanged);
    }, 100);
  });
  // Not letting the error end the process: Reload still loads the current files without the watcher
  watcher.on('error', (error) => {
    console.warn(`Live reload is off, as the data directory cannot be watched: ${errorMessage(error)}`);
    watcher.close();
  });
  const reloadIfChanged = (): Promise<boolean> => serialize(reloadIfChangedUnlocked);

  const server = createServer((req, res) => {
    handle(req, res).catch((error) =>
      sendJson(res, error instanceof BadRequestError ? 400 : 500, { message: errorMessage(error) }),
    );
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const { port } = server.address() as AddressInfo;
    const allowedHosts = new Set([`${host}:${port}`, `127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
    if (!allowedHosts.has(req.headers.host ?? '')) {
      sendJson(res, 403, { message: 'Requests must be addressed to the local studio server' });
      return;
    }

    const url = new URL(req.url ?? '/', 'http://localhost');

    // Not behind the token: the page has to load before it holds one. Another site cannot read the page,
    // so the token it carries keeps that site's requests out
    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
      await servePage(res, uiDir, url.pathname, token);
      return;
    }
    // Not taken from the query elsewhere: an event source cannot send headers, but a fetch can
    const presented = bearerToken(req) ?? (url.pathname === '/api/events' ? url.searchParams.get('token') : null) ?? '';
    if (!sameToken(presented, token)) {
      sendJson(res, 401, {
        message: 'This page holds no token of this run of lines-db studio. Reload it to get one.',
      });
      return;
    }
    const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);

    if (req.method === 'GET' && url.pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
      res.write(': connected\n\n');
      eventClients.add(res);
      req.on('close', () => eventClients.delete(res));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/tables') {
      // Not left open to a reload between its awaits: one would close the database the listing reads
      const listing = await serialize(async () => {
        await reloadIfChangedUnlocked();
        const current = snapshot;
        // Not listed as loaded when rows failed a constraint on load: its passing rows are in the database,
        // but its rows are fixed in the file, by index
        const loadedTables = current.db.getTableNames().filter((name) => !current.invalid.has(name));
        const tables = [];
        for (const name of loadedTables) {
          const columns = await loadedColumnsOf(current, name);
          const primaryKey = columns.find((column) => column.primaryKey)?.name ?? null;
          const rowCount =
            unwrap(current.db.queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM "${name.replaceAll('"', '""')}"`))
              ?.n ?? 0;
          tables.push({
            name,
            columns,
            primaryKey,
            rowCount,
            invalidRows: 0,
            readOnlyReason: whyReadOnly(current.db, name),
            schemaFile: null as string | null,
            references: await referencesFor(current, name),
          });
        }
        for (const [name, { issues }] of current.invalid) {
          const { columns, rowCount } = await invalidColumnsOf(current, name);
          tables.push({
            name,
            columns,
            primaryKey: null,
            rowCount,
            invalidRows: issues.size,
            readOnlyReason: null,
            schemaFile: null,
            references: await referencesFor(current, name),
          });
        }
        for (const table of tables) {
          const schemaPath = await findSchemaFile(dataDir, table.name);
          table.schemaFile = schemaPath ? basename(schemaPath) : null;
        }
        tables.sort((a, b) => a.name.localeCompare(b.name));
        return { dataDir: resolvePath(dataDir), tables, problems: current.problems };
      });
      sendJson(res, 200, listing);
      return;
    }

    const [, , tableName, resource, encodedKey] = segments;
    if (segments[0] === 'api' && segments[1] === 'tables' && resource === 'schema' && segments.length === 4) {
      if (req.method !== 'GET') {
        sendJson(res, 405, { message: 'Method not allowed' });
        return;
      }
      await reloadIfChanged();
      // Not looked up for a name that is not a table: the name would otherwise reach the file system as is
      const known = Boolean(snapshot.db.getSchema(tableName)) || snapshot.invalid.has(tableName);
      const schemaPath = known ? await findSchemaFile(dataDir, tableName) : undefined;
      if (!schemaPath) {
        sendJson(res, 404, { message: `Table '${tableName}' has no schema file` });
        return;
      }
      const loaded = snapshot.invalid.has(tableName) ? undefined : snapshot.db.getSchema(tableName);
      const declared = loaded && (await readDeclaredColumns(schemaPath, dataDir));
      const flagsOf = (name: string) => {
        const column = loaded?.columns.find((candidate) => candidate.name === name);
        return { ...(column?.primaryKey ? { primaryKey: true } : {}), ...(column?.unique ? { unique: true } : {}) };
      };
      sendJson(res, 200, {
        file: basename(schemaPath),
        source: await readFile(schemaPath, 'utf-8'),
        definition: loaded
          ? {
              // Declared when the types of the schema can be read, as the columns the database holds are inferred
              // from the values of the rows: a field left out of every row is missing, and one in every row is not null
              columnsFrom: declared ? 'schema' : 'rows',
              columns: declared
                ? declared.map((column) => ({ ...column, ...flagsOf(column.name) }))
                : loaded.columns.map((column) => ({
                    name: column.name,
                    type: column.valueType ?? column.type,
                    ...(column.notNull ? { notNull: true } : {}),
                    ...flagsOf(column.name),
                  })),
              foreignKeys: loaded.declaredForeignKeys ?? [],
              indexes: loaded.indexes ?? [],
            }
          : null,
      });
      return;
    }
    const isRows = segments[0] === 'api' && segments[1] === 'tables' && resource === 'rows' && segments.length <= 5;
    const isChanges =
      segments[0] === 'api' &&
      segments[1] === 'tables' &&
      (resource === 'changes' || resource === 'check') &&
      segments.length === 4;
    if (!isRows && !isChanges) {
      sendJson(res, 404, { message: 'Not found' });
      return;
    }

    if (isRows && req.method === 'GET' && encodedKey === undefined) {
      await reloadIfChanged();
      const invalid = snapshot.invalid.get(tableName);
      if (invalid) {
        const { rows, contentHash } = unwrap(await JsonlReader.readSnapshot(invalid.file));
        const read = unwrap(rows);
        sendJson(res, 200, {
          rows: read,
          defaulted: read.map(() => []),
          issues: Object.fromEntries(invalid.issues),
          revision: contentHash,
        });
        return;
      }
      if (!snapshot.db.getSchema(tableName)) {
        sendJson(res, 404, { message: `Table '${tableName}' does not exist` });
        return;
      }
      const rows = unwrap(await snapshot.db.findWithDefaults(tableName));
      sendJson(res, 200, { rows: rows.map(({ row }) => row), defaulted: rows.map(({ defaulted }) => defaulted) });
      return;
    }

    const write = isChanges
      ? req.method === 'POST'
        ? resource === 'check'
          ? ({ kind: 'check' } as const)
          : ({ kind: 'batch' } as const)
        : undefined
      : writeOperation(req.method, encodedKey);
    if (!write) {
      sendJson(res, 405, { message: 'Method not allowed' });
      return;
    }
    const origin = req.headers.origin;
    if (origin !== undefined && !allowedHosts.has(origin.replace(/^http:\/\//, ''))) {
      sendJson(res, 403, { message: 'Writes are accepted from the studio page only' });
      return;
    }
    if (write.kind !== 'delete' && !isJsonMediaType(req.headers['content-type'])) {
      sendJson(res, 415, { message: 'Writes must be sent as application/json' });
      return;
    }
    let batch: ChangeBatch;
    if (write.kind === 'batch' || write.kind === 'check') {
      batch = changeBatch(await readJson(req));
    } else if (write.kind === 'delete') {
      batch = { inserts: [], updates: [], deletes: [write.key] };
    } else {
      const body = writeBody(await readJson(req));
      batch =
        write.kind === 'insert'
          ? { inserts: [body.row ?? {}], updates: [], deletes: [] }
          : {
              inserts: [],
              updates: [{ key: write.key, changes: body.changes ?? {}, resetToDefault: body.resetToDefault }],
              deletes: [],
            };
    }

    type Outcome = { status: number; body: unknown; changed?: boolean };
    /** Apply the updates to the rows of the file, and write them only once every edited row passes */
    const writeInvalidTable = async ({ file }: InvalidTable): Promise<Outcome> => {
      if (batch.inserts.length > 0 || batch.deletes.length > 0) {
        const message = 'Fix the rows that fail validation before adding or deleting rows of this table';
        return { status: 409, body: { message } };
      }
      const content = await readFile(file, 'utf8');
      // Not left to the watcher: once it reloads, the file it compares against is the changed one, while
      // the page still addresses rows by where they stood when it read them
      if (batch.revision !== hashJsonlContent(content)) {
        const message = `${relative(dataDir, file)} changed since its rows were read; reload the table to see them`;
        return { status: 409, body: { message } };
      }
      const rows = unwrap(await JsonlReader.read(file));
      const replaced = new Map<number, JsonObject>();
      for (const [index, { key, changes, resetToDefault }] of batch.updates.entries()) {
        // An earlier update of the same row in the batch is built on, as a transaction would apply it
        const base = typeof key === 'number' ? (replaced.get(key) ?? rows[key]) : undefined;
        if (!base)
          return { status: 400, body: { message: `No row ${JSON.stringify(key)} in ${relative(dataDir, file)}` } };
        const next: JsonObject = { ...base, ...changes };
        for (const field of resetToDefault ?? []) delete next[field];
        const validated = snapshot.db.validateRow(tableName, next);
        if (!validated.ok) {
          const change: FailedChange = { kind: 'update', index, key };
          const failure = { message: validated.error.message, issues: perKey(validated.error.issues), change };
          return write.kind === 'check'
            ? { status: 200, body: { ok: false, ...failure } }
            : { status: 400, body: failure };
        }
        replaced.set(key as number, next);
      }
      if (write.kind === 'check') return { status: 200, body: { ok: true } };
      // Not written over the file in place: a write that fails partway would leave it truncated
      const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
      try {
        await writeFile(temporary, replaceRows(content, replaced), 'utf8');
        // Not left to the umask: the file replaced would otherwise lose a mode such as 0600
        await chmod(temporary, (await stat(file)).mode & 0o7777);
        await rename(temporary, file);
      } catch (error) {
        await rm(temporary, { force: true });
        throw error;
      }
      await reloadUnlocked();
      // Not refused before writing: a foreign key is checked on load only, so the edited rows that still
      // fail are reported once the tables are loaded again
      const stillFailing = [...replaced.keys()]
        .map((index) => ({ index, issues: snapshot.invalid.get(tableName)?.issues.get(index) ?? [] }))
        .filter(({ issues }) => issues.length > 0);
      return { status: 200, body: { ok: true, ...(stillFailing.length > 0 ? { stillFailing } : {}) }, changed: true };
    };

    let reloaded = false;
    const outcome = await serialize(async (): Promise<Outcome> => {
      // Not left to the watcher: its event may not have fired yet, and a changed schema file is no
      // conflict a write-back detects, so the rows would be validated against the old schema
      const changedFiles = unwrap(await snapshot.db.findExternalChanges());
      if (changedFiles.length > 0) {
        await reloadUnlocked();
        reloaded = true;
        if (write.kind === 'check') changedFiles.length = 0;
        // Not saved over an outside edit of the edited table's own file: the change was made on rows
        // the page showed before that edit
        // A changed schema file of the edited table counts too: its primary key may name another column
        const ownFile = changedFiles.find(
          (file) =>
            resolvePath(file) === resolvePath(dataDir, `${tableName}.jsonl`) ||
            basename(file).startsWith(`${tableName}.schema.`),
        );
        if (ownFile) {
          const message = `${relative(dataDir, ownFile) || ownFile} changed on disk, so the tables were reloaded. Check the rows and try again.`;
          return { status: 409, body: { message }, changed: true };
        }
      }
      const { db } = snapshot;
      const invalid = snapshot.invalid.get(tableName);
      if (invalid) return writeInvalidTable(invalid);
      const schema = db.getSchema(tableName);
      if (!schema) return { status: 404, body: { message: `Table '${tableName}' does not exist` } };
      const primaryKey = schema.columns.find((column) => column.primaryKey)?.name;
      const reason = whyReadOnly(db, tableName);
      if (!primaryKey || reason) return { status: 409, body: { message: reason } };

      const result = await db.transaction((tx) => {
        const check = (written: { ok: boolean; error?: Error }, change: FailedChange) => {
          if (!written.ok) throw Object.assign(written.error!, { change });
        };
        batch.deletes.forEach((key, index) =>
          check(tx.delete(tableName, { [primaryKey]: key }), { kind: 'delete', index, key }),
        );
        batch.updates.forEach(({ key, changes, resetToDefault }, index) =>
          check(tx.update(tableName, changes, { [primaryKey]: key }, { resetToDefault }), {
            kind: 'update',
            index,
            key,
          }),
        );
        batch.inserts.forEach((row, index) => check(tx.insert(tableName, row), { kind: 'insert', index }));
        // Not committed when only checking: throwing rolls the transaction back before anything is written
        if (write.kind === 'check') throw DRY_RUN;
      });
      if (write.kind === 'check') {
        if (!result.ok && result.error === DRY_RUN) return { status: 200, body: { ok: true } };
        const failure = (result.ok ? {} : result.error) as Partial<ValidationError> & { change?: FailedChange };
        return {
          status: 200,
          body: {
            ok: false,
            message: failure.message,
            issues: perKey(failure.issues ?? []),
            ...(failure.change ? { change: failure.change } : {}),
          },
        };
      }
      if (!result.ok) {
        if (result.error.name === 'JsonlConflictError') {
          await reloadUnlocked();
          const { file } = result.error as JsonlConflictError;
          const message = `${relative(dataDir, file) || file} changed on disk, so the tables were reloaded. Check the rows and try again.`;
          return { status: 409, body: { message }, changed: true };
        }
        const { issues, change } = result.error as Partial<ValidationError> & { change?: FailedChange };
        return {
          status: 400,
          body: {
            message: result.error.message,
            ...(issues ? { issues: perKey(issues) } : {}),
            ...(change ? { change } : {}),
          },
        };
      }
      return { status: write.kind === 'insert' ? 201 : 200, body: { ok: true }, changed: true };
    });
    sendJson(res, outcome.status, outcome.body);
    // Not before the response: the page that saved would still be in its editor when the event arrives
    // Not only when the outcome says so: the watcher finds nothing left to reload once this did
    if (outcome.changed || reloaded) notifyChanged();
  }

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(options.port ?? 4848, host, () => {
        server.off('error', reject);
        resolve();
      });
    });
  } catch (error) {
    watcher.close();
    await snapshot.db.close();
    throw error;
  }
  const { port } = server.address() as AddressInfo;

  const url = `http://${host.includes(':') ? `[${host}]` : host}:${port}`;
  return {
    url,
    token,
    close: async () => {
      watcher.close();
      clearTimeout(watchTimer);
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await serialize(() => snapshot.db.close());
    },
  };
}

async function loadSnapshot(dataDir: string, writeFilledValues: WriteFilledValues): Promise<Snapshot> {
  const db = LinesDB.create<TableDefs>({ dataDir, writeFilledValues });
  // Not the bulk insert: a foreign key or NOT NULL violation would fail the whole load instead of
  // marking the row, which the studio then cannot show to be fixed
  const loaded = await db.initialize({ detailedValidate: true });
  if (!loaded.ok) {
    await db.close();
    if (loaded.error.name === 'JsonlParseError') {
      const { file, line, message } = loaded.error as JsonlParseError;
      throw new Error(`${relative(dataDir, file) || file}:${line}: ${message}`, { cause: loaded.error });
    }
    throw loaded.error;
  }
  return {
    db,
    problems: describeProblems(dataDir, loaded.value.errors),
    invalid: invalidTables(loaded.value.errors),
  };
}

/**
 * Each column with whether the schema lets it be null and lets the key be left out. A schema does not
 * list what it takes, so a row is validated with the field set to null and with the key removed, and
 * the column counts as taking it when no issue is about that field; an issue about another field is
 * the row's own and says nothing of this one
 */
function withLeeway<Column extends { name: string; type?: string; notNull?: boolean }>(
  db: LinesDB<TableDefs>,
  tableName: string,
  sample: JsonObject | undefined,
  columns: Column[],
): Array<Column & { nullable: boolean; optional: boolean; nested?: Record<string, NestedLeeway> }> {
  const probe = prober(db, tableName, sample ?? {});
  return columns.map((column) => {
    const { [column.name]: _removed, ...without } = sample ?? {};
    const value = sample?.[column.name];
    // Not taken on the schema's word alone for a NOT NULL column: the row is written as the schema leaves it
    // Not taken while the field still fails: a sample failing for it already, as with no row that passes,
    // has its issue among the sample's, so the change brings no new one
    const takes = (row: JsonObject) => {
      const { taken, value: validated, failsAt } = probe(row);
      return taken && !failsAt([column.name]) && (!column.notNull || (validated?.[column.name] ?? null) !== null);
    };
    return {
      ...column,
      nullable: takes({ ...without, [column.name]: null }),
      optional: takes(without),
      ...(sample && value !== null && typeof value === 'object'
        ? { nested: nestedLeeway(db, tableName, sample, column.name) }
        : {}),
    };
  });
}

/**
 * Whether the schema takes a change of the sample row: it does when the change brings no issue the
 * sample did not have. Not only an issue about the field changed counts, as a check across fields
 * reports on another field, or on the row as a whole
 */
function prober(db: LinesDB<TableDefs>, tableName: string, sample: JsonObject) {
  const issuesOf = (result: ReturnType<typeof tryValidate>) =>
    !result ? undefined : result.ok ? [] : perKey(result.error.issues).map((issue) => JSON.stringify(issue));
  const before = new Set(issuesOf(tryValidate(db, tableName, sample)));
  return (
    row: JsonObject,
  ): { taken: boolean; value?: JsonObject; failsAt: (path: Array<string | number>) => boolean } => {
    const result = tryValidate(db, tableName, row);
    const taken = issuesOf(result)?.every((issue) => before.has(issue)) ?? false;
    const paths = result && !result.ok ? perKey(result.error.issues).map((issue) => (issue.path ?? []).map(keyOf)) : [];
    // Whether an issue is about the value at the path or one inside it
    const failsAt = (path: Array<string | number>) =>
      paths.some((at) => path.every((segment, index) => at[index] === String(segment)));
    return { taken, value: result?.ok ? result.value : undefined, failsAt };
  };
}

/**
 * The foreign keys of a table, as the row form opens the row a key refers to by them. Read from its
 * schema file first: the database leaves out a key to a table whose rows failed on load, and has no
 * schema at all for a table whose own rows failed, though the studio lists those tables and their rows
 */
async function referencesOf(db: LinesDB<TableDefs>, dataDir: string, tableName: string) {
  const declared = await foreignKeysInFile(dataDir, tableName);
  const foreignKeys = declared.length > 0 ? declared : (db.getSchema(tableName)?.foreignKeys ?? []);
  return foreignKeys.map((fk) => ({
    column: fk.column,
    table: fk.references.table,
    referencedColumn: fk.references.column,
  }));
}

/** The foreign keys a table's schema file exports, as the database reads them on load */
async function foreignKeysInFile(dataDir: string, tableName: string): Promise<ForeignKeyDefinition[]> {
  const schemaPath = await findSchemaFile(dataDir, tableName);
  if (!schemaPath) return [];
  try {
    const module = await import(`${pathToFileURL(schemaPath).href}?t=${Date.now()}`);
    const exported = module.schema ?? module.default;
    return exported?.foreignKeys ?? module.foreignKeys ?? [];
  } catch {
    // Not failing the listing: the file failed to load on start too, and its problem is listed there
    return [];
  }
}

/**
 * The row validated, or undefined when the schema threw: a schema can assume a value the change took
 * away, such as reading the keys of an object removed, and that says it does not take the change
 */
function tryValidate(db: LinesDB<TableDefs>, tableName: string, row: JsonObject) {
  try {
    return db.validateRow(tableName, row);
  } catch {
    return undefined;
  }
}

/** What the schema takes of an object inside a JSON value: keys it does not name, and leaving a key out */
interface NestedLeeway {
  open?: boolean;
  optional?: boolean;
}

/** A key no schema names, added to an object to see whether the schema takes keys it does not name */
const PROBE_KEY = '__lines_db_studio_probe__';

/**
 * What the schema takes of each object inside the sample's value of a JSON column, by its path there
 * with list indexes as `*` (`''` for the value itself, `items.*.name` for a key of each item, and
 * `%`, `.` and `*` in a key as `%25`, `%2E` and `%2A`). Found as
 * for a column, from the issues a change brings that the sample did not have: a key added to an object
 * tells whether it takes keys it does not name, and a key removed whether it can be left out. The
 * items of a list are changed together in one check, so what one of them refuses counts as refused for all
 */
function nestedLeeway(
  db: LinesDB<TableDefs>,
  tableName: string,
  sample: JsonObject,
  column: string,
): Record<string, NestedLeeway> {
  const probe = prober(db, tableName, sample);
  // Not one object at a time: the items of a list share a pattern, so all of them are changed in one check,
  // and one an item refuses is refused for all
  const atAll = (paths: Array<Array<string | number>>, change: (object: JsonObject) => JsonObject) =>
    ({
      ...sample,
      [column]: paths.reduce((value, path) => changeAt(value, path, change), sample[column]),
    }) as JsonObject;

  const objects = new Map<string, Array<{ path: Array<string | number>; object: JsonObject }>>();
  const walk = (value: JsonValue | undefined, path: Array<string | number>, pattern: string[]) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, [...path, index], [...pattern, '*']));
      return;
    }
    if (value === null || typeof value !== 'object') return;
    const key = pattern.join('.');
    objects.set(key, [...(objects.get(key) ?? []), { path, object: value }]);
    for (const [name, item] of Object.entries(value)) walk(item, [...path, name], [...pattern, segmentOf(name)]);
  };
  walk(sample[column], [], []);

  const leeway: Record<string, NestedLeeway> = {};
  for (const [pattern, found] of objects) {
    const prefix = pattern === '' ? '' : `${pattern}.`;
    // Not tried on an empty object: with no value of its own to give a new key, any value tried may be refused
    const filled = found.filter(({ object }) => Object.keys(object).length > 0);
    if (filled.length > 0) {
      // Not the probe key alone: an object may hold it already, and then it is changed rather than added
      let added = PROBE_KEY;
      while (filled.some(({ object }) => Object.hasOwn(object, added))) added += '_';
      const open = probe(
        atAll(
          filled.map(({ path }) => path),
          (object) => ({ ...object, [added]: Object.values(object)[0] }),
        ),
      ).taken;
      leeway[pattern] = { open };
    }
    const keys = new Set(found.flatMap(({ object }) => Object.keys(object)));
    for (const name of keys) {
      const holding = found.filter(({ object }) => Object.hasOwn(object, name)).map(({ path }) => path);
      const { taken, failsAt } = probe(
        atAll(holding, (object) => {
          const { [name]: _removed, ...rest } = object;
          return rest;
        }),
      );
      // Not taken while the key still fails: a sample failing for it already has its issue among the sample's
      const optional = taken && !holding.some((path) => failsAt([column, ...path, name]));
      leeway[`${prefix}${segmentOf(name)}`] = { ...leeway[`${prefix}${segmentOf(name)}`], optional };
    }
  }
  return leeway;
}

/** A key as a segment of a pattern, apart from the dots between segments and the `*` of a list index */
const segmentOf = (key: string) => key.replace(/[%.*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

/** The value with the object at the path inside it changed */
function changeAt(
  value: JsonValue | undefined,
  path: Array<string | number>,
  change: (object: JsonObject) => JsonObject,
): JsonValue {
  if (path.length === 0) return change(value as JsonObject);
  const [head, ...rest] = path;
  if (Array.isArray(value)) return value.map((item, index) => (index === head ? changeAt(item, rest, change) : item));
  const object = value as JsonObject;
  return { ...object, [head]: changeAt(object[head], rest, change) };
}

/**
 * The issues with one about several refused keys split per key. Zod reports the keys a strict object
 * refuses in one issue at the path of the object and the keys beside it, which no field would be found
 * by, nor a key inside a JSON value
 */
function perKey(issues: readonly StandardSchemaIssue[]): StandardSchemaIssue[] {
  return issues.flatMap((issue) => {
    const { code, keys } = issue as { code?: unknown; keys?: unknown };
    if (code !== 'unrecognized_keys' || !Array.isArray(keys)) return [issue];
    if (keys.length === 0 || !keys.every((key) => typeof key === 'string')) return [issue];
    return keys.map((key) => ({ ...issue, keys: [key], path: [...(issue.path ?? []), { key }] }));
  });
}

/** A segment of an issue's path as the key it names */
const keyOf = (segment: PropertyKey | { key: PropertyKey }) =>
  typeof segment === 'object' && segment !== null && 'key' in segment ? String(segment.key) : String(segment);

/** The field of the row an issue is about, if it is about one */
function fieldOf(issue: StandardSchemaIssue): string | undefined {
  const segment = issue.path?.[0];
  if (segment === undefined) return undefined;
  return typeof segment === 'object' && segment !== null && 'key' in segment ? String(segment.key) : String(segment);
}

/**
 * The fields of a table's rows its schema refuses as keys, which a fix can only remove. A schema does
 * not list its keys, so a field counts when removing it from each row it fails on clears its issues,
 * and no row that passes keeps it: removing a known optional field holding a wrong value clears its
 * issue too, but a passing row then has it
 */
function unknownFields(
  db: LinesDB<TableDefs>,
  tableName: string,
  rows: JsonObject[],
  issues: Map<number, StandardSchemaIssue[]>,
): Set<string> {
  const failingOn = new Map<string, number[]>();
  for (const [index, rowIssues] of issues) {
    for (const issue of rowIssues) {
      const key = fieldOf(issue);
      if (key !== undefined && Object.hasOwn(rows[index] ?? {}, key))
        failingOn.set(key, [...(failingOn.get(key) ?? []), index]);
    }
  }
  const kept = new Set<string>();
  rows.forEach((row, index) => {
    if (issues.has(index)) return;
    const validated = tryValidate(db, tableName, row);
    if (validated?.ok) for (const key of Object.keys(validated.value)) kept.add(key);
  });
  const unknown = new Set<string>();
  for (const [key, indexes] of failingOn) {
    if (kept.has(key)) continue;
    const clears = indexes.every((index) => {
      const { [key]: _removed, ...rest } = rows[index];
      // Not counted as clearing it when the schema throws without the key: it relies on the key being there
      const result = tryValidate(db, tableName, rest);
      return (
        result !== undefined && (result.ok || !perKey(result.error.issues).some((issue) => fieldOf(issue) === key))
      );
    });
    if (clears) unknown.add(key);
  }
  return unknown;
}

/** The tables whose failing rows all come from one file, which can then be edited line by line */
function invalidTables(errors: ValidationErrorDetail[]): Map<string, InvalidTable> {
  const tables = new Map<string, InvalidTable | null>();
  for (const error of errors) {
    const known = tables.get(error.tableName);
    if (known === null) continue;
    if (known && known.file !== error.file) {
      tables.set(error.tableName, null);
      continue;
    }
    const table = known ?? { file: error.file, issues: new Map() };
    const foreignKey = error.foreignKeyError;
    const issues: StandardSchemaIssue[] = foreignKey
      ? [
          {
            message: `No ${foreignKey.referencedTable} row has ${foreignKey.referencedColumn} ${JSON.stringify(foreignKey.value)}`,
            path: [{ key: foreignKey.column }],
          },
        ]
      : perKey(error.issues);
    table.issues.set(error.rowIndex, [...(table.issues.get(error.rowIndex) ?? []), ...issues]);
    tables.set(error.tableName, table);
  }
  return new Map([...tables].filter((entry): entry is [string, InvalidTable] => entry[1] !== null));
}

function describeProblems(dataDir: string, errors: ValidationErrorDetail[]): string[] {
  const formatter = new ErrorFormatter();
  return errors.map((error) => {
    const file = relative(dataDir, error.file) || error.file;
    const foreignKey = error.foreignKeyError;
    return foreignKey
      ? formatter.formatForeignKeyError({ file, rowIndex: error.rowIndex, ...foreignKey })
      : formatter.formatValidationErrors([{ file, rowIndex: error.rowIndex, issues: error.issues }]);
  });
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
};

/** The built page shipped next to the CLI (bin/) or the sources (src/studio/), whichever exists */
async function shippedUiDir(): Promise<string> {
  const candidates = ['../studio', '../../studio'].map((path) => fileURLToPath(new URL(path, import.meta.url)));
  for (const dir of candidates) {
    if (await stat(join(dir, 'index.html')).catch(() => undefined)) return dir;
  }
  return candidates[0];
}

/** Serve a file of the built page, the page itself carrying the token */
async function servePage(res: ServerResponse, uiDir: string, pathname: string, token: string): Promise<void> {
  // Not only `/`: the same page is reachable as /index.html, and must carry the token and stay uncached there too
  const isPage = pathname === '/' || pathname === '/index.html';
  const file = resolvePath(uiDir, `.${isPage ? '/index.html' : pathname}`);
  if (relative(uiDir, file).startsWith('..')) {
    sendJson(res, 404, { message: 'Not found' });
    return;
  }
  const content = await readFile(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') return undefined;
    throw error;
  });
  if (!content) {
    if (isPage) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('The studio page has not been built. Run `pnpm build` in the lines-db repository.');
      return;
    }
    sendJson(res, 404, { message: 'Not found' });
    return;
  }
  // Not 'unsafe-inline' for styles: the editor injects its styles, and a nonce allows only those
  const nonce = randomBytes(18).toString('base64');
  const body = isPage
    ? Buffer.from(
        content
          .toString('utf8')
          .replace(
            '</head>',
            `<meta name="csp-nonce" content="${nonce}"><meta name="studio-token" content="${token}"></head>`,
          ),
      )
    : content;
  res.writeHead(200, {
    'Content-Type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
    'Content-Security-Policy': `default-src 'none'; script-src 'self'; style-src 'self' 'nonce-${nonce}'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    'Cache-Control': isPage ? 'no-store' : 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function bearerToken(req: IncomingMessage): string | undefined {
  return /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
}

function sameToken(presented: string, token: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

const NO_PRIMARY_KEY =
  'This table has no primary key, so a row cannot be told apart from the others. Add an "id" column or declare primaryKey in its schema file to edit it here.';

/** Why a table cannot be edited here: a row is found by its primary key, which must tell every row apart */
function whyReadOnly(db: LinesDB<TableDefs>, tableName: string): string | null {
  const primaryKey = db.getSchema(tableName)?.columns.find((column) => column.primaryKey)?.name;
  if (!primaryKey) return NO_PRIMARY_KEY;
  const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
  const missing =
    unwrap(
      db.queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM ${quote(tableName)} WHERE ${quote(primaryKey)} IS NULL`),
    )?.n ?? 0;
  return missing > 0
    ? `${missing} row(s) have no value for the primary key ${primaryKey}, so they cannot be told apart. Give them one in the JSONL file to edit this table here.`
    : null;
}

type WriteOperation = { kind: 'insert' } | { kind: 'update' | 'delete'; key: JsonValue };

function writeOperation(method: string | undefined, encodedKey: string | undefined): WriteOperation | undefined {
  if (method === 'POST' && encodedKey === undefined) return { kind: 'insert' };
  if (encodedKey === undefined) return undefined;
  const key = parseJson(encodedKey, 'The row key in the address is not JSON') as JsonValue;
  if (method === 'PATCH') return { kind: 'update', key };
  if (method === 'DELETE') return { kind: 'delete', key };
  return undefined;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return parseJson(Buffer.concat(chunks).toString('utf8'), 'The request body is not JSON');
}

/** The rows a save inserts, the changes it makes by primary key, and the keys it deletes */
interface ChangeBatch {
  inserts: JsonObject[];
  updates: Array<{ key: JsonValue; changes: JsonObject; resetToDefault?: string[] }>;
  deletes: JsonValue[];
  /** For a table with failing rows, whose rows are addressed by index: the file the page read them from */
  revision?: string;
}

/** The change of a batch the database refused */
type FailedChange = { kind: 'insert'; index: number } | { kind: 'update' | 'delete'; index: number; key: JsonValue };

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFieldList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((field) => typeof field === 'string');
}

/** `application/json`, with or without parameters such as a charset */
function isJsonMediaType(contentType: string | undefined): boolean {
  return contentType?.split(';')[0].trim().toLowerCase() === 'application/json';
}

function changeBatch(body: unknown): ChangeBatch {
  if (!isJsonObject(body)) throw new BadRequestError('The request body must be a JSON object');
  const { inserts = [], updates = [], deletes = [] } = body;
  if (!Array.isArray(inserts) || !inserts.every(isJsonObject))
    throw new BadRequestError('`inserts` must be a list of rows');
  if (!Array.isArray(deletes)) throw new BadRequestError('`deletes` must be a list of primary keys');
  if (
    !Array.isArray(updates) ||
    !updates.every(
      (update) =>
        isJsonObject(update) &&
        'key' in update &&
        isJsonObject(update.changes) &&
        (update.resetToDefault === undefined || isFieldList(update.resetToDefault)),
    )
  ) {
    throw new BadRequestError('`updates` must be a list of { key, changes, resetToDefault? }');
  }
  if (body.revision !== undefined && typeof body.revision !== 'string')
    throw new BadRequestError('`revision` must be a string');
  return {
    inserts,
    updates: updates as unknown as ChangeBatch['updates'],
    deletes,
    revision: body.revision,
  };
}

interface WriteBody {
  row?: JsonObject;
  changes?: JsonObject;
  resetToDefault?: string[];
}

function writeBody(body: unknown): WriteBody {
  if (!isJsonObject(body)) throw new BadRequestError('The request body must be a JSON object');
  const { row, changes, resetToDefault } = body;
  if (row !== undefined && !isJsonObject(row)) throw new BadRequestError('`row` must be an object');
  if (changes !== undefined && !isJsonObject(changes)) throw new BadRequestError('`changes` must be an object');
  if (resetToDefault !== undefined && !isFieldList(resetToDefault)) {
    throw new BadRequestError('`resetToDefault` must be a list of field names');
  }
  return { row, changes, resetToDefault };
}

/** Thrown at the end of a checked batch, so its transaction rolls back */
const DRY_RUN = new Error('dry run');

/** An error in the request itself, answered with 400 */
class BadRequestError extends Error {}

function parseJson(text: string, message: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new BadRequestError(message);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
