// Monthly Planning is the one path where the gate is load-bearing rather than advisory:
// scheduleGeneratedItem() takes a generated static straight to a live Facebook/Instagram
// publish on a cron with no human in the loop.
//
// When the gate holds such an item, the sweep parks the plan item in `error` with an
// explicit message (rather than spinning forever or silently dropping the slot). This
// module is the other half of that contract: approving the creative in the QC queue puts
// the item back to `producing` — the state the stepper schedules from — and re-opens a
// plan that already finished, so the next sweep schedules it as originally planned.

import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export const QC_HOLD_MESSAGE = "Held by Quality Control — approve it in the QC queue to reschedule.";

/**
 * Un-park any plan item that was blocked on this generation's QC verdict.
 * Guarded on the hold message so a genuine generation error is never resurrected.
 * Returns the number of items released.
 */
export async function releaseHeldPlanItem(generationId: string): Promise<number> {
  const released = await db
    .update(schema.planItems)
    .set({ status: "producing", errorMessage: null, updatedAt: new Date() })
    .where(
      and(
        eq(schema.planItems.generationId, generationId),
        eq(schema.planItems.status, "error"),
        eq(schema.planItems.errorMessage, QC_HOLD_MESSAGE)
      )
    )
    .returning({ id: schema.planItems.id, planId: schema.planItems.planId });

  if (released.length) {
    // The stepper only visits 'producing' plans; a plan that completed while this slot
    // was held would otherwise never pick it back up.
    const planIds = [...new Set(released.map((r) => r.planId))];
    await db
      .update(schema.monthlyPlans)
      .set({ status: "producing", updatedAt: new Date() })
      .where(and(inArray(schema.monthlyPlans.id, planIds), inArray(schema.monthlyPlans.status, ["complete", "scheduled"])));
    console.log(`[qc/release] released ${released.length} plan item(s) for generation ${generationId}`);
  }
  return released.length;
}
