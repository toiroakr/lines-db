import * as v from 'valibot';
import { defineSchema } from '@toiroakr/lines-db';
import type { InferOutput } from '@toiroakr/lines-db';

const userSchema = v.object({
  id: v.string(),
  name: v.string(),
  email: v.pipe(v.string(), v.email()),
});

export const schema = defineSchema(userSchema, {
  primaryKey: 'id',
  // email is NOT the primary key, but has a unique index
  // This is the same pattern as sdk/example/seed/data/User.schema.ts
  indexes: [{ name: 'user_email_unique_idx', columns: ['email'], unique: true }],
});

export type User = InferOutput<typeof schema>;

export default schema;
