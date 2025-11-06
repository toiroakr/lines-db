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
import type { InferOutput } from '@toiroakr/lines-db';

const userSchema = v.object({
  id: v.pipe(v.number(), v.integer(), v.minValue(1)),
  name: v.pipe(v.string(), v.minLength(1)),
  age: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(150)),
  email: v.pipe(v.string(), v.email()),
});

export const schema = defineSchema(userSchema);
export type User = InferOutput<typeof schema>;
export default schema;
```

**Supported validation libraries:**

- Valibot
- Zod (with StandardSchema support)
- Yup (with StandardSchema support)
- Any library implementing [StandardSchema](https://standardschema.dev/)

### Validate JSONL Files

Validate your JSONL files against their schemas:

```bash
npx lines-db validate <dataDir>
```

**Example:**

```bash
# Validate all JSONL files in ./data directory
npx lines-db validate ./data

# Verbose output
npx lines-db validate ./data --verbose
```

This command will:

- Find all `.jsonl` files in the directory
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

```typescript
import { LinesDB } from '@toiroakr/lines-db';

const db = LinesDB.create({ dataDir: './data' });
await db.initialize();

const users = db.find('users');
const user = db.findOne('users', { id: 1 });

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

Query: `find()`, `findOne()`, `query()` | Modify: `insert()`, `update()`, `delete()` | Batch: `batchInsert()`, `batchUpdate()`, `batchDelete()` | Transaction: `transaction()` | Schema: `getSchema()`, `getTableNames()`

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

For schemas with transformations (e.g., string → Date), provide backward transformation:

```typescript
import * as v from 'valibot';
import { defineSchema } from '@toiroakr/lines-db';

const eventSchema = v.pipe(
  v.object({
    date: v.pipe(
      v.string(),
      v.isoDate(),
      v.transform((str) => new Date(str)),
    ),
  }),
);

export const schema = defineSchema(eventSchema, (output) => ({
  ...output,
  date: output.date.toISOString(), // Convert Date back to string
}));
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
