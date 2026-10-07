---
'@toiroakr/lines-db': patch
---

Add named dataset configuration for CLI validation. `validate` without a positional path reads `lines-db.config.json` and validates only `base`; `--dataset <name>` adds a named set and `--all-datasets` combines all sets. `--config <path>` selects another configuration, and data and schema paths resolve relative to that file. Existing positional file and directory validation remains unchanged. Reject invalid configurations, unknown datasets and conflicting options; deduplicate overlapping data directories before validation.
