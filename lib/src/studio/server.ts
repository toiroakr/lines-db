import { randomBytes, timingSafeEqual } from 'node:crypto';
import { watch } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { basename, extname, join, relative, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LinesDB } from '../database.js';
import { ErrorFormatter } from '../error-formatter.js';
import { unwrap } from '../result.js';
import type {
  JsonlConflictError,
  JsonlParseError,
  JsonObject,
  JsonValue,
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
  /** The token every request presents, generated at start-up */
  token: string;
  /** The URL that logs a browser in with the token */
  loginUrl: string;
  close(): Promise<void>;
}

interface Snapshot {
  db: LinesDB<TableDefs>;
  /** Rows that failed validation on load, whose table is therefore left out */
  problems: string[];
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

    const presented = url.searchParams.get('token');
    if (req.method === 'GET' && url.pathname === '/' && presented !== null && sameToken(presented, token)) {
      res.writeHead(303, {
        Location: '/',
        'Set-Cookie': `${tokenCookie(req)}=${token}; HttpOnly; SameSite=Strict; Path=/`,
      });
      res.end();
      return;
    }
    if (!sameToken(presentedToken(req) ?? '', token)) {
      sendJson(res, 401, { message: 'Open the URL lines-db studio printed when it started' });
      return;
    }
    const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);

    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
      await servePage(res, uiDir, url.pathname);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
      res.write(': connected\n\n');
      eventClients.add(res);
      req.on('close', () => eventClients.delete(res));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/tables') {
      await reloadIfChanged();
      const tables = snapshot.db.getTableNames().map((name) => {
        const columns = snapshot.db.getSchema(name)?.columns ?? [];
        const primaryKey = columns.find((column) => column.primaryKey)?.name ?? null;
        const rowCount =
          unwrap(snapshot.db.queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM "${name.replaceAll('"', '""')}"`))?.n ??
          0;
        return { name, columns, primaryKey, rowCount, readOnlyReason: whyReadOnly(snapshot.db, name) };
      });
      sendJson(res, 200, { dataDir: resolvePath(dataDir), tables, problems: snapshot.problems });
      return;
    }

    const [, , tableName, resource, encodedKey] = segments;
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
    if (write.kind !== 'delete' && !req.headers['content-type']?.startsWith('application/json')) {
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

    const outcome = await serialize(async (): Promise<{ status: number; body: unknown; changed?: boolean }> => {
      // Not left to the watcher: its event may not have fired yet, and a changed schema file is no
      // conflict a write-back detects, so the rows would be validated against the old schema
      const changedFiles = unwrap(await snapshot.db.findExternalChanges());
      if (changedFiles.length > 0) {
        await reloadUnlocked();
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
            issues: failure.issues ?? [],
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
          body: { message: result.error.message, ...(issues ? { issues } : {}), ...(change ? { change } : {}) },
        };
      }
      return { status: write.kind === 'insert' ? 201 : 200, body: { ok: true }, changed: true };
    });
    sendJson(res, outcome.status, outcome.body);
    // Not before the response: the page that saved would still be in its editor when the event arrives
    if (outcome.changed) notifyChanged();
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
    loginUrl: `${url}/?token=${token}`,
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
  const loaded = await db.initialize();
  if (!loaded.ok) {
    await db.close();
    if (loaded.error.name === 'JsonlParseError') {
      const { file, line, message } = loaded.error as JsonlParseError;
      throw new Error(`${relative(dataDir, file) || file}:${line}: ${message}`, { cause: loaded.error });
    }
    throw loaded.error;
  }
  return { db, problems: describeProblems(dataDir, loaded.value.errors) };
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

/** Not one fixed name: a browser keeps cookies by host, not port, so studios on other ports would overwrite it */
const tokenCookie = (req: IncomingMessage) => `lines_db_studio_token_${req.socket.localPort}`;

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

async function servePage(res: ServerResponse, uiDir: string, pathname: string): Promise<void> {
  const file = resolvePath(uiDir, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (relative(uiDir, file).startsWith('..')) {
    sendJson(res, 404, { message: 'Not found' });
    return;
  }
  const content = await readFile(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') return undefined;
    throw error;
  });
  if (!content) {
    if (pathname === '/') {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('The studio page has not been built. Run `pnpm build` in the lines-db repository.');
      return;
    }
    sendJson(res, 404, { message: 'Not found' });
    return;
  }
  // Not 'unsafe-inline' for styles: the editor injects its styles, and a nonce allows only those
  const nonce = randomBytes(18).toString('base64');
  const body =
    pathname === '/'
      ? Buffer.from(content.toString('utf8').replace('</head>', `<meta name="csp-nonce" content="${nonce}"></head>`))
      : content;
  res.writeHead(200, {
    'Content-Type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
    'Content-Security-Policy': `default-src 'none'; script-src 'self'; style-src 'self' 'nonce-${nonce}'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    'Cache-Control': pathname === '/' ? 'no-store' : 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function presentedToken(req: IncomingMessage): string | undefined {
  const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
  if (bearer) return bearer;
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === tokenCookie(req)) return value.join('=');
  }
  return undefined;
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
}

/** The change of a batch the database refused */
type FailedChange = { kind: 'insert'; index: number } | { kind: 'update' | 'delete'; index: number; key: JsonValue };

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFieldList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((field) => typeof field === 'string');
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
  return {
    inserts,
    updates: updates as unknown as ChangeBatch['updates'],
    deletes,
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
