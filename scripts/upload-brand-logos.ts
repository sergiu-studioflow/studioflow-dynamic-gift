/**
 * One-shot logo uploader for Dynamic Gift's 8 sub-brands.
 * Uploads each PNG from temp-logos/ to R2 under canonical paths and
 * UPDATEs client_static_ad_config with the resulting public URLs.
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import postgres from "postgres";

const TEMP_DIR = join(process.cwd(), "temp-logos");

const FILE_TO_SLUG: Record<string, string> = {
  "dynamic-gift-logo": "dynamic-gift",
  "dynamic-gift-logo-white": "dynamic-gift",
  "event-display-logo": "event-display",
  "event-display-logo-white": "event-display",
  "indigenous-promotions-logo": "indigenous-promotions",
  "indigenous-promotions-logo-white": "indigenous-promotions",
  "inflatable-promotions-logo": "inflatable-promotions",
  "lanyards-factory-logo": "lanyards-factory",
  "lanyards-factory-logo-white": "lanyards-factory",
  "the-pin-factory-logo": "pin-factory",
  "the-pin-factory-logo-white": "pin-factory",
  "promo-superstore-logo": "promo-superstore",
  "promo-superstore-logo-white": "promo-superstore",
  "medal-factory-logo": "the-medal-factory",
  "medal-factory-logo-white": "the-medal-factory",
};

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID!;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID!;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY!;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || "studioflow-assets";
const R2_PUBLIC_URL = "https://pub-c85814e28869441d8a619b3b90562166.r2.dev";

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

async function main() {
  const brands = (await sql`
    SELECT id, slug, storage_prefix
    FROM brands
    WHERE slug = ANY(${Object.values(FILE_TO_SLUG).filter((v, i, a) => a.indexOf(v) === i)})
  `) as { id: string; slug: string; storage_prefix: string }[];
  const slugToBrand = new Map(brands.map((b) => [b.slug, b]));

  const updates = new Map<string, { color?: string; white?: string }>();

  const files = readdirSync(TEMP_DIR).filter((f) => f.endsWith(".png"));
  console.log(`Found ${files.length} PNG files in ${TEMP_DIR}\n`);

  for (const file of files) {
    const base = file.replace(/\.png$/, "");
    const slug = FILE_TO_SLUG[base];
    if (!slug) {
      console.warn(`⚠ skipping ${file} — no slug mapping`);
      continue;
    }
    const brand = slugToBrand.get(slug);
    if (!brand?.storage_prefix) {
      console.warn(`⚠ skipping ${file} — brand ${slug} not found or no storage_prefix`);
      continue;
    }

    const isWhite = base.endsWith("-white");
    const targetName = isWhite ? "logo-white.png" : "logo-color.png";
    const key = `${brand.storage_prefix}/brand-assets/${targetName}`;

    const body = readFileSync(join(TEMP_DIR, file));
    await r2.send(new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: "image/png",
    }));

    const publicUrl = `${R2_PUBLIC_URL}/${key}`;
    console.log(`✓ ${file} → ${key}`);

    const entry = updates.get(slug) || {};
    if (isWhite) entry.white = publicUrl;
    else entry.color = publicUrl;
    updates.set(slug, entry);
  }

  console.log("\nUpdating DB rows...\n");
  for (const [slug, urls] of updates) {
    const brand = slugToBrand.get(slug)!;
    if (urls.color && urls.white) {
      await sql`
        UPDATE client_static_ad_config
        SET brand_logo_url = ${urls.color},
            brand_logo_white_url = ${urls.white},
            updated_at = NOW()
        WHERE client_id = ${brand.id}::uuid
      `;
    } else if (urls.color) {
      await sql`
        UPDATE client_static_ad_config
        SET brand_logo_url = ${urls.color},
            updated_at = NOW()
        WHERE client_id = ${brand.id}::uuid
      `;
    } else if (urls.white) {
      await sql`
        UPDATE client_static_ad_config
        SET brand_logo_white_url = ${urls.white},
            updated_at = NOW()
        WHERE client_id = ${brand.id}::uuid
      `;
    }
    console.log(`✓ ${slug} updated (color=${!!urls.color}, white=${!!urls.white})`);
  }

  console.log("\nDone.");
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
