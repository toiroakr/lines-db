import * as v from 'valibot';
import { defineSchema } from 'lines-db';
import type { InferOutput } from 'lines-db';

const userSchema = v.object({
  id: v.pipe(v.number(), v.integer(), v.minValue(1)),
  name: v.pipe(v.string(), v.minLength(1)),
  age: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(150)),
  email: v.pipe(v.string(), v.email()),
});

export const schema = defineSchema(userSchema);
export type User = InferOutput<typeof schema>;
export default schema;
