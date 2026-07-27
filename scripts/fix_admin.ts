import { getDb, makeSuperAdmin } from "../server/db.js";
import { users } from "../drizzle/schema.js";
import { eq } from "drizzle-orm";

async function main() {
  const db = await getDb();
  if (!db) { console.error("DB not available"); process.exit(1); }

  const allUsers = await db.select().from(users);
  console.log("=== ALL USERS ===");
  allUsers.forEach((u: typeof users.$inferSelect) =>
    console.log(`  id=${u.id} email=${u.email} role=${u.role} superAdmin=${u.isSuperAdmin}`)
  );

  // Set lhill528@gmail.com as super admin
  const gmailUser = allUsers.find((u: typeof users.$inferSelect) => u.email === "lhill528@gmail.com");
  if (gmailUser) {
    await makeSuperAdmin(gmailUser.id);
    console.log(`\n✅ Set lhill528@gmail.com (id=${gmailUser.id}) as admin + superAdmin`);
  } else {
    console.log("\n⚠️  lhill528@gmail.com not in DB yet — must log in first to be created");
  }

  // Also elevate lhill29@comcast.net if present
  const comcastUser = allUsers.find((u: typeof users.$inferSelect) => u.email === "lhill29@comcast.net");
  if (comcastUser) {
    await makeSuperAdmin(comcastUser.id);
    console.log(`✅ Set lhill29@comcast.net (id=${comcastUser.id}) as admin + superAdmin`);
  }

  const updated = await db.select().from(users);
  console.log("\n=== FINAL STATE ===");
  updated.forEach((u: typeof users.$inferSelect) =>
    console.log(`  id=${u.id} email=${u.email} role=${u.role} superAdmin=${u.isSuperAdmin}`)
  );

  process.exit(0);
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
