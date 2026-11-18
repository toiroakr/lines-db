import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { createStudioHandler, startStudioServer, type StudioHandler } from './server.js';

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
    const response = await studio.fetch(
      new Request('http://elsewhere.example:9999/api/tables', {
        headers: { Authorization: `Bearer ${studio.token}` },
      }),
    );

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

  describe('framing', () => {
    const framingOf = async (options: Partial<Parameters<typeof createStudioHandler>[0]> = {}) => {
      const framed = await createStudioHandler({ dataDir, uiDir, ...options });
      try {
        const response = await framed.fetch(new Request(`${origin}/`));
        return response.headers.get('Content-Security-Policy') ?? '';
      } finally {
        await framed.close();
      }
    };

    it('keeps the page out of every frame unless told otherwise', async () => {
      expect(await framingOf()).toContain("frame-ancestors 'none'");
    });

    it('lets a page of the same origin frame it when asked to', async () => {
      expect(await framingOf({ frameAncestors: 'self' })).toContain("frame-ancestors 'self'");
    });
  });

  describe('request headers', () => {
    const metaOf = async (requestHeaders?: Record<string, string>) => {
      const hosted = await createStudioHandler({ dataDir, uiDir, requestHeaders });
      try {
        const html = await (await hosted.fetch(new Request(`${origin}/`))).text();
        return /<meta name="studio-request-headers" content="([^"]*)">/.exec(html)?.[1];
      } finally {
        await hosted.close();
      }
    };

    it('hands the page the headers to send with every API request, escaped for the attribute', async () => {
      const content = await metaOf({ 'x-token': 'a"b<c>&d' });

      expect(content).not.toMatch(/["<>]/);
      const decoded = content!
        .replaceAll('&quot;', '"')
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&amp;', '&');
      expect(JSON.parse(decoded)).toEqual({ 'x-token': 'a"b<c>&d' });
    });

    it('hands over a value that has a replacement pattern of a string replace in it as it is', async () => {
      const content = await metaOf({ 'x-token': 'a$$b$&c$`d' });

      expect(JSON.parse(content!.replaceAll('&quot;', '"').replaceAll('&amp;', '&'))).toEqual({
        'x-token': 'a$$b$&c$`d',
      });
    });

    it('leaves the page without the entry when there are none', async () => {
      expect(await metaOf()).toBeUndefined();
    });
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

  it('ends the event stream of a request that is aborted after it connected', async () => {
    const aborted = new AbortController();
    const events = await studio.fetch(
      new Request(`${origin}/api/events`, {
        headers: { Authorization: `Bearer ${studio.token}` },
        signal: aborted.signal,
      }),
    );
    const reader = events.body!.getReader();
    await reader.read();

    aborted.abort();

    expect((await reader.read()).done).toBe(true);
  });

  it('ends the event stream of a request that was aborted before it arrived', async () => {
    const events = await studio.fetch(
      new Request(`${origin}/api/events`, {
        headers: { Authorization: `Bearer ${studio.token}` },
        signal: AbortSignal.abort(),
      }),
    );

    expect((await events.body!.getReader().read()).done).toBe(true);
  });

  it('turns away a request that arrives while it is closing, so no event stream outlives it', async () => {
    const closing = studio.close();

    const late = await call('/api/events');
    await closing;

    expect(late.status).toBe(503);
  });

  it('ends the event streams when it is closed', async () => {
    const events = await call(`/api/events`);
    const reader = events.body!.getReader();
    await reader.read();

    await studio.close();

    expect((await reader.read()).done).toBe(true);
  });

  describe('behind a node server', () => {
    it('answers a method the fetch standard forbids with a client error and keeps serving', async () => {
      const server = await startStudioServer({ dataDir, uiDir, port: 0 });
      try {
        const { port } = new URL(server.url);
        const send = async (method: string) => {
          const request = httpRequest({ host: '127.0.0.1', port, method, path: '/' });
          request.end();
          const [response] = (await once(request, 'response')) as [{ statusCode: number; resume(): void }];
          response.resume();
          return response.statusCode;
        };

        expect([await send('TRACE'), await send('GET')]).toEqual([400, 200]);
      } finally {
        await server.close();
      }
    });
  });
});
