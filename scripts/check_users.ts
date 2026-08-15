import * as db from "../server/db.js";
import { getDb } from "../server/db.js";
import { users } from "../drizzle/schema.js";

async function main() {
  const dbConn = await getDb();
  if (!dbConn) { console.error("DB not available"); process.exit(1); }
  const rows = await dbConn.select().from(users);
  rows.forEach((u: typeof users.$inferSelect) => {
    console.log(JSON.stringify({ id: u.id, email: u.email, clerkId: u.clerkId, role: u.role, isSuperAdmin: u.isSuperAdmin }));
  });
  process.exit(0);
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
