/**
 * Edit pipeline — 3 Claude agents for text extraction and editing:
 * Agent 1: Extract all text elements from an ad image (Vision)
 * Agent 2: Format extraction into human-friendly editable list
 * Agent 3: Generate structured edit command from user changes
 * + buildEditPrompt: Convert edit command to Kie AI prose prompt
 */

import { callClaude, imageUrlToBase64Block } from "./anthropic";

// ═══════════════════════════════════════════════
// AGENT 1 — TEXT EXTRACTION (Vision)
// ═══════════════════════════════════════════════

const AGENT_1_EXTRACT = `You are a precise visual text extraction agent.
You receive a generated advertisement image as
input. Your sole job is to locate, read, and
map every single piece of visible text in the
image with enough precision that a downstream
text-editing tool can find each element,
replace its content, and leave everything else
in the image completely untouched.




You output a structured JSON object only.
No prose. No explanation. Raw JSON.




═══════════════════════════════════════════════
WHAT YOU MUST FIND AND DESCRIBE
═══════════════════════════════════════════════




Find every text element visible in the image.
This includes but is not limited to:




- Hero headlines
- Subheads
- Body copy
- Category tabs or editorial pill labels
- Badge copy (pill badges, scalloped badges,
  award seals, urgency badges)
- Speech bubble text
- Callout text with leader lines
- Checklist items (✓ or ✗ rows)
- Stat labels and numbers
- Pull quotes
- Review text
- Reviewer attribution
- Caption text
- Logo wordmark text
- Product label text
- Website URL text
- Footnote or disclaimer text
- Any other visible text regardless of size




For each text element you find, capture:




CONTENT
The exact text as it appears in the image,
including punctuation, line breaks, and
capitalisation exactly as rendered.
If a line break is present within the element,
represent it with \\n in the string.




LOCATION
Describe the position using two systems
simultaneously:




1. Zone label — a human-readable description
   of where it sits:
   top-left / top-center / top-right /
   upper-left / upper-center / upper-right /
   center-left / center / center-right /
   lower-left / lower-center / lower-right /
   bottom-left / bottom-center / bottom-right /
   overlapping-product / inside-badge /
   inside-bubble / inside-panel-[1/2/3] /
   on-product-label / floating-left /
   floating-right




2. Percentage coordinates — approximate
   position of the text element's top-left
   corner as a percentage of total frame
   width (x) and frame height (y), and the
   approximate width and height of the
   bounding box as a percentage of frame
   dimensions.
   Example: x: 5, y: 8, width: 45, height: 6
   means the element starts 5% from the left
   edge, 8% from the top, spans 45% of frame
   width and 6% of frame height.




TYPOGRAPHY
- font_style: serif / sans-serif / monospace /
  script / unknown
- font_weight: thin / light / regular / medium /
  semibold / bold / heavy / black
- font_size_relative: tiny / small / medium /
  large / xlarge / display
  (tiny = footnote scale, display =
  headline filling significant frame portion)
- letter_spacing: tight / normal / wide /
  very-wide
- line_height: tight / normal / loose
- case: lowercase / uppercase / sentence /
  title / mixed
- italic: true / false
- colour: describe as precisely as possible,
  include hex estimate if determinable
- alignment: left / center / right / justified




CONTAINER
Is this text inside a containing element?
- container_type: none / pill-badge /
  scalloped-badge / rounded-rectangle /
  speech-bubble / circle / box /
  on-product-label / photo-panel / other
- container_colour: if applicable, describe
  with hex estimate
- container_has_border: true / false
- container_border_colour: if applicable




RELATIONSHIP
- is_this_the_intended_copy: true / false /
  uncertain
  (true = this is a headline, subhead, or
  callout that the client would want to edit.
  false = this is product label text, logo
  wordmark, or brand asset text that should
  not be edited.
  uncertain = ambiguous, flag for human review)
- edit_priority: high / medium / low / do-not-edit
  (high = main copy the client cares about.
  medium = supporting copy like callouts
  or badge text.
  low = small supporting text like URLs
  or footnotes.
  do-not-edit = product label text, logo text,
  brand asset text — touching this would
  break the brand identity)




═══════════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════════




{
  "image_dimensions_estimate": {
    "aspect_ratio": "",
    "orientation": "portrait / landscape / square"
  },
  "total_text_elements_found": 0,
  "text_elements": [
    {
      "id": "text_01",
      "content": "",
      "location": {
        "zone_label": "",
        "x_percent": 0,
        "y_percent": 0,
        "width_percent": 0,
        "height_percent": 0
      },
      "typography": {
        "font_style": "",
        "font_weight": "",
        "font_size_relative": "",
        "letter_spacing": "",
        "line_height": "",
        "case": "",
        "italic": false,
        "colour": "",
        "colour_hex_estimate": "",
        "alignment": ""
      },
      "container": {
        "container_type": "",
        "container_colour": "",
        "container_has_border": false,
        "container_border_colour": ""
      },
      "relationship": {
        "is_intended_copy": true,
        "edit_priority": "",
        "notes": ""
      }
    }
  ],
  "edit_summary": {
    "high_priority_elements": [],
    "medium_priority_elements": [],
    "do_not_edit_elements": [],
    "flagged_for_review": []
  }
}`;

// ═══════════════════════════════════════════════
// AGENT 2 — HUMAN-FRIENDLY FORMATTER
// ═══════════════════════════════════════════════

const AGENT_2_FORMAT = `You receive a JSON object from a text extraction
analysis of an advertisement image. This JSON
contains detailed technical data about every
text element found in the image.


Your job is to convert this into a clean, simple,
plain English list that a non-technical client
can read in seconds and immediately understand.
Nothing technical. Nothing about coordinates,
hex values, font weights, or bounding boxes.
Just the name of each text element and what
it currently says.


Output only the list. No introduction.
No explanation. No JSON. No technical language.
No preamble. Start immediately with the first item.


Format every item exactly like this:


[Element Name]: "[Exact text as it appears]"


Group them in this order:
1. High priority edit elements first
2. Medium priority edit elements second
3. Do not edit elements last, under a
   clear separator


Use these plain English names for element types:


hero headline        → Main Headline
subhead              → Subheading
contrast statement 1 → First Statement
contrast statement 2 → Second Statement
category tab         → Category Label
pill badge           → Badge
speech bubble        → Callout Bubble [1, 2, 3...]
callout text         → Callout [1, 2, 3...]
checklist item       → Checklist Item [1, 2, 3...]
stat label           → Stat [1, 2, 3...]
pull quote           → Pull Quote
review text          → Review Body
reviewer attribution → Reviewer Name
caption              → Caption
footnote             → Footnote
website url          → Website
panel word           → Panel Word [1, 2, 3...]


After the list, add one blank line then output
this single line:


"To change a line, tell me which one and what
you want it to say."


Nothing else.`;

// ═══════════════════════════════════════════════
// AGENT 3 — EDIT COMMAND GENERATOR
// ═══════════════════════════════════════════════

const AGENT_3_EDIT = `You receive two inputs:
1. text_map — the full JSON output from the text extraction agent
   containing the technical data for every text
   element in the image
2. edit_request — plain English from the client
   describing which lines they want to change
   and what they want them to say




Your job is to match the client's plain English
edit request against the technical text map,
find the correct element IDs, and output a
clean JSON edit command that a text editing
tool can execute immediately.




You are a translation layer. The client speaks
plain English. The editing tool speaks JSON.
You convert one into the other precisely.




═══════════════════════════════════════════════
HOW TO MATCH THE CLIENT'S REQUEST TO THE MAP
═══════════════════════════════════════════════




The client will refer to elements using the
plain English names:




"Main Headline"        → match to element
                         where edit_priority
                         is "high" and
                         font_size_relative
                         is "display" or "xlarge"




"First Statement"      → match to first
                         high-priority element
                         in upper zone




"Second Statement"     → match to second
                         high-priority element
                         in lower zone




"Category Label"       → match to element
                         with container_type
                         "pill-badge" or
                         edit_priority "medium"
                         in top zone




"Badge"                → match to element
                         with container_type
                         "pill-badge" or
                         "scalloped-badge"




"Callout Bubble [N]"   → match to element
                         with container_type
                         "speech-bubble"
                         in order of
                         y_percent ascending




"Callout [N]"          → match to floating
                         callout text elements
                         in order of
                         y_percent ascending




"Checklist Item [N]"   → match to checklist
                         elements in order of
                         y_percent ascending




"Stat [N]"             → match to stat
                         elements in order of
                         x_percent ascending




"Pull Quote"           → match to element
                         with largest
                         font_size_relative
                         in upper zone with
                         italic: true




"Review Body"          → match to longest
                         text content element
                         inside a card container




"Reviewer Name"        → match to short element
                         directly below
                         review body




"Panel Word [N]"       → match to single-word
                         elements overlapping
                         panel containers in
                         order of y_percent
                         ascending




"Subheading"           → match to high-priority
                         element with
                         font_size_relative
                         "medium" or "small"
                         directly below
                         main headline




"Caption"              → match to element
                         with edit_priority
                         "low" and
                         font_size_relative
                         "small" or "tiny"




"Footnote"             → match to element
                         with lowest y_percent
                         and font_size_relative
                         "tiny"




If the client refers to an element that does
not exist in the map, flag it in the
unmatched_requests array.




If the client tries to edit a do-not-edit
element (product label, logo, brand asset),
block it and add it to the blocked_requests
array with a plain English reason.




═══════════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════════




Output only valid JSON. No prose. No markdown.
Raw JSON only.




{
  "edit_command": {
    "total_edits_requested": 0,
    "total_edits_approved": 0,
    "edits": [
      {
        "edit_id": "edit_01",
        "element_id": "",
        "plain_english_name": "",
        "current_text": "",
        "replacement_text": "",
        "location": {
          "zone_label": "",
          "x_percent": 0,
          "y_percent": 0,
          "width_percent": 0,
          "height_percent": 0
        },
        "typography_preserve": {
          "font_style": "",
          "font_weight": "",
          "font_size_relative": "",
          "letter_spacing": "",
          "line_height": "",
          "case": "",
          "italic": false,
          "colour_hex": "",
          "alignment": ""
        },
        "container_preserve": {
          "container_type": "",
          "container_colour": "",
          "container_has_border": false,
          "container_border_colour": ""
        },
        "status": "approved"
      }
    ],
    "blocked_requests": [],
    "unmatched_requests": []
  }
}`;

// ═══════════════════════════════════════════════
// PIPELINE FUNCTIONS
// ═══════════════════════════════════════════════

export type TextElement = {
  name: string;
  currentText: string;
  editPriority: "high" | "medium" | "low" | "do-not-edit";
};

/**
 * Agent 1: Extract all text elements from an ad image.
 * Returns raw JSON string.
 */
export async function extractTextElements(imageUrl: string): Promise<string> {
  const imageBlock = await imageUrlToBase64Block(imageUrl);

  const result = await callClaude({
    system: AGENT_1_EXTRACT,
    messages: [
      {
        role: "user",
        content: [
          imageBlock,
          { type: "text", text: "Extract all text elements from this advertisement image." },
        ],
      },
    ],
    maxTokens: 16000,
    budgetTokens: 10000,
  });

  let text = result.text.trim();

  // Strip markdown fences if present
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?\s*```\s*$/, "").trim();
  }

  // Extract JSON object — find the outermost { ... }
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1);
  }

  // Validate JSON
  try {
    JSON.parse(text);
  } catch {
    throw new Error("Agent 1 did not return valid JSON: " + text.slice(0, 300));
  }

  return text;
}

/**
 * Agent 2: Convert technical extraction JSON to human-friendly editable list.
 * Returns parsed TextElement array.
 */
export async function formatForEditing(analysisJson: string): Promise<TextElement[]> {
  const result = await callClaude({
    system: AGENT_2_FORMAT,
    messages: [
      {
        role: "user",
        content: analysisJson,
      },
    ],
    maxTokens: 8000,
    budgetTokens: 4000,
  });

  const text = result.text.trim();

  // Parse the plain English output into structured array
  const elements: TextElement[] = [];
  let currentPriority: TextElement["editPriority"] = "high";

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Detect separator for "do not edit" section
    if (trimmed.includes("Do Not Edit") || trimmed.includes("do not edit") || trimmed.startsWith("───") || trimmed.startsWith("---")) {
      currentPriority = "do-not-edit";
      continue;
    }

    // Skip the closing instruction line
    if (trimmed.startsWith("To change a line") || trimmed.startsWith('"To change')) continue;

    // Parse "Element Name: "text content""
    const match = trimmed.match(/^(.+?):\s*"(.+)"$/);
    if (match) {
      const name = match[1].trim();
      const currentText = match[2].trim();

      // Determine priority from the analysis JSON if we haven't hit the separator
      let priority: TextElement["editPriority"] = currentPriority;
      if (currentPriority !== "do-not-edit") {
        const lowerName = name.toLowerCase();
        if (lowerName.includes("badge") || lowerName.includes("callout") || lowerName.includes("caption") || lowerName.includes("footnote") || lowerName.includes("website")) {
          priority = "medium";
        } else {
          priority = "high";
        }
      }

      elements.push({ name, currentText, editPriority: priority });
    }
  }

  return elements;
}

/**
 * Agent 3: Generate structured edit command from user's changes.
 * Returns raw JSON string.
 */
export async function generateEditCommand(
  analysisJson: string,
  edits: { name: string; newText: string }[]
): Promise<string> {
  // Build plain English edit request
  const editRequest = edits
    .map((e) => `Change the ${e.name} to: "${e.newText}"`)
    .join("\n");

  const result = await callClaude({
    system: AGENT_3_EDIT,
    messages: [
      {
        role: "user",
        content: `TEXT MAP (from extraction agent):
${analysisJson}

EDIT REQUEST (from client):
${editRequest}`,
      },
    ],
    maxTokens: 8000,
    budgetTokens: 6000,
  });

  let text = result.text.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  }

  try {
    JSON.parse(text);
  } catch {
    throw new Error("Agent 3 did not return valid JSON: " + text.slice(0, 300));
  }

  return text;
}

/**
 * Build a Kie AI prompt from the edit command JSON.
 * The prompt instructs Kie to reproduce the image with text changes only.
 */
export function buildEditPrompt(editCommandJson: string): string {
  let cmd: Record<string, any>;
  try {
    cmd = JSON.parse(editCommandJson);
  } catch {
    throw new Error("Invalid edit command JSON — could not parse Agent 5 output");
  }
  const edits = cmd.edit_command?.edits || [];

  if (edits.length === 0) {
    throw new Error("No approved edits in the edit command");
  }

  const textChanges = edits
    .filter((e: Record<string, unknown>) => e.status === "approved")
    .map((e: Record<string, unknown>) => {
      const loc = e.location as Record<string, unknown> || {};
      const typo = e.typography_preserve as Record<string, unknown> || {};
      const container = e.container_preserve as Record<string, unknown> || {};

      return `- At ${loc.zone_label || "unknown position"} (${loc.x_percent || 0}% x, ${loc.y_percent || 0}% y): Change "${e.current_text}" to "${e.replacement_text}". Preserve: ${typo.font_style || ""} ${typo.font_weight || ""} ${typo.colour_hex || ""} ${(typo.case as string) || ""} ${typo.alignment || ""}. ${container.container_type !== "none" ? `Inside ${container.container_type} (${container.container_colour || ""}).` : ""}`;
    })
    .join("\n");

  return `Reproduce the attached advertisement image exactly as it appears — same layout, same composition, same colors, same product placement, same lighting, same background, same supporting elements, same overall visual identity. The ONLY changes are to specific text elements listed below. Everything else in the image must remain identical.

TEXT CHANGES:
${textChanges}

CRITICAL INSTRUCTIONS:
- Only change the listed text elements above.
- Do not modify any other part of the image.
- Product, background, layout, lighting, unlisted text, and brand assets must remain exactly as shown.
- Preserve the exact typography style (font, weight, color, size, alignment) for each changed element.
- If text is inside a container (badge, bubble, box), keep the container identical — only change the words inside.
- Match the overall image quality, resolution, and style of the original exactly.`;
}
