import * as v from 'valibot';
import { defineSchema } from '@toiroakr/lines-db';
import type { InferOutput } from '@toiroakr/lines-db';

const productSchema = v.object({
  category: v.string(),
  sku: v.string(),
  name: v.string(),
  price: v.pipe(v.number(), v.minValue(0)),
});

export const schema = defineSchema(productSchema, {
  primaryKey: ['category', 'sku'],
});

export type Product = InferOutput<typeof schema>;

export default schema;
