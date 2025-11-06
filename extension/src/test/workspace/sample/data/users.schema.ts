import * as v from 'valibot';
import { defineSchema } from '../../lib/dist/index.cjs';

const rawSchema = v.object({
  id: v.pipe(v.number(), v.integer(), v.minValue(1)),
  name: v.string(),
  active: v.boolean(),
});

export const schema = defineSchema(rawSchema, {
  primaryKey: ['id'],
});
