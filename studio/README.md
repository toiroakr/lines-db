# @lines-db/studio

[日本語](./README.ja.md)

Studio is a browser editor for [lines-db](https://github.com/toiroakr/lines-db). It runs a local server, reads JSONL tables, and validates edits against their schemas before saving.

## Start Studio

Requires Node.js 22.12.0 or later. Install both packages in the project.

```bash
npm install -D lines-db @lines-db/studio
npx lines-db studio ./data --open
```

The default URL is `http://127.0.0.1:4848`. Use `--port` to change the port, or `--port 0` to pick a free one. `--open` opens the browser. Press Ctrl+C to stop the server.

A table needs a primary key with a value on every row to be editable. Studio uses the `id` column or the schema's `primaryKey` definition. Tables without a primary key are read-only.

## Edit and save

Select a table to see its rows and columns. The row form beside the grid edits all fields of a record. Open it from the button on the right of the header, and drag its edge to resize it. While the form is open, click a row to select it or double-click a cell to edit it. When the form is hidden, double-click a row to open it. Foreign key fields link to the referenced row.

Use **Add record** to create a row, or select rows to delete them. The dialog includes the primary key and checks the whole row as you enter values. Empty fields are omitted so the schema can fill them in.

Edits, additions, and deletions remain pending until **Save N changes** writes them in one transaction. **Discard** removes the pending changes. If validation fails, Studio shows the errors and keeps the edits for correction. A normal save rewrites the table's JSONL file, so formatting on unchanged lines can also change.

### Fields and JSON values

The cell editor validates values as you type and shows errors below the affected field. **Set** adds the value to the pending changes; it does not save the file. Press Enter to set a value, or Cmd/Ctrl+Enter in the JSON editor. Text fields grow to fit their contents, and Shift+Enter inserts a line break.

JSON objects have an input for each key, arrays have one for each item, and arrays of objects have a block for each item. Switch a block to the JSON editor to edit the value as text. Syntax errors are marked in place. Comments and trailing commas are accepted while editing and removed when you set the value.

Values supplied by the schema are dimmed and marked **default**. **Remove field** omits a field from the file so the schema can supply its value again. **Set null** sets it to null. Studio offers these actions only when the schema accepts them. It checks a sample row to determine whether a field can be removed or set to null, or whether keys can be added or removed within a JSON value.

By default, saves write explicitly supplied fields and generated primary keys. Other schema defaults remain omitted. Use `--write-filled-values all` to write every value, including defaults. See [write-back behavior](https://github.com/toiroakr/lines-db/blob/main/lib/README.md#values-the-schema-fills-in) for details.

### Fix invalid rows

When a table contains rows that fail validation, Studio displays the original file and marks the affected rows and cells. Saving a correction validates the row and rewrites only that line. Other lines remain unchanged. Once every row passes validation, Studio loads the table normally.

Adding and deleting rows is disabled while the table has validation errors. Unknown fields rejected by the schema are marked **not in schema**; the column header can remove that field from every row.

## Inspect schemas

**Schema** shows columns, foreign keys, and indexes. Each column lists its type and whether it is optional or nullable. Foreign keys link to the referenced table's schema. The URL records the open schema, for example `#orders?schema=customers`.

Studio reads declared columns from the schema's Standard Schema `types` using the TypeScript installed in the project. It supports the compiler API in TypeScript 5 and 6 and the Corsa API in TypeScript 7.1 and later. If TypeScript is unavailable or the schema does not declare types, Studio infers columns from the rows and labels them accordingly.

The **Code** tab shows the schema file as stored on disk, with syntax highlighting. Tables with invalid rows show only the code. The header also lets you choose system, light, or dark colors.

## Shared schemas and data sets

Use `--schema-dir` when the schema files live separately from the data.

```bash
npx lines-db studio seed/data/cogs --schema-dir seed/data
```

Repeat `--data-dir` to combine several data directories. A positional directory can also be combined with `--data-dir`. Multiple directories require `--schema-dir`.

```bash
npx lines-db studio --data-dir seed/data --data-dir seed/data/cogs --schema-dir seed/data
```

Validation, declared columns, foreign keys, and the Schema dialog use the shared schemas. Unique constraints and foreign keys are checked across all selected data sets.

Updates and deletions go back to each row's source file. In **Add record**, choose the destination directory; Studio creates the table file there if needed. If a save fails after writing a file, Studio attempts to restore the files it already wrote.

## Changes made outside Studio

Studio watches the files on disk. With no pending edits, it reloads changed data automatically. With pending edits, it shows a notice.

Before saving, Studio reloads changed schemas and validates against them. If a file that the save would write has changed, the save stops, names the file, and reloads the tables without writing. This includes tables affected by foreign key actions such as `CASCADE` or `SET NULL`. Changes to unrelated table files do not stop the save.

## Local server

The server creates a token at startup and includes it in the page. The page stores it in `sessionStorage` and sends it with API requests. Requests without the token receive a 401 response. Pages on other sites cannot read the Studio page to obtain the token.

The server accepts requests addressed to its local host. Writes must come from the Studio page with an `application/json` content type.

## Start from code

```js
import { startStudioServer } from '@lines-db/studio';

const studio = await startStudioServer({ dataDir: './data', port: 4848 });
console.log(studio.url);
await studio.close();
```

TypeScript schema files require a loader such as `amaro/transform`. The lines-db CLI registers it automatically. When starting from code, register a loader before loading the schemas.
