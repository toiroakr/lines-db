# lines-db

[日本語版 README](./README.ja.md) | [English README](./README.md)

A lightweight database implementation that treats JSONL (JSON Lines) files as tables using SQLite. Perfect for managing application seed data and testing.

## Features

- 📝 Load JSONL files as database tables
- 🔄 Automatic schema inference
- 💾 In-memory or file-based SQLite storage
- 🚀 Full SQL query support
- 🔍 Simple query API
- 📦 **JSON column support** with automatic serialization/deserialization
- ✅ Built-in validation using StandardSchema (supports Valibot, Zod, and more)
- 🎯 **Automatic type inference from table names** (no type arguments needed!)
- 🔄 **Bidirectional schema transformations** with automatic backward conversion
- 💾 **Auto-sync to JSONL files** - persist database changes back to files
- 🛡️ Type-safe with TypeScript
- 🧪 Minimal dependencies (uses built-in SQLite in each runtime)
- 🌐 **Multi-runtime support** - works with Node.js, Bun, and Deno

## Quick Start

```bash
npm install @toiroakr/lines-db
```

```typescript
import { LinesDB } from '@toiroakr/lines-db';

const db = LinesDB.create({ dataDir: './data' });
await db.initialize();

const users = db.find('users');
await db.close();
```

**For full documentation, see [lib/README.md](./lib/README.md)**

## Repository Structure

This repository is organized as a monorepo:

```
lines-db/
├── lib/                 # Core library package (@toiroakr/lines-db)
│   ├── src/            # Source code
│   ├── dist/           # Build output (ESM + CJS)
│   ├── bin/            # CLI executable
│   └── README.md       # 📚 User documentation (published to npm)
├── tests/              # Integration tests
│   ├── unit/          # Unit tests
│   ├── runtime-cjs/   # Node.js CommonJS tests
│   ├── runtime-deno/  # Deno tests
│   └── runtime-bun/   # Bun tests
├── examples/           # Usage examples
└── extension/          # VSCode extension
```

## Packages

### 📦 Core Library: [@toiroakr/lines-db](./lib)

The main npm package that provides the database functionality.

**[→ Full documentation](./lib/README.md)**

**Features:**

- JSONL file loading and parsing
- SQLite database abstraction
- Schema inference and validation
- Type-safe query APIs
- Multi-runtime support (Node.js 22.5+, Bun 1.0+, Deno 2.0+)
- CLI tools for validation and type generation

### 🔌 VSCode Extension: [lines-db-vscode](./extension)

VSCode extension for lines-db with real-time validation and development tools.

**[→ Extension documentation](./extension/README.md)**

**Features:**

- Command palette integration (validate, migrate)
- Real-time validation diagnostics
- CodeLens showing record counts
- Hover information for schema files
- JSONL syntax highlighting

## Development

### Prerequisites

- Node.js 22.5.0 or later
- pnpm 10.x or later

### Setup

```bash
# Install dependencies
pnpm install

# Build the library
cd lib
pnpm run build
```

### Testing

```bash
# Run unit tests
pnpm test

# Run all runtime tests (Node.js, Deno, Bun)
pnpm test:runtime

# Run specific runtime tests
pnpm test:cjs   # Node.js CommonJS
pnpm test:deno  # Deno
pnpm test:bun   # Bun

# Run all tests
pnpm test:all
```

### Runtime Tests

lines-db is tested across three runtimes using a shared test suite:

- **Node.js (CommonJS)**: `tests/runtime-cjs/` - Tests with CommonJS module system
- **Deno**: `tests/runtime-deno/` - Tests with Deno runtime
- **Bun**: `tests/runtime-bun/` - Tests with Bun runtime

Each runtime test runs the same test suite (16 test cases) located in `tests/shared/test-suite.ts`.

### Other Commands

```bash
# Type checking
pnpm typecheck

# Linting
pnpm lint
pnpm lint:fix

# Formatting
pnpm format
pnpm format:check

# Run examples
pnpm example
pnpm example:validation
pnpm example:json
pnpm example:datadir
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Workflow

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Publishing

This project uses [changesets](https://github.com/changesets/changesets) for version management:

```bash
# Create a changeset
pnpm changeset

# Version packages
pnpm version

# Publish to npm
pnpm release
```

## License

MIT

## Links

- **npm**: [@toiroakr/lines-db](https://www.npmjs.com/package/@toiroakr/lines-db)
- **GitHub**: [toiroakr/lines-db](https://github.com/toiroakr/lines-db)
- **Issues**: [github.com/toiroakr/lines-db/issues](https://github.com/toiroakr/lines-db/issues)
- **Documentation**: [lib/README.md](./lib/README.md)
- **Extension**: [extension/README.md](./extension/README.md)
