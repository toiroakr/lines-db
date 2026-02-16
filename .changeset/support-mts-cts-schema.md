---
"@toiroakr/lines-db": minor
---

feat: support .mts and .cts schema file extensions

Schema files are now auto-detected with the following priority: `.schema.ts` > `.schema.mts` > `.schema.cts`. Mixed extensions within a single project are supported.

- Added `--output` option to `generate` command for specifying the output file path (e.g., `--output ./data/db.mts`)
- Import paths are correctly rewritten: `.ts`→`.js`, `.mts`→`.mjs`, `.cts`→`.cjs`
- New exported utilities: `findSchemaFile`, `isSchemaFile`, `extractTableNameFromSchemaFile`, `rewriteExtensionForImport`, `SCHEMA_EXTENSIONS`
