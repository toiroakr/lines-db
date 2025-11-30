import * as v from 'valibot';
import { defineSchema } from '@toiroakr/lines-db';
import type { InferOutput } from '@toiroakr/lines-db';
import { STATUS_VALUES } from '../testdir/shared.js';

const itemSchema = v.object({
  id: v.pipe(v.number(), v.integer(), v.minValue(1)),
  name: v.string(),
  status: v.union(STATUS_VALUES.map((s) => v.literal(s))),
});

export const schema = defineSchema(itemSchema, {
  primaryKey: 'id',
});

export type Item = InferOutput<typeof schema>;

export default schema;
