import "dotenv/config";
import { readFileSync, readdirSync } from "fs";
import path from "path";
import { createPostgresClient, env } from "shared";

async function main() {
  const pool = createPostgresClient();
  const migrationsDir = path.resolve(process.cwd(), "../..", "packages/shared/src/db/migrations");
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const fullPath = path.join(migrationsDir, file);
    const sql = readFileSync(fullPath, "utf8");
    console.log(`Applying migration: ${file}`);
    await pool.query(sql);
  }

  await pool.end();
  console.log("Migrations applied successfully");
}

main().catch((err) => {
  console.error("Migration failed", err);
  process.exit(1);
});
