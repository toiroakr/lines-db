---
'@toiroakr/lines-db': patch
---

Add named dataset configuration for CLI and programmatic use. Export `loadDatasetConfig(path?, { datasets?: string[] | "all" })` returning a database configuration; omit `datasets` or use `[]` for base only, pass an array to combine named sets in order, or use `"all"` to combine every set. `validate` without a positional path reads `lines-db.config.json` and validates only `base`; Repeated `--dataset <name>` flags add named sets in order and `--all-datasets` combines all sets. `--config <path>` selects another configuration, and data and schema paths resolve relative to that file. Existing positional file and directory validation remains unchanged. Reject nonexistent or non-directory schema paths to prevent skipped validation. Reject invalid configurations, unknown datasets and conflicting options; deduplicate overlapping data directories before validation.
