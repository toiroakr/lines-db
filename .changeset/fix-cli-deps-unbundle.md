---
'@toiroakr/lines-db': patch
---

Stop bundling `zod` and `politty` into the CLI binary (`bin/cli.mjs`) and declare them as regular
`dependencies` instead of `devDependencies`. Both are implementation details of the CLI's argument
parsing (`src/cli.ts`) — the library's public API (`src/index.ts`) never touches them — but bundling
them baked in a copy that could drift from the `zod` version `politty` itself requires as a peer
dependency. Installing them as ordinary dependencies keeps a single, consistent `zod` instance.

No functional change for consumers: `npx lines-db` and installed CLI usage behave identically, just
with a smaller bundled binary and `politty`/`zod` resolved from `node_modules` instead.
