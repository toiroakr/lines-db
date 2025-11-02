# Deno Runtime Test

This test verifies that lines-db works correctly in the Deno runtime.

## Running the test

```bash
pnpm test:deno
# or from this directory
deno task test
```

## What it tests

- ESM module loading in Deno
- Basic instantiation of LinesDB
- SQLite operations in Deno context
- Deno's Node.js compatibility layer

## Requirements

- Deno 2.0 or later
