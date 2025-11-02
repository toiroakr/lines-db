# Bun Runtime Test

This test verifies lines-db compatibility with Bun.

## Current Status

✅ **Supported** - lines-db automatically detects the Bun runtime and uses `bun:sqlite`.

## Running the test

```bash
pnpm test:bun
# or from this directory
bun test
```

## What it tests

- ESM module loading in Bun
- Basic instantiation of LinesDB
- SQLite operations in Bun context using `bun:sqlite`
- Runtime detection and adapter switching

## Implementation

lines-db includes a runtime detection system that automatically switches between:

- `node:sqlite` for Node.js and Deno
- `bun:sqlite` for Bun

This allows the same API to work across all supported runtimes without any configuration.
