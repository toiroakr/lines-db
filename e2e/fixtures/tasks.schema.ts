import { z } from 'zod';

export default z.strictObject({
  id: z.number().int().positive(),
  title: z.string().min(1),
  done: z.boolean().default(false),
});
