---
'@toiroakr/lines-db': minor
---

feat: Refactor validation process and enhance database initialization

- Added detailedValidate option to initialize() for detailed constraint violation reporting
- Enhanced migrate command to apply transforms during initialization for better performance
- Implemented batch insert for improved performance with SQLite parameter limits
- Added support for self-referencing foreign keys (e.g., nullable parent_id columns)
- Improved error handling and reporting for validation failures
- Added transform option to initialize() method for data transformation during load
- Enhanced foreign key dependency resolution
- Added type-fest as dev dependency
