import { LinesDB, unwrap } from '../lib/dist/index.mjs';
import { config } from './fixtures/db.js';

async function main() {
  console.log('📁 Auto-Discovery with dataDir Example\n');

  // Simple configuration - just specify the directory!
  const db = LinesDB.create(config);

  // Initialize - all JSONL files in the directory will be auto-discovered.
  // Most LinesDB methods return a Result instead of throwing; unwrap() reads the value or
  // throws the error, which main().catch() below handles.
  unwrap(await db.initialize());

  console.log('✅ Database initialized with auto-discovery\n');

  // Show discovered tables
  console.log('📋 Auto-discovered tables:');
  const tableNames = db.getTableNames();
  tableNames.forEach((name) => {
    const schema = db.getSchema(name);
    console.log(`   - ${name} (${schema?.columns.length} columns)`);
  });
  console.log();

  // All tables are automatically loaded with their schemas
  console.log('👥 Users table:');
  // Interface for type reference
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface User {
    id: number;
    name: string;
    age: number;
    email: string;
  }

  const users = unwrap(db.find('users'));
  console.table(users);

  console.log('\n🛍️  Products table:');
  const products = unwrap(db.find('products'));
  console.table(products);

  console.log('\n📦 Orders table (with JSON columns):');
  const orders = unwrap(db.find('orders'));
  orders.forEach((order) => {
    console.log(`   Order #${order.id}:`);
    console.log(`     Customer: ${order.customerId}`);
    console.log(`     Items: ${order.items.length}`);
    console.log(`     Metadata:`, order.metadata);
  });

  // Validation schemas are also auto-loaded! insert()/update()/delete() return a Result rather
  // than throwing, so an expected validation failure is handled by checking `.ok` instead of
  // catching an exception.
  console.log('\n\n✅ Inserting valid data (with auto-loaded schema validation):');
  const validInsert = db.insert('users', {
    id: 500,
    name: 'Auto User',
    age: 35,
    email: 'auto@example.com',
  });
  if (validInsert.ok) {
    console.log('   Insert successful!');
  } else {
    console.log('   Insert failed:', validInsert.error.message);
  }

  console.log('\n❌ Attempting invalid insert (schema validation):');
  const invalidInsert = db.insert('users', {
    id: 501,
    name: '',
    age: -5,
    email: 'invalid',
  });
  if (invalidInsert.ok) {
    console.log('   Insert successful!');
  } else {
    console.log('   Insert failed (as expected):', invalidInsert.error.name);
    const validationError = invalidInsert.error as Error & { issues?: Array<{ message: string }> };
    console.log('   Issues:', validationError.issues?.map((i) => i.message).join(', '));
  }

  // Summary
  console.log('\n\n📊 Summary:');
  console.log(`   Discovered tables: ${tableNames.length}`);
  tableNames.forEach((name) => {
    const count = unwrap(db.query<{ count: number }>(`SELECT COUNT(*) as count FROM ${name}`));
    console.log(`   - ${name}: ${count[0].count} rows`);
  });

  // Clean up
  unwrap(await db.close());
  console.log('\n✅ Done!');
}

main().catch(console.error);
