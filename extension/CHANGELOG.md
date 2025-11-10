# Changelog

All notable changes to the LinesDB VS Code Extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
