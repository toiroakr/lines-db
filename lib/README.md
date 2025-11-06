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
- 🌐 **Multi-runtime support** - Node.js (22.5+), Bun, Deno

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
```

**Options:**

- `--filter, -f <expr>` - Filter expression to select rows
- `--errorOutput, -e <path>` - Save transformed data to file if migration fails
- `--verbose, -v` - Show detailed error messages

The migration runs in a transaction and validates all transformed rows before committing.

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

## Configuration

```typescript
interface DatabaseConfig {
  dataDir: string; // Directory containing JSONL files
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
