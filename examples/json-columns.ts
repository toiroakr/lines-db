import { LinesDB } from '../lib/dist/index.js';
import { config } from './fixtures/db.js';

async function main() {
  console.log('📦 JSON Columns Example\n');

  // Configure database with orders table
  const db = LinesDB.create(config);

  // Initialize and load data
  await db.initialize();

  console.log('✅ Database initialized\n');

  // Check schema
  console.log('📋 Orders table schema:');
  const schema = db.getSchema('orders');
  schema?.columns.forEach((col) => {
    console.log(`   ${col.name}: ${col.type}${col.primaryKey ? ' (PRIMARY KEY)' : ''}`);
  });
  console.log();

  // Display all orders with JSON columns
  console.log('📊 All orders:');
  const orders = db.find('orders');
  for (const order of orders) {
    console.log(`\n   Order #${order.id} (Customer: ${order.customerId})`);
    console.log(`   Items (${order.items.length}):`);
    for (const item of order.items) {
      console.log(`     - ${item.name} x${item.quantity} @ $${item.price}`);
    }
    console.log(`   Metadata:`, order.metadata);
  }

  // Insert new order with complex JSON
  console.log('\n\n➕ Inserting new order with complex JSON structure...');
  db.insert('orders', {
    id: 100,
    customerId: 500,
    items: [
      { name: 'Monitor 4K', quantity: 2, price: 399.99 },
      { name: 'USB-C Cable', quantity: 3, price: 19.99 },
      { name: 'Laptop Stand', quantity: 1, price: 89.99 },
    ],
    metadata: {
      source: 'api',
      campaign: 'spring2024',
      discount: {
        type: 'percentage',
        value: 15,
      },
      tags: ['bulk', 'priority', 'enterprise'],
      shippingAddress: {
        country: 'USA',
        state: 'CA',
        zip: '94102',
      },
    },
  });

  // Retrieve and display the new order
  console.log('\n📦 New order details:');
  const newOrder = db.findOne('orders', { id: 100 });
  if (newOrder) {
    console.log(`   Order #${newOrder.id}`);
    console.log(`   Total items: ${newOrder.items.length}`);
    console.log(`   First item: ${newOrder.items[0].name}`);
    console.log(`   Campaign: ${newOrder.metadata?.campaign}`);
    console.log(
      `   Discount: ${newOrder.metadata?.discount.type} - ${newOrder.metadata?.discount.value}%`,
    );
    console.log(`   Tags:`, newOrder.metadata?.tags);
    console.log(
      `   Shipping to: ${newOrder.metadata?.shippingAddress.state}, ${newOrder.metadata?.shippingAddress.country}`,
    );
  }

  // Calculate total value
  console.log('\n\n💰 Order value calculation:');
  if (newOrder) {
    type Item = { name: string; quantity: number; price: number };
    const totalValue = newOrder.items.reduce(
      (sum: number, item: Item) => sum + item.price * item.quantity,
      0,
    );
    const discount = newOrder.metadata?.discount?.value || 0;
    const finalPrice = totalValue * (1 - discount / 100);

    console.log(`   Subtotal: $${totalValue.toFixed(2)}`);
    console.log(`   Discount: ${discount}%`);
    console.log(`   Final price: $${finalPrice.toFixed(2)}`);
  }

  // Update order metadata
  console.log('\n\n✏️  Updating order metadata...');
  db.update(
    'orders',
    {
      metadata: {
        source: 'api',
        campaign: 'spring2024',
        status: 'shipped',
        trackingNumber: 'TRK123456789',
        discount: { type: 'percentage', value: 15 },
        tags: ['bulk', 'priority', 'enterprise', 'shipped'],
      },
    },
    { id: 100 },
  );

  const updatedOrder = db.findOne('orders', { id: 100 });
  console.log(`   Status: ${updatedOrder?.metadata?.status}`);
  console.log(`   Tracking: ${updatedOrder?.metadata?.trackingNumber}`);

  // Query orders
  console.log('\n\n🔍 Query: All orders with more than 0 items');
  const ordersWithItems = orders.filter((o) => o.items.length > 0);
  console.log(`   Found ${ordersWithItems.length} orders`);

  // Clean up
  db.close();
  console.log('\n✅ Done!');
}

main().catch(console.error);
