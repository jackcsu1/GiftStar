// Best-effort product details from a store link: title, photo, price.
// Many big stores block automated requests, so every field is optional and the
// app always lets people type details or upload a photo themselves.

// `found` is true only when we read real details from the store's page.
// When it is false, `title` (if any) is just a guess from the link.
export type Unfurled = { url: string; title: string; image: string; price: string; images: string[]; found: boolean };

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";

export async function unfurl(url: string): Promise<Unfurled> {
  const out: Unfurled = { url: cleanUrl(url), title: "", image: "", price: "", images: [], found: false };
  let html = "";
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });
    out.url = cleanUrl(res.url || url);
    if (res.ok && (res.headers.get("Content-Type") || "").includes("html")) {
      html = (await res.text()).slice(0, 2_000_000);
    }
  } catch {
    // fall through to whatever we can learn from the URL itself
  }

  if (html && !looksBlocked(html)) {
    const product = jsonLdProduct(html);
    const meta = (name: string) => metaContent(html, name);

    out.title =
      product.title ||
      meta("og:title") ||
      meta("twitter:title") ||
      match(html, /id="productTitle"[^>]*>([\s\S]*?)</) ||
      match(html, /<title[^>]*>([\s\S]*?)<\/title>/i);

    const images = [
      ...product.images,
      meta("og:image:secure_url"),
      meta("og:image"),
      meta("twitter:image"),
      match(html, /"hiRes":"(https:[^"]+)"/),
      match(html, /data-old-hires="(https:[^"]+)"/),
      match(html, /"large":"(https:[^"]+)"/),
    ]
      .filter(Boolean)
      .map((src) => absolute(decode(src), out.url))
      .filter((src): src is string => !!src);
    out.images = [...new Set(images)].slice(0, 8);
    out.image = out.images[0] || "";

    out.price =
      product.price ||
      formatPrice(meta("product:price:amount") || meta("og:price:amount"), meta("product:price:currency") || meta("og:price:currency")) ||
      match(html, /class="a-offscreen">\s*(\$[\d,]+\.?\d*)\s*</);
    out.found = !!(clean(out.title) || out.image);
  } else {
    out.title = "";
  }

  if (!out.title) out.title = titleFromUrl(out.url);
  out.title = clean(out.title).slice(0, 300);
  return out;
}

function jsonLdProduct(html: string) {
  const found = { title: "", images: [] as string[], price: "" };
  const blocks = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const [, raw] of blocks) {
    let data: unknown;
    try {
      data = JSON.parse(raw.trim());
    } catch {
      continue;
    }
    for (const node of flatten(data)) {
      const type = node["@type"];
      const isProduct = type === "Product" || (Array.isArray(type) && type.includes("Product")) || type === "ProductGroup";
      if (!isProduct) continue;
      if (!found.title && typeof node.name === "string") found.title = node.name;
      found.images.push(...imageList(node.image));
      if (!found.price) {
        const offers = flatten(node.offers ?? []);
        for (const offer of offers) {
          const amount = offer.price ?? offer.lowPrice;
          if (amount !== undefined && amount !== null && amount !== "") {
            found.price = formatPrice(String(amount), String(offer.priceCurrency ?? "USD"));
            break;
          }
        }
      }
    }
  }
  return found;
}

type Node = Record<string, unknown>;

function flatten(data: unknown): Node[] {
  if (Array.isArray(data)) return data.flatMap(flatten);
  if (data && typeof data === "object") {
    const node = data as Node;
    const graph = node["@graph"];
    return [node, ...(Array.isArray(graph) ? graph.flatMap(flatten) : [])];
  }
  return [];
}

function imageList(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(imageList);
  if (v && typeof v === "object" && typeof (v as Node).url === "string") return [(v as Node).url as string];
  return [];
}

function metaContent(html: string, name: string) {
  const esc = name.replace(/[.:]/g, "\\$&");
  return decode(
    match(html, new RegExp(`<meta[^>]+(?:property|name)=["']${esc}["'][^>]*content=["']([^"']*)["']`, "i")) ||
      match(html, new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${esc}["']`, "i")),
  );
}

function match(html: string, re: RegExp) {
  return html.match(re)?.[1]?.trim() ?? "";
}

function formatPrice(amount: string, currency = "USD") {
  const n = Number(String(amount).replace(/[^0-9.]/g, ""));
  if (!amount || !Number.isFinite(n) || n <= 0) return "";
  const symbol = currency === "USD" || !currency ? "$" : `${currency} `;
  return `${symbol}${n.toFixed(2).replace(/\.00$/, "")}`;
}

function absolute(src: string, base: string) {
  try {
    const u = new URL(src, base);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

// e.g. amazon.com/LEGO-Classic-Creative-Bricks-10696/dp/B00NHQFA1I -> "LEGO Classic Creative Bricks 10696"
function titleFromUrl(url: string) {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const slug = parts
      .filter((p) => /[a-z].*-.*[a-z]/i.test(p) && !/^(dp|gp|product|products|p|ip|item)$/i.test(p))
      .sort((a, b) => b.length - a.length)[0];
    return slug ? decodeURIComponent(slug).replace(/\.html?$/, "").replace(/[-_]+/g, " ") : "";
  } catch {
    return "";
  }
}

function decode(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
}

function clean(s: string) {
  return decode(s)
    .replace(/\s+/g, " ")
    .replace(/\s*[|:-]\s*(Amazon\.com|Target|Walmart\.com|Etsy|Best Buy)\s*$/i, "")
    .replace(/^Amazon\.com\s*:\s*/i, "")
    .trim();
}

// Stores sometimes answer "200 OK" with a robot-check page instead of the product.
const BLOCKED_TITLE =
  /robot check|access denied|just a moment|attention required|are you a (human|robot)|captcha|pardon our interruption|verify you are|request blocked|security check|too many requests|service unavailable/i;

function looksBlocked(html: string) {
  const title = match(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  if (BLOCKED_TITLE.test(title)) return true;
  return html.length < 5000 && /captcha|automated access|unusual traffic/i.test(html);
}

// Remove tracking junk so saved links are short and tidy. Amazon links shrink to /dp/<code>.
const TRACKING =
  /^(utm_.*|fbclid|gclid|msclkid|igshid|mc_cid|mc_eid|srsltid|irclickid|affid|clickid|ref|ref_|tag|linkcode|linkid|pd_rd_.*|pf_rd_.*|cv_ct_.*)$/i;

function cleanUrl(raw: string) {
  try {
    const u = new URL(raw);
    if (/(^|\.)amazon\.[a-z.]+$/i.test(u.hostname)) {
      const m = u.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i);
      if (m) return `https://${u.hostname}/dp/${m[1].toUpperCase()}`;
    }
    for (const key of [...u.searchParams.keys()]) if (TRACKING.test(key)) u.searchParams.delete(key);
    return u.toString();
  } catch {
    return raw;
  }
}
