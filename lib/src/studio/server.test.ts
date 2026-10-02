import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
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

  it('shows a table read-only while a row has no primary key value, as such rows cannot be told apart', async () => {
    await studio.close();
    await writeFile(join(dataDir, 'notes.jsonl'), '{"title":"first","body":"a"}\n{"title":null,"body":"untitled"}\n');
    await writeFile(
      join(dataDir, 'notes.schema.ts'),
      "export const schema = { primaryKey: 'title', '~standard': { version: 1, vendor: 'test', validate: (data) => ({ value: data }) } };\n",
    );
    studio = await startStudioServer({ dataDir, port: 0 });

    const tables = (await bodyOf(await fetch(`${studio.url}/api/tables`))).tables;
    const response = await sendJsonRequest('POST', `${studio.url}/api/tables/notes/changes`, {
      inserts: [],
      updates: [{ key: null, changes: { body: 'edited' } }],
      deletes: [],
    });

    expect(tables.find((table: { name: string }) => table.name === 'notes').readOnlyReason).toContain('primary key');
    expect(response.status).toBe(409);
    expect(await readFile(join(dataDir, 'notes.jsonl'), 'utf8')).toBe(
      '{"title":"first","body":"a"}\n{"title":null,"body":"untitled"}\n',
    );
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

  it('reports the rows that failed validation on load, and lists their table as having failing rows', async () => {
    await studio.close();
    await writeFile(
      join(dataDir, 'users.jsonl'),
      '{"id":1,"name":"Alice","active":true,"tags":[]}\n{"id":2,"name":"","active":true,"tags":[]}\n',
    );
    studio = await startStudioServer({ dataDir, port: 0 });

    const body = await bodyOf(await fetch(`${studio.url}/api/tables`));

    expect(body.tables).toEqual([expect.objectContaining({ name: 'users', invalidRows: 1 })]);
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

  it('keeps a page signed in after another studio on the same host signs in, as cookies are not kept apart by port', async () => {
    const other = await startStudioServer({ dataDir, port: 0 });
    try {
      const cookieOf = async (loginUrl: string) =>
        ((await globalThis.fetch(loginUrl, { redirect: 'manual' })).headers.get('set-cookie') ?? '').split(';')[0];
      const cookies = `${await cookieOf(studio.loginUrl)}; ${await cookieOf(other.loginUrl)}`;

      const first = await globalThis.fetch(`${studio.url}/api/tables`, { headers: { Cookie: cookies } });
      const second = await globalThis.fetch(`${other.url}/api/tables`, { headers: { Cookie: cookies } });

      expect([first.status, second.status]).toEqual([200, 200]);
    } finally {
      await other.close();
    }
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

  it('refuses a save made after the edited table schema file changed, then validates the retry against it', async () => {
    await studio.close();
    await writeFile(join(dataDir, 'members.jsonl'), '{"id":1,"name":"Alexandria"}\n');
    studio = await startStudioServer({ dataDir, port: 0 });
    await writeFile(
      join(dataDir, 'members.schema.ts'),
      NAME_REQUIRED_SCHEMA.replace('data.name.length > 0', 'data.name.length > 9'),
    );

    const first = await patchJson(rowUrl('members', 1), { changes: { name: 'Alex' } });
    const retry = await patchJson(rowUrl('members', 1), { changes: { name: 'Alex' } });

    expect(first.status).toBe(409);
    expect((await bodyOf(first)).message).toContain('members.schema.ts');
    expect(retry.status).toBe(400);
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

  it('lists the schema file of each table, or null for a table without one', async () => {
    await studio.close();
    await writeFile(join(dataDir, 'notes.jsonl'), '{"title":"first"}\n');
    studio = await startStudioServer({ dataDir, port: 0 });

    const body = await bodyOf(await fetch(`${studio.url}/api/tables`));

    expect(
      body.tables.map((table: { name: string; schemaFile: string | null }) => [table.name, table.schemaFile]),
    ).toEqual([
      ['notes', null],
      ['users', 'users.schema.ts'],
    ]);
  });

  it('gives the source of a table schema file as it is on disk', async () => {
    const response = await fetch(`${studio.url}/api/tables/users/schema`);

    expect(response.status).toBe(200);
    expect(await bodyOf(response)).toEqual({ file: 'users.schema.ts', source: NAME_REQUIRED_SCHEMA });
  });

  it('answers 404 for the schema of a table without a schema file, or of a table that does not exist', async () => {
    await studio.close();
    await writeFile(join(dataDir, 'notes.jsonl'), '{"title":"first"}\n');
    studio = await startStudioServer({ dataDir, port: 0 });

    expect((await fetch(`${studio.url}/api/tables/notes/schema`)).status).toBe(404);
    expect((await fetch(`${studio.url}/api/tables/missing/schema`)).status).toBe(404);
  });

  it('lists how many rows each table holds', async () => {
    const body = await bodyOf(await fetch(`${studio.url}/api/tables`));

    expect(body.tables[0]).toMatchObject({ name: 'users', rowCount: 2 });
  });

  it('applies a batch of inserts, updates and deletes in one write', async () => {
    const response = await sendJsonRequest('POST', `${studio.url}/api/tables/users/changes`, {
      inserts: [{ id: 3, name: 'Carol', active: true, tags: [] }],
      updates: [{ key: 1, changes: { name: 'Alicia' } }],
      deletes: [2],
    });

    expect(response.status).toBe(200);
    expect(await readFile(join(dataDir, 'users.jsonl'), 'utf8')).toBe(
      '{"id":1,"name":"Alicia","active":true,"tags":["a"]}\n{"id":3,"name":"Carol","active":true,"tags":[]}\n',
    );
  });

  it('applies none of a batch when one change is refused, and names that change', async () => {
    const before = await readFile(join(dataDir, 'users.jsonl'), 'utf8');

    const response = await sendJsonRequest('POST', `${studio.url}/api/tables/users/changes`, {
      updates: [
        { key: 1, changes: { name: 'Alicia' } },
        { key: 2, changes: { name: '' } },
      ],
    });

    expect(response.status).toBe(400);
    expect(await bodyOf(response)).toMatchObject({
      change: { kind: 'update', index: 1, key: 2 },
      issues: [{ message: 'Name is required' }],
    });
    expect(await readFile(join(dataDir, 'users.jsonl'), 'utf8')).toBe(before);
  });

  it('answers a batch of the wrong shape with 400', async () => {
    const response = await sendJsonRequest('POST', `${studio.url}/api/tables/users/changes`, { updates: [{ key: 1 }] });

    expect(response.status).toBe(400);
  });

  it('checks a batch without writing it, reporting the issues a save would meet', async () => {
    const before = await readFile(join(dataDir, 'users.jsonl'), 'utf8');

    const refused = await sendJsonRequest('POST', `${studio.url}/api/tables/users/check`, {
      updates: [{ key: 1, changes: { name: '' } }],
    });
    const accepted = await sendJsonRequest('POST', `${studio.url}/api/tables/users/check`, {
      updates: [{ key: 1, changes: { name: 'Alicia' } }],
    });

    expect(await bodyOf(refused)).toMatchObject({ ok: false, issues: [{ message: 'Name is required' }] });
    expect(await bodyOf(accepted)).toEqual({ ok: true });
    expect(await readFile(join(dataDir, 'users.jsonl'), 'utf8')).toBe(before);
    expect((await bodyOf(await fetch(`${studio.url}/api/tables/users/rows`))).rows[0].name).toBe('Alice');
  });

  describe('a table with rows that fail validation', () => {
    const NOTES = '{"id":1,"name":"first"}\n\n{"id":2,"extra":true}\n{"id":3,"name":"third"}\n';
    const notesPath = () => join(dataDir, 'notes.jsonl');

    beforeEach(async () => {
      await studio.close();
      await writeFile(notesPath(), NOTES);
      await writeFile(join(dataDir, 'notes.schema.ts'), NAME_REQUIRED_SCHEMA);
      studio = await startStudioServer({ dataDir, port: 0 });
    });

    it('is listed with how many of its rows fail, and columns read from the file', async () => {
      const notes = (await bodyOf(await fetch(`${studio.url}/api/tables`))).tables.find(
        (table: { name: string }) => table.name === 'notes',
      );

      expect(notes).toMatchObject({ name: 'notes', primaryKey: null, rowCount: 3, invalidRows: 1 });
      expect(notes.columns.map((column: { name: string }) => column.name)).toEqual(['id', 'name', 'extra']);
    });

    it('gives its schema file too, as the schema says why its rows fail', async () => {
      const notes = (await bodyOf(await fetch(`${studio.url}/api/tables`))).tables.find(
        (table: { name: string }) => table.name === 'notes',
      );
      const schema = await bodyOf(await fetch(`${studio.url}/api/tables/notes/schema`));

      expect(notes.schemaFile).toBe('notes.schema.ts');
      expect(schema).toEqual({ file: 'notes.schema.ts', source: NAME_REQUIRED_SCHEMA });
    });

    it('gives its rows as the file holds them, with the issues of each failing row by its index', async () => {
      const body = await bodyOf(await fetch(`${studio.url}/api/tables/notes/rows`));

      expect(body.rows).toEqual([
        { id: 1, name: 'first' },
        { id: 2, extra: true },
        { id: 3, name: 'third' },
      ]);
      expect(body.issues).toEqual({ 1: [{ message: 'Name is required', path: [{ key: 'name' }] }] });
    });

    it('writes a fixed row to its line only, leaving the other lines as they were, and then loads the table', async () => {
      const response = await sendJsonRequest('POST', `${studio.url}/api/tables/notes/changes`, {
        inserts: [],
        updates: [{ key: 1, changes: { name: 'second' }, resetToDefault: ['extra'] }],
        deletes: [],
      });

      expect(response.status).toBe(200);
      expect(await readFile(notesPath(), 'utf8')).toBe(
        '{"id":1,"name":"first"}\n\n{"id":2,"name":"second"}\n{"id":3,"name":"third"}\n',
      );
      const notes = (await bodyOf(await fetch(`${studio.url}/api/tables`))).tables.find(
        (table: { name: string }) => table.name === 'notes',
      );
      expect(notes).toMatchObject({ primaryKey: 'id', invalidRows: 0 });
    });

    it('applies several updates of one failing row in order, each on top of the one before', async () => {
      const response = await sendJsonRequest('POST', `${studio.url}/api/tables/notes/changes`, {
        inserts: [],
        updates: [
          { key: 1, changes: { name: 'second' } },
          { key: 1, changes: { extra: false } },
        ],
        deletes: [],
      });

      expect([response.status, await bodyOf(response)]).toEqual([200, { ok: true }]);
      expect(await readFile(notesPath(), 'utf8')).toBe(
        '{"id":1,"name":"first"}\n\n{"id":2,"extra":false,"name":"second"}\n{"id":3,"name":"third"}\n',
      );
    });

    it.skipIf(process.platform === 'win32')('keeps the permissions of the file it fixes a row in', async () => {
      await chmod(notesPath(), 0o600);

      await sendJsonRequest('POST', `${studio.url}/api/tables/notes/changes`, {
        inserts: [],
        updates: [{ key: 1, changes: { name: 'second' } }],
        deletes: [],
      });

      expect((await stat(notesPath())).mode & 0o777).toBe(0o600);
    });

    it('refuses a change that leaves the row failing, with its issues, and writes nothing', async () => {
      const response = await sendJsonRequest('POST', `${studio.url}/api/tables/notes/changes`, {
        inserts: [],
        updates: [{ key: 1, changes: { extra: false } }],
        deletes: [],
      });

      expect(response.status).toBe(400);
      expect((await bodyOf(response)).issues).toEqual([{ message: 'Name is required', path: [{ key: 'name' }] }]);
      expect(await readFile(notesPath(), 'utf8')).toBe(NOTES);
    });

    it('checks a change without writing it', async () => {
      const response = await sendJsonRequest('POST', `${studio.url}/api/tables/notes/check`, {
        inserts: [],
        updates: [{ key: 1, changes: { name: 'second' } }],
        deletes: [],
      });

      expect(await bodyOf(response)).toEqual({ ok: true });
      expect(await readFile(notesPath(), 'utf8')).toBe(NOTES);
    });

    it('marks a column the schema refuses as a key, which can only be removed, apart from a column holding a wrong value', async () => {
      await studio.close();
      await writeFile(
        join(dataDir, 'labels.schema.ts'),
        `export const schema = { '~standard': { version: 1, vendor: 'test', validate: (data) => {
  const issues = Object.keys(data).filter((key) => !['id', 'name', 'size'].includes(key)).map((key) => ({ message: 'Invalid key', path: [{ key }] }));
  if (typeof data.name !== 'string') issues.push({ message: 'Name is required', path: [{ key: 'name' }] });
  if (data.size !== undefined && typeof data.size !== 'number') issues.push({ message: 'Expected number', path: [{ key: 'size' }] });
  return issues.length > 0 ? { issues } : { value: data };
} } };
`,
      );
      await writeFile(
        join(dataDir, 'labels.jsonl'),
        '{"id":1,"name":"first","size":1}\n{"id":2,"name":"second","extra":true,"size":"big"}\n',
      );
      studio = await startStudioServer({ dataDir, port: 0 });

      const labels = (await bodyOf(await fetch(`${studio.url}/api/tables`))).tables.find(
        (table: { name: string }) => table.name === 'labels',
      );

      expect(
        Object.fromEntries(
          labels.columns.map((column: { name: string; unknown?: boolean }) => [column.name, Boolean(column.unknown)]),
        ),
      ).toEqual({
        id: false,
        name: false,
        size: false,
        extra: true,
      });
    });

    it('lists a field every row lacks but an issue names, so it can be filled in', async () => {
      await studio.close();
      await writeFile(join(dataDir, 'tasks.schema.ts'), NAME_REQUIRED_SCHEMA);
      await writeFile(join(dataDir, 'tasks.jsonl'), '{"id":1}\n{"id":2}\n');
      studio = await startStudioServer({ dataDir, port: 0 });

      const tasks = (await bodyOf(await fetch(`${studio.url}/api/tables`))).tables.find(
        (table: { name: string }) => table.name === 'tasks',
      );

      expect(tasks.columns).toEqual([
        expect.objectContaining({ name: 'id' }),
        expect.objectContaining({ name: 'name', type: 'JSON' }),
      ]);
    });

    it('says which edited rows still fail once saved, as a foreign key is checked only on load', async () => {
      await studio.close();
      await writeFile(join(dataDir, 'owners.jsonl'), '{"id":1}\n');
      await writeFile(join(dataDir, 'pets.jsonl'), '{"id":1,"owner":9,"name":"a"}\n');
      await writeFile(
        join(dataDir, 'pets.schema.ts'),
        "export const foreignKeys = [{ column: 'owner', references: { table: 'owners', column: 'id' } }];\n" +
          "export const schema = { '~standard': { version: 1, vendor: 'test', validate: (data) => ({ value: data }) } };\n",
      );
      studio = await startStudioServer({ dataDir, port: 0 });

      const response = await sendJsonRequest('POST', `${studio.url}/api/tables/pets/changes`, {
        inserts: [],
        updates: [{ key: 0, changes: { name: 'b' } }],
        deletes: [],
      });

      expect(response.status).toBe(200);
      expect((await bodyOf(response)).stillFailing).toEqual([
        { index: 0, issues: [expect.objectContaining({ path: [{ key: 'owner' }] })] },
      ]);
    });

    it('refuses to add or delete rows until the failing rows are fixed', async () => {
      const response = await sendJsonRequest('POST', `${studio.url}/api/tables/notes/changes`, {
        inserts: [{ id: 4, name: 'fourth' }],
        updates: [],
        deletes: [],
      });

      expect(response.status).toBe(409);
      expect(await readFile(notesPath(), 'utf8')).toBe(NOTES);
    });
  });

  describe('the built page', () => {
    let uiDir: string;

    beforeEach(async () => {
      uiDir = await mkdtemp(join(tmpdir(), 'linesdb-studio-ui-'));
      await mkdir(join(uiDir, 'assets'));
      await writeFile(join(uiDir, 'index.html'), '<!doctype html><head></head><div id="root"></div>');
      await writeFile(join(uiDir, 'assets', 'app.js'), 'console.log("app");');
      await studio.close();
      studio = await startStudioServer({ dataDir, port: 0, uiDir });
    });

    afterEach(async () => {
      await rm(uiDir, { recursive: true, force: true });
    });

    it('hands the page a nonce its CSP allows styles with, for an editor that injects its styles', async () => {
      const response = await fetch(`${studio.url}/`);
      const nonce = response.headers.get('content-security-policy')?.match(/style-src 'self' 'nonce-([^']+)'/)?.[1];

      expect(nonce).toBeTruthy();
      expect(await response.text()).toContain(`<meta name="csp-nonce" content="${nonce}">`);
    });

    it('is served with scripts and styles allowed only from the server itself', async () => {
      const response = await fetch(`${studio.url}/`);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(response.headers.get('content-security-policy')).toContain("script-src 'self'");
      expect(await response.text()).toContain('<div id="root"></div>');
    });

    it('serves an asset with the type its extension names', async () => {
      const response = await fetch(`${studio.url}/assets/app.js`);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/javascript');
      expect(await response.text()).toBe('console.log("app");');
    });

    it('refuses a path that leaves the directory of the built page', async () => {
      const { port, host } = new URL(studio.url);

      const response = await rawRequest({
        port,
        path: '/assets/../../users.jsonl',
        headers: { Host: host, Authorization: `Bearer ${studio.token}` },
      });

      expect(response.status).toBe(404);
    });

    it('answers 503 for the page when it has not been built, while the API keeps working', async () => {
      await studio.close();
      studio = await startStudioServer({ dataDir, port: 0, uiDir: join(uiDir, 'missing') });

      expect((await fetch(`${studio.url}/`)).status).toBe(503);
      expect((await fetch(`${studio.url}/api/tables`)).status).toBe(200);
    });
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
