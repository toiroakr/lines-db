import * as v from 'valibot';
import { defineSchema } from '@toiroakr/lines-db';
import type { InferOutput } from '@toiroakr/lines-db';

const testMigrateSchema = v.object({
  id: v.pipe(v.number(), v.integer(), v.minValue(1)),
  name: v.pipe(v.string(), v.minLength(1)),
  age: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(120)), // age must be 0-120
});

export const schema = defineSchema(testMigrateSchema, {
  primaryKey: ['id'],
});

export type TestMigrate = InferOutput<typeof schema>;

export default schema;
