import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { toAccessibleUrl } from "@/lib/r2";
import type { SourceSystem } from "@/lib/qc/constants";
import { sourceTableFor } from "@/lib/qc/enqueue";
import { releaseHeldPlanItem } from "@/lib/qc/release";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type ReviewRow = typeof schema.gateReviews.$inferSelect;

async function loadReview(id: string): Promise<ReviewRow | null> {
  const [row] = await db.select().from(schema.gateReviews).where(eq(schema.gateReviews.id, id)).limit(1);
  return row ?? null;
}

/** IDOR guard: a review may only ever be read or mutated within its own client. */
function clientMismatch(review: ReviewRow, clientId: string | null): NextResponse | null {
  if (!clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });
  if (review.clientId !== clientId) {
    return NextResponse.json({ error: "Review belongs to a different client" }, { status: 403 });
  }
  return null;
}

/** Write a human decision onto the source row. */
async function setSourceStatus(
  review: ReviewRow,
  qcStatus: "approved" | "rejected",
  reviewedBy: string
): Promise<void> {
  if (!review.sourceId) return;
  const t = sourceTableFor(review.sourceSystem as SourceSystem);
  if (!t) return;
  await db
    .update(t.table)
    .set({ qcStatus, qcReviewedAt: new Date(), qcReviewedBy: reviewedBy, updatedAt: new Date() })
    .where(eq(t.id, review.sourceId));
}

/** Detach a source from a review being deleted so its output is never stranded. */
async function grandfatherSource(review: ReviewRow): Promise<void> {
  if (!review.sourceId) return;
  const t = sourceTableFor(review.sourceSystem as SourceSystem);
  if (!t) return;
  await db
    .update(t.table)
    .set({ qcStatus: "skipped", qcReviewId: null, updatedAt: new Date() })
    .where(and(eq(t.id, review.sourceId), eq(t.qcReviewId, review.id)));
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;
  const { portalUser } = authResult;

  const { id } = await params;
  const review = await loadReview(id);
  if (!review) return NextResponse.json({ error: "Review not found" }, { status: 404 });

  const mismatch = clientMismatch(review, req.nextUrl.searchParams.get("clientId"));
  if (mismatch) return mismatch;

  return NextResponse.json({
    review: {
      ...review,
      assetUrl: review.assetPath ? await toAccessibleUrl(review.assetPath).catch(() => review.assetPath) : null,
    },
    canEdit: portalUser.role !== "viewer",
  });
}

/**
 * PATCH /api/qc/reviews/[id]
 *   { clientId, action: "regenerate" }  → re-queue for a fresh AI grade
 *   { clientId, overallPass: boolean }  → human override (approve / reject)
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;
  const { portalUser } = authResult;
  if (portalUser.role === "viewer") {
    return NextResponse.json({ error: "Viewers cannot change QC decisions" }, { status: 403 });
  }

  const { id } = await params;
  const review = await loadReview(id);
  if (!review) return NextResponse.json({ error: "Review not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const mismatch = clientMismatch(review, body.clientId ?? null);
  if (mismatch) return mismatch;

  // Re-grade: hand it back to the AI from a clean slate.
  if (body.action === "regenerate") {
    await db
      .update(schema.gateReviews)
      .set({
        status: "pending",
        attempts: 0,
        overridden: false,
        reviewer: "ai",
        errorMessage: null,
        overallPass: null,
        completedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.gateReviews.id, id));

    const t = sourceTableFor(review.sourceSystem as SourceSystem);
    if (t && review.sourceId) {
      await db
        .update(t.table)
        .set({ qcStatus: "pending", qcReviewedAt: null, qcReviewedBy: null, updatedAt: new Date() })
        .where(and(eq(t.id, review.sourceId), eq(t.qcReviewId, review.id)));
    }
    return NextResponse.json({ ok: true, status: "pending" });
  }

  if (typeof body.overallPass !== "boolean") {
    return NextResponse.json({ error: "overallPass (boolean) or action:'regenerate' is required" }, { status: 400 });
  }

  // Human override. `overridden` makes an in-flight AI completion no-op, so a decision
  // made mid-grade is never silently reverted. criteriaJson is left exactly as the AI
  // wrote it — the audit trail should show what the machine actually said.
  await db
    .update(schema.gateReviews)
    .set({
      overallPass: body.overallPass,
      reviewer: "human",
      overridden: true,
      status: "complete",
      notes: typeof body.notes === "string" ? body.notes : review.notes,
      reviewedBy: portalUser.id,
      reviewedAt: new Date(),
      completedAt: review.completedAt ?? new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.gateReviews.id, id));

  await setSourceStatus(review, body.overallPass ? "approved" : "rejected", portalUser.id);

  // A monthly-planning item parked by the gate resumes on approval.
  if (body.overallPass && review.sourceSystem === "static" && review.sourceId) {
    await releaseHeldPlanItem(review.sourceId);
  }

  return NextResponse.json({ ok: true, overallPass: body.overallPass });
}

/** DELETE — remove a review and grandfather its source so nothing is left stranded. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;
  const { portalUser } = authResult;
  if (portalUser.role === "viewer") {
    return NextResponse.json({ error: "Viewers cannot delete reviews" }, { status: 403 });
  }

  const { id } = await params;
  const review = await loadReview(id);
  if (!review) return NextResponse.json({ error: "Review not found" }, { status: 404 });

  const mismatch = clientMismatch(review, req.nextUrl.searchParams.get("clientId"));
  if (mismatch) return mismatch;

  await grandfatherSource(review);
  await db.delete(schema.gateReviews).where(eq(schema.gateReviews.id, id));

  return NextResponse.json({ ok: true });
}
