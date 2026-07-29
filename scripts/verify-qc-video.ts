/**
 * Verification of the Quality Control gate on the VIDEO path — the transport that only
 * Gemini can do (Claude accepts no video input), so this also proves the provider split.
 *
 * Run: DOTENV_CONFIG_PATH=.env.local npx tsx scripts/verify-qc-video.ts
 *
 * SELF-CLEANING. Costs one real Gemini video grade.
 * Without a Gemini key this asserts the kill-switch instead: the clip must end up flagged
 * for a human, never auto-approved on the basis of a grade that never happened.
 */

import "dotenv/config";
import { db, schema } from "@/lib/db";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { enqueueGateReview } from "@/lib/qc/enqueue";
import { runGateTick } from "@/lib/qc/pipeline";
import { providerStatus } from "@/lib/qc/provider";

let failures = 0;
function check(label: string, condition: boolean, detail = "") {
  console.log(`  ${condition ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures++;
}

async function main() {
  const providers = await providerStatus();
  console.log(`Judges: gemini=${providers.gemini} claude=${providers.claude}`);
  console.log(`Video gradable: ${providers.videoGradable}\n`);

  console.log("1. Subject");
  const [subject] = await db
    .select()
    .from(schema.videoGenerations)
    .where(
      and(
        eq(schema.videoGenerations.status, "completed"),
        isNotNull(schema.videoGenerations.videoUrl),
        sql`${schema.videoGenerations.videoUrl} LIKE '%r2.dev%'`
      )
    )
    .orderBy(desc(schema.videoGenerations.createdAt))
    .limit(1);
  if (!subject) throw new Error("no completed R2-hosted video to grade");

  const originalQc = subject.qcStatus;
  const originalReviewId = subject.qcReviewId;
  console.log(`  subject ${subject.id} type=${subject.videoType} ar=${subject.aspectRatio} qc=${originalQc}`);

  await db
    .update(schema.videoGenerations)
    .set({ qcStatus: "pending", qcReviewId: null })
    .where(eq(schema.videoGenerations.id, subject.id));

  console.log("\n2. Enqueue");
  await enqueueGateReview({
    sourceSystem: "video",
    sourceId: subject.id,
    clientId: subject.clientId,
    assetPath: subject.videoUrl,
    copyText: subject.script,
  });

  const [review] = await db
    .select()
    .from(schema.gateReviews)
    .where(and(eq(schema.gateReviews.sourceSystem, "video"), eq(schema.gateReviews.sourceId, subject.id)));
  check("review created", !!review);
  if (!review) throw new Error("no review");

  console.log("\n3. Grade (downloads the clip — this can take a minute)");
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
  const lipSync = criteria.find((c) => c.key === "lip_sync_audio");
  const technical = criteria.find((c) => c.key === "technical");

  check("lip_sync_audio present on a video", keys.includes("lip_sync_audio"));
  check("technical criterion present", !!technical);
  check("winner_alignment advisory", criteria.find((c) => c.key === "winner_alignment")?.gating === false);

  const [after] = await db
    .select({ qcStatus: schema.videoGenerations.qcStatus })
    .from(schema.videoGenerations)
    .where(eq(schema.videoGenerations.id, subject.id));

  if (providers.videoGradable) {
    check("review completed", graded.status === "complete", graded.status);
    check("technical passed on a real clip", technical?.pass === true, technical?.note);
    check("verdict applied", ["approved", "flagged"].includes(after.qcStatus), after.qcStatus);
    // B-roll has no on-camera speech, so lip sync must not be invented as a failure.
    if (subject.videoType === "broll") {
      check("lip_sync n/a or pass on B-roll", !lipSync?.assessed || lipSync?.pass === true, lipSync?.note);
    }
    console.log(`     cost: ${graded.costCents}c`);
  } else {
    check("no Gemini → flagged, never auto-approved", after.qcStatus === "flagged", after.qcStatus);
    check(
      "reason names the Gemini requirement",
      criteria.some((c) => c.note.toLowerCase().includes("gemini")),
      criteria.find((c) => c.key === "lip_sync_audio")?.note
    );
  }

  console.log("\n4. Cleanup");
  await db.delete(schema.gateReviews).where(eq(schema.gateReviews.id, review.id));
  await db
    .update(schema.videoGenerations)
    .set({ qcStatus: originalQc, qcReviewId: originalReviewId, qcReviewedAt: null })
    .where(eq(schema.videoGenerations.id, subject.id));
  const [restored] = await db
    .select({ qcStatus: schema.videoGenerations.qcStatus })
    .from(schema.videoGenerations)
    .where(eq(schema.videoGenerations.id, subject.id));
  check("subject restored", restored.qcStatus === originalQc, restored.qcStatus);

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
