# CommonJS Runtime Test

This test verifies that lines-db works correctly in CommonJS (Node.js) environments.

## Running the test

```bash
pnpm test:cjs
# or from this directory
pnpm test
```

## What it tests

- CommonJS module loading using `require()`
- Basic instantiation of LinesDB
- SQLite operations in CommonJS context
