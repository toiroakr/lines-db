import * as v from 'valibot';
import { defineSchema } from 'lines-db';
import type { InferOutput } from 'lines-db';

// Define user schema using Valibot
const userSchema = v.object({
  id: v.pipe(v.number(), v.integer(), v.minValue(1)),
  name: v.pipe(v.string(), v.minLength(1)),
  age: v.pipe(v.number(), v.integer(), v.minValue(10), v.maxValue(150)),
  email: v.pipe(v.string(), v.email()),
});

// Wrap with defineSchema to create BiDirectionalSchema
// No backward transformation needed since Input = Output
export const schema = defineSchema(userSchema);

// Export inferred type from schema using StandardSchema
export type User = InferOutput<typeof schema>;

export default schema;
