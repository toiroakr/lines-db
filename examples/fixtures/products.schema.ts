import * as v from 'valibot';
import { defineSchema } from '@toiroakr/lines-db';
import type { InferOutput } from '@toiroakr/lines-db';

// Define product schema using Valibot
const productSchema = v.object({
  id: v.pipe(v.number(), v.integer(), v.minValue(1)),
  name: v.pipe(v.string(), v.minLength(1)),
  price: v.pipe(v.number(), v.minValue(0)),
  inStock: v.boolean(),
});

export const schema = defineSchema(productSchema);

// Export inferred type from schema using StandardSchema
export type Product = InferOutput<typeof schema>;

export default schema;
