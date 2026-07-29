/**
 * End-to-end verification of the Quality Control gate on the TEXT path (ad copy / video
 * briefs / content ideas), against the live DB through the real library code.
 *
 * Run: DOTENV_CONFIG_PATH=.env.local npx tsx scripts/verify-qc-text.ts
 *
 * The text lane has one thing the visual lane doesn't: those three tables carry NO
 * client_id, so the client has to be resolved through the *_requests parent's brand name.
 * That resolution is the main thing under test here — get it wrong and every text grade
 * silently runs with no brand grounding at all.
 *
 * Also asserts the deterministic red-line scan by injecting a banned phrase into the
 * scanned copy and confirming it hard-fails brand_fit regardless of what the judge says.
 *
 * SELF-CLEANING. Costs one real judge call (sub-cent).
 */

import "dotenv/config";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { enqueueGateReview } from "@/lib/qc/enqueue";
import { runGateTick } from "@/lib/qc/pipeline";
import { loadTextPayload, resolveTextClientId } from "@/lib/qc/grade";
import { providerStatus } from "@/lib/qc/provider";

let failures = 0;
function check(label: string, condition: boolean, detail = "") {
  console.log(`  ${condition ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures++;
}

async function main() {
  const providers = await providerStatus();
  console.log(`Judges: gemini=${providers.gemini} claude=${providers.claude}\n`);

  // ── 1. Client resolution from the request parent's brand name ───────────────
  console.log("1. Client resolution (text rows have no client_id)");
  const [row] = await db
    .select({ id: schema.generatedAdCopy.id, qcStatus: schema.generatedAdCopy.qcStatus, brand: schema.adCopyRequests.brand })
    .from(schema.generatedAdCopy)
    .leftJoin(schema.adCopyRequests, eq(schema.generatedAdCopy.requestId, schema.adCopyRequests.id))
    .limit(1);
  if (!row) throw new Error("no generated_ad_copy rows to grade");

  const resolved = await resolveTextClientId(row.brand);
  check("brand name resolves to a client", !!resolved, `${row.brand} → ${resolved}`);

  const payload = await loadTextPayload("ad_copy", row.id);
  check("payload carries a body", payload.body.length > 20, `${payload.body.length} chars`);
  check("payload resolves the same client", payload.clientId === resolved);
  console.log(`     body preview: ${payload.body.slice(0, 110).replace(/\n/g, " · ")}…`);

  // ── 2. Red-line scan (deterministic, must beat the judge) ──────────────────
  console.log("\n2. Deterministic red-line scan");
  const [cfg] = await db
    .select({ banned: schema.complianceConfig.bannedPhrasings })
    .from(schema.complianceConfig)
    .where(eq(schema.complianceConfig.clientId, resolved!))
    .limit(1);
  const redLine = (cfg?.banned ?? [])[0];
  check("client has a red-line phrase seeded", !!redLine, redLine);

  const originalQc = row.qcStatus;
  await db
    .update(schema.generatedAdCopy)
    .set({ qcStatus: "pending", qcReviewId: null })
    .where(eq(schema.generatedAdCopy.id, row.id));

  // copyText is scanned alongside the body — inject the red line there so the assertion
  // tests the scan without mutating the client's real copy.
  await enqueueGateReview({
    sourceSystem: "ad_copy",
    sourceId: row.id,
    clientId: resolved,
    copyText: `Visit ${redLine} today`,
  });

  const [review] = await db
    .select()
    .from(schema.gateReviews)
    .where(and(eq(schema.gateReviews.sourceSystem, "ad_copy"), eq(schema.gateReviews.sourceId, row.id)));
  check("review enqueued without an asset", !!review && review.assetPath === null);

  // ── 3. Grade ───────────────────────────────────────────────────────────────
  console.log("\n3. Grade");
  let graded = null as typeof review | null;
  for (let i = 0; i < 4; i++) {
    await runGateTick();
    const [r] = await db.select().from(schema.gateReviews).where(eq(schema.gateReviews.id, review.id));
    if (r && (r.status === "complete" || r.status === "failed")) {
      graded = r;
      break;
    }
  }
  if (!graded) throw new Error("review never reached a terminal state");

  const criteria = graded.criteriaJson ?? [];
  for (const c of criteria) {
    console.log(`     ${c.pass ? "PASS" : "FAIL"}${c.assessed ? "" : " (n/a)"}${c.gating ? "" : " [advisory]"}  ${c.key}: ${c.note || "—"}`);
  }
  const keys = criteria.map((c) => c.key);
  check("no visual criteria on a text grade", !keys.includes("technical") && !keys.includes("product_fidelity") && !keys.includes("no_hallucinations"), keys.join(","));
  check("value_clarity present", keys.includes("value_clarity"));
  check("copy_direction present", keys.includes("copy_direction"));
  check("brand_fit present", keys.includes("brand_fit"));
  check("winner_alignment present and advisory", criteria.find((c) => c.key === "winner_alignment")?.gating === false);

  const brandFit = criteria.find((c) => c.key === "brand_fit");
  if (providers.anyGradable) {
    check("red line hard-failed brand_fit", brandFit?.pass === false, brandFit?.note);
    check("red line named in the note", (brandFit?.note ?? "").includes(redLine), brandFit?.note?.slice(0, 80));
    check("overall verdict is a fail", graded.overallPass === false);
    const [after] = await db
      .select({ qcStatus: schema.generatedAdCopy.qcStatus })
      .from(schema.generatedAdCopy)
      .where(eq(schema.generatedAdCopy.id, row.id));
    check("source flagged", after.qcStatus === "flagged", after.qcStatus);
  } else {
    check("no judge → flagged, never auto-approved", graded.overallPass === false);
  }

  // ── 4. Cleanup ─────────────────────────────────────────────────────────────
  console.log("\n4. Cleanup");
  await db.delete(schema.gateReviews).where(eq(schema.gateReviews.id, review.id));
  await db
    .update(schema.generatedAdCopy)
    .set({ qcStatus: originalQc, qcReviewId: null, qcReviewedAt: null })
    .where(eq(schema.generatedAdCopy.id, row.id));
  const [restored] = await db
    .select({ qcStatus: schema.generatedAdCopy.qcStatus })
    .from(schema.generatedAdCopy)
    .where(eq(schema.generatedAdCopy.id, row.id));
  check("source restored", restored.qcStatus === originalQc, restored.qcStatus);

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
