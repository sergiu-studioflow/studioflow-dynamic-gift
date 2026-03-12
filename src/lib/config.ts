import { db, schema } from "@/lib/db";
import type { AppConfig } from "@/lib/types";

let cachedConfig: AppConfig | null = null;
let lastFetched = 0;
const CACHE_TTL = 60_000; // 1 minute

export async function getAppConfig(): Promise<AppConfig | null> {
  const now = Date.now();
  if (cachedConfig && now - lastFetched < CACHE_TTL) {
    return cachedConfig;
  }

  const [row] = await db.select().from(schema.appConfig).limit(1);
  if (!row) return null;

  cachedConfig = {
    id: row.id,
    brandName: row.brandName,
    brandColor: row.brandColor,
    logoUrl: row.logoUrl,
    portalTitle: row.portalTitle,
    features: (row.features as Record<string, boolean>) || {},
    workflows: (row.workflows as Record<string, { webhook_path: string; n8n_base_url?: string }>) || {},
  };
  lastFetched = now;

  return cachedConfig;
}
