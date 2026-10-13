import { execFile, spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
const env = { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' };

describe('Studio package installation', () => {
  let project: string;
  let core: string;
  let cli: string;

  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), 'lines-db-packages-'));
    core = join(project, 'node_modules/lines-db');
    await mkdir(core, { recursive: true });
    const manifest = JSON.parse(await readFile(join(root, 'lib/package.json'), 'utf8'));
    await writeFile(join(core, 'package.json'), JSON.stringify(manifest));
    for (const directory of ['bin', 'dist']) {
      await cp(join(root, 'lib', directory), join(core, directory), { recursive: true });
    }
    for (const dependency of Object.keys(manifest.dependencies)) {
      const target = join(project, 'node_modules', dependency);
      await mkdir(dirname(target), { recursive: true });
      await symlink(join(root, 'lib/node_modules', dependency), target, 'junction');
    }
    cli = join(core, 'bin/cli.mjs');
    await mkdir(join(project, 'data'));
    await writeFile(join(project, 'data/users.jsonl'), '{"id":1,"name":"Alice"}\n');
  });

  afterEach(async () => {
    await rm(project, { recursive: true, force: true });
  });

  it('runs other commands without Studio and explains how to install it on studio', async () => {
    const result = await exec(process.execPath, [cli, 'validate', join(project, 'data')], {
      cwd: project,
      env,
      timeout: 10000,
    });
    expect(result.stdout).toContain('users');
    await expect(
      exec(process.execPath, [cli, 'studio', join(project, 'data')], { cwd: project, env, timeout: 10000 }),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('npm install -D @lines-db/studio'),
    });
  }, 15000);

  it('serves the shipped page and data when Studio is installed', async () => {
    const studio = join(project, 'node_modules/@lines-db/studio');
    await mkdir(studio, { recursive: true });
    await cp(join(root, 'studio/package.json'), join(studio, 'package.json'));
    for (const directory of ['dist', 'ui']) {
      await cp(join(root, 'studio', directory), join(studio, directory), { recursive: true });
    }
    const child = spawn(process.execPath, [cli, 'studio', join(project, 'data'), '--port', '0'], { cwd: project, env });
    let output = '';
    let errors = '';
    child.stderr.on('data', (chunk) => (errors += chunk.toString()));
    try {
      const url = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Studio did not start: ${errors}`)), 10000);
        child.stdout.on('data', (chunk) => {
          output += chunk.toString();
          const match = /http:\/\/127\.0\.0\.1:\d+/.exec(output);
          if (match) {
            clearTimeout(timeout);
            resolve(match[0]);
          }
        });
        child.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        child.once('exit', (code) => {
          clearTimeout(timeout);
          reject(new Error(`Studio exited with ${code}: ${errors}`));
        });
      });
      const page = await fetch(url);
      expect(page.status).toBe(200);
      const html = await page.text();
      const token = /<meta name="studio-token" content="([^"]+)">/.exec(html)?.[1];
      expect(token).toBeTruthy();
      const asset = /src="([^"]+\.js)"/.exec(html)?.[1];
      expect(asset).toBeTruthy();
      expect((await fetch(new URL(asset!, `${url}/`))).status).toBe(200);
      const tables = await fetch(`${url}/api/tables`, { headers: { Authorization: `Bearer ${token}` } });
      expect(await tables.json()).toMatchObject({ tables: [expect.objectContaining({ name: 'users' })] });
    } finally {
      if (child.exitCode === null) {
        const stopped = new Promise<void>((resolve) => child.once('exit', () => resolve()));
        child.kill('SIGTERM');
        await stopped;
      }
    }
  }, 15000);
});
