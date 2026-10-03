import { z } from 'zod';

export const foreignKeys = [{ column: 'userId', references: { table: 'users', column: 'id' } }];

export default z.strictObject({
  id: z.number().int().positive(),
  userId: z.number().int().positive(),
  body: z.string().min(1),
});
