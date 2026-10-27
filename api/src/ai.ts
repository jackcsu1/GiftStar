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
