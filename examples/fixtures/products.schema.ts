import * as v from 'valibot';
import { defineSchema } from 'lines-db';
import type { InferOutput } from 'lines-db';

// Define product schema using Valibot
// SQLite stores booleans as 0/1, so we need to transform them
const productSchema = v.object({
  id: v.pipe(v.number(), v.integer(), v.minValue(1)),
  name: v.pipe(v.string(), v.minLength(1)),
  price: v.pipe(v.number(), v.minValue(0)),
  inStock: v.pipe(
    v.union([v.boolean(), v.number()]),
    v.transform((input) => (typeof input === 'number' ? input !== 0 : input)),
  ),
});

// Wrap with defineSchema to create BiDirectionalSchema
export const schema = defineSchema(productSchema, {
  backward: (output) => ({
    ...output,
    inStock: output.inStock ? 1 : 0,
  }),
});

// Export inferred type from schema using StandardSchema
export type Product = InferOutput<typeof schema>;

export default schema;
