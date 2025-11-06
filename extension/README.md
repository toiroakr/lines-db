# LinesDB VS Code Extension

VS Code extension for [@toiroakr/lines-db](https://github.com/toiroakr/lines-db/tree/main/lib#readme) - JSONL database utilities with schema validation.

## Features

### 🔍 Real-time Validation

Automatically validates JSONL files as you edit them:

- **Inline error highlighting** - See validation errors directly in your editor
- **Detailed error messages** - Understand what's wrong with specific fields
- **Instant feedback** - Catch data quality issues before runtime

### 💻 Command Palette Integration

Execute lines-db CLI commands without leaving VS Code:

- **LinesDB: Validate Files** - Validate all JSONL files in your data directory
- **LinesDB: Migrate Data** - Transform data with validation

Access via `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux).

### 📊 CodeLens Information

See data statistics at a glance:

- **Record count** displayed at the top of JSONL files
- **Quick validation** access with one click

### 💡 Hover Information

Hover over `schema` exports in `.schema.ts` files to see:

- Table name and corresponding JSONL file
- Number of records
- File validation status

## Requirements

- **VS Code** 1.85.0 or later
- **@toiroakr/lines-db** installed in your project
- **Node.js** 22.5.0 or later

## Extension Settings

Configure the extension in VS Code settings (search for "LinesDB"):

| Setting                      | Description                                 | Default  |
| ---------------------------- | ------------------------------------------- | -------- |
| `lines-db.dataDir`           | Directory containing JSONL and schema files | `./data` |
| `lines-db.enableDiagnostics` | Enable real-time validation diagnostics     | `true`   |

## Usage

### Quick Start

**1. Install lines-db in your project:**

```bash
npm install @toiroakr/lines-db
# or
pnpm add @toiroakr/lines-db
```

**2. Create your data directory:**

```
data/
  ├── users.jsonl
  ├── users.schema.ts
  ├── products.jsonl
  └── products.schema.ts
```

**3. Open a JSONL file** - The extension will automatically start validating!

### Validate Files

**Automatic validation:**

- Open any `.jsonl` file and see real-time validation errors

**Manual validation:**

- Command Palette → "LinesDB: Validate Files"
- Validates all JSONL files in your data directory

### Migrate Data

**Transform data with validation:**

1. Open a JSONL file
2. Command Palette → "LinesDB: Migrate Data"
3. Enter transformation: `(row) => ({ ...row, updated: true })`
4. (Optional) Enter filter: `{ age: (age) => age > 25 }`

### View Schema Info

Hover over `schema` exports in `.schema.ts` files to see:

- Table name and file path
- Record count
- Validation status

## Development

**Build from source:**

```bash
# Install dependencies
pnpm install

# Build the extension
pnpm --filter lines-db-vscode build

# Watch mode
pnpm --filter lines-db-vscode watch
```

**Test the extension:**

1. Open `extension` folder in VS Code
2. Press `F5` to launch Extension Development Host
3. Test features in the new window

## Known Issues

- Real-time validation may be slow for large JSONL files (10,000+ records)
- Migration requires manual transformation function input

## Release Notes

### 0.1.0 (Initial Release)

- ✅ Real-time validation diagnostics
- ✅ Command palette integration (validate/migrate)
- ✅ CodeLens with record counts
- ✅ Hover information for schema files
- ✅ JSONL syntax highlighting

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT
