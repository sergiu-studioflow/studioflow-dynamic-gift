/**
 * End-to-end verification of the Quality Control gate on the STATIC path, against the live
 * DB and through the REAL library code (no auth layer, no HTTP).
 *
 * Run: DOTENV_CONFIG_PATH=.env.local npx tsx scripts/verify-qc-gate.ts
 *
 * SELF-CLEANING: snapshots the subject row's original qc_status, restores it, and deletes
 * the review it created. Safe to run against production.
 *
 * Costs one real judge call (~$0.01) when a judge key is configured.
 */

import "dotenv/config";
import { db, schema } from "@/lib/db";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { buildBrandGrounding } from "@/lib/qc/grounding";
import { enqueueGateReview } from "@/lib/qc/enqueue";
import { runGateTick } from "@/lib/qc/pipeline";
import { isShippable } from "@/lib/qc/gate";
import { providerStatus } from "@/lib/qc/provider";
import { QC_EXEMPT_STATIC_MODES } from "@/lib/qc/constants";

let failures = 0;
function check(label: string, condition: boolean, detail = "") {
  console.log(`  ${condition ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures++;
}

async function main() {
  const providers = await providerStatus();
  console.log(`Judges: gemini=${providers.gemini} claude=${providers.claude}\n`);

  // ── 1. Grounding ────────────────────────────────────────────────────────────
  console.log("1. Grounding");
  const [brand] = await db
    .select({ id: schema.brands.id, name: schema.brands.brandName })
    .from(schema.brands)
    .where(eq(schema.brands.clientSlug, "dynamic-gift"))
    .limit(1);
  if (!brand) throw new Error("dynamic-gift brand not found");

  const grounding = await buildBrandGrounding(brand.id);
  check("ruleset row exists", grounding.source === "flat", `source=${grounding.source}`);
  check("visual rules seeded", grounding.visualRules.length >= 8, `${grounding.visualRules.length} rules`);
  check("red lines seeded", grounding.bannedPhrasings.length >= 3, `${grounding.bannedPhrasings.length} phrases`);
  check("brand name resolved", grounding.brandName === brand.name, grounding.brandName);

  // ── 2. Subject ──────────────────────────────────────────────────────────────
  console.log("\n2. Subject");
  const [subject] = await db
    .select()
    .from(schema.staticAdGenerations)
    .where(
      and(
        eq(schema.staticAdGenerations.clientId, brand.id),
        eq(schema.staticAdGenerations.status, "completed"),
        isNotNull(schema.staticAdGenerations.imageUrl),
        sql`${schema.staticAdGenerations.imageUrl} LIKE '%r2.dev%'`,
        sql`${schema.staticAdGenerations.mode} NOT IN ('intermediate','logo-refined')`
      )
    )
    // Prefer a row WITH a product so the ground-truth reference photo gets attached.
    .orderBy(sql`${schema.staticAdGenerations.productId} IS NOT NULL DESC`, desc(schema.staticAdGenerations.createdAt))
    .limit(1);
  if (!subject) throw new Error("no completed R2-hosted static ad to grade");

  const originalQc = subject.qcStatus;
  const originalReviewId = subject.qcReviewId;
  console.log(`  subject ${subject.id} mode=${subject.mode} product=${subject.productId ? "yes" : "NONE"} qc=${originalQc}`);

  // Reset so enqueue is not a no-op on a previously-graded row.
  await db
    .update(schema.staticAdGenerations)
    .set({ qcStatus: "pending", qcReviewId: null })
    .where(eq(schema.staticAdGenerations.id, subject.id));

  // ── 3. Enqueue (idempotency) ────────────────────────────────────────────────
  console.log("\n3. Enqueue — called twice, must create exactly one review");
  const enqueueArgs = {
    sourceSystem: "static" as const,
    sourceId: subject.id,
    clientId: subject.clientId,
    assetPath: subject.imageUrl,
    copyText: subject.adCopy,
    mode: subject.mode,
  };
  await enqueueGateReview(enqueueArgs);
  await enqueueGateReview(enqueueArgs);

  const reviews = await db
    .select()
    .from(schema.gateReviews)
    .where(and(eq(schema.gateReviews.sourceSystem, "static"), eq(schema.gateReviews.sourceId, subject.id)));
  check("exactly one review row", reviews.length === 1, `found ${reviews.length}`);
  const review = reviews[0];
  if (!review) throw new Error("enqueue created no review");

  const [afterEnqueue] = await db
    .select({ qcStatus: schema.staticAdGenerations.qcStatus, qcReviewId: schema.staticAdGenerations.qcReviewId })
    .from(schema.staticAdGenerations)
    .where(eq(schema.staticAdGenerations.id, subject.id));
  check("source marked pending", afterEnqueue.qcStatus === "pending", afterEnqueue.qcStatus);
  check("source points at the review", afterEnqueue.qcReviewId === review.id);
  check("ruleset version snapshotted", review.rulesetVersion != null, `v${review.rulesetVersion}`);

  // ── 4. Grade ────────────────────────────────────────────────────────────────
  console.log("\n4. Grade");
  let graded = null as typeof review | null;
  for (let i = 0; i < 4; i++) {
    await runGateTick();
    const [row] = await db.select().from(schema.gateReviews).where(eq(schema.gateReviews.id, review.id));
    if (row && (row.status === "complete" || row.status === "failed")) {
      graded = row;
      break;
    }
  }
  if (!graded) throw new Error("review never reached a terminal state");

  const criteria = graded.criteriaJson ?? [];
  for (const c of criteria) {
    console.log(`     ${c.pass ? "PASS" : "FAIL"}${c.assessed ? "" : " (n/a)"}${c.gating ? "" : " [advisory]"}  ${c.key}: ${c.note || "—"}`);
  }
  const keys = criteria.map((c) => c.key);
  check("terminal state", graded.status === "complete" || graded.status === "failed", graded.status);
  check("technical criterion present", keys.includes("technical"));
  check("lip_sync_audio absent on a static", !keys.includes("lip_sync_audio"));
  check("winner_alignment present", keys.includes("winner_alignment"));
  check(
    "winner_alignment is advisory (never gates)",
    criteria.find((c) => c.key === "winner_alignment")?.gating === false
  );
  check("value_clarity present", keys.includes("value_clarity"));
  check("copy_direction present", keys.includes("copy_direction"));
  check("brand_fit present", keys.includes("brand_fit"));

  const [afterGrade] = await db
    .select({ qcStatus: schema.staticAdGenerations.qcStatus })
    .from(schema.staticAdGenerations)
    .where(eq(schema.staticAdGenerations.id, subject.id));

  if (providers.anyGradable) {
    check("review completed", graded.status === "complete", graded.status);
    check(
      "verdict applied to the source",
      ["approved", "flagged"].includes(afterGrade.qcStatus),
      afterGrade.qcStatus
    );
    check("overall verdict recorded", graded.overallPass !== null, String(graded.overallPass));
    console.log(`     cost: ${graded.costCents}c`);
  } else {
    // KILL SWITCH: with no judge, nothing may be auto-approved.
    check("no judge → source flagged, never auto-approved", afterGrade.qcStatus === "flagged", afterGrade.qcStatus);
    check(
      "criteria explain why",
      criteria.some((c) => c.note.includes("unavailable")),
      criteria[1]?.note
    );
  }

  // ── 5. Gate predicates ──────────────────────────────────────────────────────
  console.log("\n5. Gate predicates");
  check("approved is shippable", isShippable("approved"));
  check("skipped is shippable", isShippable("skipped"));
  check("null is shippable (legacy-safe)", isShippable(null));
  check("flagged is NOT shippable", !isShippable("flagged"));
  check("rejected is NOT shippable", !isShippable("rejected"));
  check("pending is NOT shippable", !isShippable("pending"));
  check("exempt modes configured", QC_EXEMPT_STATIC_MODES.length === 2, QC_EXEMPT_STATIC_MODES.join(","));

  // ── 6. Cleanup ──────────────────────────────────────────────────────────────
  console.log("\n6. Cleanup");
  await db.delete(schema.gateReviews).where(eq(schema.gateReviews.id, review.id));
  await db
    .update(schema.staticAdGenerations)
    .set({ qcStatus: originalQc, qcReviewId: originalReviewId, qcReviewedAt: null })
    .where(eq(schema.staticAdGenerations.id, subject.id));

  const [restored] = await db
    .select({ qcStatus: schema.staticAdGenerations.qcStatus })
    .from(schema.staticAdGenerations)
    .where(eq(schema.staticAdGenerations.id, subject.id));
  const leftover = await db
    .select({ id: schema.gateReviews.id })
    .from(schema.gateReviews)
    .where(inArray(schema.gateReviews.id, [review.id]));
  check("subject restored", restored.qcStatus === originalQc, restored.qcStatus);
  check("review deleted", leftover.length === 0);

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
