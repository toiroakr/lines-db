import { z } from 'zod';

export const foreignKeys = [{ column: 'customerId', references: { table: 'users', column: 'id' } }];

export default z.strictObject({
  id: z.number().int().positive(),
  customerId: z.number().int().positive(),
  items: z.array(z.strictObject({ name: z.string().min(1), quantity: z.number().int().nonnegative() })),
  meta: z.record(z.string(), z.string()).nullable(),
});
