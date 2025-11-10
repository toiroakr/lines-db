import * as v from 'valibot';
import { defineSchema } from '@toiroakr/lines-db';
import type { InferOutput } from '@toiroakr/lines-db';

const customerSchema = v.object({
  id: v.pipe(v.number(), v.integer(), v.minValue(1)),
  name: v.string(),
  email: v.pipe(v.string(), v.email()),
});

export const schema = defineSchema(customerSchema, {
  primaryKey: 'id',
  indexes: [{ columns: ['email'], unique: true }],
});

export type Customer = InferOutput<typeof schema>;

export default schema;
