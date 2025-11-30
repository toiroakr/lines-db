import * as v from 'valibot';
import { defineSchema } from '@toiroakr/lines-db';
import type { InferOutput } from '@toiroakr/lines-db';
import { ORDER_STATUSES, type OrderStatus } from '../../testdir/orderType.js';

const nestedOrderSchema = v.object({
  id: v.pipe(v.number(), v.integer(), v.minValue(1)),
  customerId: v.pipe(v.number(), v.integer(), v.minValue(1)),
  amount: v.pipe(v.number(), v.minValue(0)),
  status: v.union(ORDER_STATUSES.map((s: OrderStatus) => v.literal(s))),
});

export const schema = defineSchema(nestedOrderSchema, {
  primaryKey: 'id',
  indexes: [{ columns: ['customerId'] }, { columns: ['status'] }],
});

export type NestedOrder = InferOutput<typeof schema>;

export default schema;
