// "Does it match patterns from past winners?" — the fifth QC question.
//
// Rather than attaching winner images to every grade (expensive, run-to-run variance, and
// opaque — you could never see or correct the standard being applied), we distil the
// client's winners_library ONCE into a written profile. That profile is:
//   - cheap and identical across every grade in a batch,
//   - visible and editable in the QC Rules tab, so a human owns what "winning" means,
//   - regenerable when the library grows.
//
// The resulting criterion is ADVISORY (constants.ts → gating:false). A creative that
// departs from past winners is a business signal worth surfacing, not a defect worth
// blocking — blocking novelty would make the whole system a regression-to-the-mean machine.

import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { callClaudeJSON, type ContentBlock } from "./claude";
import { imageUrlToBase64Block } from "@/lib/static-ads/anthropic";

/** Max winners fed to the profiler. Beyond ~8 the marginal signal is small and the
 *  vision call gets slow and expensive. */
const MAX_WINNERS = 8;

/** Below this the "pattern" is noise, not a pattern — the criterion stays n/a. */
export const MIN_WINNERS_FOR_PROFILE = 3;

const SYSTEM = `You analyse a brand's best-performing ad creatives and write a short, concrete profile of what they have in common, to be used later as a reference standard by an automated quality reviewer.

Be specific and observable. Write about what is actually visible across the set: layout archetypes, where the product sits, how much of the frame it occupies, headline placement and length, copy structures and hook styles, colour and background treatment, use of people, badges, price callouts, CTA treatment.

Rules:
- Only describe patterns you can see in AT LEAST TWO of the creatives. A trait appearing once is not a pattern — omit it.
- Never invent performance data, spend, or results. You are looking at images, not metrics.
- Do not write praise, marketing language, or advice. This is a descriptive spec.
- If the set is visually inconsistent and has no shared pattern, say so plainly — that is a valid and useful answer.

Return ONLY JSON: {"profile":"...","patterns":["...","..."]}
"profile" is 120-200 words of prose. "patterns" is 3-6 short bullet strings.`;

export type WinnerProfileResult = {
  profile: string | null;
  sourceCount: number;
  /** Why no profile, when profile is null. */
  reason?: string;
};

/**
 * Build (or rebuild) the winner profile for a client and persist it to compliance_config.
 * Safe to call opportunistically — returns a null profile rather than throwing when the
 * client has too few winners or no Claude key.
 */
export async function buildWinnerProfile(clientId: string): Promise<WinnerProfileResult> {
  const winners = await db
    .select({
      name: schema.winnersLibrary.name,
      imageUrl: schema.winnersLibrary.imageUrl,
      productName: schema.winnersLibrary.productName,
      tags: schema.winnersLibrary.tags,
      notes: schema.winnersLibrary.notes,
    })
    .from(schema.winnersLibrary)
    .where(and(eq(schema.winnersLibrary.clientId, clientId), eq(schema.winnersLibrary.isActive, true)))
    .orderBy(desc(schema.winnersLibrary.createdAt))
    .limit(MAX_WINNERS);

  const usable = winners.filter((w) => (w.imageUrl ?? "").trim());
  if (usable.length < MIN_WINNERS_FOR_PROFILE) {
    await persistProfile(clientId, null, usable.length);
    return {
      profile: null,
      sourceCount: usable.length,
      reason: `Needs at least ${MIN_WINNERS_FOR_PROFILE} saved winners to find a pattern (found ${usable.length}).`,
    };
  }

  const content: ContentBlock[] = [];
  let attached = 0;
  for (const w of usable) {
    try {
      content.push(await imageUrlToBase64Block(w.imageUrl));
      const meta = [w.name, w.productName, w.tags, w.notes].map((x) => (x ?? "").trim()).filter(Boolean).join(" · ");
      content.push({ type: "text", text: `Winner ${attached + 1}${meta ? `: ${meta}` : ""}` });
      attached++;
    } catch (e) {
      console.warn("[qc/winners] winner image skipped", w.imageUrl, String(e).slice(0, 120));
    }
  }

  if (attached < MIN_WINNERS_FOR_PROFILE) {
    await persistProfile(clientId, null, attached);
    return { profile: null, sourceCount: attached, reason: "Winner images could not be loaded." };
  }

  content.push({
    type: "text",
    text: `Those are ${attached} of this brand's best-performing ad creatives. Write the shared-pattern profile. Return ONLY the JSON described.`,
  });

  const { text } = await callClaudeJSON({ system: SYSTEM, messages: [{ role: "user", content }], maxTokens: 1200 });
  const parsed = safeParse(text);

  const bullets = (parsed.patterns ?? []).filter((p) => typeof p === "string" && p.trim()).slice(0, 6);
  const prose = (parsed.profile ?? "").trim();
  if (!prose && !bullets.length) {
    await persistProfile(clientId, null, attached);
    return { profile: null, sourceCount: attached, reason: "The profiler returned nothing usable." };
  }

  const profile = [prose, bullets.length ? bullets.map((b) => `- ${b.trim()}`).join("\n") : ""]
    .filter(Boolean)
    .join("\n\n");

  await persistProfile(clientId, profile, attached);
  return { profile, sourceCount: attached };
}

function safeParse(text: string): { profile?: string; patterns?: string[] } {
  let t = (text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s >= 0 && e > s) t = t.slice(s, e + 1);
  try {
    return JSON.parse(t);
  } catch {
    return {};
  }
}

/** Upsert the profile onto the client's compliance_config row (creating a bare row if
 *  none exists yet — a client can have winners before anyone writes a ruleset). Does NOT
 *  bump `version`: the profile is advisory and shouldn't invalidate ruleset provenance. */
async function persistProfile(clientId: string, profile: string | null, sourceCount: number): Promise<void> {
  await db
    .insert(schema.complianceConfig)
    .values({
      clientId,
      winnerProfile: profile,
      winnerProfileUpdatedAt: new Date(),
      winnerProfileSourceCount: sourceCount,
    })
    .onConflictDoUpdate({
      target: schema.complianceConfig.clientId,
      set: {
        winnerProfile: profile,
        winnerProfileUpdatedAt: new Date(),
        winnerProfileSourceCount: sourceCount,
        updatedAt: new Date(),
      },
    });
}

/**
 * Back-off for the lazy build. Without this, a client whose profile legitimately resolves
 * to null (fewer than 3 winners) would re-attempt on EVERY grade — and a client that has
 * enough winners but keeps failing would fire a full 8-image vision call per grade. A
 * single ideation run is 25 rows, so that is 25 vision calls in one cron tick.
 * Attempts are therefore rate-limited per client, per process.
 */
const RETRY_AFTER_MS = 6 * 60 * 60_000;
const lastAttempt = new Map<string, number>();

/**
 * Lazily ensure a profile exists before a grade. Failures are swallowed — an absent profile
 * just means winner_alignment comes back "na", which must never break a grade or block a
 * creative.
 */
export async function ensureWinnerProfile(clientId: string | null, existing: string | null): Promise<string | null> {
  if (existing) return existing;
  if (!clientId) return null;

  const last = lastAttempt.get(clientId);
  if (last && Date.now() - last < RETRY_AFTER_MS) return null;
  lastAttempt.set(clientId, Date.now());

  try {
    const { profile, reason } = await buildWinnerProfile(clientId);
    if (!profile) console.log(`[qc/winners] no profile for ${clientId}: ${reason}`);
    return profile;
  } catch (e) {
    console.warn("[qc/winners] profile build failed", String(e).slice(0, 200));
    return null;
  }
}
