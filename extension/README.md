# LinesDB for VS Code

[日本語](./README.ja.md)

This extension validates JSONL files using [lines-db](https://github.com/toiroakr/lines-db/tree/main/lib#readme). It also provides record counts, schema information, and commands for validation and migration.

## Setup

Requires VS Code 1.134.0 or later. Install `lines-db` in the workspace project; the library requires Node.js 22.12.0 or later.

```bash
npm install lines-db
```

Place JSONL files and their schemas in the data directory.

```text
data/
  users.jsonl
  users.schema.ts
  products.jsonl
  products.schema.ts
```

The default data directory is `./data`. To use another directory, change `lines-db.dataDir` in the workspace settings.

## Validation and schema information

Open a JSONL file to see validation errors in the editor. Diagnostics identify the affected fields and explain the errors. To validate the full data directory, run **LinesDB: Validate Files** from the Command Palette.

CodeLens shows the record count at the top of each JSONL file and provides a validation action. Hover over a `schema` export in a `.schema.ts` file to see the table name, corresponding file, record count, and validation status.

Large files can take longer to validate.

## Migration

Open a JSONL file and run **LinesDB: Migrate Data** from the Command Palette. Enter a transformation function, for example:

```js
(row) => ({ ...row, updated: true });
```

You can also enter a filter to limit the rows being changed.

```js
{
  age: (age) => age > 25;
}
```

Open the Command Palette with Cmd+Shift+P on macOS or Ctrl+Shift+P on Windows and Linux.

## Settings

Search for “LinesDB” in VS Code settings.

| Setting                      | Description                                 | Default  |
| ---------------------------- | ------------------------------------------- | -------- |
| `lines-db.dataDir`           | Directory containing JSONL and schema files | `./data` |
| `lines-db.enableDiagnostics` | Enable validation diagnostics while editing | `true`   |

## Development

From the repository root:

```bash
pnpm install
pnpm --filter lines-db-vscode build
```

Use `pnpm --filter lines-db-vscode watch` to rebuild on changes. To try the extension, open the `extension` folder in VS Code and press F5 to launch an Extension Development Host.

## Release notes

See [CHANGELOG.md](./CHANGELOG.md).

## License

[MIT](../LICENSE)
