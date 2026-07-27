import { createConnection } from 'mysql2/promise';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.log('No DATABASE_URL'); return; }
  const conn = await createConnection(url);
  const [ppu] = await conn.query('SHOW COLUMNS FROM player_power_ups') as any;
  console.log('player_power_ups:', ppu.map((c: any) => c.Field).join(', '));
  const [pu] = await conn.query('SHOW COLUMNS FROM power_ups') as any;
  console.log('power_ups:', pu.map((c: any) => c.Field).join(', '));
  const [tables] = await conn.query("SHOW TABLES LIKE 'power_up_usage_fees'") as any;
  console.log('power_up_usage_fees exists:', tables.length > 0);
  await conn.end();
}
main().catch(console.error);
