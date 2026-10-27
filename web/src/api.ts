export const API = (import.meta.env.VITE_API as string | undefined) || "http://127.0.0.1:8787";

const TOKEN = "giftstar.token";
const PERSON = "giftstar.person";
const ADMIN = "giftstar.admin";

function read(key: string) {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}
function write(key: string, value: string) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // private browsing: identity just won't persist
  }
}

export const session = {
  get token() {
    return read(TOKEN);
  },
  set token(v: string) {
    write(TOKEN, v);
  },
  get person() {
    return read(PERSON);
  },
  set person(v: string) {
    write(PERSON, v);
  },
  get admin() {
    return read(ADMIN);
  },
  set admin(v: string) {
    write(ADMIN, v);
  },
};

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T = any>(method: string, path: string, body?: unknown, opts: { admin?: boolean; raw?: Blob } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  if (session.person) headers["X-Person"] = session.person;
  if (opts.admin) headers["X-Admin"] = session.admin;
  let payload: BodyInit | undefined;
  if (opts.raw) {
    headers["Content-Type"] = opts.raw.type;
    payload = opts.raw;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(`${API}/api${path}`, { method, headers, body: payload });
  } catch {
    throw new ApiError(0, "Can't reach GiftStar. Check your internet connection.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || "Something went wrong.");
  return data as T;
}

export function imageSrc(image: string) {
  if (!image) return "";
  return image.startsWith("img:") ? `${API}/api/img/${image.slice(4)}` : image;
}

// Shrink phone photos before upload: faster on slow connections, cheaper to store.
export async function shrinkImage(file: Blob, max = 1200, quality = 0.85): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't read that photo."))), "image/jpeg", quality));
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export type PersonSummary = { id: string; name: string; household: string; is_kid: number; sort: number; items?: number };

export type Claim = { item_id: string; claimer_id: string; claimer_name: string; qty: number; status: "reserved" | "bought" };
export type Contribution = { group_id: string; person_id: string; name: string; amount_cents: number; paid: number };
export type Group = { id: string; item_id: string; organizer_id: string; organizer_name: string; total_cents: number; note: string; people: Contribution[] };

export type Item = {
  id: string;
  title: string;
  url: string;
  image: string;
  price: string;
  notes: string;
  priority: number;
  qty: number;
  deleted_at?: number | null;
  suggested_by_name?: string | null;
  claims?: Claim[];
  group?: Group | null;
};

export type Idea = {
  id: string;
  title: string;
  url: string;
  image: string;
  price: string;
  notes: string;
  author_id: string;
  author_name: string;
  claimer_id: string | null;
  claimer_name: string | null;
  status: "reserved" | "bought" | null;
  similar_item_id: string | null;
  similar_item_title: string | null;
};

export type Question = { id: string; item_id: string | null; question: string; answer: string | null; mine: boolean };

export type PersonFull = PersonSummary & { sizes: string; favorites: string; dont_buy: string; about: string };

export type PersonView = { person: PersonFull; isMe: boolean; items: Item[]; questions: Question[]; ideas?: Idea[] };
