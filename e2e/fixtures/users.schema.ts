import { z } from 'zod';

export default z.strictObject({
  id: z.number().int().positive(),
  name: z.string().min(1),
  email: z.email(),
});
