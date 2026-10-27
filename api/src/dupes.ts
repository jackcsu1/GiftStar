// Spotting when a family idea and someone's own wish are the same gift.

type Thing = { title: string; url: string };

function words(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Store links differ in tracking junk; compare host + path, and Amazon by product code.
function urlKey(url: string) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const asin = u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
    if (asin && host.includes("amazon.")) return `amazon:${asin[1].toUpperCase()}`;
    return `${host}${u.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return "";
  }
}

// Confident enough to merge without asking.
export function sameThing(a: Thing, b: Thing) {
  const ua = urlKey(a.url);
  if (ua && ua === urlKey(b.url)) return true;
  const ta = words(a.title);
  return !!ta && ta === words(b.title);
}

// Worth pointing out to shoppers, but a person should decide.
export function similarThing(a: Thing, b: Thing) {
  const sig = (t: string) => new Set(words(t).split(" ").filter((w) => w.length >= 3));
  const sa = sig(a.title);
  const sb = sig(b.title);
  if (!sa.size || !sb.size) return false;
  let shared = 0;
  for (const w of sa) if (sb.has(w)) shared++;
  return shared / Math.min(sa.size, sb.size) >= 0.6;
}
