import { Hono, type Context, type Next } from "hono";
import { cors } from "hono/cors";
import { unfurl } from "./unfurl";
import { suggestIdeas, identifyPhoto } from "./ai";
import { sameThing, similarThing } from "./dupes";

export type Env = {
  DB: D1Database;
  OCCASION: string;
  ALLOWED_ORIGINS: string;
  FAMILY_PASSCODE: string;
  ADMIN_PASSCODE: string;
  ANTHROPIC_API_KEY?: string;
};

type Person = {
  id: string;
  name: string;
  household: string;
  is_kid: number;
  sort: number;
  sizes: string;
  favorites: string;
  dont_buy: string;
  about: string;
  in_drawing: number;
};

type Vars = { me: Person; tokenHash: string };
type C = Context<{ Bindings: Env; Variables: Vars }>;

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

app.use("/api/*", (c, next) =>
  cors({
    origin: (origin) => (c.env.ALLOWED_ORIGINS.split(",").includes(origin) ? origin : null),
    allowHeaders: ["Content-Type", "Authorization", "X-Person", "X-Admin"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    maxAge: 86400,
  })(c, next),
);

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
  console.error(err);
  return c.json({ error: "Something went wrong. Please try again." }, 500);
});

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
const fail = (status: number, message: string): never => {
  throw new HttpError(status, message);
};

const now = () => Date.now();
const uid = () => crypto.randomUUID();

async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, (ch) => ({ "+": "-", "/": "_", "=": "" })[ch]!);
}

// Codes avoid look-alike characters so they are easy to read over the phone.
function inviteCode() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

function sameSecret(a: string | undefined, b: string | undefined) {
  if (!a || !b) return false;
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

const text = (v: unknown, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const int = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

async function body(c: C): Promise<Record<string, unknown>> {
  try {
    return await c.req.json();
  } catch {
    return {};
  }
}

const all = async <T = Record<string, unknown>>(db: D1Database, sql: string, ...args: unknown[]) =>
  (await db.prepare(sql).bind(...args).all<T>()).results;
const first = <T = Record<string, unknown>>(db: D1Database, sql: string, ...args: unknown[]) =>
  db.prepare(sql).bind(...args).first<T>();
const run = (db: D1Database, sql: string, ...args: unknown[]) => db.prepare(sql).bind(...args).run();

const PUBLIC_PERSON = "id, name, household, is_kid, sort";

// Some households don't see each other's lists, and some people and a whole
// household don't see each other (both ways). Bind with hiddenArgs(me).
const HIDDEN_FROM = (alias: string) =>
  `(EXISTS (SELECT 1 FROM household_hidden h
      WHERE (h.household_a = ? AND h.household_b = ${alias}.household)
         OR (h.household_b = ? AND h.household_a = ${alias}.household))
    OR EXISTS (SELECT 1 FROM person_hidden ph
      WHERE (ph.viewer_id = ? AND ph.household = ${alias}.household)
         OR (ph.viewer_id = ${alias}.id AND ph.household = ?)))`;
const hiddenArgs = (me: Person) => [me.household, me.household, me.id, me.household];

// ---------- Joining ----------

app.post("/api/join", async (c) => {
  const { passcode } = await body(c);
  if (!sameSecret(passcode as string, c.env.FAMILY_PASSCODE)) fail(403, "That family passcode isn't right.");
  const people = await all(
    c.env.DB,
    `SELECT ${PUBLIC_PERSON} FROM people
     WHERE id NOT IN (SELECT person_id FROM device_people) ORDER BY sort`,
  );
  return c.json({ people });
});

app.post("/api/pick", async (c) => {
  const b = await body(c);
  if (!sameSecret(b.passcode as string, c.env.FAMILY_PASSCODE)) fail(403, "That family passcode isn't right.");
  const personId = text(b.personId, 64);
  const person = await first(c.env.DB, "SELECT id FROM people WHERE id = ?", personId);
  if (!person) fail(404, "We couldn't find that name.");
  const taken = await first(c.env.DB, "SELECT 1 FROM device_people WHERE person_id = ?", personId);
  if (taken) fail(409, "That name is already set up on another device. Ask Matt for a code.");
  const token = randomToken();
  const hash = await sha256(token);
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO devices (token_hash, created_at) VALUES (?, ?)").bind(hash, now()),
    c.env.DB.prepare("INSERT INTO device_people (token_hash, person_id, created_at) VALUES (?, ?, ?)").bind(hash, personId, now()),
  ]);
  return c.json({ token, personId });
});

// Admin-issued code: puts a person on a new device, or adds them to this one.
app.post("/api/redeem", async (c) => {
  const b = await body(c);
  const code = text(b.code, 20).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const row = await first<{ person_id: string; created_at: number; used_at: number | null }>(
    c.env.DB,
    "SELECT person_id, created_at, used_at FROM invite_codes WHERE code = ?",
    code,
  );
  if (!row || row.used_at || now() - row.created_at > 7 * 86400_000) fail(403, "That code isn't valid. Ask for a new one.");
  let token = text(b.token, 200);
  let hash = token ? await sha256(token) : "";
  if (!token || !(await first(c.env.DB, "SELECT 1 FROM devices WHERE token_hash = ?", hash))) {
    token = randomToken();
    hash = await sha256(token);
    await run(c.env.DB, "INSERT INTO devices (token_hash, created_at) VALUES (?, ?)", hash, now());
  }
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT OR IGNORE INTO device_people (token_hash, person_id, created_at) VALUES (?, ?, ?)").bind(hash, row!.person_id, now()),
    c.env.DB.prepare("UPDATE invite_codes SET used_at = ? WHERE code = ?").bind(now(), code),
  ]);
  return c.json({ token, personId: row!.person_id });
});

app.get("/api/img/:key", async (c) => {
  const img = await first<{ type: string; data: ArrayBuffer }>(c.env.DB, "SELECT type, data FROM images WHERE key = ?", c.req.param("key"));
  if (!img) return c.notFound();
  return new Response(new Uint8Array(img.data), {
    headers: {
      "Content-Type": img.type,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
});

// ---------- Admin ----------

const admin = async (c: C, next: Next) => {
  if (!sameSecret(c.req.header("X-Admin"), c.env.ADMIN_PASSCODE)) fail(403, "Admin passcode isn't right.");
  await next();
};

app.get("/api/admin/people", admin, async (c) => {
  const people = await all(
    c.env.DB,
    `SELECT ${PUBLIC_PERSON}, in_drawing,
       (SELECT COUNT(*) FROM device_people dp WHERE dp.person_id = people.id) AS devices,
       (SELECT COUNT(*) FROM items i WHERE i.owner_id = people.id AND i.deleted_at IS NULL AND i.occasion = ?) AS items
     FROM people ORDER BY sort`,
    c.env.OCCASION,
  );
  const assignments = await all(c.env.DB, "SELECT giver_id, recipient_id FROM assignments WHERE occasion = ?", c.env.OCCASION);
  return c.json({ people, assignments });
});

app.post("/api/admin/people", admin, async (c) => {
  const b = await body(c);
  const name = text(b.name, 60);
  const household = text(b.household, 60);
  if (!name || !household) fail(400, "Name and household are required.");
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "person";
  const id = (await first(c.env.DB, "SELECT 1 FROM people WHERE id = ?", base)) ? `${base}-${inviteCode().toLowerCase()}` : base;
  const max = await first<{ m: number }>(c.env.DB, "SELECT COALESCE(MAX(sort), 0) AS m FROM people");
  await run(c.env.DB, "INSERT INTO people (id, name, household, is_kid, sort) VALUES (?, ?, ?, ?, ?)", id, name, household, b.is_kid ? 1 : 0, (max?.m ?? 0) + 1);
  return c.json({ id });
});

app.patch("/api/admin/people/:id", admin, async (c) => {
  const b = await body(c);
  const p = await first<Person>(c.env.DB, "SELECT * FROM people WHERE id = ?", c.req.param("id"));
  if (!p) fail(404, "Not found.");
  await run(
    c.env.DB,
    "UPDATE people SET name = ?, household = ?, is_kid = ? WHERE id = ?",
    text(b.name, 60) || p!.name,
    text(b.household, 60) || p!.household,
    b.is_kid === undefined ? p!.is_kid : b.is_kid ? 1 : 0,
    p!.id,
  );
  return c.json({ ok: true });
});

app.post("/api/admin/code", admin, async (c) => {
  const personId = text((await body(c)).personId, 64);
  if (!(await first(c.env.DB, "SELECT 1 FROM people WHERE id = ?", personId))) fail(404, "Not found.");
  const code = inviteCode();
  await run(c.env.DB, "INSERT INTO invite_codes (code, person_id, created_at) VALUES (?, ?, ?)", code, personId, now());
  return c.json({ code });
});

app.post("/api/admin/reset", admin, async (c) => {
  const personId = text((await body(c)).personId, 64);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM device_people WHERE person_id = ?").bind(personId),
    c.env.DB.prepare("DELETE FROM devices WHERE token_hash NOT IN (SELECT token_hash FROM device_people)"),
  ]);
  return c.json({ ok: true });
});

app.put("/api/admin/assignments", admin, async (c) => {
  const pairs = (await body(c)).pairs;
  if (!Array.isArray(pairs)) fail(400, "Expected a list of pairs.");
  const drawing = new Set((await all<{ id: string }>(c.env.DB, "SELECT id FROM people WHERE in_drawing = 1")).map((p) => p.id));
  const stmts = [c.env.DB.prepare("DELETE FROM assignments WHERE occasion = ?").bind(c.env.OCCASION)];
  for (const p of pairs as { giver_id?: string; recipient_id?: string }[]) {
    if (!p.giver_id || !p.recipient_id || p.giver_id === p.recipient_id) continue;
    if (!drawing.has(p.giver_id) || !drawing.has(p.recipient_id)) continue;
    stmts.push(
      c.env.DB.prepare("INSERT INTO assignments (occasion, giver_id, recipient_id) VALUES (?, ?, ?)").bind(c.env.OCCASION, p.giver_id, p.recipient_id),
    );
  }
  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

// ---------- Signed-in routes ----------

const authed = async (c: C, next: Next) => {
  const token = (c.req.header("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) fail(401, "Not signed in.");
  const hash = await sha256(token);
  const personId = c.req.header("X-Person") || "";
  const me = await first<Person>(
    c.env.DB,
    `SELECT p.* FROM people p JOIN device_people dp ON dp.person_id = p.id
     WHERE dp.token_hash = ? AND (p.id = ? OR ? = '') ORDER BY dp.created_at LIMIT 1`,
    hash,
    personId,
    personId,
  );
  if (!me) fail(401, "This device isn't signed in anymore.");
  c.set("me", me!);
  c.set("tokenHash", hash);
  await next();
};

for (const path of ["/api/me", "/api/home", "/api/people/*", "/api/profile", "/api/items", "/api/items/*", "/api/ideas", "/api/ideas/*", "/api/questions", "/api/questions/*", "/api/groups/*", "/api/unfurl", "/api/upload", "/api/ai/*"]) {
  app.use(path, authed);
}

app.get("/api/me", async (c) => {
  const people = await all(
    c.env.DB,
    `SELECT ${PUBLIC_PERSON} FROM people p JOIN device_people dp ON dp.person_id = p.id
     WHERE dp.token_hash = ? ORDER BY dp.created_at`,
    c.get("tokenHash"),
  );
  return c.json({ people, occasion: c.env.OCCASION });
});

app.get("/api/home", async (c) => {
  const me = c.get("me");
  const occ = c.env.OCCASION;
  const [people, assignment, removed, unanswered, answers, myClaims] = await Promise.all([
    all(
      c.env.DB,
      `SELECT ${PUBLIC_PERSON},
         (SELECT COUNT(*) FROM items i WHERE i.owner_id = people.id AND i.deleted_at IS NULL AND i.occasion = ?) AS items,
         (SELECT COUNT(*) FROM ideas d WHERE d.target_id = people.id AND d.occasion = ? AND people.id != ?) AS ideas,
         EXISTS (SELECT 1 FROM device_people dp WHERE dp.person_id = people.id) AS signed_in
       FROM people WHERE NOT ${HIDDEN_FROM("people")} ORDER BY sort`,
      occ,
      occ,
      me.id,
      ...hiddenArgs(me),
    ),
    first(
      c.env.DB,
      `SELECT p.id, p.name FROM assignments a JOIN people p ON p.id = a.recipient_id
       WHERE a.occasion = ? AND a.giver_id = ? AND ? = 1`,
      occ,
      me.id,
      me.in_drawing,
    ),
    all(
      c.env.DB,
      `SELECT i.id, i.title, p.id AS owner_id, p.name AS owner_name FROM claims cl
       JOIN items i ON i.id = cl.item_id JOIN people p ON p.id = i.owner_id
       WHERE cl.claimer_id = ? AND i.deleted_at IS NOT NULL AND i.occasion = ?`,
      me.id,
      occ,
    ),
    first<{ n: number }>(c.env.DB, "SELECT COUNT(*) AS n FROM questions WHERE target_id = ? AND answer IS NULL", me.id),
    all(
      c.env.DB,
      `SELECT q.id, q.question, q.answer, p.id AS target_id, p.name AS target_name FROM questions q
       JOIN people p ON p.id = q.target_id
       WHERE q.asker_id = ? AND q.answer IS NOT NULL AND q.answered_at > ? ORDER BY q.answered_at DESC`,
      me.id,
      now() - 14 * 86400_000,
    ),
    all(
      c.env.DB,
      `SELECT i.id, i.title, cl.status, p.id AS owner_id, p.name AS owner_name FROM claims cl
       JOIN items i ON i.id = cl.item_id JOIN people p ON p.id = i.owner_id
       WHERE cl.claimer_id = ? AND i.deleted_at IS NULL AND i.occasion = ?
       UNION ALL
       SELECT d.id, d.title, d.status, p.id, p.name FROM ideas d JOIN people p ON p.id = d.target_id
       WHERE d.claimer_id = ? AND d.occasion = ?`,
      me.id,
      occ,
      me.id,
      occ,
    ),
  ]);
  return c.json({
    me: { id: me.id, name: me.name, is_kid: me.is_kid, in_drawing: me.in_drawing },
    people,
    assignment,
    removed,
    unanswered: unanswered?.n ?? 0,
    answers,
    myClaims,
  });
});

app.get("/api/people/:id", async (c) => {
  const me = c.get("me");
  const occ = c.env.OCCASION;
  const person = await visiblePerson(c, c.req.param("id"));
  const isMe = person.id === me.id;

  const items = await all<Record<string, unknown> & { id: string; title: string; url: string; deleted_at: number | null }>(
    c.env.DB,
    `SELECT id, title, url, image, price, notes, priority, qty, sort, created_at, deleted_at,
       (SELECT name FROM people WHERE id = items.suggested_by) AS suggested_by_name FROM items
     WHERE owner_id = ? AND occasion = ? AND (deleted_at IS NULL OR (? = 0 AND id IN (SELECT item_id FROM claims)))
     ORDER BY sort, created_at`,
    person!.id,
    occ,
    isMe ? 1 : 0,
  );

  const questions = (
    await all<Record<string, unknown> & { asker_id: string }>(
      c.env.DB,
      "SELECT id, item_id, asker_id, question, answer, created_at, answered_at FROM questions WHERE target_id = ? ORDER BY created_at",
      person!.id,
    )
  ).map(({ asker_id, ...q }) => ({ ...q, mine: asker_id === me.id }));

  if (isMe) {
    // The owner never learns an item was also a family idea.
    return c.json({ person, isMe, items: items.map(({ deleted_at, suggested_by_name, ...i }) => i), questions });
  }

  const ids = items.map((i) => i.id);
  const placeholders = ids.map(() => "?").join(",") || "''";
  const [claims, groups, contributions, ideas] = await Promise.all([
    all(
      c.env.DB,
      `SELECT cl.item_id, cl.claimer_id, p.name AS claimer_name, cl.qty, cl.status FROM claims cl
       JOIN people p ON p.id = cl.claimer_id WHERE cl.item_id IN (${placeholders})`,
      ...ids,
    ),
    all(
      c.env.DB,
      `SELECT g.id, g.item_id, g.organizer_id, p.name AS organizer_name, g.total_cents, g.note FROM group_gifts g
       JOIN people p ON p.id = g.organizer_id WHERE g.item_id IN (${placeholders})`,
      ...ids,
    ),
    all(
      c.env.DB,
      `SELECT co.group_id, co.person_id, p.name, co.amount_cents, co.paid FROM contributions co
       JOIN people p ON p.id = co.person_id JOIN group_gifts g ON g.id = co.group_id
       WHERE g.item_id IN (${placeholders}) ORDER BY p.sort`,
      ...ids,
    ),
    all(
      c.env.DB,
      `SELECT d.id, d.title, d.url, d.image, d.price, d.notes, d.author_id, a.name AS author_name,
         d.claimer_id, cp.name AS claimer_name, d.status, d.created_at
       FROM ideas d JOIN people a ON a.id = d.author_id LEFT JOIN people cp ON cp.id = d.claimer_id
       WHERE d.target_id = ? AND d.occasion = ? ORDER BY d.created_at`,
      person!.id,
      occ,
    ),
  ]);

  return c.json({
    person,
    isMe,
    items: items.map((i) => ({
      ...i,
      claims: claims.filter((cl) => cl.item_id === i.id),
      group: (() => {
        const g = groups.find((g) => g.item_id === i.id);
        return g ? { ...g, people: contributions.filter((co) => co.group_id === g.id) } : null;
      })(),
    })),
    questions,
    ideas: ideas.map((d) => {
      const twin = items.find((i) => !i.deleted_at && similarThing(i, d as unknown as { title: string; url: string }));
      return { ...d, similar_item_id: twin?.id ?? null, similar_item_title: twin?.title ?? null };
    }),
  });
});

async function visiblePerson(c: C, id: string) {
  const me = c.get("me");
  const person = await first<Person>(c.env.DB, `SELECT * FROM people WHERE id = ? AND NOT ${HIDDEN_FROM("people")}`, id, ...hiddenArgs(me));
  if (!person) fail(404, "We couldn't find that person.");
  return person!;
}

app.put("/api/profile", async (c) => {
  const b = await body(c);
  await run(
    c.env.DB,
    "UPDATE people SET sizes = ?, favorites = ?, dont_buy = ?, about = ? WHERE id = ?",
    text(b.sizes),
    text(b.favorites),
    text(b.dont_buy),
    text(b.about),
    c.get("me").id,
  );
  return c.json({ ok: true });
});

// ---------- Images ----------

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];

async function storeImage(env: Env, data: ArrayBuffer, contentType: string) {
  const key = `${uid()}`;
  await run(env.DB, "INSERT INTO images (key, type, data, created_at) VALUES (?, ?, ?, ?)", key, contentType, data, now());
  return `img:${key}`;
}

// Copy a store's product photo into our bucket so it keeps working even if the
// store blocks hotlinking or changes the URL. Falls back to the original URL.
async function mirrorImage(env: Env, image: string) {
  if (!/^https?:\/\//i.test(image)) return image;
  try {
    const res = await fetch(image, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36" },
      signal: AbortSignal.timeout(8000),
    });
    const type = (res.headers.get("Content-Type") || "").split(";")[0].trim();
    if (!res.ok || !IMAGE_TYPES.includes(type)) return image;
    const data = await res.arrayBuffer();
    if (data.byteLength > 1_800_000) return image;
    return await storeImage(env, data, type);
  } catch {
    return image;
  }
}

app.post("/api/upload", async (c) => {
  const type = (c.req.header("Content-Type") || "").split(";")[0].trim();
  if (!IMAGE_TYPES.includes(type)) fail(400, "Please choose a photo.");
  const data = await c.req.arrayBuffer();
  if (data.byteLength > 1_800_000) fail(413, "That photo is too large.");
  return c.json({ image: await storeImage(c.env, data, type) });
});

app.post("/api/unfurl", async (c) => {
  const url = text((await body(c)).url, 2000);
  if (!/^https?:\/\//i.test(url)) fail(400, "That doesn't look like a web link.");
  return c.json(await unfurl(url));
});

// ---------- Items ----------

function itemFields(b: Record<string, unknown>) {
  return {
    title: text(b.title, 300),
    url: text(b.url, 2000),
    image: text(b.image, 2000),
    price: text(b.price, 40),
    notes: text(b.notes, 2000),
    priority: int(b.priority, 1, 3, 2),
    qty: int(b.qty, 1, 99, 1),
  };
}

async function ownItem(c: C, id: string) {
  const item = await first<{ id: string; owner_id: string; image: string }>(
    c.env.DB,
    "SELECT id, owner_id, image FROM items WHERE id = ? AND deleted_at IS NULL",
    id,
  );
  if (!item) fail(404, "That item is gone.");
  if (item!.owner_id !== c.get("me").id) fail(403, "Only the list owner can change this item.");
  return item!;
}

async function othersItem(c: C, id: string) {
  const item = await first<{ id: string; owner_id: string; qty: number }>(
    c.env.DB,
    "SELECT id, owner_id, qty FROM items WHERE id = ? AND deleted_at IS NULL",
    id,
  );
  if (!item) fail(404, "That item was removed from the list.");
  if (item!.owner_id === c.get("me").id) fail(403, "That's on your own list.");
  await visiblePerson(c, item!.owner_id);
  return item!;
}

type IdeaRow = { id: string; author_id: string; claimer_id: string | null; status: string | null; title: string; url: string };

// Fold a family idea into the person's own wish: carry over any claim so nobody
// buys it twice, credit whoever suggested it, and drop the separate idea.
async function mergeIdea(env: Env, idea: IdeaRow, itemId: string) {
  const stmts = [
    env.DB.prepare("UPDATE items SET suggested_by = COALESCE(suggested_by, ?) WHERE id = ?").bind(idea.author_id, itemId),
    env.DB.prepare("DELETE FROM ideas WHERE id = ?").bind(idea.id),
  ];
  if (idea.claimer_id) {
    stmts.unshift(
      env.DB.prepare(
        `INSERT INTO claims (id, item_id, claimer_id, qty, status, created_at) VALUES (?, ?, ?, 1, ?, ?)
         ON CONFLICT (item_id, claimer_id) DO NOTHING`,
      ).bind(uid(), itemId, idea.claimer_id, idea.status || "reserved", now()),
    );
  }
  await env.DB.batch(stmts);
}

async function absorbMatchingIdeas(env: Env, ownerId: string, item: { id: string; title: string; url: string }) {
  const ideas = await all<IdeaRow>(
    env.DB,
    "SELECT id, author_id, claimer_id, status, title, url FROM ideas WHERE target_id = ? AND occasion = ?",
    ownerId,
    env.OCCASION,
  );
  for (const idea of ideas) if (sameThing(item, idea)) await mergeIdea(env, idea, item.id);
}

app.post("/api/items", async (c) => {
  const f = itemFields(await body(c));
  if (!f.title) fail(400, "Give it a name.");
  f.image = await mirrorImage(c.env, f.image);
  const min = await first<{ m: number }>(c.env.DB, "SELECT COALESCE(MIN(sort), 0) AS m FROM items WHERE owner_id = ?", c.get("me").id);
  const id = uid();
  await run(
    c.env.DB,
    `INSERT INTO items (id, owner_id, occasion, title, url, image, price, notes, priority, qty, sort, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, c.get("me").id, c.env.OCCASION, f.title, f.url, f.image, f.price, f.notes, f.priority, f.qty, (min?.m ?? 0) - 1, now(),
  );
  await absorbMatchingIdeas(c.env, c.get("me").id, { id, title: f.title, url: f.url });
  return c.json({ id });
});

app.patch("/api/items/:id", async (c) => {
  const item = await ownItem(c, c.req.param("id"));
  const f = itemFields(await body(c));
  if (!f.title) fail(400, "Give it a name.");
  if (f.image !== item.image) f.image = await mirrorImage(c.env, f.image);
  await run(
    c.env.DB,
    "UPDATE items SET title = ?, url = ?, image = ?, price = ?, notes = ?, priority = ?, qty = ? WHERE id = ?",
    f.title, f.url, f.image, f.price, f.notes, f.priority, f.qty, item.id,
  );
  await absorbMatchingIdeas(c.env, c.get("me").id, { id: item.id, title: f.title, url: f.url });
  return c.json({ ok: true });
});

app.delete("/api/items/:id", async (c) => {
  const item = await ownItem(c, c.req.param("id"));
  const claimed = await first(c.env.DB, "SELECT 1 FROM claims WHERE item_id = ?", item.id);
  // Claimed items are only hidden so the shopper can see it was removed.
  if (claimed) await run(c.env.DB, "UPDATE items SET deleted_at = ? WHERE id = ?", now(), item.id);
  else await run(c.env.DB, "DELETE FROM items WHERE id = ?", item.id);
  return c.json({ ok: true });
});

app.post("/api/items/reorder", async (c) => {
  const ids = (await body(c)).ids;
  if (!Array.isArray(ids)) fail(400, "Expected a list.");
  await c.env.DB.batch(
    (ids as string[]).map((id, i) =>
      c.env.DB.prepare("UPDATE items SET sort = ? WHERE id = ? AND owner_id = ?").bind(i, String(id), c.get("me").id),
    ),
  );
  return c.json({ ok: true });
});

app.post("/api/items/:id/claim", async (c) => {
  const item = await othersItem(c, c.req.param("id"));
  const b = await body(c);
  const status = b.status === "bought" ? "bought" : "reserved";
  const others = await first<{ n: number }>(
    c.env.DB,
    "SELECT COALESCE(SUM(qty), 0) AS n FROM claims WHERE item_id = ? AND claimer_id != ?",
    item.id,
    c.get("me").id,
  );
  const left = item.qty - (others?.n ?? 0);
  if (left <= 0) fail(409, "Someone already claimed this one.");
  const qty = int(b.qty, 1, left, 1);
  await run(
    c.env.DB,
    `INSERT INTO claims (id, item_id, claimer_id, qty, status, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (item_id, claimer_id) DO UPDATE SET qty = excluded.qty, status = excluded.status`,
    uid(), item.id, c.get("me").id, qty, status, now(),
  );
  return c.json({ ok: true });
});

app.delete("/api/items/:id/claim", async (c) => {
  const id = c.req.param("id");
  await run(c.env.DB, "DELETE FROM claims WHERE item_id = ? AND claimer_id = ?", id, c.get("me").id);
  // Once nobody is tracking a removed item, drop it for good.
  await run(
    c.env.DB,
    "DELETE FROM items WHERE id = ? AND deleted_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM claims WHERE item_id = ?)",
    id,
    id,
  );
  return c.json({ ok: true });
});

// ---------- Group gifts ----------

app.post("/api/items/:id/group", async (c) => {
  const item = await othersItem(c, c.req.param("id"));
  const b = await body(c);
  if (await first(c.env.DB, "SELECT 1 FROM group_gifts WHERE item_id = ?", item.id)) fail(409, "There's already a group gift for this.");
  const id = uid();
  const me = c.get("me").id;
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO group_gifts (id, item_id, organizer_id, total_cents, note, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(
      id, item.id, me, int(b.total_cents, 0, 10_000_000, 0), text(b.note, 500), now(),
    ),
    c.env.DB.prepare("INSERT INTO contributions (group_id, person_id, amount_cents, paid) VALUES (?, ?, 0, 1)").bind(id, me),
    c.env.DB.prepare(
      `INSERT INTO claims (id, item_id, claimer_id, qty, status, created_at) VALUES (?, ?, ?, 1, 'reserved', ?)
       ON CONFLICT (item_id, claimer_id) DO NOTHING`,
    ).bind(uid(), item.id, me, now()),
  ]);
  return c.json({ id });
});

async function groupFor(c: C, id: string) {
  const g = await first<{ id: string; organizer_id: string; owner_id: string }>(
    c.env.DB,
    "SELECT g.id, g.organizer_id, i.owner_id FROM group_gifts g JOIN items i ON i.id = g.item_id WHERE g.id = ?",
    id,
  );
  if (!g) fail(404, "That group gift is gone.");
  if (g!.owner_id === c.get("me").id) fail(403, "That's for you!");
  await visiblePerson(c, g!.owner_id);
  return g!;
}

app.patch("/api/groups/:id", async (c) => {
  const g = await groupFor(c, c.req.param("id"));
  if (g.organizer_id !== c.get("me").id) fail(403, "Only the organizer can change this.");
  const b = await body(c);
  await run(c.env.DB, "UPDATE group_gifts SET total_cents = ?, note = ? WHERE id = ?", int(b.total_cents, 0, 10_000_000, 0), text(b.note, 500), g.id);
  return c.json({ ok: true });
});

app.delete("/api/groups/:id", async (c) => {
  const g = await groupFor(c, c.req.param("id"));
  if (g.organizer_id !== c.get("me").id) fail(403, "Only the organizer can cancel this.");
  await run(c.env.DB, "DELETE FROM group_gifts WHERE id = ?", g.id);
  return c.json({ ok: true });
});

app.put("/api/groups/:id/people/:pid", async (c) => {
  const g = await groupFor(c, c.req.param("id"));
  const pid = c.req.param("pid");
  const me = c.get("me").id;
  if (pid !== me && g.organizer_id !== me) fail(403, "Only the organizer can change someone else's share.");
  if (pid === g.owner_id) fail(400, "They can't chip in on their own gift.");
  const b = await body(c);
  await run(
    c.env.DB,
    `INSERT INTO contributions (group_id, person_id, amount_cents, paid) VALUES (?, ?, ?, ?)
     ON CONFLICT (group_id, person_id) DO UPDATE SET amount_cents = excluded.amount_cents, paid = excluded.paid`,
    g.id, pid, int(b.amount_cents, 0, 10_000_000, 0), b.paid ? 1 : 0,
  );
  return c.json({ ok: true });
});

app.delete("/api/groups/:id/people/:pid", async (c) => {
  const g = await groupFor(c, c.req.param("id"));
  const pid = c.req.param("pid");
  const me = c.get("me").id;
  if (pid !== me && g.organizer_id !== me) fail(403, "Only the organizer can remove someone.");
  if (pid === g.organizer_id) fail(400, "The organizer can cancel the group gift instead.");
  await run(c.env.DB, "DELETE FROM contributions WHERE group_id = ? AND person_id = ?", g.id, pid);
  return c.json({ ok: true });
});

// ---------- Ideas for someone else ----------

async function notSelf(c: C, targetId: string) {
  await visiblePerson(c, targetId);
  if (targetId === c.get("me").id) fail(403, "Add it to your own list instead.");
}

async function ideaFor(c: C, id: string) {
  const idea = await first<{ id: string; target_id: string; author_id: string; image: string }>(
    c.env.DB,
    "SELECT id, target_id, author_id, image FROM ideas WHERE id = ?",
    id,
  );
  if (!idea) fail(404, "That idea is gone.");
  await visiblePerson(c, idea!.target_id);
  if (idea!.target_id === c.get("me").id) fail(403, "No peeking!");
  return idea!;
}

app.post("/api/ideas", async (c) => {
  const b = await body(c);
  const targetId = text(b.targetId, 64);
  await notSelf(c, targetId);
  const f = itemFields(b);
  if (!f.title) fail(400, "Give it a name.");
  const wishes = await all<{ title: string; url: string }>(
    c.env.DB,
    "SELECT title, url FROM items WHERE owner_id = ? AND occasion = ? AND deleted_at IS NULL",
    targetId,
    c.env.OCCASION,
  );
  if (wishes.some((w) => sameThing(w, f))) {
    const target = await first<{ name: string }>(c.env.DB, "SELECT name FROM people WHERE id = ?", targetId);
    fail(409, `That's already on ${target?.name}'s own list. You can claim it there.`);
  }
  const id = uid();
  await run(
    c.env.DB,
    `INSERT INTO ideas (id, target_id, author_id, occasion, title, url, image, price, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, targetId, c.get("me").id, c.env.OCCASION, f.title, f.url, await mirrorImage(c.env, f.image), f.price, f.notes, now(),
  );
  return c.json({ id });
});

app.patch("/api/ideas/:id", async (c) => {
  const idea = await ideaFor(c, c.req.param("id"));
  if (idea.author_id !== c.get("me").id) fail(403, "Only the person who added this can edit it.");
  const f = itemFields(await body(c));
  if (!f.title) fail(400, "Give it a name.");
  if (f.image !== idea.image) f.image = await mirrorImage(c.env, f.image);
  await run(c.env.DB, "UPDATE ideas SET title = ?, url = ?, image = ?, price = ?, notes = ? WHERE id = ?", f.title, f.url, f.image, f.price, f.notes, idea.id);
  return c.json({ ok: true });
});

app.delete("/api/ideas/:id", async (c) => {
  const idea = await ideaFor(c, c.req.param("id"));
  if (idea.author_id !== c.get("me").id) fail(403, "Only the person who added this can remove it.");
  await run(c.env.DB, "DELETE FROM ideas WHERE id = ?", idea.id);
  return c.json({ ok: true });
});

app.post("/api/ideas/:id/merge", async (c) => {
  const idea = await ideaFor(c, c.req.param("id"));
  const itemId = text((await body(c)).itemId, 64);
  const item = await first(c.env.DB, "SELECT 1 FROM items WHERE id = ? AND owner_id = ? AND deleted_at IS NULL", itemId, idea.target_id);
  if (!item) fail(404, "That item isn't on their list anymore.");
  const row = await first<IdeaRow>(c.env.DB, "SELECT id, author_id, claimer_id, status, title, url FROM ideas WHERE id = ?", idea.id);
  await mergeIdea(c.env, row!, itemId);
  return c.json({ ok: true });
});

app.post("/api/ideas/:id/claim", async (c) => {
  const idea = await ideaFor(c, c.req.param("id"));
  const status = (await body(c)).status === "bought" ? "bought" : "reserved";
  const res = await run(
    c.env.DB,
    "UPDATE ideas SET claimer_id = ?, status = ? WHERE id = ? AND (claimer_id IS NULL OR claimer_id = ?)",
    c.get("me").id, status, idea.id, c.get("me").id,
  );
  if (!res.meta.changes) fail(409, "Someone already claimed this one.");
  return c.json({ ok: true });
});

app.delete("/api/ideas/:id/claim", async (c) => {
  const idea = await ideaFor(c, c.req.param("id"));
  await run(c.env.DB, "UPDATE ideas SET claimer_id = NULL, status = NULL WHERE id = ? AND claimer_id = ?", idea.id, c.get("me").id);
  return c.json({ ok: true });
});

// ---------- Anonymous questions ----------

app.post("/api/questions", async (c) => {
  const b = await body(c);
  const targetId = text(b.targetId, 64);
  await notSelf(c, targetId);
  const question = text(b.question, 500);
  if (!question) fail(400, "Type a question.");
  const itemId = text(b.itemId, 64) || null;
  if (itemId && !(await first(c.env.DB, "SELECT 1 FROM items WHERE id = ? AND owner_id = ?", itemId, targetId))) fail(404, "That item is gone.");
  await run(
    c.env.DB,
    "INSERT INTO questions (id, target_id, item_id, asker_id, question, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    uid(), targetId, itemId, c.get("me").id, question, now(),
  );
  return c.json({ ok: true });
});

app.post("/api/questions/:id/answer", async (c) => {
  const answer = text((await body(c)).answer, 1000);
  if (!answer) fail(400, "Type an answer.");
  const res = await run(
    c.env.DB,
    "UPDATE questions SET answer = ?, answered_at = ? WHERE id = ? AND target_id = ?",
    answer, now(), c.req.param("id"), c.get("me").id,
  );
  if (!res.meta.changes) fail(404, "That question is gone.");
  return c.json({ ok: true });
});

app.delete("/api/questions/:id", async (c) => {
  // The asker can withdraw it; the owner can dismiss it.
  await run(
    c.env.DB,
    "DELETE FROM questions WHERE id = ? AND (asker_id = ? OR target_id = ?)",
    c.req.param("id"), c.get("me").id, c.get("me").id,
  );
  return c.json({ ok: true });
});

// ---------- AI ----------

app.post("/api/ai/ideas", async (c) => {
  if (!c.env.ANTHROPIC_API_KEY) fail(503, "Gift ideas aren't switched on yet.");
  const b = await body(c);
  const me = c.get("me");
  const person = await visiblePerson(c, text(b.targetId, 64));
  const isMe = person!.id === me.id;
  const items = await all<{ title: string; notes: string; price: string }>(
    c.env.DB,
    "SELECT title, notes, price FROM items WHERE owner_id = ? AND occasion = ? AND deleted_at IS NULL ORDER BY sort",
    person!.id,
    c.env.OCCASION,
  );
  // Family ideas are secret from the person themselves, so leave them out then.
  const ideas = isMe
    ? []
    : await all<{ title: string }>(c.env.DB, "SELECT title FROM ideas WHERE target_id = ? AND occasion = ?", person!.id, c.env.OCCASION);
  const result = await suggestIdeas(c.env.ANTHROPIC_API_KEY!, {
    name: person!.name,
    isKid: !!person!.is_kid,
    forSelf: isMe,
    profile: { sizes: person!.sizes, favorites: person!.favorites, dontBuy: person!.dont_buy, about: person!.about },
    items,
    ideas: ideas.map((i) => i.title),
    request: text(b.request, 500),
  });
  return c.json(result);
});

app.post("/api/ai/snap", async (c) => {
  if (!c.env.ANTHROPIC_API_KEY) fail(503, "Photo add isn't switched on yet.");
  const b = await body(c);
  const image = text(b.image, 12_000_000);
  const m = image.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/);
  if (!m) fail(400, "Please choose a photo.");
  return c.json(await identifyPhoto(c.env.ANTHROPIC_API_KEY!, m![1] as "image/jpeg", m![2]));
});

export default app;
