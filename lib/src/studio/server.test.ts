import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
import { startStudioServer, type StudioServer } from './server.js';

describe('studio server', () => {
  let dataDir: string;
  let studio: StudioServer;
  // Every request but the ones about the token itself presents it, as the page does once logged in
  const fetch = (input: string, init: RequestInit = {}) =>
    globalThis.fetch(input, {
      ...init,
      headers: { Authorization: `Bearer ${studio.token}`, ...(init.headers as Record<string, string>) },
    });
  const AGE_DEFAULT_SCHEMA = `export const schema = { '~standard': { version: 1, vendor: 'test', validate: (data) =>
  ({ value: { ...data, age: data.age ?? 20 } }) } };
`;
  const NAME_REQUIRED_SCHEMA = `export const schema = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (data) =>
      typeof data.name === 'string' && data.name.length > 0
        ? { value: data }
        : { issues: [{ message: 'Name is required', path: [{ key: 'name' }] }] },
  },
};
`;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'linesdb-studio-'));
    await writeFile(
      join(dataDir, 'users.jsonl'),
      '{"id":1,"name":"Alice","active":true,"tags":["a"]}\n{"id":2,"name":"Bob","active":false,"tags":[]}\n',
    );
    await writeFile(join(dataDir, 'users.schema.ts'), NAME_REQUIRED_SCHEMA);
    studio = await startStudioServer({ dataDir, port: 0 });
  });

  afterEach(async () => {
    await studio.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('lists each table with its columns and primary key', async () => {
    const response = await fetch(`${studio.url}/api/tables`);

    expect(response.status).toBe(200);
    const body = await bodyOf(response);
    expect(body.tables).toEqual([
      expect.objectContaining({
        name: 'users',
        primaryKey: 'id',
        columns: expect.arrayContaining([
          expect.objectContaining({ name: 'id' }),
          expect.objectContaining({ name: 'name' }),
          expect.objectContaining({ name: 'tags', type: 'JSON' }),
        ]),
      }),
    ]);
  });

  it('returns rows with JSON and boolean columns as they appear in the JSONL file', async () => {
    const response = await fetch(`${studio.url}/api/tables/users/rows`);

    expect(response.status).toBe(200);
    expect((await bodyOf(response)).rows).toEqual([
      { id: 1, name: 'Alice', active: true, tags: ['a'] },
      { id: 2, name: 'Bob', active: false, tags: [] },
    ]);
  });

  it('writes a row changed by primary key back to its line in the JSONL file', async () => {
    const response = await patchJson(rowUrl('users', 2), { changes: { name: 'Bobby', tags: ['b', 'c'] } });

    expect(response.status).toBe(200);
    expect(await readFile(join(dataDir, 'users.jsonl'), 'utf8')).toBe(
      '{"id":1,"name":"Alice","active":true,"tags":["a"]}\n{"id":2,"name":"Bobby","active":false,"tags":["b","c"]}\n',
    );
  });

  it('reports the fields of each row that the schema filled in, so the page can tell them from the file', async () => {
    await studio.close();
    await writeFile(join(dataDir, 'people.jsonl'), '{"id":1,"name":"Alice"}\n{"id":2,"name":"Bob","age":40}\n');
    await writeFile(join(dataDir, 'people.schema.ts'), AGE_DEFAULT_SCHEMA);
    studio = await startStudioServer({ dataDir, port: 0 });

    const body = await bodyOf(await fetch(`${studio.url}/api/tables/people/rows`));

    expect(body.rows).toEqual([
      { id: 1, name: 'Alice', age: 20 },
      { id: 2, name: 'Bob', age: 40 },
    ]);
    expect(body.defaulted).toEqual([['age'], []]);
  });

  it('leaves a field to its default when a change resets it, removing it from the line', async () => {
    await studio.close();
    await writeFile(join(dataDir, 'people.jsonl'), '{"id":2,"name":"Bob","age":40}\n');
    await writeFile(join(dataDir, 'people.schema.ts'), AGE_DEFAULT_SCHEMA);
    studio = await startStudioServer({ dataDir, port: 0 });

    const response = await patchJson(rowUrl('people', 2), { changes: {}, resetToDefault: ['age'] });

    expect(response.status).toBe(200);
    expect(await readFile(join(dataDir, 'people.jsonl'), 'utf8')).toBe('{"id":2,"name":"Bob"}\n');
  });

  it('rejects a change the schema refuses with its issues and leaves the JSONL file untouched', async () => {
    const before = await readFile(join(dataDir, 'users.jsonl'), 'utf8');

    const response = await patchJson(rowUrl('users', 1), { changes: { name: '' } });

    expect(response.status).toBe(400);
    expect((await bodyOf(response)).issues).toEqual([{ message: 'Name is required', path: [{ key: 'name' }] }]);
    expect(await readFile(join(dataDir, 'users.jsonl'), 'utf8')).toBe(before);
  });

  it('appends an added row to the JSONL file', async () => {
    const response = await sendJsonRequest('POST', `${studio.url}/api/tables/users/rows`, {
      row: { id: 3, name: 'Carol', active: true, tags: [] },
    });

    expect(response.status).toBe(201);
    expect(await readFile(join(dataDir, 'users.jsonl'), 'utf8')).toBe(
      '{"id":1,"name":"Alice","active":true,"tags":["a"]}\n{"id":2,"name":"Bob","active":false,"tags":[]}\n{"id":3,"name":"Carol","active":true,"tags":[]}\n',
    );
  });

  it('removes a deleted row from the JSONL file', async () => {
    const response = await fetch(rowUrl('users', 1), { method: 'DELETE' });

    expect(response.status).toBe(200);
    expect(await readFile(join(dataDir, 'users.jsonl'), 'utf8')).toBe(
      '{"id":2,"name":"Bob","active":false,"tags":[]}\n',
    );
  });

  it('refuses to write to a table without a primary key and says why', async () => {
    await studio.close();
    await writeFile(join(dataDir, 'notes.jsonl'), '{"title":"first"}\n');
    studio = await startStudioServer({ dataDir, port: 0 });

    const response = await sendJsonRequest('POST', `${studio.url}/api/tables/notes/rows`, { row: { title: 'second' } });

    expect(response.status).toBe(409);
    expect((await bodyOf(response)).message).toContain('primary key');
    expect(await readFile(join(dataDir, 'notes.jsonl'), 'utf8')).toBe('{"title":"first"}\n');
  });

  it('refuses a write made after the JSONL file changed on disk and serves the new content next', async () => {
    const edited =
      '{"id":1,"name":"Alice","active":true,"tags":["a"]}\n{"id":2,"name":"Robert","active":false,"tags":[]}\n';
    await writeFile(join(dataDir, 'users.jsonl'), edited);

    const response = await patchJson(rowUrl('users', 1), { changes: { name: 'Alicia' } });

    expect(response.status).toBe(409);
    expect((await bodyOf(response)).message).toContain('users.jsonl');
    expect(await readFile(join(dataDir, 'users.jsonl'), 'utf8')).toBe(edited);
    const rows = (await bodyOf(await fetch(`${studio.url}/api/tables/users/rows`))).rows;
    expect(rows[1].name).toBe('Robert');
  });

  it('saves an edit when only another table file changed on disk, leaving that file as it was edited', async () => {
    await studio.close();
    await writeFile(join(dataDir, 'tags.jsonl'), '{"id":1,"label":"a"}\n');
    studio = await startStudioServer({ dataDir, port: 0 });
    await writeFile(join(dataDir, 'tags.jsonl'), '{"id":1,"label":"b"}\n');

    const response = await patchJson(rowUrl('users', 1), { changes: { name: 'Alicia' } });

    expect(response.status).toBe(200);
    expect(await readFile(join(dataDir, 'users.jsonl'), 'utf8')).toContain('"name":"Alicia"');
    expect(await readFile(join(dataDir, 'tags.jsonl'), 'utf8')).toBe('{"id":1,"label":"b"}\n');
  });

  it('accepts consecutive writes, as its own write-back is not taken for an outside change', async () => {
    await patchJson(rowUrl('users', 1), { changes: { name: 'Alicia' } });

    const response = await patchJson(rowUrl('users', 2), { changes: { name: 'Bobby' } });

    expect(response.status).toBe(200);
  });

  it('reports the rows that failed validation on load, since their table is left out of the list', async () => {
    await studio.close();
    await writeFile(
      join(dataDir, 'users.jsonl'),
      '{"id":1,"name":"Alice","active":true,"tags":[]}\n{"id":2,"name":"","active":true,"tags":[]}\n',
    );
    studio = await startStudioServer({ dataDir, port: 0 });

    const body = await bodyOf(await fetch(`${studio.url}/api/tables`));

    expect(body.tables).toEqual([]);
    expect(body.problems).toEqual([expect.stringMatching(/users\.jsonl:2 .* name: Name is required/)]);
  });

  // Not run on Windows or as root: neither lets chmod make a file unwritable
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'drops a change whose write-back failed, so the rows shown match the JSONL file',
    async () => {
      await chmod(join(dataDir, 'users.jsonl'), 0o444);
      await chmod(dataDir, 0o555);
      try {
        const response = await patchJson(rowUrl('users', 1), { changes: { name: 'Alicia' } });
        expect(response.status).toBeGreaterThanOrEqual(400);
      } finally {
        await chmod(dataDir, 0o755);
        await chmod(join(dataDir, 'users.jsonl'), 0o644);
      }

      const rows = (await bodyOf(await fetch(`${studio.url}/api/tables/users/rows`))).rows;
      expect(rows[0].name).toBe('Alice');
    },
  );

  it('lists a table left out on load once its file is fixed', async () => {
    await studio.close();
    await writeFile(join(dataDir, 'users.jsonl'), '{"id":1,"name":"","active":true,"tags":[]}\n');
    studio = await startStudioServer({ dataDir, port: 0 });
    await writeFile(join(dataDir, 'users.jsonl'), '{"id":1,"name":"Alice","active":true,"tags":[]}\n');

    const body = await bodyOf(await fetch(`${studio.url}/api/tables`));

    expect(body.tables.map((table: { name: string }) => table.name)).toEqual(['users']);
    expect(body.problems).toEqual([]);
  });

  it('reloads the tables once a schema file is added, so a primary key it declares makes its table editable', async () => {
    await studio.close();
    await writeFile(join(dataDir, 'notes.jsonl'), '{"title":"first"}\n');
    studio = await startStudioServer({ dataDir, port: 0 });
    await writeFile(
      join(dataDir, 'notes.schema.ts'),
      "export const schema = { primaryKey: 'title', '~standard': { version: 1, vendor: 'test', validate: (data) => ({ value: data }) } };\n",
    );

    const body = await bodyOf(await fetch(`${studio.url}/api/tables`));

    expect(body.tables.find((table: { name: string }) => table.name === 'notes')).toMatchObject({
      primaryKey: 'title',
      readOnlyReason: null,
    });
  });

  it('names the file and line of a JSONL line broken on disk, as the tables cannot be reloaded until it is fixed', async () => {
    await writeFile(join(dataDir, 'users.jsonl'), '{"id":1,"name":"Alice","active":true,"tags":[]}\n{"id":2,\n');

    const response = await fetch(`${studio.url}/api/tables`);

    expect(response.status).toBe(500);
    expect((await bodyOf(response)).message).toMatch(/^users\.jsonl:2: /);
  });

  it('tells an open page over /api/events once a JSONL file changes on disk, so it shows the new rows', async () => {
    const events = await openEvents();
    await writeFile(join(dataDir, 'users.jsonl'), '{"id":1,"name":"Alice","active":true,"tags":[]}\n');

    await events.waitFor('changed');
    events.close();
    expect((await bodyOf(await fetch(`${studio.url}/api/tables/users/rows`))).rows).toHaveLength(1);
  });

  it('tells an open page over /api/events once a save succeeds, so another open page shows it too', async () => {
    const events = await openEvents();

    await patchJson(rowUrl('users', 1), { changes: { name: 'Alicia' } });

    await events.waitFor('changed');
    events.close();
  });

  it('refuses a request that does not present the token printed at start-up', async () => {
    const response = await globalThis.fetch(`${studio.url}/api/tables`);

    expect(response.status).toBe(401);
  });

  it('refuses a write that presents a wrong token, leaving the JSONL file untouched', async () => {
    const before = await readFile(join(dataDir, 'users.jsonl'), 'utf8');

    const response = await globalThis.fetch(rowUrl('users', 1), {
      method: 'DELETE',
      headers: { Authorization: 'Bearer wrong' },
    });

    expect(response.status).toBe(401);
    expect(await readFile(join(dataDir, 'users.jsonl'), 'utf8')).toBe(before);
  });

  it('logs in from the printed URL with a cookie the page then presents, and drops the token from the address', async () => {
    const login = await globalThis.fetch(studio.loginUrl, { redirect: 'manual' });
    const cookie = login.headers.get('set-cookie') ?? '';

    expect(login.status).toBe(303);
    expect(login.headers.get('location')).toBe('/');
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    const response = await globalThis.fetch(`${studio.url}/api/tables`, { headers: { Cookie: cookie.split(';')[0] } });
    expect(response.status).toBe(200);
  });

  it('answers a write whose body is not JSON with 400, as the request is at fault', async () => {
    const response = await fetch(rowUrl('users', 1), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{"changes":',
    });

    expect(response.status).toBe(400);
  });

  it('answers a row address whose key is not JSON with 400', async () => {
    const response = await fetch(`${studio.url}/api/tables/users/rows/not-json`, { method: 'DELETE' });

    expect(response.status).toBe(400);
  });

  it('validates a save made right after a schema file appeared against that schema, not the state loaded before', async () => {
    await studio.close();
    await writeFile(join(dataDir, 'members.jsonl'), '{"id":1,"name":"Alexandria"}\n');
    studio = await startStudioServer({ dataDir, port: 0 });
    await writeFile(
      join(dataDir, 'members.schema.ts'),
      NAME_REQUIRED_SCHEMA.replace('data.name.length > 0', 'data.name.length > 9'),
    );

    const response = await patchJson(rowUrl('members', 1), { changes: { name: 'Alex' } });

    expect(response.status).toBe(400);
    expect(await readFile(join(dataDir, 'members.jsonl'), 'utf8')).toBe('{"id":1,"name":"Alexandria"}\n');
  });

  it('answers a write whose JSON body is not an object of the expected shape with 400', async () => {
    const responses = await Promise.all(
      [null, 'text', { changes: 'not an object' }, { changes: {}, resetToDefault: 'age' }].map((body) =>
        patchJson(rowUrl('users', 1), body),
      ),
    );

    expect(responses.map((response) => response.status)).toEqual([400, 400, 400, 400]);
  });

  it('fails to start on a port already in use instead of crashing the process', async () => {
    const { port } = new URL(studio.url);

    await expect(startStudioServer({ dataDir, port: Number(port) })).rejects.toMatchObject({ code: 'EADDRINUSE' });
  });

  it('rejects a request whose Host is not the local server, so a rebound DNS name cannot reach it', async () => {
    const { port } = new URL(studio.url);

    const response = await rawRequest({ port, path: '/api/tables', headers: { Host: `evil.example:${port}` } });

    expect(response.status).toBe(403);
  });

  it('rejects a write that is not sent as application/json, so a plain cross-site form cannot make one', async () => {
    const response = await fetch(rowUrl('users', 1), {
      method: 'PATCH',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ changes: { name: 'Mallory' } }),
    });

    expect(response.status).toBe(415);
    expect(await readFile(join(dataDir, 'users.jsonl'), 'utf8')).toContain('"name":"Alice"');
  });

  it('rejects a write sent from another origin', async () => {
    const response = await fetch(rowUrl('users', 1), {
      method: 'DELETE',
      headers: { Origin: 'https://evil.example' },
    });

    expect(response.status).toBe(403);
    expect(await readFile(join(dataDir, 'users.jsonl'), 'utf8')).toContain('"name":"Alice"');
  });

  it('serves the studio page with a script allowed only by the nonce in its Content-Security-Policy', async () => {
    const response = await fetch(`${studio.url}/`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const nonce = response.headers.get('content-security-policy')?.match(/'nonce-([^']+)'/)?.[1];
    expect(nonce).toBeTruthy();
    expect(await response.text()).toContain(`<script nonce="${nonce}">`);
  });

  function rawRequest(options: {
    port: string;
    path: string;
    headers: Record<string, string>;
  }): Promise<{ status: number | undefined }> {
    return new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', ...options }, (res) => {
        res.resume();
        resolve({ status: res.statusCode });
      });
      req.on('error', reject);
      req.end();
    });
  }

  async function openEvents(): Promise<{ waitFor(event: string): Promise<void>; close(): void }> {
    const controller = new AbortController();
    const response = await fetch(`${studio.url}/api/events`, { signal: controller.signal });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let received = '';
    return {
      async waitFor(event) {
        const deadline = Date.now() + 3000;
        while (!received.includes(`event: ${event}\n`)) {
          if (Date.now() > deadline) throw new Error(`No '${event}' event within 3s; received: ${received}`);
          const { value, done } = await reader.read();
          if (done) throw new Error(`The event stream ended before '${event}'`);
          received += decoder.decode(value, { stream: true });
        }
      },
      close: () => controller.abort(),
    };
  }

  async function bodyOf(response: Response): Promise<Record<string, any>> {
    return (await response.json()) as Record<string, any>;
  }

  function patchJson(url: string, body: unknown): Promise<Response> {
    return sendJsonRequest('PATCH', url, body);
  }

  function sendJsonRequest(method: string, url: string, body: unknown): Promise<Response> {
    return fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }

  function rowUrl(table: string, key: unknown): string {
    return `${studio.url}/api/tables/${table}/rows/${encodeURIComponent(JSON.stringify(key))}`;
  }
});
