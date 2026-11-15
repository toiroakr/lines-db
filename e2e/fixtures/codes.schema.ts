import { z } from 'zod';

// A create hook: the schema makes "ORD-a" of the code "a", as a TailorDB `create` hook does
export default z.strictObject({
  id: z.number().int().positive(),
  code: z.string().transform((code) => `ORD-${code}`),
});
