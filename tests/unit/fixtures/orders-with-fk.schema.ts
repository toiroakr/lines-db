import * as v from 'valibot';
import { defineSchema } from '@toiroakr/lines-db';
import type { InferOutput } from '@toiroakr/lines-db';

const orderSchema = v.object({
  id: v.pipe(v.number(), v.integer(), v.minValue(1)),
  customerId: v.pipe(v.number(), v.integer(), v.minValue(1)),
  amount: v.pipe(v.number(), v.minValue(0)),
  status: v.union([v.literal('pending'), v.literal('completed'), v.literal('cancelled')]),
});

export const schema = defineSchema(orderSchema, {
  primaryKey: ['id'],
  foreignKeys: [
    {
      columns: ['customerId'],
      references: { table: 'customers', columns: ['id'] },
      onDelete: 'CASCADE',
    },
  ],
  indexes: [{ columns: ['customerId'] }, { columns: ['status'] }],
});

export type Order = InferOutput<typeof schema>;

export default schema;
