// Helpers for turning whatever a person pastes into a clean link and name.
// Store apps' Share buttons often paste "Product name https://…", so we pull the
// link out and keep the words as a starting title.

const LINK =
  /(?:https?:\/\/|www\.)[^\s<>"']+|\b(?:a\.co|amzn\.to|amzn\.com|bit\.ly|pin\.it)\/[^\s<>"']+/i;

const STORES: [RegExp, string][] = [
  [/(^|\.)(amazon\.[a-z.]+|amzn\.[a-z]+|a\.co)$/i, "Amazon"],
  [/(^|\.)target\.com$/i, "Target"],
  [/(^|\.)walmart\.com$/i, "Walmart"],
  [/(^|\.)bestbuy\.com$/i, "Best Buy"],
  [/(^|\.)etsy\.com$/i, "Etsy"],
  [/(^|\.)ebay\.com$/i, "eBay"],
  [/(^|\.)homedepot\.com$/i, "Home Depot"],
  [/(^|\.)lowes\.com$/i, "Lowe's"],
  [/(^|\.)kohls\.com$/i, "Kohl's"],
  [/(^|\.)costco\.com$/i, "Costco"],
  [/(^|\.)macys\.com$/i, "Macy's"],
];

export function storeName(url: string): string {
  try {
    const host = new URL(url).hostname;
    return STORES.find(([re]) => re.test(host))?.[1] ?? "";
  } catch {
    return "";
  }
}

export function parseShared(raw: string): { url: string; title: string } {
  const text = raw.replace(/\s+/g, " ").trim();
  const m = text.match(LINK);
  if (!m || m.index === undefined) return { url: "", title: cleanTitle(text) };
  let url = m[0].replace(/[.,;:!?)\]}]+$/, "");
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  const rest = `${text.slice(0, m.index)} ${text.slice(m.index + m[0].length)}`;
  return { url, title: cleanTitle(rest) };
}

const STORE_WORDS = "amazon(?:\\.com)?|target|walmart|best buy|etsy|ebay|costco|home depot|lowe'?s|kohl'?s|macy'?s";

function cleanTitle(s: string): string {
  const t = s
    .replace(/^\s*(hey[, ]*)?(check out (this|it)|check (this|it) out|look at this|i found this|take a look( at this)?)\b[^a-z0-9]*/i, "")
    .replace(/^\s*amazon\.com\s*:\s*/i, "")
    .replace(new RegExp(`\\b(on|at|from|via)\\s+(${STORE_WORDS})\\b[\\s:.!-]*$`, "i"), "")
    .replace(/[\s:|\-–—]+$/, "")
    .replace(/^[\s:|\-–—"“']+/, "")
    .replace(/["”']+$/, "")
    .trim();
  return /[a-z]{3}/i.test(t) ? t.slice(0, 300) : "";
}

// A normal Amazon search page for a gift idea. Opens Amazon itself; nothing is scraped.
export function amazonSearchUrl(query: string): string {
  return `https://www.amazon.com/s?k=${encodeURIComponent(query.replace(/\s+/g, " ").trim().slice(0, 150))}`;
}
