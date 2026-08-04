---
'@toiroakr/lines-db': minor
---

Put a field a line did not have where the schema declares it, instead of at the end of the line, and
export that merge as `mergeFields` for filling a JSONL file in without a database.

A write-back appended a key the line was missing, which left a backfilled `id` trailing at the end of
the row - somewhere no hand-written seed line puts it - and left callers re-reading the file afterwards
to reorder it themselves:

```jsonl
{"name":"Alice","id":"018f…"}   before
{"id":"018f…","name":"Alice"}   now
```

The order comes from the row the schema computes, so it is the order the schema declares its fields in.
A key the line already had never moves, and a key the schema does not declare stays behind the declared
ones.

`mergeFields` is that same merge on its own, for when the values come from somewhere other than a query
and loading the file into SQLite would only get in the way:

```typescript
import { JsonlReader, JsonlWriter, mergeFields } from '@toiroakr/lines-db';

const rows = await JsonlReader.read('./data/users.jsonl');
const filled = rows.map((row) => mergeFields(row, fillIds(row), { fields: ['id'] }));
await JsonlWriter.write('./data/users.jsonl', filled);
```

Nothing else in the line is read or checked, so a field in a format a schema would reject cannot keep
the named ones from being written. A field the computed row has no value for is left alone rather than
nulled out, and `keyOrder` overrides where a new key lands when the computed row does not list its
fields in the order the schema declares them.
