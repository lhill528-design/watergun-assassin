import { createConnection } from 'mysql2/promise';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.log('No DATABASE_URL'); return; }
  const conn = await createConnection(url);

  const [ppu] = await conn.query('SHOW COLUMNS FROM player_power_ups') as any;
  console.log('player_power_ups cols:', ppu.map((c: any) => c.Field).join(', '));

  const [pu] = await conn.query('SHOW COLUMNS FROM power_ups') as any;
  console.log('power_ups cols:', pu.map((c: any) => c.Field).join(', '));

  const [fees] = await conn.query("SHOW TABLES LIKE 'power_up_usage_fees'") as any;
  console.log('power_up_usage_fees exists:', fees.length > 0);

  if (fees.length > 0) {
    const [feeCols] = await conn.query('SHOW COLUMNS FROM power_up_usage_fees') as any;
    console.log('power_up_usage_fees cols:', feeCols.map((c: any) => c.Field).join(', '));
  }

  await conn.end();
}
main().catch(console.error);
