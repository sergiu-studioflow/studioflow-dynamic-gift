// Migrate the Dynamic Gift portal to password login + set roles.
//
//   node scripts/seed-admins.mjs
//
// What it does (idempotent — safe to re-run; re-running ROTATES passwords):
//   1. Gives EVERY existing portal user a freshly generated password, hashed
//      with Better Auth's own scrypt (better-auth/crypto) — the exact hasher
//      `authClient.signIn.email(...)` verifies against. Handles users who only
//      had a magic-link identity before (no credential account yet).
//   2. Sets each user's role: admin for ADMIN_EMAILS, member for everyone else.
//      (Admin's only extra power is /admin/users + managing clients; the portal
//      is otherwise the same for admins and members.)
//   3. Ensures each ADMIN_EMAILS account exists (creates it if missing).
//
// Prints each email + temp password ONCE to stdout. Share them securely; users
// rotate their own password in Settings → Change Password.
//
// MUST be run before/at cutover — with magic-link removed, anyone without a
// password credential cannot sign in.

import { readFileSync } from "node:fs";
import { randomUUID, randomInt } from "node:crypto";
import postgres from "postgres";
import { hashPassword } from "better-auth/crypto";

// Admins (get the /admin/users power). Everyone else is a member.
const ADMIN_EMAILS = ["access@studio-flow.co", "johnferd@dynamicgift.com.au"].map((e) =>
  e.trim().toLowerCase(),
);

function getDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    const line = env.split("\n").find((l) => l.trim().startsWith("DATABASE_URL="));
    if (line) return line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
  } catch {
    /* ignore */
  }
  throw new Error("DATABASE_URL not set and not found in .env.local");
}

function generatePassword(length = 16) {
  const charset = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
  let out = "";
  for (let i = 0; i < length; i++) out += charset[randomInt(charset.length)];
  return out;
}

const sql = postgres(getDatabaseUrl(), { prepare: false });

async function upsertCredential(userId, hashed, now) {
  const [account] = await sql`
    SELECT id FROM account WHERE user_id = ${userId} AND provider_id = 'credential' LIMIT 1
  `;
  if (account) {
    await sql`UPDATE account SET password = ${hashed}, updated_at = ${now} WHERE id = ${account.id}`;
  } else {
    await sql`
      INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at)
      VALUES (${randomUUID()}, ${userId}, 'credential', ${userId}, ${hashed}, ${now}, ${now})
    `;
  }
}

async function run() {
  const now = new Date();
  const results = [];
  const seen = new Set();

  // 1. Migrate every existing portal user: password + role.
  const existing = await sql`SELECT user_id, email FROM users ORDER BY created_at`;
  for (const row of existing) {
    const email = (row.email || "").trim().toLowerCase();
    seen.add(email);
    const password = generatePassword();
    const hashed = await hashPassword(password);
    await upsertCredential(row.user_id, hashed, now);
    const role = ADMIN_EMAILS.includes(email) ? "admin" : "member";
    await sql`
      UPDATE users SET role = ${role}, is_active = true, updated_at = ${now} WHERE user_id = ${row.user_id}
    `;
    results.push({ email, role, password });
  }

  // 2. Ensure each named admin exists (create the full account if missing).
  for (const email of ADMIN_EMAILS) {
    if (seen.has(email)) continue;
    const name = email.split("@")[0];
    const password = generatePassword();
    const hashed = await hashPassword(password);

    let [user] = await sql`SELECT id FROM "user" WHERE email = ${email} LIMIT 1`;
    if (!user) {
      const id = randomUUID();
      await sql`
        INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
        VALUES (${id}, ${name}, ${email}, true, ${now}, ${now})
      `;
      user = { id };
    }
    await upsertCredential(user.id, hashed, now);

    const [portal] = await sql`SELECT id FROM users WHERE user_id = ${user.id} LIMIT 1`;
    if (portal) {
      await sql`UPDATE users SET role = 'admin', is_active = true, updated_at = ${now} WHERE id = ${portal.id}`;
    } else {
      await sql`
        INSERT INTO users (user_id, display_name, email, role, is_active)
        VALUES (${user.id}, ${name}, ${email}, 'admin', true)
      `;
    }
    results.push({ email, role: "admin", password });
  }

  return results;
}

try {
  const results = await run();
  results.sort((a, b) =>
    a.role === b.role ? a.email.localeCompare(b.email) : a.role.localeCompare(b.role),
  );
  console.log(
    "\n✅ Users migrated to password login. Temp passwords (share securely; rotate after first login):\n",
  );
  for (const r of results) console.log(`   [${r.role}]  ${r.email}\n   ${r.password}\n`);
  console.log(`Total: ${results.length} user(s).`);
} catch (err) {
  console.error("❌ Seed failed:", err);
  process.exitCode = 1;
} finally {
  await sql.end();
}
