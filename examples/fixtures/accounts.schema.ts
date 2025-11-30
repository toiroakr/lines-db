import { z } from 'zod';
import { defineSchema } from '@toiroakr/lines-db';
import type { InferOutput } from '@toiroakr/lines-db';
import { STATUS_VALUES } from '../testdir/shared.js';

// Schema that uses relative import from ../testdir/
// This tests Windows path resolution where \t could be interpreted as tab
export const schema = defineSchema(
  z.object({
    id: z.number().min(1).int(),
    name: z.string().min(1),
    status: z.enum(STATUS_VALUES),
  }),
);

export type Account = InferOutput<typeof schema>;

export default schema;
