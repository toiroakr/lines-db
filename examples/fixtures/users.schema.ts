import { z } from 'zod';
import { defineSchema } from 'lines-db';
import type { InferOutput } from 'lines-db';

// Define user schema using Zod
// Wrap with defineSchema to create BiDirectionalSchema
// No backward transformation needed since Input = Output
export const schema = defineSchema(
  z.object({
    id: z.number().min(1).int(),
    name: z.string().min(1),
    age: z.number().min(10).max(150).int().default(20),
    email: z.email(),
    gender: z.enum(['male', 'female', 'other']),
  }),
);

// Export inferred type from schema using StandardSchema
export type User = InferOutput<typeof schema>;

export default schema;
