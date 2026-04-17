export type CompetitorAd = {
  id: number;
  adArchiveId: string;
  adGroupId: string;
  collationId: string | null;
  competitorPageId: string;
  brandPageName: string;
  snapshotId: string;
  snapshotLabel: string;
  snapshotDate: string;
  adStartDate: string;
  metaSortRank: number;
  mediaType: "Video" | "Image" | "Carousel" | "Text";
  isDco: boolean;
  primaryThumbnail: string | null;
  fullMediaAsset: string | null;
  displayPrimaryText: string | null;
  headlineTitle: string | null;
  ctaButtonType: string | null;
  destinationUrl: string | null;
  displayDomain: string | null;
  adLibraryUrl: string | null;
  publisherPlatforms: string[] | null;
  platformsDisplay: string | null;
  dedupCount: number;
  creativeAngle: string | null;
  adDescription: string | null;
  targetPersona: string | null;
  coreMotivation: string | null;
  proofMechanism: string | null;
  visualHook: string | null;
  spokenHook: string | null;
  outroOffer: string | null;
  fullTranscript: string | null;
  aiAnalysisStatus: string;
  aiErrorMessage: string | null;
  aiLastAnalyzedAt: string;
  createdAt: string;
};

export type Snapshot = {
  snapshotId: string;
  snapshotLabel: string;
  competitorPageId?: string;
  brandPageName?: string;
};

export type ParsedMedia =
  | { type: "video"; video_hd_url: string; video_sd_url: string; thumbnail: string }
  | { type: "image"; url: string }
  | {
      type: "carousel";
      cards: Array<{
        video_hd_url: string | null;
        video_sd_url: string | null;
        thumbnail: string | null;
        image_url: string | null;
        title: string | null;
        body: string | null;
        link_url: string | null;
        cta_text: string | null;
        creative_angle: string | null;
        ad_description: string | null;
        target_persona: string | null;
        core_motivation: string | null;
        proof_mechanism: string | null;
        visual_hook: string | null;
        spoken_hook: string | null;
        outro_offer: string | null;
        full_transcript: string | null;
      }>;
    }
  | null;
