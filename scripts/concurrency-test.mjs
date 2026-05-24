// Concurrency test script utilizing native global fetch in Node 18+

async function runTest() {
  const baseUrl = process.argv[2] || 'http://localhost:3000';
  console.log('================================================================');
  console.log(`OmniStock Concurrency Validation Test Center`);
  console.log(`Targeting local Server: ${baseUrl}`);
  console.log('================================================================');

  // 1. Seed database first to ensure fresh predictable stock levels
  console.log('\n[1/4] Seeding database to baseline values...');
  try {
    const seedRes = await fetch(`${baseUrl}/api/seed`, { method: 'POST' });
    if (!seedRes.ok) {
      const err = await seedRes.json();
      console.error('❌ Seeding failed:', err);
      process.exit(1);
    }
    console.log('✔ Database successfully seeded and reset!');
  } catch (err) {
    console.error('❌ Failed to connect to dev server. Is the Next.js app running?');
    console.error('   Please run: npm run dev');
    console.error('   Error details:', err.message);
    process.exit(1);
  }

  // 2. Fetch products to resolve database IDs
  console.log('\n[2/4] Fetching catalog and resolving target product...');
  const productsRes = await fetch(`${baseUrl}/api/products`);
  const productsData = await productsRes.json();
  
  // Find our target test product: Aero Chair (has exactly 1 available unit in Midwest!)
  const product = productsData.products.find(p => p.sku === 'AERO-CHAIR-003');
  if (!product) {
    console.error('❌ Target test product (Aero Chair) not found. Make sure seeding succeeded.');
    process.exit(1);
  }

  // Target Midwest Distribution (has exactly 1 available unit!)
  const warehouseStock = product.stockBreakdown.find(w => w.warehouseName.includes('Midwest'));
  if (!warehouseStock || warehouseStock.availableUnits !== 1) {
    console.error(`❌ Midwest Distribution Center stock must be exactly 1 available. Found: ${warehouseStock?.availableUnits}`);
    process.exit(1);
  }

  const productId = product.id;
  const warehouseId = warehouseStock.warehouseId;

  console.log(`🎯 Target Product   : "${product.name}" (${product.sku})`);
  console.log(`🎯 Target Warehouse : "${warehouseStock.warehouseName}" (${warehouseStock.location})`);
  console.log(`🎯 Target Unit Stock: ${warehouseStock.availableUnits} Available`);

  // 3. Fire 5 concurrent reservation requests for quantity 1
  console.log('\n[3/4] Firing 5 checkout hold requests concurrently at the same millisecond...');
  
  const requestPromises = Array.from({ length: 5 }).map(async (_, index) => {
    const userId = `User_${String.fromCharCode(65 + index)}`; // User_A, User_B, User_C, User_D, User_E
    const idempotencyKey = `battle_key_concur_${index}_${Math.random().toString(36).substring(2, 6)}`;
    
    const startTime = Date.now();
    try {
      const res = await fetch(`${baseUrl}/api/reservations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-idempotency-key': idempotencyKey,
        },
        body: JSON.stringify({
          productId,
          warehouseId,
          quantity: 1
        })
      });
      const duration = Date.now() - startTime;
      const data = await res.json();
      return { userId, status: res.status, data, duration };
    } catch (error) {
      return { userId, status: 500, error: error.message };
    }
  });

  const results = await Promise.all(requestPromises);

  console.log('\n[4/4] Concurrency Battle Arena Results:');
  console.table(results.map(r => ({
    'Buyer Account': r.userId,
    'HTTP Code': r.status,
    'Checkout Holding result': r.status === 201 
      ? `👑 WINNER! Held Hold ID: ${r.data.reservationId.substring(0, 8)}...`
      : r.status === 409
      ? `🚫 BLOCKED (409 Conflict): Inventory exhausted.`
      : `❌ ERROR: ${r.error || JSON.stringify(r.data)}`,
    'Response Time': `${r.duration || 'N/A'} ms`
  })));

  // 4. Verify exactly ONE succeeded and 4 failed with 409
  const successCount = results.filter(r => r.status === 201).length;
  const conflictCount = results.filter(r => r.status === 409).length;

  console.log('================================================================');
  console.log('Concurrency Verification Checklist:');
  console.log(`[${successCount === 1 ? '✔' : '❌'}] Exactly ONE reservation succeeded (Count: ${successCount})`);
  console.log(`[${conflictCount === 4 ? '✔' : '❌'}] Exactly FOUR requests rejected with 409 Conflict (Count: ${conflictCount})`);
  console.log('================================================================');

  if (successCount === 1 && conflictCount === 4) {
    console.log('\n🎉 SUCCESS! Row-level transactional locking works flawlessly! Concurrency safety is fully validated.');
  } else {
    console.log('\n❌ FAILURE: Concurrency validation failed. Ensure database transactions and SELECT FOR UPDATE are functioning.');
  }
  console.log('================================================================');
}

runTest();
