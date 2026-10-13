import { z } from 'zod';

export default z.strictObject({
  id: z.number().int(),
  name: z.string().optional(),
  email: z.email(),
  tags: z.array(z.string()).default([]),
  role: z.enum(['admin', 'user']).nullable(),
});
