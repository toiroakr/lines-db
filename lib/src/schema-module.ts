import * as nodeModule from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RELOAD_PARAM = 'linesDbReload';

export interface SchemaImports {
  /** The module a schema file exports, evaluated anew together with the project files it imports */
  import(schemaPath: string): Promise<Record<string, unknown>>;
  /** The files evaluated so far, the schema files and the project files they import, as paths */
  files(): string[];
  /** Stops recording; the modules evaluated stay loaded, as the module cache cannot be emptied */
  dispose(): void;
}

const passes = new Map<string, Set<string>>();
let counter = 0;
let hooked = false;

function reloadOf(url: string): string | null {
  return url.includes(RELOAD_PARAM) ? new URL(url).searchParams.get(RELOAD_PARAM) : null;
}

// Not by what a specifier resolves to: a package linked from a workspace resolves outside node_modules too,
// and must stay one module across reloads
function isProjectSpecifier(specifier: string): boolean {
  return specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('file:');
}

function hookImports(): boolean {
  if (hooked) return true;
  // Without synchronous hooks (a runtime other than Node, or Node before 22.15) only the schema file itself is read again
  if (typeof nodeModule.registerHooks !== 'function') return false;
  nodeModule.registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context);
      if (!resolved.url.startsWith('file:')) return resolved;
      const own = reloadOf(resolved.url);
      if (own) {
        passes.get(own)?.add(fileURLToPath(resolved.url));
        return resolved;
      }
      const reload = context.parentURL ? reloadOf(context.parentURL) : null;
      if (!reload || !isProjectSpecifier(specifier) || resolved.url.includes('/node_modules/')) return resolved;
      const url = new URL(resolved.url);
      url.searchParams.set(RELOAD_PARAM, reload);
      passes.get(reload)?.add(fileURLToPath(url));
      return { ...resolved, url: url.href };
    },
  });
  hooked = true;
  return true;
}

/**
 * Imports of schema files that share one evaluation of the project files they import: a file imported
 * by several schemas is evaluated once for all of them, and again for the next set of imports
 */
export function createSchemaImports(): SchemaImports {
  const id = `${Date.now()}-${++counter}`;
  const files = new Set<string>();
  passes.set(id, files);
  const hooks = hookImports();
  return {
    async import(schemaPath) {
      const url = new URL(pathToFileURL(schemaPath).href);
      url.searchParams.set(RELOAD_PARAM, hooks ? id : `${Date.now()}`);
      return (await import(url.href)) as Record<string, unknown>;
    },
    files: () => [...files],
    dispose() {
      passes.delete(id);
    },
  };
}
