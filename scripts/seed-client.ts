import postgres from "postgres";
import "dotenv/config";

// =============================================================
// CUSTOMIZE THESE VALUES FOR EACH CLIENT BEFORE RUNNING
// =============================================================
const BRAND_NAME = process.env.SEED_BRAND_NAME ?? "";
const PORTAL_TITLE = process.env.SEED_PORTAL_TITLE ?? `${BRAND_NAME} Creative Studio`;
const BRAND_COLOR = process.env.SEED_BRAND_COLOR ?? "#b2ff00";
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "";

// Paste the full content of [Brand]/[Brand] - Brand Intelligence Layer.md here
const BRAND_INTEL_CONTENT = `# Brand Intelligence

[Paste brand intelligence markdown content here]
`;
// =============================================================

if (!BRAND_NAME) {
  console.error("❌ SEED_BRAND_NAME env var is required. Set it before running seed.");
  console.error("   Example: SEED_BRAND_NAME=Trimrx SEED_ADMIN_EMAIL=client@company.com npm run seed");
  process.exit(1);
}

if (!ADMIN_EMAIL) {
  console.error("❌ SEED_ADMIN_EMAIL env var is required.");
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL not set. Copy .env.example to .env.local and fill in values.");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });

async function main() {
  console.log(`\nSeeding database for: ${BRAND_NAME}\n`);

  // 1. App Config (singleton)
  await sql`
    INSERT INTO app_config (brand_name, brand_color, logo_url, portal_title, features, workflows)
    VALUES (
      ${BRAND_NAME},
      ${BRAND_COLOR},
      '/client-logo.png',
      ${PORTAL_TITLE},
      '{"brand_intel_editing": true}'::jsonb,
      '{}'::jsonb
    )
    ON CONFLICT DO NOTHING
  `;
  console.log("  ✓ app_config");

  // 2. Brand Intelligence (singleton)
  await sql`
    INSERT INTO brand_intelligence (title, raw_content)
    VALUES ('Brand Intelligence', ${BRAND_INTEL_CONTENT})
    ON CONFLICT DO NOTHING
  `;
  console.log("  ✓ brand_intelligence");

  // 3. Better Auth user + portal user
  // The Better Auth user must be created first via magic link login.
  // After the admin logs in for the first time, run this to create their portal profile:
  //
  //   INSERT INTO users (user_id, display_name, email, role)
  //   SELECT id, name, email, 'admin'
  //   FROM "user"
  //   WHERE email = 'ADMIN_EMAIL'
  //   ON CONFLICT DO NOTHING;
  //
  console.log("  ⚠️  Admin user: log in via magic link first, then run the SQL above to grant admin role.");

  console.log(`\n✅ Database seeded for ${BRAND_NAME}`);
  console.log("📋 Next steps:");
  console.log("   1. Add client-logo.png to /public/");
  console.log(`   2. Send magic link to ${ADMIN_EMAIL} from the portal login page`);
  console.log("   3. Run the admin SQL above after first login to grant admin role");
  console.log("   4. Set BETTER_AUTH_URL and NEXT_PUBLIC_APP_URL to the Vercel deployment URL");

  await sql.end();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
