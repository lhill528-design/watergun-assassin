import { createConnection } from 'mysql2/promise';

// Cash fees in cents as specified in POWER_UP_IMPLEMENTATION.md
const FEE_MAP: Record<string, number> = {
  'Bounty':               500,   // $5.00
  'Raise the Stakes':    1000,   // $10.00
  'Clean Slate':          500,   // $5.00
  'Revive':              1500,   // $15.00
  'Respawn':              750,   // $7.50
  'Witness Protection':   500,   // $5.00
  'Sanctuary':            500,   // $5.00
  'Lifeline':             500,   // $5.00
  'Wildcard':             500,   // $5.00
};

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.log('No DATABASE_URL'); return; }
  const conn = await createConnection(url);

  // List all power-ups to confirm names
  const [rows] = await conn.query('SELECT id, name, usageFeeCents FROM power_ups') as any;
  console.log(`Found ${rows.length} power-ups in DB.`);

  let updated = 0;
  for (const row of rows) {
    const fee = FEE_MAP[row.name];
    if (fee !== undefined && row.usageFeeCents !== fee) {
      await conn.query('UPDATE power_ups SET usageFeeCents = ? WHERE id = ?', [fee, row.id]);
      console.log(`  Updated "${row.name}" → $${(fee/100).toFixed(2)}`);
      updated++;
    } else if (fee !== undefined) {
      console.log(`  "${row.name}" already has fee $${(fee/100).toFixed(2)} — skipped`);
    }
  }

  console.log(`\nDone. ${updated} power-ups updated.`);
  await conn.end();
}

main().catch(console.error);
