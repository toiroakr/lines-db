# lines-db

A data management library that treats JSONL (JSON Lines) files as tables. Perfect for managing application seed data and testing.

## Features

- 📝 Load JSONL files as database tables
- ✅ **CLI tools for validation and data migration**
- 🖥️ **Browser UI to browse and edit tables** (`lines-db studio`)
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
# users.jsonl after:  {"id":"...","name":"John"}
```

Rows are matched to their existing line by primary key, or by position when the file does not carry
one yet (the case when the primary key itself is being backfilled). Lines keep the order the file
has them in, and rows the file never had are appended, since there is nothing to preserve for them.
When rows cannot be matched to their lines - the file has no usable primary key _and_ the row count
changed - the migration fails instead of guessing.

One list covers every table the migration touches. A table that does not have a named field simply
has nothing written back to it, so a directory holding tables that do not all share an `id` works
with a single `--fields id`. A field _no_ table has is a typo, and the migration stops.

### Fill Missing Values

```bash
npx lines-db fill <path> [--fields id,createdAt]
```

Fills the named fields - by default each table's primary key - into the rows of the JSONL files under
`path` (a data directory, or one `.jsonl` file) that have no value for them, with the value each
table's validation schema gives the row. A value already in the file is never replaced, and a line
that gains nothing is left byte for byte, its line separator included; a line that does gain a value
is written with its keys in the order the schema lists them. Every value is computed before any file
is written, and a row the schema rejects gains nothing. A file saved by another tool after the fill
read it stops the fill with a `JsonlConflictError` naming the file, before any file is written.

The same runs from code with `fillFields()`, which also takes the function that computes a row's
values, for a table whose create-time values come from something other than its validation schema:

```typescript
import { fillFields, unwrap } from '@toiroakr/lines-db';

const { filled } = unwrap(
  await fillFields({
    path: './data',
    fields: ['id'],
    // Computes the values from the `hook` the schema file exports; throwing stops the fill
    loadFiller: (schemaModule, { schemaPath }) => {
      if (typeof schemaModule.hook !== 'function') throw new Error(`${schemaPath} does not export \`hook\``);
      return schemaModule.hook;
    },
  }),
);
```

The result also lists the tables without a schema file (`tablesWithoutSchema`), the lines that are
not JSON objects (`unreadableLines`), and the named fields no table produced a value for
(`unproducedFields`).

### Browse and Edit in the Browser

```bash
npx lines-db studio <dataDir> [--port 4848] [--open] [--write-filled-values primaryKey|all]
```

Starts a local web UI at `http://127.0.0.1:4848` that lists the tables of `dataDir` with their row
counts and shows a table as a grid. Click a cell to edit it, add records, or select rows to delete;
the changes stay pending - highlighted in the grid - until **Save N changes** writes them all in one
transaction through `db.update()` / `db.insert()` / `db.delete()`, or **Discard** drops them. A value
the schema rejects writes nothing: the issues are shown with the change they came from, and the
pending changes stay for you to fix. A save changes the values of the rows it edits only, but
rewrites the table's JSONL file as a whole, so the formatting of the other lines can change too.

- The URL printed at start-up holds a token generated for the run. Opening it signs the browser in
  with an HttpOnly, SameSite=Strict cookie; a request without the token is refused with 401.
- A save writes the fields you wrote and leaves the values the schema fills in out of the file
  (`writeFilledValues: 'primaryKey'`, see [Values the Schema Fills In](#values-the-schema-fills-in));
  `--write-filled-values all` writes them as a sync does by default.
- A value the schema filled in rather than the file is shown dimmed with a **default** mark. **Use
  default** in a cell's editor removes the value from the file and leaves it to the schema; a new
  row's empty field is left to the schema too.
- A cell's editor checks the value as you type, against the schema as a save would
  (`POST /api/tables/:name/check`, which validates the change without writing it), and lists the
  issues under the field. A JSON column opens in a dialog with syntax highlighting, and a syntax
  error is marked where it is. **Set** puts the value among the pending changes; nothing is written
  until you save.
- A table needs a primary key (an `id` column, or `primaryKey` in its schema file) to be edited; one
  without is shown read-only.
- A table whose rows fail validation on load is left out, and the failing rows are listed at the top
  of the page. Fix them in the JSONL or schema file and click **Reload**.
- When the files change on disk while the studio is open, the page reloads the rows on its own, or,
  with changes pending, says so. A save checks the files first: a changed schema file is loaded so the
  save is validated against it, and a change to the edited table's own file stops the save with the
  name of that file, writes nothing, and reloads the tables. A save writes back only the table it
  edits, so a change to another table's file does not stop it.
- The server only answers requests addressed to the local host, and only accepts writes sent as
  `application/json` from its own page.

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
import { LinesDB, unwrap } from '@toiroakr/lines-db';

const db = LinesDB.create({ dataDir: './data' });
unwrap(await db.initialize());

// Find all users
const users = unwrap(db.find('users'));
console.log(users); // [{ id: 1, name: "Alice", ... }, ...]

// Find a specific user
const user = unwrap(db.findOne('users', { id: 1 }));
console.log(user); // { id: 1, name: "Alice", age: 30, ... }

// Find with conditions
const adults = unwrap(db.find('users', { age: (age) => age >= 30 }));

unwrap(await db.close());
```

> Most `LinesDB`/`JsonlReader` methods return a `Result<T, Error>` instead of throwing — see
> [Error Handling](#error-handling) below. `unwrap()` reads the value or throws the error, which is
> convenient at the top of a script but not the only way to consume a `Result`.

### Using Generated Types

After running `npx lines-db generate ./data`:

```typescript
import { LinesDB, unwrap } from '@toiroakr/lines-db';
import { config } from './data/db.js';

const db = LinesDB.create(config);
unwrap(await db.initialize());

// ✨ Type is automatically inferred!
const users = unwrap(db.find('users'));

// ✨ Type-safe operations
unwrap(
  db.insert('users', {
    id: 10,
    name: 'Alice',
    age: 30,
    email: 'alice@example.com',
  }),
);

unwrap(await db.close());
```

## Error Handling

`LinesDB` and `JsonlReader` methods that can fail return a `Result<T, Error>` — a discriminated union
`{ ok: true; value: T } | { ok: false; error: Error }` — instead of throwing. `getSchema`,
`getTableNames`, and `getDb` can't fail, so they still return their value directly.

```typescript
const result = db.insert('users', { id: 2, name: '' }); // fails a validation schema

if (result.ok) {
  console.log(result.value.changes);
} else {
  console.log(result.error.message);
}
```

`unwrap(result)` reads `result.value`, or throws `result.error` when `result.ok` is `false` — useful
at the top of a script, or anywhere a failure should propagate like an exception:

```typescript
import { unwrap } from '@toiroakr/lines-db';

const users = unwrap(db.find('users')); // throws if db.find() returned an error
```

Inside `db.transaction(async (tx) => { ... })`, `tx` is the same Result-returning API as `db` — a
failed `tx.insert()`/`tx.update()`/etc. does not throw on its own and therefore does not roll back the
transaction by itself. Check the Result and `throw result.error` (or call `unwrap`) to abort the
transaction on such a failure; only a thrown error inside the callback rolls it back.

### Core API

All operations below return `Result<T, Error>` unless noted otherwise; `getSchema`, `getTableNames`,
and `getDb` return their value directly since they cannot fail.

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
- `getSchema(table)` - Get table schema (returns `TableSchema | undefined`, not a `Result`)
- `getTableNames()` - Get all table names (returns `string[]`, not a `Result`)

**Where Conditions:**

```typescript
// Simple equality
unwrap(db.find('users', { age: 30 }));

// Multiple conditions (AND)
unwrap(db.find('users', { age: 30, name: 'Alice' }));

// Advanced conditions
unwrap(
  db.find('users', {
    age: (age) => age > 25,
    name: (name) => name.startsWith('A'),
  }),
);
```

### JSON Columns

Objects and arrays are automatically handled as JSON columns:

```typescript
unwrap(
  db.insert('orders', {
    id: 1,
    items: [{ name: 'Laptop', quantity: 1 }],
    metadata: { source: 'web' },
  }),
);

const order = unwrap(db.findOne('orders', { id: 1 }));
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
const event = unwrap(db.findOne('events', { id: 1 }));
console.log(event.date instanceof Date); // true
console.log(event.date.getFullYear()); // 2024
```

### Transactions

Operations outside transactions are auto-synced:

```typescript
unwrap(db.insert('users', { id: 10, name: 'Alice', age: 30 }));
// ↑ Automatically synced to users.jsonl
```

A sync keeps the order the file lists its rows in and appends rows the file did not have, so the
diff stays limited to what actually changed.

Batch operations with transactions:

```typescript
unwrap(
  await db.transaction(async (tx) => {
    unwrap(tx.insert('users', { id: 10, name: 'Alice', age: 30 }));
    unwrap(tx.update('users', { age: 31 }, { id: 1 }));
    // Written back together, then committed
  }),
);
```

`unwrap()` inside the callback turns a failed `tx.insert()`/`tx.update()` into a thrown error, which
`transaction()` catches and rolls back on - see [Error Handling](#error-handling).

Once the callback is done, `transaction()` writes back the tables it changed through
`tx.insert()`/`tx.update()`/`tx.delete()` and their batch variants, before it commits. Every file is
checked before the first one is written, and a write-back that fails rolls the transaction back and
puts the files it already wrote back to what they held, so the database keeps matching its files.
Putting a file back is a write too; when that write fails as well, the file keeps the change. Tables the transaction did not change are left as they are; raw
SQL through `tx.execute()` or `tx.query()` that changes rows writes back every table, since the
tables it changed are unknown. `sync()` inside the callback fails: the transaction writes the files
itself once the callback is done.

### Files Changed After Loading

The database remembers what each JSONL file held when `initialize()` read it, and what it last wrote
there. A sync that finds the file changed since - a line added in an editor, a value edited by hand,
the file deleted - leaves the file alone instead of writing over those changes, and fails with a
`JsonlConflictError` naming the file:

```typescript
const result = await db.transaction((tx) => unwrap(tx.update('users', { age: 31 }, { id: 1 })));

if (!result.ok && result.error.name === 'JsonlConflictError') {
  console.log(`${(result.error as JsonlConflictError).file} changed on disk`);
}
```

To pick up the changes, create the database again and call `initialize()`, then retry the write. A
failed `transaction()` has rolled its change back and writes back only the tables it changed, so only
a change to one of those files fails it. `sync()` and the auto-sync after a write outside a transaction
have nothing to roll back - the database keeps the change the file did not get - and `sync()` without a
table name writes back every table, so a change to any table's file fails it. An auto-sync reports the
error through `console.error`.

The file is checked right before it is written, with no lock held in between, so a change saved in
the instant between the check and the write - by an editor or by another process writing the same
file - is still overwritten. The check is meant for a single user editing files on their own
machine, where a change landing in that window is unlikely.

To find out before writing, `hasExternalChanges()` tells whether the files changed since the database
last read or wrote them: a JSONL file edited, added or removed, or a table's schema file edited, added
or removed. `findExternalChanges()` lists those files, for telling which table an outside edit
touched. A long-running process can call either to reload when something else touched the files:

```typescript
if (unwrap(await db.hasExternalChanges())) {
  await db.close();
  db = LinesDB.create(config);
  unwrap(await db.initialize());
}
```

### Values the Schema Fills In

A sync writes each row back in full by default, so a value the validation schema fills in - a default,
or a field it computes - is written into the line. Set `writeFilledValues: 'primaryKey'` to write back
only the fields a user wrote instead: the ones a row's line holds, the ones an `insert()` was given,
and the ones an `update()` changed. Every other value the schema fills in stays out of the file, so a
line keeps leaving it to the schema. A primary key the schema generates is still written, so the row
keeps the same key the next time it is loaded.

```typescript
const db = LinesDB.create({ dataDir: './data', writeFilledValues: 'primaryKey' });
// people.jsonl: {"id":1,"name":"Alice"}   (the schema defaults age to 20)
unwrap(await db.transaction((tx) => unwrap(tx.update('people', { name: 'Alicia' }, { id: 1 }))));
// people.jsonl: {"id":1,"name":"Alicia"}  (age is still left to the schema)
```

A single sync can choose for itself with `sync(tableName, { writeFilledValues })`. Setting a field to
the value it already holds is not a change, so a field the schema filled in stays out of the line
when it is set to that same value. Fields named in `writeBackFields` or `sync(..., { fields })` are
written even when the schema filled them in.

To hand a field the line holds back to the schema, reset it; the row then holds the value the schema
fills in, and with `writeFilledValues: 'primaryKey'` its line loses the field:

```typescript
unwrap(db.update('people', {}, { id: 1 }, { resetToDefault: ['age'] }));
```

`findWithDefaults()` lists the rows with the fields the schema filled in on each - the ones the file
does not hold - for showing them apart from the values in the file:

```typescript
unwrap(await db.findWithDefaults('people'));
// [{ row: { id: 1, name: 'Alicia', age: 20 }, defaulted: ['age'] }]
```

A row whose backward transformation renames fields, a row with neither a line nor a recorded
write (one added with raw SQL), and every row of a table after raw SQL through `execute()` or
`query()` changed rows, are written whole, since there is no way to tell which of their fields a user
wrote. A field a migration `transform` set on a row while loading counts as written on that row.

### Writing Back Only Some Fields

A sync writes each row back in full by default, which materializes values a validation schema
computed and fields the JSONL file omitted. Name the fields to write back to keep the rest of every
line exactly as the file had it:

```typescript
// users.jsonl: {"name":"Alice"}
unwrap(await db.sync('users', { fields: ['id'] }));
// users.jsonl: {"id":"...","name":"Alice"}
```

Use `writeBackFields` on the config to apply the same rule to every sync, including the automatic
sync after an insert, update, or transaction:

```typescript
const db = LinesDB.create({ dataDir: './data', writeBackFields: ['id'] });
```

Rows are matched to their existing line by primary key, or by position when the file does not carry
one yet (the case when the primary key itself is being backfilled). Lines keep the order the file
has them in, and rows the file never had are appended. A field you name is always taken from the
database - including when it is `null` there - and `sync` returns an error Result when rows cannot
be matched to their lines, rather than guessing.

A field a line did not have is inserted where the schema declares it rather than appended, so a
backfilled `id` lands at the front of the line the way a hand-written row has it. Keys the schema
does not declare stay behind the declared ones, and no key a line already had moves.

The order is read off the rows the schema computes, since that is where a schema states it: a field
it fills in first is ranked first. A field only some rows carry is ranked after the ones already seen,
and `mergeFields` takes a `keyOrder` for stating the order outright.

`sync('users', { fields })` names one table, so a field that table does not have is rejected. A sync
covering every table - `sync()` or the config option - leaves such a field out of the tables without
it instead, so one list can serve a directory of tables that do not all share it.

### Editing a Line Yourself

`mergeFields` is the write-back merge on its own, without a database: give it a line and the row a
schema computed from it, and it hands back the line with the named fields written into it. Reach for it
when the values come from somewhere other than a query - a hook that fills in ids, say - and loading the
file into SQLite would only get in the way:

```typescript
import { JsonlReader, JsonlWriter, mergeFields, unwrap } from '@toiroakr/lines-db';

const rows = unwrap(await JsonlReader.read('./data/users.jsonl'));
const filled = rows.map((row) => mergeFields(row, fillIds(row), { fields: ['id'] }));
await JsonlWriter.write('./data/users.jsonl', filled);

// {"name":"Alice"}  ->  {"id":"018f...","name":"Alice"}
```

Nothing else in the line is read or checked, so a field in a format a schema would reject cannot keep
the named ones from being written. A field the computed row has no value for is left alone rather than
nulled out, and `keyOrder` overrides where a new key lands when the computed row does not list its
fields in the order the schema declares them.

## Configuration

```typescript
interface DatabaseConfig {
  dataDir: string | readonly string[]; // Directory (or directories) containing JSONL files
  schemaDir?: string; // Directory containing the schema files (default: next to each JSONL file)
  writeBackFields?: readonly string[]; // Fields written back on sync (default: every field)
}

const db = LinesDB.create({ dataDir: './data' });
```

### Data Sets

Seed data can be split into sets that are validated together - a `base` set every environment needs,
plus a set that only one scenario loads:

```
data/
  Item.schema.ts   Item.jsonl              # schemas + base set
  ItemValuation.schema.ts
  cogs/
    Item.jsonl                             # more Item rows, no schema here
    ItemValuation.jsonl                    # references Item rows of both sets
```

```typescript
const db = LinesDB.create({ dataDir: ['./data', './data/cogs'], schemaDir: './data' });
const result = unwrap(await db.initialize({ detailedValidate: true }));
```

A table found in several directories has the rows of each file, in the order `dataDir` lists them.
Validation, unique indexes and foreign keys run over those rows together, so `cogs/ItemValuation.jsonl`
can reference an `Item` from `data/Item.jsonl`, and an id defined in both sets is reported as a
violation. Every error names the file the row came from and its line in that file.

`schemaDir` is required when `dataDir` lists several directories: a data set directory does not hold
the schemas of its tables, so without it they would be loaded unvalidated. It also works with a single
directory - `{ dataDir: './data/cogs', schemaDir: './data' }` - and without it a single directory's
schemas are looked up next to its JSONL files.

Rows of a table composed from several files have no single file to be written back to, so a database
whose `dataDir` lists several directories is read-only: `insert`, `update`, `delete`, their `batch*`
forms, `sync()`, and SQL that writes through `execute()` or `query()` return an error without changing
the database or the files.

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
