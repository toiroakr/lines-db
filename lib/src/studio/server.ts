import { randomBytes, timingSafeEqual } from 'node:crypto';
import { watch } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { relative, resolve as resolvePath } from 'node:path';
import { LinesDB } from '../database.js';
import { ErrorFormatter } from '../error-formatter.js';
import { unwrap } from '../result.js';
import { renderPage } from './page.js';
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
        'Set-Cookie': `${TOKEN_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`,
      });
      res.end();
      return;
    }
    if (!sameToken(presentedToken(req) ?? '', token)) {
      sendJson(res, 401, { message: 'Open the URL lines-db studio printed when it started' });
      return;
    }
    const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);

    if (req.method === 'GET' && url.pathname === '/') {
      const nonce = randomBytes(24).toString('base64');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
        'Cache-Control': 'no-store',
      });
      res.end(renderPage(nonce));
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
        return { name, columns, primaryKey, readOnlyReason: primaryKey ? null : readOnlyReason };
      });
      sendJson(res, 200, { dataDir: resolvePath(dataDir), tables, problems: snapshot.problems });
      return;
    }

    if (segments[0] !== 'api' || segments[1] !== 'tables' || segments[3] !== 'rows' || segments.length > 5) {
      sendJson(res, 404, { message: 'Not found' });
      return;
    }
    const tableName = segments[2];

    if (req.method === 'GET' && segments.length === 4) {
      await reloadIfChanged();
      if (!snapshot.db.getSchema(tableName)) {
        sendJson(res, 404, { message: `Table '${tableName}' does not exist` });
        return;
      }
      const rows = unwrap(await snapshot.db.findWithDefaults(tableName));
      sendJson(res, 200, { rows: rows.map(({ row }) => row), defaulted: rows.map(({ defaulted }) => defaulted) });
      return;
    }

    const write = writeOperation(req.method, segments[4]);
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
    const body = write.kind === 'delete' ? {} : writeBody(await readJson(req));

    const outcome = await serialize(async (): Promise<{ status: number; body: unknown; changed?: boolean }> => {
      // Not left to the watcher: its event may not have fired yet, and a changed schema file is no
      // conflict a write-back detects, so the rows would be validated against the old schema
      const changedFiles = unwrap(await snapshot.db.findExternalChanges());
      if (changedFiles.length > 0) {
        await reloadUnlocked();
        // Not saved over an outside edit of the edited table's own file: the change was made on rows
        // the page showed before that edit
        const ownFile = changedFiles.find((file) => resolvePath(file) === resolvePath(dataDir, `${tableName}.jsonl`));
        if (ownFile) {
          const message = `${relative(dataDir, ownFile) || ownFile} changed on disk, so the tables were reloaded. Check the rows and try again.`;
          return { status: 409, body: { message }, changed: true };
        }
      }
      const { db } = snapshot;
      const schema = db.getSchema(tableName);
      if (!schema) return { status: 404, body: { message: `Table '${tableName}' does not exist` } };
      const primaryKey = schema.columns.find((column) => column.primaryKey)?.name;
      if (!primaryKey) return { status: 409, body: { message: readOnlyReason } };

      const where = { [primaryKey]: write.kind === 'insert' ? null : write.key };
      const result = await db.transaction((tx) => {
        const written =
          write.kind === 'insert'
            ? tx.insert(tableName, body.row ?? {})
            : write.kind === 'update'
              ? tx.update(tableName, body.changes ?? {}, where, { resetToDefault: body.resetToDefault })
              : tx.delete(tableName, where);
        if (!written.ok) throw written.error;
      });
      if (!result.ok) {
        if (result.error.name === 'JsonlConflictError') {
          await reloadUnlocked();
          const { file } = result.error as JsonlConflictError;
          const message = `${relative(dataDir, file) || file} changed on disk, so the tables were reloaded. Check the rows and try again.`;
          return { status: 409, body: { message }, changed: true };
        }
        const issues = (result.error as Partial<ValidationError>).issues;
        return { status: 400, body: { message: result.error.message, ...(issues ? { issues } : {}) } };
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

const TOKEN_COOKIE = 'lines_db_studio_token';

function presentedToken(req: IncomingMessage): string | undefined {
  const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
  if (bearer) return bearer;
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === TOKEN_COOKIE) return value.join('=');
  }
  return undefined;
}

function sameToken(presented: string, token: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

const readOnlyReason =
  'This table has no primary key, so a row cannot be told apart from the others. Add an "id" column or declare primaryKey in its schema file to edit it here.';

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

interface WriteBody {
  row?: JsonObject;
  changes?: JsonObject;
  resetToDefault?: string[];
}

function writeBody(body: unknown): WriteBody {
  const isObject = (value: unknown): value is JsonObject =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
  if (!isObject(body)) throw new BadRequestError('The request body must be a JSON object');
  const { row, changes, resetToDefault } = body;
  if (row !== undefined && !isObject(row)) throw new BadRequestError('`row` must be an object');
  if (changes !== undefined && !isObject(changes)) throw new BadRequestError('`changes` must be an object');
  if (
    resetToDefault !== undefined &&
    !(Array.isArray(resetToDefault) && resetToDefault.every((f) => typeof f === 'string'))
  ) {
    throw new BadRequestError('`resetToDefault` must be a list of field names');
  }
  return { row, changes, resetToDefault: resetToDefault as string[] | undefined };
}

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
