# LinesDB VS Code Extension

VS Code extension for [lines-db](https://github.com/lines-db/lines-db) - JSONL database utilities with schema validation.

## Features

### 1. Command Palette Integration

Execute lines-db CLI commands directly from VS Code:

- **LinesDB: Validate Files** - Validate JSONL files against their schemas
- **LinesDB: Migrate Data** - Migrate data with transformation functions

Access these commands from the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`).

### 2. Real-time Validation Diagnostics

- Automatically validates JSONL files against their schemas
- Shows validation errors inline in the editor
- Errors are displayed with detailed messages and field paths

### 3. CodeLens

- Shows record count at the top of JSONL files
- Provides quick access to validation commands
- Click on the record count to see file statistics

### 4. Hover Information

- Hover over schema exports in `.schema.ts` files to see:
  - Table name
  - Corresponding JSONL file
  - Number of records
  - File status

## Requirements

- VS Code 1.85.0 or later
- lines-db library installed in your project
- Node.js 22.5.0 or later (for lines-db CLI)

## Extension Settings

This extension contributes the following settings:

- `lines-db.dataDir`: Directory containing JSONL and schema files (default: `./data`)
- `lines-db.enableDiagnostics`: Enable/disable real-time validation diagnostics (default: `true`)

## Usage

### Setting up your project

1. Install lines-db in your project:

   ```bash
   npm install lines-db
   # or
   pnpm add lines-db
   ```

2. Create a data directory with JSONL files and schema files:

   ```
   data/
     ├── users.jsonl
     ├── users.schema.ts
     ├── products.jsonl
     └── products.schema.ts
   ```

3. Configure the extension (optional):
   - Open VS Code settings
   - Search for "LinesDB"
   - Set your data directory path

### Using the extension

#### Validate Files

1. Open Command Palette
2. Type "LinesDB: Validate Files"
3. Validation results will be shown in a notification

Or, simply open a JSONL file and the extension will automatically validate it in real-time.

#### Migrate Data

1. Open a JSONL file in the editor
2. Right-click in the editor and select "LinesDB: Migrate Data"
   - Or open Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) and type "LinesDB: Migrate Data"
3. Follow the prompts:
   - Enter transformation function (e.g., `(row) => ({ ...row, updated: true })`)
   - Optionally enter a filter expression (e.g., `{ age: (age) => age > 25 }`)

#### View Schema Information

1. Open a `.schema.ts` file
2. Hover over the `schema` export
3. See table information including record count

## Development

### Building from source

```bash
# Install dependencies
pnpm install

# Build the extension
pnpm --filter lines-db-vscode build

# Watch mode
pnpm --filter lines-db-vscode watch
```

### Testing the extension

1. Open the `extension` folder in VS Code
2. Press F5 to launch the Extension Development Host
3. Test the extension features in the new window

## Known Issues

- Real-time validation may be slow for very large JSONL files
- Migration commands require manual input for transformation functions

## Release Notes

### 0.1.0

Initial release with:

- Command palette integration for validate and migrate
- Real-time validation diagnostics
- CodeLens showing record counts
- Hover information for schema files
- JSONL syntax highlighting

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT
