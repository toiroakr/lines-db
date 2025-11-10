import * as v from 'valibot';
import { defineSchema } from '@toiroakr/lines-db';
import type { InferOutput } from '@toiroakr/lines-db';

const inventorySchema = v.object({
  warehouseId: v.pipe(v.number(), v.integer(), v.minValue(1)),
  category: v.string(),
  productSku: v.string(),
  quantity: v.pipe(v.number(), v.integer(), v.minValue(0)),
});

export const schema = defineSchema(inventorySchema, {
  foreignKeys: [
    {
      columns: ['category', 'productSku'],
      references: { table: 'products-composite-pk', columns: ['category', 'sku'] },
      onDelete: 'CASCADE',
    },
  ],
});

export type Inventory = InferOutput<typeof schema>;

export default schema;
