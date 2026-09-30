/**
 * Voices for Video Generation, synced from the ElevenLabs account in Settings → API Keys.
 *
 * A voice's preview clip is passed to Seedance as reference audio: tested 30 Sep 2026, it switched
 * the spoken accent from American to Australian (Seedance 2.0 and 2.5) with no prompt change, and
 * costs no ElevenLabs credits. ElevenLabs serves previews as text/plain, which Kie rejects, so each
 * clip is re-hosted on R2 as audio/mpeg.
 */

import { db, schema } from "@/lib/db";
import { eq, notInArray } from "drizzle-orm";
import { getApiKey } from "@/lib/api-keys";
import { uploadToR2, toExternalUrl } from "@/lib/r2";

type ElevenLabsVoice = {
  voice_id: string;
  name: string;
  preview_url?: string | null;
  labels?: Record<string, string | undefined>;
};

export type VoiceOption = {
  voiceId: string;
  name: string;
  gender: string | null;
  age: string | null;
  accent: string | null;
  description: string | null;
  previewUrl: string;
};

const VOICE_PREFIX = `brands/${process.env.BRAND_SLUG || "dynamic-gift"}/video-generation/voices`;

/** "en-australian", "Australian", "aussie" → "australian" so one filter matches them all. */
function normaliseAccent(raw: string | undefined, name: string): string | null {
  const text = `${raw ?? ""} ${name}`.toLowerCase();
  if (/austral|aussie/.test(text)) return "australian";
  const accent = (raw ?? "").toLowerCase().replace(/^en-/, "").trim();
  return accent || null;
}

function isMp3(buf: Buffer): boolean {
  // ID3 tag, or an MPEG audio frame sync.
  return buf.length > 1024 && ((buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0));
}

/**
 * Pull every voice in the ElevenLabs account, re-host its preview on R2, and upsert it.
 * Voices removed from the account are deactivated, not deleted (past videos reference them).
 */
export async function syncVoices(): Promise<{ synced: number; skipped: string[]; deactivated: number }> {
  const key = await getApiKey("ELEVENLABS_API_KEY");
  if (!key) throw new Error("Add the ElevenLabs API key in Settings → API Keys to load voices.");

  const res = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": key },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`ElevenLabs voices request failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const { voices = [] } = (await res.json()) as { voices?: ElevenLabsVoice[] };

  const skipped: string[] = [];
  const kept: string[] = [];

  async function syncOne(v: ElevenLabsVoice) {
    if (!v.preview_url) {
      skipped.push(`${v.name} (no preview)`);
      return;
    }
    try {
      const clip = await fetch(v.preview_url, { signal: AbortSignal.timeout(20_000) });
      const buf = Buffer.from(await clip.arrayBuffer());
      if (!clip.ok || !isMp3(buf)) {
        skipped.push(`${v.name} (preview not an mp3)`);
        return;
      }
      const previewUrl = await uploadToR2(`${VOICE_PREFIX}/${v.voice_id}.mp3`, buf, "audio/mpeg");
      const labels = v.labels ?? {};
      const row = {
        name: v.name.trim(),
        gender: labels.gender ?? null,
        age: labels.age?.replace(/_/g, " ") ?? null,
        accent: normaliseAccent(labels.accent, v.name),
        description: [labels.descriptive, labels.use_case?.replace(/_/g, " ")].filter(Boolean).join(" · ") || null,
        previewUrl,
        isActive: true,
        syncedAt: new Date(),
      };
      await db
        .insert(schema.videoVoices)
        .values({ voiceId: v.voice_id, ...row })
        .onConflictDoUpdate({ target: schema.videoVoices.voiceId, set: row });
      kept.push(v.voice_id);
    } catch (err) {
      skipped.push(`${v.name} (${err instanceof Error ? err.message : "failed"})`);
    }
  }

  // 6 at a time: ~60 voices finish well inside the route's 120 s instead of one by one.
  const queue = [...voices];
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      for (let v = queue.shift(); v; v = queue.shift()) await syncOne(v);
    })
  );

  // Deactivate only voices ElevenLabs no longer lists. One that failed to download this time keeps
  // its existing row, and an empty answer from ElevenLabs must never wipe the picker.
  let deactivated = 0;
  const listed = voices.filter((v) => v.preview_url).map((v) => v.voice_id);
  if (listed.length > 0) {
    const gone = await db
      .update(schema.videoVoices)
      .set({ isActive: false })
      .where(notInArray(schema.videoVoices.voiceId, listed))
      .returning({ id: schema.videoVoices.id });
    deactivated = gone.length;
  }
  return { synced: kept.length, skipped, deactivated };
}

export async function listVoices(): Promise<VoiceOption[]> {
  const rows = await db
    .select()
    .from(schema.videoVoices)
    .where(eq(schema.videoVoices.isActive, true))
    .orderBy(schema.videoVoices.name);
  return rows.map((r) => ({
    voiceId: r.voiceId,
    name: r.name,
    gender: r.gender,
    age: r.age,
    accent: r.accent,
    description: r.description,
    previewUrl: toExternalUrl(r.previewUrl),
  }));
}

/** The reference clip URL for a chosen voice, or null when it isn't an active voice. */
export async function getVoiceClipUrl(voiceId: string): Promise<string | null> {
  const [row] = await db
    .select({ previewUrl: schema.videoVoices.previewUrl, isActive: schema.videoVoices.isActive })
    .from(schema.videoVoices)
    .where(eq(schema.videoVoices.voiceId, voiceId))
    .limit(1);
  return row?.isActive ? toExternalUrl(row.previewUrl) : null;
}
