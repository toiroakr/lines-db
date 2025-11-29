import * as v from 'valibot';
import { defineSchema } from '@toiroakr/lines-db';
import type { InferOutput } from '@toiroakr/lines-db';

const underscoreUserSchema = v.object({
  name: v.pipe(v.string(), v.email()),
  password: v.string(),
});

export const schema = defineSchema(underscoreUserSchema, {
  indexes: [{ name: '_user_name_unique_idx', columns: ['name'], unique: true }],
  // Foreign key reference to User.email (not primary key, but has unique index)
  // This is the same pattern as sdk/example/seed/data/_User.schema.ts
  foreignKeys: [
    {
      column: 'name',
      references: {
        table: 'User',
        column: 'email',
      },
    },
  ],
});

export type UnderscoreUser = InferOutput<typeof schema>;

export default schema;
