import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const VERSION_PARAM = 'linesDbV';
// Not the shape of one copy of this package: another copy, of another version, shares the hook and the graph
const SHARED = Symbol.for('lines-db:schema-imports:1');

export interface SchemaImports {
  /** The module a schema file exports, with the project files it imports as they are now */
  import(schemaPath: string): Promise<Record<string, unknown>>;
  /** The project files the schema files imported so far import, as paths; not the schema files themselves */
  files(): string[];
}

interface Shared {
  /** The files a file imported when it was evaluated */
  graph: Map<string, Set<string>>;
  /** The version of each file, as of the import in progress */
  versions: Map<string, string>;
  hooked: boolean;
}

const shared: Shared = ((globalThis as Record<symbol, unknown>)[SHARED] ??= {
  graph: new Map(),
  versions: new Map(),
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

/**
 * What the file is, with what it imports: a file evaluated again only when it or a file it imports changed,
 * as a URL that names the version is one module for as long as the version stays. An import not recorded
 * yet is not in the version, and a file importing itself through others is taken by its own content
 */
function versionOf(file: string, visiting = new Set<string>()): string {
  const known = shared.versions.get(file);
  if (known) return known;
  if (visiting.has(file)) return hashOf([contentOf(file)]);
  visiting.add(file);
  const imports = [...(shared.graph.get(file) ?? [])].sort();
  const version = hashOf([contentOf(file), ...imports.map((imported) => versionOf(imported, visiting))]);
  visiting.delete(file);
  shared.versions.set(file, version);
  return version;
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

// Not by what a specifier resolves to: a package linked from a workspace resolves outside node_modules too,
// and must stay one module across reloads
function isProjectSpecifier(specifier: string): boolean {
  return specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('file:');
}

function hookImports(): boolean {
  if (shared.hooked) return true;
  // Without synchronous hooks (a runtime other than Node, or Node before 22.15) only the schema file itself is read again
  if (typeof nodeModule.registerHooks !== 'function') return false;
  nodeModule.registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context);
      if (!context.parentURL?.includes(VERSION_PARAM) || !resolved.url.startsWith('file:')) return resolved;
      if (!new URL(context.parentURL).searchParams.has(VERSION_PARAM)) return resolved;
      if (!isProjectSpecifier(specifier) || resolved.url.includes('/node_modules/')) return resolved;
      const url = new URL(resolved.url);
      if (url.searchParams.has(VERSION_PARAM)) return resolved;
      const parent = fileURLToPath(context.parentURL);
      const imported = fileURLToPath(url);
      // Not beyond the package of the importing file: a file of another package is shared with the program, and stays one module
      const root = packageRootOf(parent);
      if (root && !imported.startsWith(root + sep)) return resolved;
      const imports = shared.graph.get(parent) ?? new Set<string>();
      imports.add(imported);
      shared.graph.set(parent, imports);
      url.searchParams.set(VERSION_PARAM, versionOf(imported));
      return { ...resolved, url: url.href };
    },
  });
  shared.hooked = true;
  return true;
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
  const modules = new Map<string, Promise<Record<string, unknown>>>();
  return {
    import(schemaPath) {
      let file = schemaPath;
      try {
        file = realpathSync(schemaPath);
      } catch {
        // The import below reports a file that is not there
      }
      const known = modules.get(file);
      if (known) return known;
      const url = new URL(pathToFileURL(file).href);
      url.searchParams.set(VERSION_PARAM, hooks ? versionOf(file) : `${Date.now()}`);
      const loaded = import(url.href) as Promise<Record<string, unknown>>;
      modules.set(file, loaded);
      return loaded;
    },
    files: () => importedBy(new Set(modules.keys())),
  };
}
