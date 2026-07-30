import { db, schema } from "@/lib/db";
import { uploadToR2 } from "@/lib/r2";
import { slugify } from "@/lib/utils";
import { getAppConfig } from "@/lib/config";
import { buildPlaceholderStaticAdConfig } from "@/lib/static-ads/placeholder-prompts";
import type { Client } from "@/lib/types";

// Default brand intelligence sections seeded for every new client
const DEFAULT_BRAND_INTEL_SECTIONS = [
  { title: "Core Identity & Mission", sectionType: "identity", sortOrder: 0 },
  { title: "Target Customer Profile", sectionType: "audience", sortOrder: 1 },
  { title: "Key Products & Services", sectionType: "products", sortOrder: 2 },
  { title: "Unique Selling Propositions", sectionType: "usps", sortOrder: 3 },
  { title: "Brand Voice & Tone", sectionType: "voice", sortOrder: 4 },
  { title: "Visual Direction", sectionType: "visual", sortOrder: 5 },
  { title: "Competitor Landscape", sectionType: "competitors", sortOrder: 6 },
  { title: "Creative Constraints & Guardrails", sectionType: "constraints", sortOrder: 7 },
];

// R2 storage folders to provision for each new client
const STORAGE_FOLDERS = [
  "uploads",
  "generated-ads",
  "videos",
  "scraped",
  "brand-assets",
];

type ProvisionClientInput = {
  clientName: string;
  clientSlug?: string;
  website?: string;
  category?: string;
  primaryMarket?: string;
  currency?: string;
  cluster?: string;
  logoUrl?: string;
  brandColor?: string;
  monthlyAdSpend?: number;
  notes?: string;
};

/**
 * Provisions a new client with all required infrastructure:
 * 1. Creates client record in database
 * 2. Seeds default brand intelligence sections
 * 3. Seeds working placeholder static-ad prompts
 * 4. Provisions R2 storage namespace
 * 5. Logs provisioning activity
 */
export async function provisionClient(
  input: ProvisionClientInput,
  userId?: string
): Promise<Client> {
  const config = await getAppConfig();
  const agencySlug = slugify(config?.brandName || "portal");
  const clientSlug = input.clientSlug || slugify(input.clientName);
  const storagePrefix = `brands/${agencySlug}/${clientSlug}`;

  // 1. Create client record
  const [client] = await db
    .insert(schema.clients)
    .values({
      brandName: input.clientName,
      clientSlug: clientSlug,
      website: input.website || null,
      category: input.category || null,
      primaryMarket: input.primaryMarket || null,
      currency: input.currency || null,
      cluster: input.cluster || null,
      logoUrl: input.logoUrl || null,
      brandColor: input.brandColor || null,
      monthlyAdSpend: input.monthlyAdSpend || null,
      status: "Active",
      storagePrefix,
      // Marks the prompts seeded below as generic. The Static-Ad Prompt Builder
      // flips this to false once brand-specific prompts are published.
      settings: { staticAdPromptsArePlaceholder: true },
      notes: input.notes || null,
      provisionedAt: new Date(),
    })
    .returning();

  // 2. Seed default brand intelligence sections
  await db.insert(schema.clientBrandIntelligence).values(
    DEFAULT_BRAND_INTEL_SECTIONS.map((section) => ({
      clientId: client.id,
      title: section.title,
      content: null,
      sectionType: section.sectionType,
      sortOrder: section.sortOrder,
    }))
  );

  // 3. Seed placeholder static-ad prompts.
  //
  // agent1_prompt / agent2_prompt are NOT NULL, so without this a brand has no
  // config row at all and the Static Ad System hard-fails for it — which is
  // exactly what happened to The Cap Company when the client added it by hand.
  // These placeholders are brand-neutral but runtime-valid: the brand can
  // generate on day one, and the Prompt Builder replaces them with researched,
  // brand-specific prompts once an admin reviews and publishes a build.
  try {
    const placeholder = buildPlaceholderStaticAdConfig({
      brandName: client.brandName,
      website: client.website,
      brandColor: client.brandColor,
    });
    await db
      .insert(schema.clientStaticAdConfig)
      .values({
        clientId: client.id,
        agent1Prompt: placeholder.agent1Prompt,
        agent2Prompt: placeholder.agent2Prompt,
        brandLogoUrl: client.logoUrl,
      })
      // Never clobber prompts a brand already has — re-provisioning an existing
      // brand must not overwrite published, brand-specific prompts.
      .onConflictDoNothing({ target: schema.clientStaticAdConfig.clientId });
  } catch (err) {
    console.warn("[client-provisioning] placeholder static-ad prompts failed:", err);
  }

  // 4. Provision R2 storage namespace (marker files)
  try {
    await Promise.all(
      STORAGE_FOLDERS.map((folder) =>
        uploadToR2(
          `${storagePrefix}/${folder}/.keep`,
          Buffer.from(""),
          "application/octet-stream"
        )
      )
    );
  } catch (err) {
    // R2 provisioning is non-critical — log but don't fail
    console.warn("[client-provisioning] R2 namespace creation failed:", err);
  }

  // 5. Log provisioning
  await db.insert(schema.activityLog).values({
    userId: userId ? (userId as unknown as undefined) : undefined, // handle uuid type
    clientId: client.id,
    action: "client_provisioned",
    resourceType: "client",
    resourceId: client.id,
    details: {
      clientName: client.brandName,
      clientSlug: client.clientSlug,
      storagePrefix,
      sectionsSeeded: DEFAULT_BRAND_INTEL_SECTIONS.length,
      storageFoldersCreated: STORAGE_FOLDERS.length,
    },
  });

  return client as unknown as Client;
}
