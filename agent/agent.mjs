// GiftStar family computer.
//
// Amazon refuses lookups from servers, but a normal browser on a home internet
// connection can open a product page. This program runs on one home computer.
// It asks GiftStar for pending Amazon lookups, opens each page in Chrome, and
// sends the page back. GiftStar reads the name, price and picture from it.
//
// It is gentle on purpose: one page at a time, a pause between pages, an hourly
// cap, and a 10-minute rest if Amazon shows a check page. It never tries to get
// past a check page. In that case people just type the name or use a screenshot.

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
loadEnv(join(here, ".env"));

const API = (process.env.GIFTSTAR_API || "").replace(/\/$/, "");
const TOKEN = process.env.AGENT_TOKEN || "";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PROFILE = process.env.PROFILE_DIR || join(homedir(), ".giftstar-agent", "chrome-profile");
const SHOW = process.env.SHOW_BROWSER === "1";

const POLL_MS = 5_000;
const BETWEEN_LOOKUPS_MS = 2_000;
const BLOCKED_REST_MS = 10 * 60_000;
const MAX_PER_HOUR = 30;

// Same rule as the GiftStar server: only Amazon pages, only over https.
const AMAZON_HOST = /^(www\.)?amazon\.(com|ca|co\.uk|de|fr|it|es|nl|se|pl|com\.au|co\.jp|in|com\.mx|com\.br|sg|ae|sa)$/i;
const SHORT_HOST = /^(a\.co|amzn\.to|amzn\.com)$/i;

const isAmazonPage = (raw) => {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && AMAZON_HOST.test(u.hostname);
  } catch {
    return false;
  }
};
const mayOpen = (raw) => {
  try {
    const u = new URL(raw);
    return isAmazonPage(raw) || (u.protocol === "https:" && SHORT_HOST.test(u.hostname));
  } catch {
    return false;
  }
};
const looksBlocked = (html) =>
  /robot check|captcha|automated access|enter the characters you see/i.test((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "") ||
  /validateCaptcha|api-services-support@amazon\.com/i.test(html.slice(0, 20000));

function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const log = (msg) => console.log(`${new Date().toISOString()}  ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let context;
async function browser() {
  context ??= await chromium.launchPersistentContext(PROFILE, {
    executablePath: CHROME,
    headless: !SHOW,
    viewport: { width: 1280, height: 900 },
    locale: "en-US",
  });
  return context;
}

async function openPage(url) {
  if (!mayOpen(url)) return { finalUrl: "", html: "" };
  const page = await (await browser()).newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25_000 });
    await page.waitForSelector("#productTitle", { timeout: 8_000 }).catch(() => {});
    const finalUrl = page.url();
    if (!isAmazonPage(finalUrl)) return { finalUrl, html: "" }; // a short link that led somewhere else
    return { finalUrl, html: await page.content() };
  } finally {
    await page.close().catch(() => {});
  }
}

async function call(path, body = {}) {
  const res = await fetch(API + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Agent-Token": TOKEN },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${path} answered ${res.status}`);
  return res.json();
}

async function testOne(url) {
  const { finalUrl, html } = await openPage(url);
  const pick = (re) => ((html.match(re) || [])[1] || "").replace(/\s+/g, " ").trim();
  console.log("Page:   ", finalUrl || "(not opened)");
  console.log("Blocked:", looksBlocked(html) ? "YES, Amazon showed a check page" : "no");
  console.log("Name:   ", pick(/id="productTitle"[^>]*>([\s\S]*?)</) || "(not found)");
  console.log("Price:  ", pick(/priceToPay[\s\S]{0,600}?class="a-offscreen">\s*([^<]+)</) || "(not found)");
  console.log("Picture:", pick(/"hiRes":"(https:[^"]+)"/) || pick(/data-old-hires="(https:[^"]+)"/) || "(not found)");
  await context?.close();
}

async function main() {
  const testUrl = process.argv[2] === "--test" ? process.argv[3] : "";
  if (testUrl) return testOne(testUrl);
  if (!API || !TOKEN) {
    console.error("Missing GIFTSTAR_API or AGENT_TOKEN. Fill in agent/.env (see README).");
    process.exit(1);
  }
  log(`GiftStar family computer started. Talking to ${API}`);
  const recent = [];
  for (;;) {
    let wait = POLL_MS;
    try {
      const job = await call("/api/agent/claim");
      if (job.id) {
        while (recent.length && Date.now() - recent[0] > 3_600_000) recent.shift();
        let page = { finalUrl: "", html: "" };
        if (recent.length >= MAX_PER_HOUR) {
          log("Hourly limit reached. Skipping this lookup.");
        } else {
          recent.push(Date.now());
          log(`Looking up a page on ${new URL(job.url).hostname}`);
          try {
            page = await openPage(job.url);
          } catch (e) {
            log(`Could not open the page: ${e.message}`);
          }
        }
        const res = await call("/api/agent/result", { id: job.id, finalUrl: page.finalUrl, html: page.html });
        log(res.found ? "Sent back the product details." : "No product details this time.");
        wait = BETWEEN_LOOKUPS_MS;
        if (!res.found && looksBlocked(page.html)) {
          log("Amazon showed a check page. Resting for 10 minutes. Not trying to get past it.");
          wait = BLOCKED_REST_MS;
        }
      }
    } catch (e) {
      log(`Problem: ${e.message}. Trying again soon.`);
      wait = 15_000;
    }
    await sleep(wait);
  }
}

process.on("SIGTERM", async () => {
  await context?.close().catch(() => {});
  process.exit(0);
});

main();
