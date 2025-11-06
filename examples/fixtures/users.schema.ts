import { z } from 'zod';
import { defineSchema } from '@toiroakr/lines-db';
import type { InferOutput } from '@toiroakr/lines-db';

// Define user schema using Zod
const userSchema = z.object({
  id: z.number().min(1).int(),
  name: z.string().min(1),
  age: z.number().min(10).max(150).int(),
  email: z.email(),
});

// Wrap with defineSchema to create BiDirectionalSchema
// No backward transformation needed since Input = Output
export const schema = defineSchema(userSchema);

// Export inferred type from schema using StandardSchema
export type User = InferOutput<typeof schema>;

export default schema;
