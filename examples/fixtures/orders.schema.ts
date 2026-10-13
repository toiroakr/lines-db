import * as v from 'valibot';
import { defineSchema } from 'lines-db';
import type { InferOutput } from 'lines-db';

// Define order schema with JSON columns
const orderSchema = v.object({
  id: v.pipe(v.number(), v.integer(), v.minValue(1)),
  customerId: v.pipe(v.number(), v.integer(), v.minValue(1)),
  items: v.array(
    v.object({
      name: v.string(),
      quantity: v.pipe(v.number(), v.integer(), v.minValue(0)),
      price: v.pipe(v.number(), v.minValue(0)),
    }),
  ),
  metadata: v.nullable(v.record(v.string(), v.any())),
});

// Wrap with defineSchema to create BiDirectionalSchema
// No backward transformation needed since Input = Output
export const schema = defineSchema(orderSchema);

// Export inferred type from schema using StandardSchema
export type Order = InferOutput<typeof schema>;

export default schema;
