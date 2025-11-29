import * as v from 'valibot';
import { defineSchema } from '@toiroakr/lines-db';
import type { InferOutput } from '@toiroakr/lines-db';

const parentSchema = v.object({
  id: v.pipe(v.number(), v.integer(), v.minValue(1)),
  email: v.pipe(v.string(), v.email()),
});

export const schema = defineSchema(parentSchema, {
  primaryKey: 'id',
  // email is NOT the primary key, but has a unique index
  // This is required for foreign key references to work in SQLite
  indexes: [{ columns: ['email'], unique: true }],
});

export type Parent = InferOutput<typeof schema>;

export default schema;
