import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-opus-5-5";

type IdeaInput = {
  name: string;
  isKid: boolean;
  forSelf: boolean;
  profile: { sizes: string; favorites: string; dontBuy: string; about: string };
  items: { title: string; notes: string; price: string }[];
  ideas: string[];
  request: string;
};

export type Idea = { title: string; why: string; price: string; search: string };

const IDEAS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ideas"],
  properties: {
    ideas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "why", "price", "search"],
        properties: {
          title: { type: "string", description: "Short, specific gift name" },
          why: { type: "string", description: "One sentence on why it fits this person" },
          price: { type: "string", description: "Typical price range, e.g. '$25–40'" },
          search: { type: "string", description: "What to type into a store's search box to find it" },
        },
      },
    },
  },
};

const SNAP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "notes", "search"],
  properties: {
    title: { type: "string", description: "Product name, with brand and model if visible" },
    notes: { type: "string", description: "Helpful details a shopper would need: color, size, variant" },
    search: { type: "string", description: "What to type into a store's search box to find it" },
  },
};

async function ask(apiKey: string, content: Anthropic.Beta.BetaContentBlockParam[], schema: Record<string, unknown>, system: string) {
  const client = new Anthropic({ apiKey });
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema } },
    system,
    messages: [{ role: "user", content }],
  });
  if (response.stop_reason === "refusal") throw new Error("The assistant couldn't help with that one.");
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") throw new Error("No answer came back.");
  return JSON.parse(textBlock.text);
}

export async function suggestIdeas(apiKey: string, input: IdeaInput): Promise<{ ideas: Idea[] }> {
  const lines = [
    input.forSelf
      ? `I'm ${input.name} and I'm making my Christmas wish list. Suggest 8 things I might want to add.`
      : `Suggest 8 Christmas gift ideas for ${input.name}, a member of our family.`,
    input.isKid ? `${input.name} is a kid.` : "",
    input.profile.about && `About them: ${input.profile.about}`,
    input.profile.favorites && `Favorites and interests: ${input.profile.favorites}`,
    input.profile.sizes && `Sizes: ${input.profile.sizes}`,
    input.profile.dontBuy && `Please avoid: ${input.profile.dontBuy}`,
    input.items.length
      ? `Already on their wish list (don't repeat these, but use them as hints):\n${input.items
          .map((i) => `- ${i.title}${i.price ? ` (${i.price})` : ""}${i.notes ? ` — ${i.notes}` : ""}`)
          .join("\n")}`
      : "Their wish list is empty so far.",
    input.ideas.length ? `Family members already suggested (don't repeat):\n${input.ideas.map((t) => `- ${t}`).join("\n")}` : "",
    input.request && `Extra request from the shopper: ${input.request}`,
  ];
  return ask(
    apiKey,
    [{ type: "text", text: lines.filter(Boolean).join("\n\n") }],
    IDEAS_SCHEMA,
    "You help a family pick thoughtful Christmas gifts. Suggest specific, currently available products " +
      "(brand and model where it helps) in a mix of price points, and keep each 'why' to one warm, plain sentence. " +
      "Never invent links.",
  );
}

export async function identifyPhoto(apiKey: string, mediaType: "image/jpeg", data: string): Promise<{ title: string; notes: string; search: string }> {
  return ask(
    apiKey,
    [
      { type: "image", source: { type: "base64", media_type: mediaType, data } },
      { type: "text", text: "Someone took this photo of something they'd like as a gift. What is it?" },
    ],
    SNAP_SCHEMA,
    "You identify products in photos for a family wish-list app. Name the product as specifically as the photo allows. " +
      "If you can't tell the exact model, describe it plainly.",
  );
}

const SHOT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["is_product_page", "title", "price", "notes", "store", "photo_found", "left", "top", "right", "bottom"],
  properties: {
    is_product_page: { type: "boolean", description: "True only if this is a screenshot of one product in a store or app" },
    title: { type: "string", description: "Product name as the page shows it. Shorten very long titles to brand, product and key details" },
    price: { type: "string", description: "The current price shown for this product, like $24.99. Empty if no price is visible" },
    notes: { type: "string", description: "Selected color, size or variant if shown. Empty if none" },
    store: { type: "string", description: "Store name if visible, such as Amazon or Target. Empty if unknown" },
    photo_found: { type: "boolean", description: "True if the main product photo is clearly visible" },
    left: { type: "number", description: "Left edge of the main product photo, 0 to 1, as a fraction of the image width" },
    top: { type: "number", description: "Top edge of the main product photo, 0 to 1, as a fraction of the image height" },
    right: { type: "number", description: "Right edge of the main product photo, 0 to 1" },
    bottom: { type: "number", description: "Bottom edge of the main product photo, 0 to 1" },
  },
};

export type Screenshot = {
  is_product_page: boolean;
  title: string;
  price: string;
  notes: string;
  store: string;
  photo_found: boolean;
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export async function identifyScreenshot(apiKey: string, mediaType: "image/jpeg", data: string): Promise<Screenshot> {
  return ask(
    apiKey,
    [
      { type: "image", source: { type: "base64", media_type: mediaType, data } },
      { type: "text", text: "Someone took this screenshot of a product in a store page or app because they want it as a gift. Read it." },
    ],
    SHOT_SCHEMA,
    "You read screenshots of store product pages for a family wish-list app. Copy the product name, current price, and selected color or size " +
      "exactly as shown. Never guess a price or invent details that are not visible. For the photo box, outline only the large main product picture: " +
      "not small thumbnails, ads, banners, or other products. Measure the box from the top-left corner of the whole image.",
  );
}
