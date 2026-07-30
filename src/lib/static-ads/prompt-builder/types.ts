/**
 * Static-Ad Prompt Builder — shared types.
 *
 * This pipeline runs at CONFIG-BUILD time (not at ad-generation runtime) to
 * produce the two per-brand system prompts that get written into
 * `clientStaticAdConfig` (agent1Prompt + agent2Prompt), replacing the
 * placeholders seeded at provisioning. It automates the manual brand-strategist
 * process: Brand DNA research → vibe pass → product/service study →
 * reference-ad calibration → author Agent 1 → author Agent 2 → QC.
 *
 * The runtime consumer (`custom-pipeline.ts`) imposes a hard output contract
 * the generated prompts MUST satisfy — see `contract.ts`:
 *   - Agent 1 output is JSON.parse()'d (must be pure JSON).
 *   - Agent 2 output is split on the last "\n{" into prompt + metadata JSON.
 */

export type BrandType = "products" | "services";

/** A single product or service, studied into one tight descriptive paragraph. */
export type ItemStudy = {
  name: string;
  sourceUrl?: string | null;
  imageUrl?: string | null;
  /** One dense paragraph of physical (product) or experiential (service) intricacies. */
  paragraph: string;
};

/** Output of Stage A — the Brand DNA research. */
export type BrandDNA = {
  /** Full BRAND DNA DOCUMENT prose (overview, visual system, photography, etc.). */
  document: string;
  /**
   * The verbatim 50–75 word "IMAGE GENERATION PROMPT MODIFIER" paragraph
   * ("Shoot in the [Brand] visual language: … #hex …"). Injected verbatim into
   * Agent 2 — never paraphrased.
   */
  modifierParagraph: string;
  /** Hex colours discovered ON THE LIVE BRAND, dominant first (research source of truth). */
  hexPalette: string[];
  fonts: { heading?: string | null; body?: string | null };
  /** 2–3 direct competitors with a one-line visual-differentiation note each. */
  competitors: string[];
  /** Specific reusable proof points / stats / trust claims found (e.g. "55,000+ creators", "4.91★"). */
  proofPoints: string[];
  /** Source URLs / citations gathered during research. */
  sources: string[];
  /** True when the live-researched palette materially disagreed with the DB brandColor seed. */
  paletteFromResearch?: boolean;
};

/** Output of Stage B — the emotional / vibe pass. */
export type VibeProfile = {
  /** One detailed paragraph: how the brand should make you feel / what vibe it gives off. */
  vibeParagraph: string;
  emotionalKeywords: string[];
};

/** Output of Stage D — reference-ad calibration. */
export type RefCalib = {
  /** The reference ad analysed via the Agent 1 master template (must be valid JSON). */
  referenceAnalysis: string;
  /** Notes on the desired succinct output style (the "good output" calibration). */
  goodOutputNotes: string;
};

/** Everything the pipeline assembles before authoring the two prompts. */
export type BuildContext = {
  brandName: string;
  website?: string | null;
  brandType: BrandType;
  vertical?: string | null;
  /** Primary brand colour hex from the client record. */
  brandColor?: string | null;
  /** Logo URL (passed through to clientStaticAdConfig.brandLogoUrl, used as a vision input). */
  logoUrl?: string | null;
  /** Optional reference-ad inspiration image URLs supplied at onboarding. */
  referenceUrls: string[];
  /** Pre-existing brand guidelines from clients.settings.brandGuidelines (authoritative when filled). */
  guidelines?: {
    colors?: {
      primary?: string;
      secondary?: string;
      accent?: string;
      text?: string;
      background?: string;
      palette?: string[];
      gradient?: string[];
      success?: string;
      danger?: string;
      warning?: string;
    };
    fonts?: { heading?: string; body?: string; scale?: string };
    tone?: { keywords?: string[]; notes?: string; dos?: string[]; donts?: string[] };
    components?: string;
  } | null;
  /** Brand-intelligence the agency already wrote (clientBrandIntelligence + USPs) — grounds research + voice. */
  brandIntel?: {
    identity?: string | null;
    audience?: string | null;
    usps?: string | null;
    voice?: string | null;
    constraints?: string | null;
  } | null;
  /** Products (for product brands) or service descriptors (for service brands). */
  items: Array<{ name: string; imageUrl?: string | null; sourceUrl?: string | null; benefits?: string | null }>;
};

/** Verdict from the QC critic (Stage G). */
export type CriticReport = {
  agent1: { passes: boolean; issues: string[] };
  agent2: { passes: boolean; issues: string[] };
  overallVerdict: "accept" | "revise";
};

/** Final result of a full build run. */
export type BuildResult = {
  agent1Prompt: string;
  agent2Prompt: string;
  brandDna: BrandDNA;
  vibe: VibeProfile;
  items: ItemStudy[];
  criticReport: CriticReport;
};

/** Stage identifiers, advanced one-at-a-time by the runner. */
export const STAGES = [
  "research", // A — Brand DNA
  "vibe", // B
  "study", // C — product/service study
  "author1", // D — Agent 1 (deterministic slot-fill)
  "author2", // E — Agent 2 (deterministic slot-fill)
  "critique", // F — QC + live contract test
  "publish", // final — write to clientStaticAdConfig + flip flag
] as const;

export type Stage = (typeof STAGES)[number];
