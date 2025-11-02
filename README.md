# lines-db

A lightweight database implementation that treats JSONL (JSON Lines) files as tables using SQLite. Perfect for managing application seed data and testing.

[日本語版 README](./README.ja.md) | [English README](./README.md)

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

## Requirements

lines-db works with the following JavaScript runtimes:

- **Node.js** 22.5.0 or later (uses `node:sqlite`)
- **Bun** 1.0 or later (uses `bun:sqlite`)
- **Deno** 2.0 or later (uses `node:sqlite` compatibility layer)

## Runtime Support

lines-db works across multiple JavaScript runtimes:

| Runtime | ESM | CommonJS | SQLite Module | Status          |
| ------- | --- | -------- | ------------- | --------------- |
| Node.js | ✅  | ✅       | `node:sqlite` | Fully supported |
| Bun     | ✅  | ✅       | `bun:sqlite`  | Fully supported |
| Deno    | ✅  | N/A      | `node:sqlite` | Fully supported |

lines-db automatically detects the runtime environment and uses the appropriate SQLite module.

## Installation

```bash
npm install lines-db
# or
pnpm add lines-db
# or
yarn add lines-db
```

## Usage

### Quick Start

Simply point lines-db at a directory containing your JSONL files:

```typescript
import { LinesDB } from 'lines-db';

// Simply specify the directory containing your JSONL files
const db = LinesDB.create({
  dataDir: './data',
});

// All JSONL files and their schemas are automatically discovered!
await db.initialize();

// Query data
const users = db.selectAll('users');
const user = db.findOne('users', { id: 1 });
const activeUsers = db.find('users', { active: true });

// Execute custom SQL
const results = db.query('SELECT * FROM users WHERE age > ?', [25]);

// Close when done (async to support autoSync)
await db.close();
```

**Directory structure:**

```
data/
  ├── users.jsonl
  ├── users.schema.ts      (optional - for validation and type generation)
  ├── products.jsonl
  ├── products.schema.ts   (optional - for validation and type generation)
  └── orders.jsonl
      orders.schema.ts     (optional - for validation and type generation)
```

### Automatic Type Inference

Generate TypeScript types from your schema files for automatic type inference:

```bash
# Generate types (creates ./data/db.ts)
npx lines-db generate --dataDir ./data

# Or add to package.json scripts
"scripts": {
  "generate:types": "lines-db generate --dataDir ./data"
}
```

#### CLI Runtime Support

The CLI works with all supported runtimes:

**Node.js:**

```bash
npx lines-db validate ./data
npx lines-db generate --dataDir ./data
```

**Bun:**

```bash
bunx lines-db validate ./data
bunx lines-db generate --dataDir ./data
```

**Deno:**

```bash
deno run --allow-read --allow-write --allow-env --allow-sys npm:lines-db validate ./data
deno run --allow-read --allow-write --allow-env --allow-sys npm:lines-db generate --dataDir ./data
```

#### Using the Generated Types

The command generates a `db.ts` file in your data directory. Import the generated `config` to get automatic type inference:

```typescript
import { LinesDB } from 'lines-db';
import { config } from './data/db.js'; // Import generated config

// Use the typed config
const db = LinesDB.create(config);
await db.initialize();

// ✨ Type is automatically inferred as User[]!
const users = db.selectAll('users');

// ✨ Type is automatically inferred as Product | null
const product = db.findOne('products', { id: 1 });

// ✨ Type-safe insert - TypeScript will catch errors!
db.insert('users', {
  id: 10,
  name: 'Alice',
  age: 30,
  email: 'alice@example.com',
});

// ❌ TypeScript error - invalid field!
// db.insert('users', { invalid: 'field' });

await db.close();
```

The generated `db.ts` file provides type-safe configuration with inferred table types for use across your entire application.

### JSONL File Format

Create JSONL files with one JSON object per line:

**users.jsonl**

```jsonl
{"id": 1, "name": "Alice", "age": 30, "email": "alice@example.com"}
{"id": 2, "name": "Bob", "age": 25, "email": "bob@example.com"}
{"id": 3, "name": "Charlie", "age": 35, "email": "charlie@example.com"}
```

**products.jsonl**

```jsonl
{"id": 1, "name": "Laptop", "price": 999.99, "inStock": true}
{"id": 2, "name": "Mouse", "price": 29.99, "inStock": true}
{"id": 3, "name": "Keyboard", "price": 79.99, "inStock": false}
```

**orders.jsonl** (with JSON columns)

```jsonl
{"id": 1, "customerId": 100, "items": [{"name": "Laptop", "quantity": 1, "price": 999.99}], "metadata": {"source": "web"}}
{"id": 2, "customerId": 101, "items": [{"name": "Mouse", "quantity": 2, "price": 29.99}], "metadata": {"source": "mobile"}}
```

## Working with JSON Columns

lines-db automatically handles JSON columns (objects and arrays) with serialization and deserialization.

### Example with JSON Columns

```typescript
import { LinesDB } from 'lines-db';

const db = LinesDB.create({
  tables: new Map([
    [
      'orders',
      {
        jsonlPath: './data/orders.jsonl',
        autoInferSchema: true,
      },
    ],
  ]),
});

await db.initialize();

// Insert order with JSON columns
db.insert('orders', {
  id: 10,
  customerId: 200,
  items: [
    { name: 'Monitor', quantity: 1, price: 299.99 },
    { name: 'Keyboard', quantity: 1, price: 79.99 },
  ],
  metadata: {
    source: 'api',
    campaign: 'spring2024',
    tags: ['bulk', 'priority'],
  },
});

// Read order - JSON columns are automatically deserialized
interface Order {
  id: number;
  customerId: number;
  items: Array<{ name: string; quantity: number; price: number }>;
  metadata: Record<string, any>;
}

const order = db.findOne<Order>('orders', { id: 10 });
console.log(order.items[0].name); // "Monitor"
console.log(order.metadata.source); // "api"
```

### Validation with JSON Columns

**orders.schema.ts**

```typescript
import * as v from 'valibot';

export const schema = v.object({
  id: v.pipe(v.number(), v.integer()),
  customerId: v.pipe(v.number(), v.integer()),
  items: v.array(
    v.object({
      name: v.string(),
      quantity: v.pipe(v.number(), v.integer(), v.minValue(0)),
      price: v.pipe(v.number(), v.minValue(0)),
    }),
  ),
  metadata: v.nullable(v.record(v.string(), v.any())),
});
```

## Validation with StandardSchema

lines-db supports validation using [StandardSchema](https://standardschema.dev/), which is compatible with popular validation libraries like Valibot, Zod, Yup, and more.

### Setting Up Validation

Create a schema file with the same name as your JSONL file:

**users.schema.ts** (for `users.jsonl`)

```typescript
import * as v from 'valibot';
import { defineSchema } from 'lines-db';
import type { InferOutput } from 'lines-db';

const userSchema = v.object({
  id: v.pipe(v.number(), v.integer(), v.minValue(1)),
  name: v.pipe(v.string(), v.minLength(1)),
  age: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(150)),
  email: v.pipe(v.string(), v.email()),
});

// Wrap with defineSchema to create BiDirectionalSchema
// No backward transformation needed since Input = Output
export const schema = defineSchema(userSchema);

// Export inferred type from schema using StandardSchema
export type User = InferOutput<typeof schema>;

export default schema;
```

The schema will be automatically loaded when the database is initialized. Validation is applied during:

- `insert()` and `batchInsert()` operations
- `batchUpdate()` (unless you pass `{ validate: false }`)
- Initial data loading from JSONL files

**Note:** `update()` skips validation after merging with existing rows to allow partial updates. Use `batchUpdate()` when you need per-record validation while updating multiple rows.

### Using Types from Schema

You can import the inferred types from your schema files. The type inference uses StandardSchema's type system, so it works with any StandardSchema-compatible library (Valibot, Zod, etc.):

```typescript
import { LinesDB } from 'lines-db';
import type { User } from './data/users.schema.ts';

const db = LinesDB.create({ dataDir: './data' });
await db.initialize();

// Use the type inferred from schema
const users = db.selectAll<User>('users');
const user = db.findOne<User>('users', { id: 1 });
```

The `InferOutput` type helper extracts the output type from any StandardSchema, providing type safety without depending on specific validation library implementations.

### Validation Example

```typescript
import { LinesDB } from 'lines-db';

const db = LinesDB.create({
  tables: new Map([
    [
      'users',
      {
        jsonlPath: './data/users.jsonl',
        autoInferSchema: true,
      },
    ],
  ]),
});

await db.initialize();

// ✅ Valid insert
db.insert('users', {
  id: 10,
  name: 'Alice',
  age: 30,
  email: 'alice@example.com',
});

// ❌ Invalid insert - will throw ValidationError
try {
  db.insert('users', {
    id: 11,
    name: '', // Empty name not allowed
    age: -5, // Negative age not allowed
    email: 'not-an-email', // Invalid email
  });
} catch (error) {
  if (error.name === 'ValidationError') {
    console.log('Validation errors:', error.issues);
  }
}
```

### Bidirectional Schema Transformations

When your schema performs transformations (Input ≠ Output), you need to provide a backward transformation for JSONL persistence:

```typescript
import * as v from 'valibot';
import { defineSchema } from 'lines-db';
import type { InferInput, InferOutput } from 'lines-db';

// Schema with transformation: string -> Date
const eventSchema = v.pipe(
  v.object({
    id: v.number(),
    name: v.string(),
    date: v.pipe(
      v.string(),
      v.isoDate(),
      v.transform((str) => new Date(str)),
    ),
  }),
);

// Define with backward transformation: Date -> string
export const schema = defineSchema(eventSchema, (output) => ({
  ...output,
  date: output.date.toISOString(), // Convert Date back to string
}));

export type EventInput = InferInput<typeof schema>; // { date: string }
export type EventOutput = InferOutput<typeof schema>; // { date: Date }

export default schema;
```

The backward transformation is essential for:

- **Persisting changes**: Converting output types back to input types for JSONL files
- **Data integrity**: Ensuring data can be serialized correctly

**Note:** If Input = Output (no transformations), backward transformation is not needed.

## Persisting Changes to JSONL Files

lines-db provides two ways to persist database changes back to JSONL files:

### 1. Auto-Sync (Outside Transactions)

Operations outside of transactions are automatically synced to JSONL files:

```typescript
import { LinesDB } from 'lines-db';

const db = LinesDB.create({ dataDir: './data' });
await db.initialize();

// These operations are immediately synced to JSONL files
db.insert('users', { id: 10, name: 'Alice', age: 30, email: 'alice@example.com' });
db.update('users', { age: 31 }, { id: 1 });
db.delete('users', { id: 3 });
// Each operation above automatically updates the users.jsonl file

await db.close();
```

The batch helpers `batchInsert()`, `batchUpdate()`, and `batchDelete()` follow the same auto-sync behavior when used outside transactions.

### 2. Transactions

Use transactions to batch multiple operations and sync them atomically:

```typescript
import { LinesDB } from 'lines-db';

const db = LinesDB.create({ dataDir: './data' });
await db.initialize();

// Transaction: changes are batched and synced on commit
await db.transaction(async (tx) => {
  tx.insert('users', { id: 10, name: 'Alice', age: 30, email: 'alice@example.com' });
  tx.update('users', { age: 31 }, { id: 1 });
  tx.delete('users', { id: 3 });
  // All changes are synced to JSONL files when transaction commits
});

// If an error occurs, changes are rolled back and not synced
await db.transaction(async (tx) => {
  tx.insert('users', { id: 11, name: 'Bob', age: 25, email: 'bob@example.com' });
  throw new Error('Something went wrong');
  // Transaction is automatically rolled back, no changes to JSONL files
});

await db.close();
```

### Manual Sync

You can also manually sync all tables to JSONL files:

```typescript
const db = LinesDB.create({ dataDir: './data' });
await db.initialize();

// Make changes using execute() or raw SQL
db.execute('INSERT INTO users (id, name) VALUES (?, ?)', [12, 'Charlie']);

// Manually sync all tables
await db.sync();

await db.close();
```

### How Sync Works

**Sync process:**

1. Reads all rows from the SQLite table
2. Applies backward transformations if defined in schema (Output → Input)
3. Writes all rows to the JSONL file, overwriting existing content
4. One JSONL object per line format is preserved

**When sync occurs:**

- **Auto-sync**: After each `insert()`, `update()`, or `delete()` outside of transactions
- **Transactions**: When `transaction()` commits successfully
- **Manual**: When calling `sync()` method explicitly

**Important Notes:**

- Backward transformations in schemas are used when syncing (Output → Input)
- All rows in the table are written back to the JSONL file (complete overwrite, not incremental)
- Sync operations are performed per table independently
- For large datasets, sync operations may take time as the entire table is rewritten
- Use transactions to batch multiple operations and improve performance

## API Reference

### Constructor

```typescript
LinesDB.create(config: DatabaseConfig, dbPath?: string)
```

- `config`: Database configuration with table definitions
- `dbPath`: Optional path to SQLite database file (defaults to `:memory:`)

### Methods

#### `initialize(): Promise<void>`

Load all JSONL files and create tables.

```typescript
await db.initialize();
```

#### `selectAll<T>(tableName: string): T[]`

Get all rows from a table.

```typescript
interface User {
  id: number;
  name: string;
  age: number;
}

const users = db.selectAll<User>('users');
```

#### `find<T>(tableName: string, where: Record<string, unknown>): T[]`

Find rows by conditions.

```typescript
const results = db.find('users', { age: 30, active: true });
```

#### `findOne<T>(tableName: string, where: Record<string, unknown>): T | null`

Find a single row by conditions.

```typescript
const user = db.findOne('users', { id: 1 });
```

#### `query<T>(sql: string, params?: any[]): T[]`

Execute a custom SQL query.

```typescript
const results = db.query('SELECT * FROM users WHERE age > ?', [25]);
```

#### `queryOne<T>(sql: string, params?: any[]): T | null`

Execute a query and return a single row.

```typescript
const result = db.queryOne('SELECT COUNT(*) as count FROM users');
```

#### `execute(sql: string, params?: any[]): { changes: number | bigint; lastInsertRowid: number | bigint }`

Execute INSERT, UPDATE, or DELETE statements (without validation).

```typescript
db.execute('INSERT INTO users (name, age) VALUES (?, ?)', ['David', 40]);
db.execute('UPDATE users SET age = ? WHERE id = ?', [31, 1]);
db.execute('DELETE FROM users WHERE id = ?', [3]);
```

#### `insert(tableName: string, data: Record<string, unknown>): { changes: number | bigint; lastInsertRowid: number | bigint }`

Insert a row with validation.

```typescript
db.insert('users', {
  id: 10,
  name: 'Eve',
  age: 28,
  email: 'eve@example.com',
});
```

#### `batchInsert(tableName: string, records: Record<string, unknown>[]): { changes: number | bigint; lastInsertRowid: number | bigint }`

Insert multiple rows in one call. Each record is validated before being written.

```typescript
db.batchInsert('users', [
  { id: 11, name: 'Mallory', age: 22 },
  { id: 12, name: 'Oscar', age: 27 },
]);
```

#### `update(tableName: string, data: Record<string, unknown>, where: Record<string, unknown>): { changes: number | bigint; lastInsertRowid: number | bigint }`

Update rows (validation is skipped for partial updates).

```typescript
db.update('users', { age: 31 }, { id: 1 });
```

#### `batchUpdate(tableName: string, records: Array<Record<string, unknown>>, options?: { validate?: boolean }): { changes: number | bigint; lastInsertRowid: number | bigint }`

Update multiple rows with record-specific values. Each record must include the primary key so the target row can be located. Validation runs by default.

```typescript
db.batchUpdate(
  'users',
  [
    { id: 1, age: 31 },
    { id: 2, age: 27 },
  ],
  { validate: true },
);
```

#### `delete(tableName: string, where: Record<string, unknown>): { changes: number | bigint; lastInsertRowid: number | bigint }`

Delete rows from a table.

```typescript
db.delete('users', { id: 3 });
```

#### `batchDelete(tableName: string, records: Array<Record<string, unknown>>): { changes: number | bigint; lastInsertRowid: number | bigint }`

Delete multiple rows by primary key. Each record must include the primary key value you want to delete.

```typescript
db.batchDelete('users', [{ id: 3 }, { id: 4 }]);
```

#### `getSchema(tableName: string): TableSchema | undefined`

Get the schema for a table.

```typescript
const schema = db.getSchema('users');
console.log(schema);
```

#### `getTableNames(): string[]`

Get all table names.

```typescript
const tables = db.getTableNames();
```

#### `sync(): Promise<void>`

Manually sync database changes back to JSONL files.

```typescript
await db.sync();
```

**Note:** Uses backward transformations from schemas when available.

#### `transaction<T>(fn: (tx: LinesDB) => Promise<T> | T): Promise<T>`

Execute a function within a transaction. Automatically commits on success or rolls back on error.

```typescript
await db.transaction(async (tx) => {
  tx.insert('users', { id: 10, name: 'Alice', age: 30 });
  tx.update('users', { age: 31 }, { id: 1 });
  tx.delete('users', { id: 3 });
  // All changes are synced to JSONL files on commit
});
```

**Parameters:**

- `fn`: Function to execute within the transaction. Receives the database instance as parameter.

**Returns:** The return value of the provided function.

**Behavior:**

- Begins a SQLite transaction with `BEGIN TRANSACTION`
- Executes the provided function
- On success: Commits with `COMMIT` and syncs all tables to JSONL files
- On error: Rolls back with `ROLLBACK` and re-throws the error
- Nested transactions are not supported

#### `close(): Promise<void>`

Close the database connection.

```typescript
await db.close();
```

## Configuration

### DatabaseConfig

```typescript
interface DatabaseConfig {
  dataDir: string; // Directory containing JSONL files
}
```

**Example:**

```typescript
const db = LinesDB.create({
  dataDir: './data', // Automatically discovers all .jsonl files
});
```

### TableConfig

```typescript
interface TableConfig {
  jsonlPath: string; // Path to JSONL file
  schema?: TableSchema; // Optional manual SQLite schema
  autoInferSchema?: boolean; // Auto-infer schema (default: true)
  validationSchema?: StandardSchema; // Optional validation schema
}
```

### Validation Schema Files

Schema files must be named `${tableName}.schema.ts` and placed in the same directory as the JSONL file (or in the directory specified by `schemaDir`).

**Supported validation libraries:**

- Valibot
- Zod (with StandardSchema support)
- Yup (with StandardSchema support)
- Any library implementing StandardSchema

### Manual Schema Definition

You can define schemas manually instead of auto-inference:

```typescript
const config = {
  tables: new Map([
    [
      'users',
      {
        jsonlPath: './data/users.jsonl',
        schema: {
          name: 'users',
          columns: [
            { name: 'id', type: 'INTEGER', primaryKey: true, notNull: true },
            { name: 'name', type: 'TEXT', notNull: true },
            { name: 'age', type: 'INTEGER' },
            { name: 'email', type: 'TEXT', unique: true },
          ],
        },
      },
    ],
  ]),
};
```

## Type Mapping

| JSON Type        | Column Type | SQLite Storage | Notes                                      |
| ---------------- | ----------- | -------------- | ------------------------------------------ |
| number (integer) | INTEGER     | INTEGER        | Whole numbers                              |
| number (float)   | REAL        | REAL           | Decimal numbers                            |
| string           | TEXT        | TEXT           | Text strings                               |
| boolean          | INTEGER     | INTEGER        | 0 for false, 1 for true                    |
| null             | NULL        | NULL           | Null values                                |
| object           | JSON        | TEXT           | Stored as JSON string, auto-parsed on read |
| array            | JSON        | TEXT           | Stored as JSON string, auto-parsed on read |

### JSON Column Type

Objects and arrays are automatically inferred as `JSON` type columns. These are:

- Stored as JSON strings in SQLite (TEXT type)
- Automatically serialized when inserting data
- Automatically deserialized when reading data using `selectAll()`, `find()`, or `findOne()`

**Note:** Raw SQL queries using `query()` or `queryOne()` will return JSON columns as strings. Use the table-specific methods for automatic deserialization.

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm run build

# Run tests
pnpm test              # Unit tests
pnpm test:runtime      # All runtime tests (Node.js, Deno, Bun)
pnpm test:cjs          # CommonJS (Node.js) tests
pnpm test:deno         # Deno tests
pnpm test:bun          # Bun tests
pnpm test:all          # All tests
```

### Runtime Tests

lines-db is tested across three runtimes using a shared test suite:

- **Node.js (CommonJS)**: `tests/runtime-cjs/` - Tests with CommonJS module system
- **Deno**: `tests/runtime-deno/` - Tests with Deno runtime
- **Bun**: `tests/runtime-bun/` - Tests with Bun runtime

Each runtime test runs the same test suite (16 test cases) located in `tests/shared/test-suite.ts`.

## License

MIT
