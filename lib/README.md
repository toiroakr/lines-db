# lines-db

[日本語](./README.ja.md)

lines-db loads JSONL files into SQLite tables and writes changes back to their source files. Use it for seed data and test fixtures that you keep in files.

Columns are inferred from the rows. Define a schema with a Standard Schema library such as Valibot or Zod to validate rows and generate TypeScript types. Objects and arrays are stored as JSON columns. Schemas can transform values on load and convert them back when saving.

The CLI validates, migrates, fills missing values, and generates types. Install `@lines-db/studio` to edit data in a browser, or use the [VS Code extension](https://marketplace.visualstudio.com/items?itemName=toiroakr.lines-db-vscode) for validation in the editor.

## Installation

Requires Node.js 22.12.0 or later.

```bash
npm install lines-db
```

With pnpm, use `pnpm add lines-db`.

## CLI usage

### Define schemas

Place a schema file next to the JSONL file, using the same table name.

```
data/
  ├── users.jsonl
  ├── users.schema.ts
  ├── products.jsonl
  └── products.schema.ts
```

The following `users.schema.ts` uses Valibot. Add it with `npm install valibot`.

```typescript
import * as v from 'valibot';
import { defineSchema } from 'lines-db';

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

Any library implementing [Standard Schema](https://standardschema.dev/) can be used.

`initialize()` fails if a schema file cannot be imported or does not export a Standard Schema as `schema` or `default`. The error includes the file and the reason.

### Validate JSONL files

Validate a file, or all JSONL files in a directory, against their schemas.

```bash
npx lines-db validate <path>
```

```bash
npx lines-db validate ./data

npx lines-db validate ./data/users.jsonl

npx lines-db validate ./data --verbose
```

The command loads the corresponding schema files and checks each row. Validation errors include the file and details of the failure.

#### Validate named datasets

Define shared data and scenario data in `lines-db.config.json`:

```json
{
  "schemaDir": "./data",
  "base": ["./data"],
  "datasets": {
    "cogs": ["./data/cogs"],
    "sales": ["./data/sales"]
  }
}
```

Omit the positional path to read `lines-db.config.json` in the current working directory and validate only `base`.
`--dataset <name>` adds the named dataset to `base`; repeat the flag to combine several sets in the specified order. `--all-datasets` combines `base` and every dataset in one
validation run; IDs shared by different scenarios will cause duplicate errors.

```bash
npx lines-db validate
npx lines-db validate --dataset cogs
npx lines-db validate --dataset cogs --dataset sales
npx lines-db validate --all-datasets
npx lines-db validate --config ./seed/lines-db.config.json --dataset cogs
```

Use `--config <path>` to select another configuration file. `schemaDir`, `base` and `datasets` are required.
`base` and each dataset must contain at least one directory; use `datasets: {}` when there are no additional sets.
Relative paths are resolved from the configuration file's directory. Directories are loaded in base-then-dataset
order, with each directory loaded only once. Subdirectories are not discovered automatically. Schemas, unique
constraints and foreign keys are checked across the combined data, and errors identify the original file.

Combining `--dataset` with `--all-datasets`, or using configuration options with a positional path, is an error.
Unknown dataset names and invalid configurations also fail. Existing `validate <path>` commands keep working
without reading a configuration file. Only the `validate` CLI command uses this configuration.

Programs can load the same configuration with `loadDatasetConfig()`:

```typescript
import { LinesDB, loadDatasetConfig } from 'lines-db';

const config = await loadDatasetConfig('./lines-db.config.json', {
  datasets: ['cogs', 'sales'],
});
const db = LinesDB.create(config);
```

Omit `datasets` or pass `[]` for base only. An array combines base and the selected sets in array order;
`'all'` combines base and every set in configuration order. Each directory is loaded once, including symlink aliases.
Calling `loadDatasetConfig()` without arguments reads `lines-db.config.json` in the current working directory.
It returns `Promise<DatabaseConfig>` and rejects unreadable or invalid configuration, unknown set names and missing
selected data directories. A missing `schemaDir` or one pointing to a file is also rejected. Call `db.initialize()` to load and validate the data.

### Migrate data

Apply a function to each row, validate the result, and save it to the JSONL file.

```bash
npx lines-db migrate <file> <transform> [options]
```

```bash
npx lines-db migrate ./data/users.jsonl "(row) => ({ ...row, age: row.age + 1 })"

npx lines-db migrate ./data/users.jsonl "(row) => ({ ...row, active: true })" --filter "{ age: (age) => age > 18 }"

npx lines-db migrate ./data/users.jsonl "(row) => ({ ...row, age: row.age + 1 })" --errorOutput ./migrated.jsonl

npx lines-db migrate ./data "(row) => row" --fields id
```

Available options:

- `--filter, -f <expr>`: Select rows with a filter expression.
- `--fields <list>`: Write back only the comma-separated fields. Other values remain as stored in the JSONL file. If omitted, write every field.
- `--errorOutput, -e <path>`: Save the transformed data to this path if migration fails.
- `--verbose, -v`: Show detailed error messages.

The migration runs in a transaction and validates all transformed rows before committing.

#### Write back selected fields

A normal migration writes whole rows back to the file, including schema defaults and fields that were omitted. Use `--fields` to keep other values as they were.

```bash
npx lines-db migrate ./data/users.jsonl "(row) => row" --fields id
```

Rows are matched by primary key, or by position when the file has no primary key yet, such as when filling in that key. Existing row order is preserved, and new rows are appended. If the file has no primary key and the row count has changed, the migration fails because the rows cannot be matched.

`--fields` applies to all target tables. Tables without the named fields are not written back, so one list can cover tables with different columns. A field absent from every table causes an error.

### Fill missing values

```bash
npx lines-db fill <path...> [--schema-dir ./schemas] [--fields id,createdAt]
```

Pass one or more data directories or JSONL files. Use `--schema-dir` for shared schemas; otherwise schemas are loaded next to each JSONL file. The command fills missing fields with values supplied by the validation schema. Without `--fields`, it fills each table's primary key.

Existing values are never replaced. Lines that gain no values remain unchanged, including line endings. Updated lines use the schema's key order. Rows that fail validation are not written. All values are computed before writing any files. If another tool changed a file after it was read, the command writes nothing and stops with a `JsonlConflictError` naming that file.

Use field names as stored in the file. When a `backward` transformation renames a primary key, the default target is the database's primary key name; pass the file's field name with `--fields`.

`fillFields()` accepts a function to compute values. This example uses a `hook` exported by the schema file. If the function throws, nothing is written.

```typescript
import { fillFields, unwrap } from 'lines-db';

const { filled } = unwrap(
  await fillFields({
    path: './data',
    fields: ['id'],
    loadFiller: (schemaModule, { schemaPath }) => {
      if (typeof schemaModule.hook !== 'function') throw new Error(`${schemaPath} does not export \`hook\``);
      return schemaModule.hook;
    },
  }),
);
```

The result's `tablesWithoutSchema` lists tables without schemas, `unreadableLines` lists lines that are not JSON objects, and `unproducedFields` lists fields for which no table produced a value.

`fillFields()` accepts a string or a non-empty readonly array of strings for `path`. Across all paths, every value is computed and every pending write is checked for outside changes before writing. If a write fails, files already written are restored. Overlapping paths process each file only once. Unreadable lines are still reported and left unchanged.

```typescript
unwrap(
  await fillFields({
    path: ['./data/dataset-a', './data/dataset-b'],
    schemaDir: './data',
  }),
);
```

### Browse and Edit in the Browser

Install Studio in the project and start it with the CLI.

```bash
npm install -D @lines-db/studio
npx lines-db studio ./data --open
```

The default URL is `http://127.0.0.1:4848`. Changes are validated and written to the JSONL files when you save. See the [Studio documentation](https://github.com/toiroakr/lines-db/blob/main/studio/README.md) for editing, shared schemas, and multiple data directories.

## TypeScript usage

### Generate types

Generate a database config and types from the schemas. The default output is `<dataDir>/db.ts`.

```bash
npx lines-db generate <dataDir>
```

```bash
npx lines-db generate ./data
```

To run these commands through `package.json`:

```json
{
  "scripts": {
    "db:validate": "lines-db validate ./data",
    "db:generate": "lines-db generate ./data"
  }
}
```

### Load data

Create `data/users.jsonl`.

```text
{"id":1,"name":"Alice","age":30,"email":"alice@example.com"}
{"id":2,"name":"Bob","age":25,"email":"bob@example.com"}
{"id":3,"name":"Charlie","age":35,"email":"charlie@example.com"}
```

Load the directory from TypeScript.

```typescript
import { LinesDB, unwrap } from 'lines-db';

const db = LinesDB.create({ dataDir: './data' });
unwrap(await db.initialize());

const users = unwrap(db.find('users'));
console.log(users); // [{ id: 1, name: "Alice", ... }, ...]

const user = unwrap(db.findOne('users', { id: 1 }));
console.log(user); // { id: 1, name: "Alice", age: 30, ... }

const adults = unwrap(db.find('users', { age: (age) => age >= 30 }));

unwrap(await db.close());
```

`unwrap()` returns the value from a successful `Result` or throws its error. See [Error handling](#error-handling) for handling failures explicitly.

### Use generated types

The generated config infers row types from table names.

```typescript
import { LinesDB, unwrap } from 'lines-db';
import { config } from './data/db.js';

const db = LinesDB.create(config);
unwrap(await db.initialize());

const users = unwrap(db.find('users'));

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

## Error handling

Methods in `LinesDB` and `JsonlReader` that can fail return `Result<T, Error>`. A successful result is `{ ok: true, value }`; a failed result is `{ ok: false, error }`. `getSchema`, `getTableNames`, and `getDb` return their values directly.

```typescript
const result = db.insert('users', { id: 2, name: '' });

if (result.ok) {
  console.log(result.value.changes);
} else {
  console.log(result.error.message);
}
```

`unwrap(result)` returns the value on success and throws the error on failure. Use it when a failure should stop the current operation.

```typescript
import { unwrap } from 'lines-db';

const users = unwrap(db.find('users'));
```

Inside a transaction, `tx` also returns Results. A failed `insert()` or `update()` does not roll back the transaction by itself. To abort on failure, use `unwrap()` or check the Result and throw with `throw result.error`.

Write through `tx` inside the transaction. Writes through `db` from other code would become part of the same transaction, so they are refused while it is open. SQL through `db.getDb()`, `db.execute()`, and `db.query()` is read-only during the transaction. `SELECT`, `VALUES`, `WITH`, `EXPLAIN`, and read-only pragmas such as `PRAGMA table_info(...)` are accepted. Run transaction control or pragmas that set values through `tx`.

## API

The operations below return `Result<T, Error>` unless noted otherwise. `getSchema`, `getTableNames`, and `getDb` return their values directly.

### Queries

- `find(table, where?)`: Find all matching records.
- `findOne(table, where?)`: Find one record.
- `query(sql, params?)`: Run a raw SQL query.

### Changes

- `insert(table, data)`: Insert one record.
- `update(table, data, where)`: Update matching records.
- `delete(table, where)`: Delete matching records.

### Batch operations

- `batchInsert(table, data[])`: Insert several records.
- `batchUpdate(table, updates[])`: Update several records.
- `batchDelete(table, where)`: Delete several records.

### Transactions and schemas

- `transaction(fn)`: Run operations in a transaction.
- `sync(table?, options?)`: Write changes back to the JSONL files.
- `getSchema(table)`: Get the schema. Returns `TableSchema | undefined` directly.
- `validateRow(table, row)`: Validate a row, including a row from a table excluded on load due to validation errors. Returns `Result<JsonObject, ValidationError>`.
- `getTableNames()`: Get all table names. Returns `string[]` directly.

### Query conditions

```typescript
unwrap(db.find('users', { age: 30 }));

unwrap(db.find('users', { age: 30, name: 'Alice' }));

unwrap(
  db.find('users', {
    age: (age) => age > 25,
    name: (name) => name.startsWith('A'),
  }),
);
```

### JSON columns

Objects and arrays are stored as JSON columns and returned as their original values.

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

### Schema transformations

If a schema converts date strings to `Date` objects on load, define a `backward` transformation to convert them to strings when saving. JSONL stores the strings; the application works with `Date` objects.

```typescript
import * as v from 'valibot';
import { defineSchema } from 'lines-db';

const eventSchema = v.pipe(
  v.object({
    id: v.number(),
    date: v.pipe(
      v.string(),
      v.isoDate(),
      v.transform((str) => new Date(str)),
    ),
  }),
);

export const schema = defineSchema(eventSchema, {
  backward: (output) => ({
    ...output,
    date: output.date.toISOString().slice(0, 10),
  }),
});
```

Store the date as a string in `events.jsonl`.

```text
{"id":1,"date":"2024-01-01"}
```

The loaded row exposes the date as a `Date`.

```typescript
const event = unwrap(db.findOne('events', { id: 1 }));
console.log(event.date instanceof Date); // true
console.log(event.date.getFullYear()); // 2024
```

### Transactions

Changes outside a transaction are automatically synced to the JSONL file.

```typescript
unwrap(db.insert('users', { id: 10, name: 'Alice', age: 30 }));
```

Sync preserves the original row order and appends new rows.

Use a transaction to save several changes together.

```typescript
unwrap(
  await db.transaction(async (tx) => {
    unwrap(tx.insert('users', { id: 10, name: 'Alice', age: 30 }));
    unwrap(tx.update('users', { age: 31 }, { id: 1 }));
  }),
);
```

Use `unwrap()` inside the callback to throw on a failed operation and roll back the transaction.

After the callback finishes, changed tables are written back before committing. All target files are checked before the first write. If write-back fails, the transaction is rolled back and files already written are restored. If restoration also fails, that file keeps its changes.

Unchanged tables are not written back. However, SQL that changes rows through `tx.execute()` or `tx.query()` writes back every table because the changed tables cannot be identified. Calling `sync()` inside the callback returns an error; the transaction handles write-back at the end.

### Files changed after loading

The database records each JSONL file's contents when reading or writing it. If an editor or another tool has changed or deleted the file since then, sync leaves it untouched and returns a `JsonlConflictError` naming the file.

```typescript
const result = await db.transaction((tx) => unwrap(tx.update('users', { age: 31 }, { id: 1 })));

if (!result.ok && result.error.name === 'JsonlConflictError') {
  console.log(`${(result.error as JsonlConflictError).file} has changed on disk`);
}
```

To load external changes, recreate the database, call `initialize()`, and retry the write. A transaction writes back only changed tables and rolls back the database changes if a conflict occurs.

With `sync()` or automatic sync outside a transaction, database changes remain after a failed write-back. A `sync()` without a table name targets every table, so a change to any file causes it to fail. Automatic sync reports errors through `console.error`.

Files are not locked between checking their contents and writing. Changes saved by another process during that interval are overwritten. This is intended for one person editing local files; it does not coordinate concurrent writers.

`hasExternalChanges()` detects changes, additions, and deletions of JSONL and schema files since the last read or write. `findExternalChanges()` lists the affected files. Use them to detect edits made by other tools and reload data in a long-running process.

```typescript
if (unwrap(await db.hasExternalChanges())) {
  await db.close();
  db = LinesDB.create(config);
  unwrap(await db.initialize());
}
```

### Values the Schema Fills In

Normal sync writes whole rows, including schema defaults and computed values. With `writeFilledValues: 'primaryKey'`, it writes fields present in the file, passed to `insert()`, or changed by `update()`. Other defaults remain omitted. Generated primary keys are saved so the row keeps its identity on the next load.

```typescript
const db = LinesDB.create({ dataDir: './data', writeFilledValues: 'primaryKey' });
// people.jsonl: {"id":1,"name":"Alice"}
unwrap(await db.transaction((tx) => unwrap(tx.update('people', { name: 'Alicia' }, { id: 1 }))));
// people.jsonl: {"id":1,"name":"Alicia"}
```

Use `sync(tableName, { writeFilledValues })` to override the setting for one sync. Setting a field to its existing value is not a change, so setting a defaulted field to that same value does not write it to the file. Fields explicitly named in `writeBackFields` or `sync(..., { fields })` are written even when the schema supplied them.

`resetToDefault` restores a field's schema default. With `writeFilledValues: 'primaryKey'`, that field is removed from the file.

```typescript
unwrap(db.update('people', {}, { id: 1 }, { resetToDefault: ['age'] }));
```

`findWithDefaults()` returns each row and the names of fields supplied by the schema. Use it to distinguish defaults from values stored in the file.

```typescript
unwrap(await db.findWithDefaults('people'));
// [{ row: { id: 1, name: 'Alicia', age: 20 }, defaulted: ['age'] }]
```

Rows whose `backward` transformation renames fields, or rows added by SQL with no original row or write record, are written in full because explicitly supplied fields cannot be identified. A table changed through SQL also has all rows written back. Fields set by a migration `transform` on load count as explicitly supplied.

Unknown fields from the original row retain their position on write-back. Schemas that strip unknown keys, such as Valibot's `v.object()`, allow those rows to pass validation. Use `v.strictObject()` or another schema that rejects unknown keys to report them as errors.

### Write back selected fields

When fields are specified, their database values are written even if the schema supplied them. Other values remain as stored in the file.

```typescript
// users.jsonl: {"name":"Alice"}
unwrap(await db.sync('users', { fields: ['id'] }));
// users.jsonl: {"id":"...","name":"Alice"}
```

Set `writeBackFields` in the config to apply the rule to every sync, including automatic sync after inserts, updates, and transactions.

```typescript
const db = LinesDB.create({ dataDir: './data', writeBackFields: ['id'] });
```

Rows are matched by primary key, or by position when the file has no primary key yet. Row order is preserved, and new rows are appended. Selected fields use the database value, including null. If rows cannot be matched, `sync()` returns a failed Result.

New fields are inserted in schema order. For example, an `id` declared first is inserted at the beginning of the row when filled later. Existing keys do not move, and unknown keys stay after declared keys.

Key order is read from the rows produced by the schema. Fields produced first are ordered first; fields first encountered in later rows follow them. Set `mergeFields`'s `keyOrder` to specify the order explicitly.

A `sync()` for a specific table rejects fields that the table does not have. Sync across all tables and the config's `writeBackFields` skip tables without those fields, so the same list works for different column sets.

### Edit rows without a database

`mergeFields` takes the original row and a computed row and returns a row with only the selected fields updated. Use it to edit files without loading them into SQLite, such as when a hook supplies IDs.

```typescript
import { JsonlReader, JsonlWriter, mergeFields, unwrap } from 'lines-db';

const rows = unwrap(await JsonlReader.read('./data/users.jsonl'));
const filled = rows.map((row) => mergeFields(row, fillIds(row), { fields: ['id'] }));
await JsonlWriter.write('./data/users.jsonl', filled);

// {"name":"Alice"}  ->  {"id":"018f...","name":"Alice"}
```

Fields outside the selection are not validated. Even if their values would fail the schema, selected fields can still be updated. Fields absent from the computed row keep their original values. If computed key order differs from schema order, use `keyOrder` to set the position of new keys.

## Configuration

```typescript
interface DatabaseConfig {
  dataDir: string | readonly string[];
  schemaDir?: string;
  writeDataSets?: boolean;
  writeBackFields?: readonly string[];
}

const db = LinesDB.create({ dataDir: './data' });
```

### Data sets

Split shared seed data from scenario-specific data and load the directories you need together.

```
data/
  Item.schema.ts   Item.jsonl              # schemas and base data
  ItemValuation.schema.ts
  cogs/
    Item.jsonl                             # additional Item rows
    ItemValuation.jsonl                    # references Item rows from both sets
```

```typescript
const db = LinesDB.create({ dataDir: ['./data', './data/cogs'], schemaDir: './data' });
const result = unwrap(await db.initialize({ detailedValidate: true }));
```

Rows for the same table are concatenated in `dataDir` order. Validation, unique constraints, and foreign keys are checked across all rows. `cogs/ItemValuation.jsonl` can reference rows from `data/Item.jsonl`. Duplicate IDs across sets cause a constraint violation. Errors identify the source file and row within it.

Multiple directories require `schemaDir` to locate shared schemas. It can also be used with one directory. If omitted for a single directory, schemas are looked up next to the JSONL files.

Databases with multiple directories are read-only by default. Set `writeDataSets: true` to write updates and deletions back to their source files. Inserts require an explicit configured directory.

```typescript
const db = LinesDB.create({ dataDir: ['./data', './data/cogs'], schemaDir: './data', writeDataSets: true });
unwrap(await db.initialize());
unwrap(
  await db.transaction((tx) => {
    const inserted = tx.insert('Item', { id: 'new-item', name: 'New item' }, { dataDir: './data/cogs' });
    if (!inserted.ok) throw inserted.error;
  }),
);
```

Use `insert()` with a destination to add rows across multiple directories. `batchInsert()` has no destination argument. SQL through `execute()`, `query()`, `queryOne()`, and `getDb()` remains read-only to preserve each row's source location.

Transactions check target files before writing and restore files already written if a later write fails. Studio enables `writeDataSets` automatically.

## Type mapping

| JSON type        | Column type | SQLite storage |
| ---------------- | ----------- | -------------- |
| number (integer) | INTEGER     | INTEGER        |
| number (float)   | REAL        | REAL           |
| string           | TEXT        | TEXT           |
| boolean          | INTEGER     | INTEGER        |
| object           | JSON        | TEXT           |
| array            | JSON        | TEXT           |

## License

MIT
