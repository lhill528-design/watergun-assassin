import { createConnection } from 'mysql2/promise';
import { readFileSync } from 'fs';
import { join } from 'path';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.log('No DATABASE_URL'); return; }
  const conn = await createConnection(url);

  // Read the migration SQL
  const sqlPath = join(process.cwd(), 'drizzle', '0004_careless_jubilee.sql');
  const rawSql = readFileSync(sqlPath, 'utf-8');

  // Split on Drizzle's statement-breakpoint marker
  const statements = rawSql
    .split('--> statement-breakpoint')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  console.log(`Running ${statements.length} statements...`);

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    try {
      await conn.query(stmt);
      console.log(`  [${i + 1}/${statements.length}] OK`);
    } catch (err: any) {
      // Ignore "column already exists" / "table already exists" errors
      if (err.code === 'ER_DUP_FIELDNAME' || err.code === 'ER_TABLE_EXISTS_ERROR' || err.code === 'ER_DUP_KEYNAME') {
        console.log(`  [${i + 1}/${statements.length}] SKIPPED (already applied): ${err.message}`);
      } else {
        console.error(`  [${i + 1}/${statements.length}] ERROR: ${err.message}`);
        console.error('  SQL:', stmt.substring(0, 120));
        // Don't abort — continue with remaining statements
      }
    }
  }

  // Record migration in drizzle migrations table if not already there
  try {
    await conn.query(
      "INSERT IGNORE INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES ('0004_careless_jubilee', ?)",
      [Date.now()]
    );
    console.log('Migration recorded in __drizzle_migrations.');
  } catch (e: any) {
    console.log('Could not record migration (may already exist):', e.message);
  }

  await conn.end();
  console.log('Done.');
}

main().catch(console.error);
