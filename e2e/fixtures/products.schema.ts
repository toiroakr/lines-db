import { z } from 'zod';

export default z.strictObject({
  id: z.number().int().positive(),
  name: z.string().min(1),
  price: z.number().nonnegative(),
});
