# Changelog

All notable changes to the LinesDB VS Code Extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Bundle Prism.js syntax highlighter locally instead of loading from a CDN, so the JSONL preview works in offline environments. The webview now loads scripts from the extension's `dist/prism/` directory under a strict Content Security Policy with a per-render nonce. Switched the highlighted block to `language-json5` and bundled the JSON5 grammar component so the preview's inline `// Displayed as array for multiline string readability` annotation is tokenized as a comment. Inline `onclick`/`onchange` handlers were replaced with `addEventListener` calls so the navigation, edit, and copy buttons still work under the nonce-only CSP. The CSP nonce is generated with `crypto.randomBytes(24)` (base64) instead of `Math.random()` so it is unpredictable, trusted placeholders (`{{NONCE}}`, `{{CSP_SOURCE}}`, Prism asset URIs) are substituted before user-controlled `{{CONTENT}}` / `{{ORIGINAL_CONTENT}}` to prevent placeholder smuggling, and user-content substitutions use function replacers so `$&`/`$1`-style sequences in JSONL data are not interpreted as `String.prototype.replace` specials.

## [0.8.0]

### Added

- **Support for .mts and .cts schema files**: Schema files with `.schema.mts` and `.schema.cts` extensions are now supported in addition to `.schema.ts`
  - Hover information works on all schema file types
  - Diagnostics revalidation triggers for all schema extensions
  - Code completion discovers schema files with any supported extension
  - Column sorting resolves schema from all supported extensions
  - Auto-detection with priority order: `.schema.ts` > `.schema.mts` > `.schema.cts`

## [0.2.0]

### Added

- **JSON Line Preview**: New preview panel feature to visualize JSON data in a formatted view
  - Added `lines-db.previewJsonlLine` command
  - Implemented preview panel with syntax highlighting
  - Added "Show Preview" button in CodeLens
  - Created preview template with proper styling
- **JSON Line Editor**: Edit individual JSONL lines in a temporary file with auto-save
  - Added `lines-db.editJsonlLine` command
  - Temporary file management with automatic cleanup
  - Changes are automatically applied back to the original file on save
  - File watcher for tracking changes
- **Code Completion**: Intelligent autocomplete for JSONL files based on TypeScript schema
  - Field name completion with type information
  - Enum value suggestions
  - Quote handling and smart insertion
  - Nested object support
  - Schema file watching for cache invalidation
- **Code Actions**: Quick actions available via lightbulb menu
  - "Edit JSON line" action
  - "Preview JSON line" action
- **Build improvements**: HTML template copying in esbuild process

### Fixed

- Fixed validator constraint detection for proper validation
- Fixed completion filtering when typing inside quotes
- Improved quote handling in completion suggestions
- Fixed diagnostics and completion for editing temporary files

### Changed

- Updated package version to 0.2.0
- Enhanced publish script to include git tagging
- Reorganized dependencies in package.json

## [0.1.5] - Previous Release

### Added

- Schema-based JSONL validation
- Command palette integration
- Basic CodeLens support

## [0.1.0] - Initial Release

### Added

- Real-time validation diagnostics
- Command palette integration (validate/migrate)
- CodeLens with record counts
- Hover information for schema files
- JSONL syntax highlighting
