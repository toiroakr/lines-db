---
'@toiroakr/lines-db': patch
---

fix: skip validation with warning instead of error when schema file is not found

When validating a directory containing JSONL files, if a schema file is missing for some tables, the validator will now:

- Skip validation for those files with a warning message instead of throwing an error
- Display warnings in yellow in the CLI output
- Continue validation for other files that have schema files

This allows for more flexible validation workflows where not all tables require validation schemas.
