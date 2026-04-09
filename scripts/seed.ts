import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import bcrypt from "bcryptjs";
import * as schema from "../src/db/schema";

async function seed() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);
  const db = drizzle(sql, { schema });

  const passwordHash = await bcrypt.hash("admin123", 12);

  await db
    .insert(schema.users)
    .values({
      name: "Admin",
      email: "admin@zissolar.mk",
      passwordHash,
      role: "admin",
    })
    .onConflictDoNothing();

  console.log("Seed completed! Admin user created:");
  console.log("  Email: admin@zissolar.mk");
  console.log("  Password: admin123");
  console.log("  Please change the password after first login!");
}

seed().catch(console.error);
