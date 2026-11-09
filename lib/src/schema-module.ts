import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const VERSION_PARAM = 'linesDbV';
// Not the shape of one copy of this package: another copy, of another version, shares the hook and the graph
const SHARED = Symbol.for('lines-db:schema-imports:1');

export interface SchemaImports {
  /** The module a schema file exports, with the project files it imports as they are now */
  import(schemaPath: string): Promise<Record<string, unknown>>;
  /**
   * The project files a schema file imports, with what each held when it was read; not the schema files
   * themselves. Of the schema files imported so far when none is given
   */
  dependencies(schemaPath?: string): Map<string, string>;
}

interface Shared {
  /** The files a file imported when it was evaluated */
  graph: Map<string, Set<string>>;
  /** The URL of the evaluation of each file that `graph` records the imports of */
  evaluated: Map<string, string>;
  /** The version of each file, as of the import in progress */
  versions: Map<string, string>;
  /** What each file held when its version was taken, before it was evaluated */
  hashes: Map<string, string>;
  /** Changes after an import failed, so that every file is imported anew: Node.js 22 keeps a failed import under its URL */
  salt: string;
  hooked: boolean;
}

let counter = 0;

const shared: Shared = ((globalThis as Record<symbol, unknown>)[SHARED] ??= {
  graph: new Map(),
  evaluated: new Map(),
  versions: new Map(),
  hashes: new Map(),
  salt: '',
  hooked: false,
}) as Shared;

const packageRoots = new Map<string, string>();

function hashOf(parts: Array<string | Buffer>): string {
  const hash = createHash('sha1');
  for (const part of parts) hash.update(part).update('\0');
  return hash.digest('hex');
}

function contentOf(file: string): Buffer | string {
  try {
    return readFileSync(file);
  } catch {
    return 'missing';
  }
}

export function hashContent(content: Buffer | string): string {
  return createHash('sha1').update(content).digest('hex');
}

/**
 * What the file is, with what it imports: a file evaluated again only when it or a file it imports changed,
 * as a URL that names the version is one module for as long as the version stays. An import not recorded
 * yet is not in the version. A file importing itself through others is taken by its own content there, so
 * a version that was cut by a cycle is kept only for the file the count started from, which holds all of it
 */
function versionOf(file: string, visiting = new Set<string>()): { version: string; whole: boolean } {
  const known = shared.versions.get(file);
  if (known) return { version: known, whole: true };
  const content = contentOf(file);
  if (!shared.hashes.has(file)) shared.hashes.set(file, hashContent(content));
  if (visiting.has(file)) return { version: hashOf([shared.salt, content]), whole: false };
  visiting.add(file);
  let whole = true;
  const versions: string[] = [];
  for (const imported of [...(shared.graph.get(file) ?? [])].sort()) {
    const importedVersion = versionOf(imported, visiting);
    versions.push(importedVersion.version);
    whole &&= importedVersion.whole;
  }
  visiting.delete(file);
  const version = hashOf([shared.salt, content, ...versions]);
  if (whole || visiting.size === 0) shared.versions.set(file, version);
  return { version, whole };
}

function packageRootOf(file: string): string {
  const start = dirname(file);
  const cached = packageRoots.get(start);
  if (cached !== undefined) return cached;
  let dir = start;
  let root = '';
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) {
      root = dir;
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  packageRoots.set(start, root);
  return root;
}

function hookImports(): boolean {
  if (shared.hooked) return true;
  // Without synchronous hooks (a runtime other than Node.js) only the schema file itself is read again
  if (typeof nodeModule.registerHooks !== 'function') return false;
  nodeModule.registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context);
      if (!context.parentURL?.includes(VERSION_PARAM) || !resolved.url.startsWith('file:')) return resolved;
      if (!new URL(context.parentURL).searchParams.has(VERSION_PARAM) || resolved.url.includes('/node_modules/')) {
        return resolved;
      }
      const url = new URL(resolved.url);
      if (url.searchParams.has(VERSION_PARAM)) return resolved;
      const parent = fileURLToPath(context.parentURL);
      const imported = fileURLToPath(url);
      // Not beyond the package of the importing file, whatever the specifier: a file of another package, such
      // as one linked from a workspace, is shared with the program and stays one module
      if (packageRootOf(imported) !== packageRootOf(parent)) return resolved;
      // Not added to what an earlier evaluation of the parent imported: a file it no longer imports is not a dependency
      let imports = shared.graph.get(parent);
      if (!imports || shared.evaluated.get(parent) !== context.parentURL) {
        imports = new Set<string>();
        shared.graph.set(parent, imports);
        shared.evaluated.set(parent, context.parentURL);
      }
      imports.add(imported);
      url.searchParams.set(VERSION_PARAM, versionOf(imported).version);
      return { ...resolved, url: url.href };
    },
  });
  shared.hooked = true;
  return true;
}

function realFile(file: string): string {
  try {
    return realpathSync(file);
  } catch {
    // The import reports a file that is not there
    return file;
  }
}

function importedBy(entries: Set<string>): string[] {
  const files = new Set<string>();
  const pending = [...entries].flatMap((entry) => [...(shared.graph.get(entry) ?? [])]);
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (files.has(file)) continue;
    files.add(file);
    pending.push(...(shared.graph.get(file) ?? []));
  }
  return [...files].filter((file) => !entries.has(file));
}

/**
 * Imports of schema files in which a file imported by several of them, and by the same one again, is
 * evaluated once: the versions are taken at the first import of a file and kept for the ones after it
 */
export function createSchemaImports(): SchemaImports {
  const hooks = hookImports();
  // Not kept from an earlier set of imports: a file is read as it is now, and one version of it serves them all
  shared.versions.clear();
  shared.hashes.clear();
  const modules = new Map<string, Promise<Record<string, unknown>>>();
  return {
    import(schemaPath) {
      const file = realFile(schemaPath);
      const known = modules.get(file);
      if (known) return known;
      const url = new URL(pathToFileURL(file).href);
      url.searchParams.set(VERSION_PARAM, hooks ? versionOf(file).version : `${Date.now()}`);
      const loaded = import(url.href) as Promise<Record<string, unknown>>;
      // Not by the file that failed: a missing file added later does not change the version of the one importing it
      loaded.catch(() => {
        shared.salt = `${Date.now()}-${++counter}`;
      });
      modules.set(file, loaded);
      return loaded;
    },
    dependencies: (schemaPath) =>
      new Map(
        importedBy(new Set(schemaPath ? [realFile(schemaPath)] : modules.keys())).map((file) => [
          file,
          shared.hashes.get(file) ?? hashContent(contentOf(file)),
        ]),
      ),
  };
}
