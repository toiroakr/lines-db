import * as v from 'valibot';
import { defineSchema } from '@toiroakr/lines-db';
import type { InferOutput } from '@toiroakr/lines-db';

const childSchema = v.object({
  id: v.pipe(v.number(), v.integer(), v.minValue(1)),
  parentEmail: v.pipe(v.string(), v.email()),
  data: v.string(),
});

export const schema = defineSchema(childSchema, {
  primaryKey: 'id',
  // Reference parent-table's email column, which is NOT primary key but has unique index
  foreignKeys: [
    {
      column: 'parentEmail',
      references: { table: 'parent-table', column: 'email' },
    },
  ],
});

export type Child = InferOutput<typeof schema>;

export default schema;
