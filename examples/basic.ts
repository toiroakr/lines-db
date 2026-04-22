import { LinesDB } from '../lib/dist/index.mjs';
import { config } from './fixtures/db.js';

async function main() {
  // Configure database with JSONL files
  const db = LinesDB.create(config);

  // Initialize and load data
  await db.initialize();

  console.log('📊 Database initialized\n');

  // Get all tables
  console.log('📋 Tables:', db.getTableNames());
  console.log();

  // Select all users
  console.log('👥 All users:');
  const users = db.find('users');
  console.table(users);

  // Find specific user
  console.log('🔍 Find user with id=2:');
  const user = db.findOne('users', { id: 2 });
  console.log(user);
  console.log();

  // Find users by condition
  console.log('🔍 Find users with age > 25:');
  const olderUsers = db.query('SELECT * FROM users WHERE age > ?', [25]);
  console.table(olderUsers);

  // Get all products
  console.log('🛍️  All products:');
  const products = db.find('products');
  console.table(products);

  // Find products in stock
  console.log('✅ Products in stock:');
  const inStock = db.find('products', { inStock: true });
  console.table(inStock);

  // Insert new user
  console.log('➕ Inserting new user...');
  db.execute('INSERT INTO users (id, name, age, email) VALUES (?, ?, ?, ?)', [4, 'David', 40, 'david@example.com']);

  // Count users
  const count = db.queryOne<{ count: number }>('SELECT COUNT(*) as count FROM users');
  console.log(`Total users: ${count?.count}`);
  console.log();

  // Update user
  console.log('✏️  Updating user age...');
  db.execute('UPDATE users SET age = ? WHERE name = ?', [31, 'Alice']);

  const updatedUser = db.findOne('users', { name: 'Alice' });
  console.log('Updated user:', updatedUser);
  console.log();

  // Get schema
  console.log('📐 Users table schema:');
  const schema = db.getSchema('users');
  console.log(schema);

  // Clean up
  db.close();
  console.log('\n✅ Done!');
}

main().catch(console.error);
