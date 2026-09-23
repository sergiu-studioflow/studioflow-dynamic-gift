// Options for a brand's descriptive fields — shared by Add Client and the Overview editor.
//
// These are not just labels on the Clients page: `category` and `primaryMarket` are read
// by the Quality Control grader ("a {category} brand … the target market is {market}")
// and `category` is the brand's vertical in the Static-Ad Prompt Builder.

// The category becomes the brand's vertical in the Static-Ad Prompt Builder, so the
// options describe Dynamic Gift's promotional-products brands, not DTC verticals.
export const CATEGORIES = [
  "Promotional Products", "Custom Apparel & Headwear", "Lanyards & Badges",
  "Event Displays & Signage", "Inflatables", "Awards & Medals", "Corporate Gifting", "Other",
];

export const MARKETS = [
  "Australia", "United States", "United Kingdom", "Canada", "Europe",
  "Global", "APAC", "MENA", "LATAM", "Other",
];

export const CURRENCIES = ["AUD", "USD", "GBP", "EUR", "CAD", "NZD"];

export const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** The brand fields an admin may edit after creation. Everything else (slug, storage
 *  prefix, provisioning, review settings) is set by the system and stays out of reach. */
export const EDITABLE_CLIENT_FIELDS = [
  "website",
  "category",
  "primaryMarket",
  "currency",
  "cluster",
  "brandColor",
  "notes",
] as const;

export type EditableClientField = (typeof EDITABLE_CLIENT_FIELDS)[number];
