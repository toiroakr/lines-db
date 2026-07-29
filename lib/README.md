# lines-db

A data management library that treats JSONL (JSON Lines) files as tables. Perfect for managing application seed data and testing.

## Features

- 📝 Load JSONL files as database tables
- ✅ **CLI tools for validation and data migration**
- 🔄 Automatic schema inference
- 📦 **JSON column support** with automatic serialization/deserialization
- ✅ Built-in validation using StandardSchema (Valibot, Zod, etc.)
- 🎯 **Automatic type inference from table names**
- 🔄 **Bidirectional schema transformations**
- 💾 **Auto-sync to JSONL files**
- 🛡️ Type-safe with TypeScript
- Node.js 22.5+ support

## VS Code Extension

A VS Code extension is available that provides syntax highlighting and validation for JSONL files with schema support.

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/toiroakr.lines-db-vscode?label=VS%20Code%20Marketplace&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=toiroakr.lines-db-vscode)

[Install from VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=toiroakr.lines-db-vscode)

## Installation

```bash
npm install @toiroakr/lines-db
# or
pnpm add @toiroakr/lines-db
```

## CLI Usage

### Setting Up Schemas

Create schema files alongside your JSONL files:

**Directory structure:**

```
data/
  ├── users.jsonl
  ├── users.schema.ts
  ├── products.jsonl
  └── products.schema.ts
```

**Example schema (users.schema.ts):**

```typescript
import * as v from 'valibot';
import { defineSchema } from '@toiroakr/lines-db';

export const schema = defineSchema(
  v.object({
    id: v.pipe(v.number(), v.integer(), v.minValue(1)),
    name: v.pipe(v.string(), v.minLength(1)),
    age: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(150)),
    email: v.pipe(v.string(), v.email()),
  }),
);
export default schema;
```

**Supported validation libraries:**

- Any library implementing [StandardSchema](https://standardschema.dev/)

### Validate JSONL Files

Validate your JSONL files against their schemas:

```bash
npx lines-db validate <path>
```

**Example:**

```bash
# Validate all JSONL files in ./data directory
npx lines-db validate ./data

# Validate a specific file
npx lines-db validate ./data/users.jsonl

# Verbose output
npx lines-db validate ./data --verbose
```

This command will:

- For directories: Find all `.jsonl` files in the directory
- For files: Validate the specified `.jsonl` file
- Load corresponding `.schema.ts` files
- Validate each record against the schema
- Report validation errors with detailed messages

### Migrate Data

Transform data in JSONL files with validation:

```bash
npx lines-db migrate <file> <transform> [options]
```

**Example:**

```bash
# Update all ages by adding 1
npx lines-db migrate ./data/users.jsonl "(row) => ({ ...row, age: row.age + 1 })"

# Migrate with filter
npx lines-db migrate ./data/users.jsonl "(row) => ({ ...row, active: true })" --filter "{ age: (age) => age > 18 }"

# Save transformed data on error
npx lines-db migrate ./data/users.jsonl "(row) => ({ ...row, age: row.age + 1 })" --errorOutput ./migrated.jsonl

# Backfill ids without rewriting anything else
npx lines-db migrate ./data "(row) => ({ ...row, id: row.id ?? crypto.randomUUID() })" --fields id
```

**Options:**

- `--filter, -f <expr>` - Filter expression to select rows
- `--fields <list>` - Comma-separated fields to write back; every other field keeps the value the JSONL file already had (default: write every field)
- `--errorOutput, -e <path>` - Save transformed data to file if migration fails
- `--verbose, -v` - Show detailed error messages

The migration runs in a transaction and validates all transformed rows before committing.

#### Writing back only some fields

By default a migration writes each row back in full, so values a validation schema computed and
fields the JSONL file omitted end up materialized in the file. `--fields` narrows the write-back to
the fields you name - everything else in the line is left exactly as it was:

```bash
# users.jsonl before: {"name":"John"}
npx lines-db migrate ./data/users.jsonl "(row) => row" --fields id
# users.jsonl after:  {"name":"John","id":"..."}
```

Rows are matched to their existing line by primary key, or by position when the file does not carry
one yet (the case when the primary key itself is being backfilled). Rows the file never had are
written in full, since there is nothing to preserve for them. When rows cannot be matched to their
lines - the file has no usable primary key _and_ the row count changed - the migration fails instead
of guessing.

One list covers every table the migration touches. A table that does not have a named field simply
has nothing written back to it, so a directory holding tables that do not all share an `id` works
with a single `--fields id`. A field _no_ table has is a typo, and the migration stops.

## TypeScript Usage

### Generate Types

Generate TypeScript types from your schemas for type-safe database access:

```bash
npx lines-db generate <dataDir>
```

**Example:**

```bash
# Generate types (creates ./data/db.ts by default)
npx lines-db generate ./data
```

**Add to package.json:**

```json
"scripts": {
  "db:validate": "lines-db validate ./data",
  "db:generate": "lines-db generate ./data"
}
```

### Quick Start

**1. Create a JSONL file (./data/users.jsonl):**

```jsonl
{"id":1,"name":"Alice","age":30,"email":"alice@example.com"}
{"id":2,"name":"Bob","age":25,"email":"bob@example.com"}
{"id":3,"name":"Charlie","age":35,"email":"charlie@example.com"}
```

**2. Use in TypeScript:**

```typescript
import { LinesDB } from '@toiroakr/lines-db';

const db = LinesDB.create({ dataDir: './data' });
await db.initialize();

// Find all users
const users = db.find('users');
console.log(users); // [{ id: 1, name: "Alice", ... }, ...]

// Find a specific user
const user = db.findOne('users', { id: 1 });
console.log(user); // { id: 1, name: "Alice", age: 30, ... }

// Find with conditions
const adults = db.find('users', { age: (age) => age >= 30 });

await db.close();
```

### Using Generated Types

After running `npx lines-db generate ./data`:

```typescript
import { LinesDB } from '@toiroakr/lines-db';
import { config } from './data/db.js';

const db = LinesDB.create(config);
await db.initialize();

// ✨ Type is automatically inferred!
const users = db.find('users');

// ✨ Type-safe operations
db.insert('users', {
  id: 10,
  name: 'Alice',
  age: 30,
  email: 'alice@example.com',
});

await db.close();
```

### Core API

**Query Operations:**

- `find(table, where?)` - Find all matching records
- `findOne(table, where?)` - Find a single record
- `query(sql, params?)` - Execute raw SQL query

**Modify Operations:**

- `insert(table, data)` - Insert a single record
- `update(table, data, where)` - Update matching records
- `delete(table, where)` - Delete matching records

**Batch Operations:**

- `batchInsert(table, data[])` - Insert multiple records
- `batchUpdate(table, updates[])` - Update multiple records
- `batchDelete(table, where)` - Delete multiple records

**Transaction & Schema:**

- `transaction(fn)` - Execute operations in a transaction
- `sync(table?, options?)` - Write changes back to the JSONL file(s)
- `getSchema(table)` - Get table schema
- `getTableNames()` - Get all table names

**Where Conditions:**

```typescript
// Simple equality
db.find('users', { age: 30 });

// Multiple conditions (AND)
db.find('users', { age: 30, name: 'Alice' });

// Advanced conditions
db.find('users', {
  age: (age) => age > 25,
  name: (name) => name.startsWith('A'),
});
```

### JSON Columns

Objects and arrays are automatically handled as JSON columns:

```typescript
db.insert('orders', {
  id: 1,
  items: [{ name: 'Laptop', quantity: 1 }],
  metadata: { source: 'web' },
});

const order = db.findOne('orders', { id: 1 });
console.log(order.items[0].name); // "Laptop"
```

### Schema Transformations

When your schema transforms data types (e.g., parsing date strings into Date objects), you need to provide a backward transformation to save data back to JSONL files.

**Why?** JSONL files store strings like `"2024-01-01"`, but your app works with `Date` objects. You need to convert both ways.

**Example:**

```typescript
import * as v from 'valibot';
import { defineSchema } from '@toiroakr/lines-db';

const eventSchema = v.pipe(
  v.object({
    id: v.number(),
    // Transform: string → Date (when reading)
    date: v.pipe(
      v.string(),
      v.isoDate(),
      v.transform((str) => new Date(str)),
    ),
  }),
);

// Provide backward transformation: Date → string (when writing)
export const schema = defineSchema(eventSchema, (output) => ({
  ...output,
  date: output.date.toISOString(), // Convert Date back to string
}));
```

**In your JSONL file (events.jsonl):**

```jsonl
{
  "id": 1,
  "date": "2024-01-01T00:00:00.000Z"
}
```

**In your TypeScript code:**

```typescript
const event = db.findOne('events', { id: 1 });
console.log(event.date instanceof Date); // true
console.log(event.date.getFullYear()); // 2024
```

### Transactions

Operations outside transactions are auto-synced:

```typescript
db.insert('users', { id: 10, name: 'Alice', age: 30 });
// ↑ Automatically synced to users.jsonl
```

Batch operations with transactions:

```typescript
await db.transaction(async (tx) => {
  tx.insert('users', { id: 10, name: 'Alice', age: 30 });
  tx.update('users', { age: 31 }, { id: 1 });
  // All changes synced atomically on commit
});
```

### Writing Back Only Some Fields

A sync writes each row back in full by default, which materializes values a validation schema
computed and fields the JSONL file omitted. Name the fields to write back to keep the rest of every
line exactly as the file had it:

```typescript
// users.jsonl: {"name":"Alice"}
await db.sync('users', { fields: ['id'] });
// users.jsonl: {"name":"Alice","id":"..."}
```

Use `writeBackFields` on the config to apply the same rule to every sync, including the automatic
sync after an insert, update, or transaction:

```typescript
const db = LinesDB.create({ dataDir: './data', writeBackFields: ['id'] });
```

Rows are matched to their existing line by primary key, or by position when the file does not carry
one yet (the case when the primary key itself is being backfilled). Rows the file never had are
written in full. A field you name is always taken from the database - including when it is `null`
there - and `sync` throws when rows cannot be matched to their lines, rather than guessing.

`sync('users', { fields })` names one table, so a field that table does not have is rejected. A sync
covering every table - `sync()` or the config option - leaves such a field out of the tables without
it instead, so one list can serve a directory of tables that do not all share it.

## Configuration

```typescript
interface DatabaseConfig {
  dataDir: string; // Directory containing JSONL files
  writeBackFields?: readonly string[]; // Fields written back on sync (default: every field)
}

const db = LinesDB.create({ dataDir: './data' });
```

## Type Mapping

| JSON Type        | Column Type | SQLite Storage |
| ---------------- | ----------- | -------------- |
| number (integer) | INTEGER     | INTEGER        |
| number (float)   | REAL        | REAL           |
| string           | TEXT        | TEXT           |
| boolean          | INTEGER     | INTEGER        |
| object           | JSON        | TEXT           |
| array            | JSON        | TEXT           |

## License

MIT
