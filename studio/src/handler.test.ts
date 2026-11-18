import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStudioHandler, type StudioHandler } from './server.js';

describe('studio handler', () => {
  let root: string;
  let dataDir: string;
  let uiDir: string;
  let studio: StudioHandler;
  const origin = 'http://studio.test';
  const call = (path: string, init: RequestInit = {}) =>
    studio.fetch(
      new Request(`${origin}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${studio.token}`, ...(init.headers as Record<string, string>) },
      }),
    );

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'linesdb-handler-'));
    dataDir = join(root, 'data');
    uiDir = join(root, 'ui');
    await mkdir(dataDir);
    await mkdir(uiDir);
    await writeFile(join(dataDir, 'users.jsonl'), '{"id":1,"name":"Alice"}\n{"id":2,"name":"Bob"}\n');
    await writeFile(join(uiDir, 'index.html'), '<html><head></head><body>studio</body></html>');
    studio = await createStudioHandler({ dataDir, uiDir });
  });

  afterEach(async () => {
    await studio.close();
    await rm(root, { recursive: true, force: true });
  });

  it('answers a request for any host, leaving the check of the Host to whoever listens', async () => {
    const response = await call('/api/tables');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ tables: [expect.objectContaining({ name: 'users' })] });
  });

  it('rejects an API request that does not present the token', async () => {
    const response = await studio.fetch(new Request(`${origin}/api/tables`));

    expect(response.status).toBe(401);
  });

  it('serves the page with the token it asks the API requests for', async () => {
    const response = await studio.fetch(new Request(`${origin}/`));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain(`<meta name="studio-token" content="${studio.token}">`);
  });

  it('accepts a write from the origin the request was made to and rejects one from another', async () => {
    const write = (from: string) =>
      call('/api/tables/users/rows/1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Origin: from },
        body: JSON.stringify({ changes: { name: 'Alicia' } }),
      });

    expect((await write('https://evil.example')).status).toBe(403);
    expect((await write(origin)).status).toBe(200);
  });

  it('streams an event to a connected page when a write changes the data', async () => {
    const events = await call(`/api/events`);
    const reader = events.body!.getReader();
    const decoder = new TextDecoder();
    const read = async () => decoder.decode((await reader.read()).value);

    expect(await read()).toBe(': connected\n\n');
    await call('/api/tables/users/rows/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ changes: { name: 'Alicia' } }),
    });

    expect(await read()).toBe('event: changed\ndata: {}\n\n');
  });

  it('ends the event streams when it is closed', async () => {
    const events = await call(`/api/events`);
    const reader = events.body!.getReader();
    await reader.read();

    await studio.close();

    expect((await reader.read()).done).toBe(true);
  });
});
