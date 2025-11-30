import * as v from 'valibot';
import { defineSchema } from '@toiroakr/lines-db';
import type { InferOutput } from '@toiroakr/lines-db';
import { STATUS_VALUES } from '../../testdir/shared';

// Path ../../testdir/ goes up 2 levels - this matches SDK structure
// where seed/data/ schema imports from ../../tailordb/
const customerSchema = v.object({
  id: v.pipe(v.number(), v.integer(), v.minValue(1)),
  name: v.string(),
  status: v.union(STATUS_VALUES.map((s) => v.literal(s))),
});

export const schema = defineSchema(customerSchema, {
  primaryKey: 'id',
});

export type Customer = InferOutput<typeof schema>;

export default schema;
