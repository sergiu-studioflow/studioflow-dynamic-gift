/**
 * Deactivate reference-library rows whose image no longer resolves.
 *
 * Run: DOTENV_CONFIG_PATH=.env.local npx tsx scripts/prune-dead-references.ts [--dry]
 *
 * The shared pool was reconciled from an R2 manifest, and a slice of that
 * manifest lists objects that were never actually uploaded. A dead reference is
 * not cosmetic: the reference image is downloaded and sent to Agent 1, Agent 2
 * AND the image model, so drawing one fails the whole generation. At ~3% of the
 * pool that is roughly one failed ad in thirty, with an opaque download error.
 *
 * Deactivates rather than deletes — the rows stay for audit, and re-uploading
 * the missing objects plus re-running this restores them.
 */

import "dotenv/config";
import { db, schema } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";

const DRY = process.argv.includes("--dry");
const CONCURRENCY = 24;

async function main() {
  const rows = await db
    .select({ id: schema.referenceAdLibrary.id, url: schema.referenceAdLibrary.imageUrl, name: schema.referenceAdLibrary.name })
    .from(schema.referenceAdLibrary)
    .where(eq(schema.referenceAdLibrary.isActive, true));
  console.log(`Checking ${rows.length} active references…`);

  const dead: Array<{ id: string; url: string; status: string }> = [];
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    await Promise.all(
      rows.slice(i, i + CONCURRENCY).map(async (r) => {
        try {
          const res = await fetch(r.url, { method: "HEAD" });
          // 4xx means the object is gone. A 5xx is likelier to be transient, so
          // it is left alone rather than pruned on one bad response.
          if (res.status >= 400 && res.status < 500) dead.push({ id: r.id, url: r.url, status: String(res.status) });
        } catch {
          /* network hiccup — leave it active */
        }
      })
    );
  }

  console.log(`\nDead: ${dead.length} / ${rows.length}`);
  const byFolder = new Map<string, number>();
  for (const d of dead) {
    const folder = d.url.split("/reference-ad-library/")[1]?.split("/")[0] ?? "?";
    byFolder.set(folder, (byFolder.get(folder) ?? 0) + 1);
  }
  for (const [f, n] of [...byFolder].sort((a, b) => b[1] - a[1])) console.log(`  ${f}: ${n}`);

  if (!dead.length) return console.log("\nNothing to prune.");
  if (DRY) return console.log("\n--dry: no changes written.");

  await db
    .update(schema.referenceAdLibrary)
    .set({ isActive: false, updatedAt: new Date() })
    .where(inArray(schema.referenceAdLibrary.id, dead.map((d) => d.id)));

  const [remaining] = await db
    .select({ id: schema.referenceAdLibrary.id })
    .from(schema.referenceAdLibrary)
    .where(eq(schema.referenceAdLibrary.isActive, true))
    .limit(1);
  console.log(`\nDeactivated ${dead.length}. Pool still populated: ${!!remaining}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
