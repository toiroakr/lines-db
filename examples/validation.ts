import { LinesDB } from '../lib/dist/index.mjs';
import { config } from './fixtures/db.js';

async function main() {
  console.log('🔐 Validation Example\n');

  // Configure database with validation schemas
  // Validation schemas will be auto-loaded from ${tableName}.schema.ts files
  const db = LinesDB.create(config);

  // Initialize and load data
  await db.initialize();

  console.log('✅ Database initialized with validation schemas\n');

  // Example 1: Valid insert
  console.log('📝 Example 1: Valid insert');
  try {
    db.insert('users', {
      id: 100,
      name: 'Valid User',
      age: 30,
      email: 'valid@example.com',
    });
    console.log('✅ Insert successful\n');
  } catch (error: any) {
    console.log('❌ Insert failed:', error.message, '\n');
  }

  // Example 2: Invalid email
  console.log('📝 Example 2: Invalid email');
  try {
    db.insert('users', {
      id: 101,
      name: 'Test User',
      age: 25,
      email: 'not-an-email',
    });
    console.log('✅ Insert successful\n');
  } catch (error: any) {
    console.log('❌ Insert failed:', error.name);
    console.log('   Issues:', error.issues.map((i: any) => i.message).join(', '));
    console.log();
  }

  // Example 3: Negative age
  console.log('📝 Example 3: Negative age');
  try {
    db.insert('users', {
      id: 102,
      name: 'Another User',
      age: -5,
      email: 'test@example.com',
    });
    console.log('✅ Insert successful\n');
  } catch (error: any) {
    console.log('❌ Insert failed:', error.name);
    console.log('   Issues:', error.issues.map((i: any) => i.message).join(', '));
    console.log();
  }

  // Example 4: Empty name
  console.log('📝 Example 4: Empty name');
  try {
    db.insert('users', {
      id: 103,
      name: '',
      age: 30,
      email: 'test@example.com',
    });
    console.log('✅ Insert successful\n');
  } catch (error: any) {
    console.log('❌ Insert failed:', error.name);
    console.log('   Issues:', error.issues.map((i: any) => i.message).join(', '));
    console.log();
  }

  // Example 5: Valid product
  console.log('📝 Example 5: Valid product insert');
  try {
    db.insert('products', {
      id: 100,
      name: 'Monitor',
      price: 299.99,
      inStock: true,
    });
    console.log('✅ Insert successful\n');
  } catch (error: any) {
    console.log('❌ Insert failed:', error.message, '\n');
  }

  // Example 6: Negative price
  console.log('📝 Example 6: Negative price');
  try {
    db.insert('products', {
      id: 101,
      name: 'Invalid Product',
      price: -10,
      inStock: true,
    });
    console.log('✅ Insert successful\n');
  } catch (error: any) {
    console.log('❌ Insert failed:', error.name);
    console.log('   Issues:', error.issues.map((i: any) => i.message).join(', '));
    console.log();
  }

  // Example 7: Update (no validation)
  console.log('📝 Example 7: Update operation (validation skipped)');
  try {
    const result = db.update('users', { age: 31 }, { id: 1 });
    console.log(`✅ Update successful: ${result.changes} row(s) affected\n`);
  } catch (error: any) {
    console.log('❌ Update failed:', error.message, '\n');
  }

  // Example 8: Delete
  console.log('📝 Example 8: Delete operation');
  try {
    const result = db.delete('users', { id: 100 });
    console.log(`✅ Delete successful: ${result.changes} row(s) affected\n`);
  } catch (error: any) {
    console.log('❌ Delete failed:', error.message, '\n');
  }

  // Show final data
  console.log('📊 Final user count:');
  const count = db.queryOne<{ count: number }>('SELECT COUNT(*) as count FROM users');
  console.log(`   Total users: ${count?.count}`);

  // Clean up
  db.close();
  console.log('\n✅ Done!');
}

main().catch(console.error);
