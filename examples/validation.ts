import { LinesDB, unwrap } from '../lib/dist/index.mjs';
import { config } from './fixtures/db.js';

async function main() {
  console.log('🔐 Validation Example\n');

  // Configure database with validation schemas
  // Validation schemas will be auto-loaded from ${tableName}.schema.ts files
  const db = LinesDB.create(config);

  // Initialize and load data. Most LinesDB methods return a Result instead of throwing;
  // unwrap() reads the value or throws the error, which main().catch() below handles.
  unwrap(await db.initialize());

  console.log('✅ Database initialized with validation schemas\n');

  // Example 1: Valid insert
  // insert()/update()/delete() return a Result instead of throwing, so an expected validation
  // failure is handled by checking `.ok` rather than catching an exception.
  console.log('📝 Example 1: Valid insert');
  const insert1 = db.insert('users', {
    id: 100,
    name: 'Valid User',
    age: 30,
    email: 'valid@example.com',
  });
  if (insert1.ok) {
    console.log('✅ Insert successful\n');
  } else {
    console.log('❌ Insert failed:', insert1.error.message, '\n');
  }

  // Example 2: Invalid email
  console.log('📝 Example 2: Invalid email');
  const insert2 = db.insert('users', {
    id: 101,
    name: 'Test User',
    age: 25,
    email: 'not-an-email',
  });
  if (insert2.ok) {
    console.log('✅ Insert successful\n');
  } else {
    const error = insert2.error as Error & { issues?: Array<{ message: string }> };
    console.log('❌ Insert failed:', error.name);
    console.log('   Issues:', error.issues?.map((i) => i.message).join(', '));
    console.log();
  }

  // Example 3: Negative age
  console.log('📝 Example 3: Negative age');
  const insert3 = db.insert('users', {
    id: 102,
    name: 'Another User',
    age: -5,
    email: 'test@example.com',
  });
  if (insert3.ok) {
    console.log('✅ Insert successful\n');
  } else {
    const error = insert3.error as Error & { issues?: Array<{ message: string }> };
    console.log('❌ Insert failed:', error.name);
    console.log('   Issues:', error.issues?.map((i) => i.message).join(', '));
    console.log();
  }

  // Example 4: Empty name
  console.log('📝 Example 4: Empty name');
  const insert4 = db.insert('users', {
    id: 103,
    name: '',
    age: 30,
    email: 'test@example.com',
  });
  if (insert4.ok) {
    console.log('✅ Insert successful\n');
  } else {
    const error = insert4.error as Error & { issues?: Array<{ message: string }> };
    console.log('❌ Insert failed:', error.name);
    console.log('   Issues:', error.issues?.map((i) => i.message).join(', '));
    console.log();
  }

  // Example 5: Valid product
  console.log('📝 Example 5: Valid product insert');
  const insert5 = db.insert('products', {
    id: 100,
    name: 'Monitor',
    price: 299.99,
    inStock: true,
  });
  if (insert5.ok) {
    console.log('✅ Insert successful\n');
  } else {
    console.log('❌ Insert failed:', insert5.error.message, '\n');
  }

  // Example 6: Negative price
  console.log('📝 Example 6: Negative price');
  const insert6 = db.insert('products', {
    id: 101,
    name: 'Invalid Product',
    price: -10,
    inStock: true,
  });
  if (insert6.ok) {
    console.log('✅ Insert successful\n');
  } else {
    const error = insert6.error as Error & { issues?: Array<{ message: string }> };
    console.log('❌ Insert failed:', error.name);
    console.log('   Issues:', error.issues?.map((i) => i.message).join(', '));
    console.log();
  }

  // Example 7: Update (no validation)
  console.log('📝 Example 7: Update operation (validation skipped)');
  const updateResult = db.update('users', { age: 31 }, { id: 1 });
  if (updateResult.ok) {
    console.log(`✅ Update successful: ${updateResult.value.changes} row(s) affected\n`);
  } else {
    console.log('❌ Update failed:', updateResult.error.message, '\n');
  }

  // Example 8: Delete
  console.log('📝 Example 8: Delete operation');
  const deleteResult = db.delete('users', { id: 100 });
  if (deleteResult.ok) {
    console.log(`✅ Delete successful: ${deleteResult.value.changes} row(s) affected\n`);
  } else {
    console.log('❌ Delete failed:', deleteResult.error.message, '\n');
  }

  // Show final data
  console.log('📊 Final user count:');
  const count = unwrap(db.queryOne<{ count: number }>('SELECT COUNT(*) as count FROM users'));
  console.log(`   Total users: ${count?.count}`);

  // Clean up
  unwrap(await db.close());
  console.log('\n✅ Done!');
}

main().catch(console.error);
