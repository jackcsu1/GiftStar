import { useEffect, useRef, useState } from "react";
import { api, blobToDataUrl, cropImage, imageSrc, shrinkImage } from "./api";
import { amazonSearchUrl, parseShared, storeName } from "./links";
import { Spinner, useAction } from "./ui";

export type ItemFields = { title: string; url: string; image: string; price: string; notes: string; priority: number; qty: number };

type Unfurl = { url: string; title: string; image: string; price: string; images: string[]; found: boolean; jobId?: string };
type Shot = {
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

// Amazon pages can be opened by the family computer. Wait a little for its answer.
async function waitForJob(id: string): Promise<Unfurl | null> {
  for (let i = 0; i < 18; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const j = await api<{ status: string; result?: Unfurl }>("GET", `/unfurl/job/${id}`);
      if (j.status === "done" && j.result) return j.result;
      if (j.status === "failed") return j.result ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

function usableBox(s: Shot) {
  const { left, top, right, bottom } = s;
  const ok = [left, top, right, bottom].every(Number.isFinite) && left >= 0 && top >= 0 && right - left >= 0.15 && bottom - top >= 0.08 && left < 1 && top < 1;
  return ok ? { left, top, right: Math.min(1, right), bottom: Math.min(1, bottom) } : null;
}
type Lookup = "idle" | "good" | "nophoto" | "guessed" | "failed" | "nolink" | "noshot";

const EMPTY: ItemFields = { title: "", url: "", image: "", price: "", notes: "", priority: 2, qty: 1 };

export function ItemForm({
  initial,
  kind,
  onSave,
  onCancel,
}: {
  initial?: Partial<ItemFields>;
  kind: "wish" | "idea";
  onSave: (f: ItemFields) => Promise<unknown>;
  onCancel: () => void;
}) {
  const isNew = !initial?.title;
  // Keep what someone typed for a new item, in case they leave the app to look at a store and come back.
  const draftKey = `giftstar:draft:${kind}`;
  const [start] = useState<{ fields: ItemFields; restored: boolean }>(() => {
    if (isNew) {
      try {
        const saved = JSON.parse(localStorage.getItem(draftKey) || "null");
        if (saved && (saved.title || saved.url)) return { fields: { ...EMPTY, ...initial, ...saved }, restored: true };
      } catch {
        // ignore: just start fresh
      }
    }
    return { fields: { ...EMPTY, ...initial }, restored: false };
  });
  const [f, setF] = useState<ItemFields>(start.fields);
  const [photos, setPhotos] = useState<string[]>(start.fields.image ? [start.fields.image] : []);
  const [fetching, setFetching] = useState(false);
  const [note, setNote] = useState("");
  const [lookup, setLookup] = useState<Lookup>("idle");
  const [store, setStore] = useState("");
  const [slow, setSlow] = useState(false);
  const shotInput = useRef<HTMLInputElement>(null);
  const looked = useRef(new Set<string>());
  const titleInput = useRef<HTMLInputElement>(null);
  const { busy, run } = useAction();
  const photoInput = useRef<HTMLInputElement>(null);
  const snapInput = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<ItemFields>) => setF((prev) => ({ ...prev, ...patch }));

  useEffect(() => {
    if (!isNew) return;
    try {
      if (f.title.trim() || f.url.trim()) localStorage.setItem(draftKey, JSON.stringify(f));
      else localStorage.removeItem(draftKey);
    } catch {
      // storage can be off in private browsing; the form still works
    }
  }, [f, isNew, draftKey]);

  const clearDraft = () => {
    try {
      localStorage.removeItem(draftKey);
    } catch {
      // ignore
    }
  };

  async function fetchDetails(raw: string) {
    const url = raw.trim();
    if (!/^https?:\/\//i.test(url) || looked.current.has(url)) return;
    looked.current.add(url);
    setFetching(true);
    setNote("");
    setLookup("idle");
    setSlow(false);
    try {
      let d = await api<Unfurl>("POST", "/unfurl", { url });
      if (!d.found && d.jobId) {
        setSlow(true);
        const r = await waitForJob(d.jobId);
        if (r) d = { ...r, url: r.url || d.url };
      }
      const shown = d.url || url;
      looked.current.add(shown);
      setStore(storeName(shown) || storeName(url));
      setF((prev) => ({
        ...prev,
        url: prev.url.trim() === url ? shown : prev.url,
        title: prev.title || d.title,
        price: prev.price || d.price,
        image: prev.image || d.image,
      }));
      setPhotos((prev) => [...new Set([...prev, ...d.images])]);
      setLookup(d.found ? (d.image ? "good" : "nophoto") : d.title ? "guessed" : "failed");
    } catch {
      setStore(storeName(url));
      setLookup("failed");
    } finally {
      setFetching(false);
      setSlow(false);
    }
  }

  // Read a screenshot of a store page: name, price and the product picture.
  const readScreenshot = (file: File) =>
    run(async () => {
      setNote("");
      const small = await shrinkImage(file, 1600, 0.8);
      const ai = await api<Shot>("POST", "/ai/screenshot", { image: await blobToDataUrl(small) });
      if (!ai.is_product_page || !ai.title) {
        setLookup("noshot");
        return;
      }
      let image = "";
      const box = ai.photo_found ? usableBox(ai) : null;
      if (box) {
        try {
          const up = await api<{ image: string }>("POST", "/upload", undefined, { raw: await cropImage(file, box) });
          image = up.image;
        } catch {
          // no picture is fine; the name and price still help
        }
      }
      if (image) setPhotos((prev) => [image, ...prev]);
      setF((prev) => ({
        ...prev,
        title: prev.title || ai.title,
        price: prev.price || ai.price,
        notes: prev.notes || ai.notes,
        image: prev.image || image,
      }));
      setLookup(image ? "good" : "nophoto");
    });

  // Accept anything pasted: a bare link, or share text like "Product name https://…".
  function takeLink(raw: string) {
    const { url, title } = parseShared(raw);
    if (!url) {
      if (title) {
        // Not a link: keep the words as the name, and don't leave them in the link box.
        setF((prev) => ({ ...prev, url: prev.url.trim() === raw.trim() ? "" : prev.url, title: prev.title || title }));
        setLookup("nolink");
      }
      return false;
    }
    setF((prev) => ({ ...prev, url, title: prev.title || title }));
    fetchDetails(url);
    return true;
  }

  const uploadPhoto = (file: File) =>
    run(async () => {
      const blob = await shrinkImage(file);
      const res = await api<{ image: string }>("POST", "/upload", undefined, { raw: blob });
      setPhotos((prev) => [res.image, ...prev]);
      set({ image: res.image });
    });

  const snap = (file: File) =>
    run(async () => {
      const small = await shrinkImage(file, 1024, 0.8);
      const [ai, up] = await Promise.all([
        api<{ title: string; notes: string; search: string }>("POST", "/ai/snap", { image: await blobToDataUrl(small) }),
        api<{ image: string }>("POST", "/upload", undefined, { raw: small }),
      ]);
      setPhotos((prev) => [up.image, ...prev]);
      setF((prev) => ({
        ...prev,
        title: ai.title,
        notes: [ai.notes, prev.notes].filter(Boolean).join(" "),
        image: up.image,
      }));
      setNote(`Search tip: try “${ai.search}” at your favorite store, then paste the link above.`);
    });

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (f.title.trim())
          run(async () => {
            await onSave(f);
            clearDraft();
          });
      }}
    >
      {start.restored && (
        <div className="card soft small">We kept what you typed last time. You can keep going, or tap Cancel to start over.</div>
      )}

      {isNew && (
        <>
          <button type="button" className="btn block" onClick={() => snapInput.current?.click()} disabled={busy}>
            📷 Snap a photo of it
          </button>
          <input ref={snapInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.target.files?.[0] && snap(e.target.files[0])} />
          <p className="small muted center">or paste a link from any store below</p>
        </>
      )}

      <input ref={shotInput} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && readScreenshot(e.target.files[0])} />

      <label>
        Store link <span className="hint">(if you have one). Paste whatever you copied. We will find the link.</span>
        <input
          type="text"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Paste here"
          value={f.url}
          onChange={(e) => set({ url: e.target.value })}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData("text");
            if (!pasted.trim()) return;
            e.preventDefault();
            takeLink(pasted);
          }}
          onBlur={() => {
            if (f.url.trim() && isNew) takeLink(f.url);
          }}
        />
      </label>

      {fetching && (
        <div className="card brand row">
          <Spinner />{" "}
          <span>{slow ? "Still looking. Amazon can take up to 30 seconds. Please wait." : "Looking at the store page. This can take a few seconds."}</span>
        </div>
      )}
      {busy && !fetching && (
        <div className="row muted small">
          <Spinner /> Working on it…
        </div>
      )}
      {!fetching && lookup === "good" && (
        <div className="card soft">
          <strong>✓ Got it!</strong> Please check the name, picture and price below. Then tap <strong>Save it</strong>.
        </div>
      )}
      {!fetching && lookup === "nophoto" && (
        <div className="card soft">
          <strong>✓ We found the name.</strong> We could not get a picture. You can tap <strong>+ Add</strong> below to add one. Or just tap <strong>Save it</strong>.
        </div>
      )}
      {!fetching && lookup === "guessed" && (
        <div className="card highlight">
          <strong>We guessed the name from the link.</strong> Please check it below. You can fix it if it is wrong. A photo is nice, but you do not need one.
        </div>
      )}
      {!fetching && lookup === "nolink" && (
        <div className="card soft">We did not find a web link in that. That is okay. Just type what it is below.</div>
      )}
      {!fetching && lookup === "failed" && (
        <div className="card highlight stack">
          <strong>{store ? `${store} will not let us read that page.` : "We could not read that page."}</strong>
          <p>That is not your fault. Some stores block this. Your link is saved. Please:</p>
          <button type="button" className="btn block" onClick={() => titleInput.current?.focus()}>
            ✏️ Type what it is
          </button>
          <button type="button" className="btn block" onClick={() => snapInput.current?.click()} disabled={busy}>
            📷 Take a photo of it
          </button>
          <button type="button" className="btn block" onClick={() => shotInput.current?.click()} disabled={busy}>
            🖼️ Use a screenshot of the page
          </button>
          <p className="small muted">
            To take a screenshot on an iPhone, press the side button and the volume-up button at the same time. On an Android phone, press the power button and the volume-down button together. Then tap the button above and pick it.
          </p>
          {store === "Amazon" && (
            <p className="small muted">Tip: in the Amazon app, tap Share, then Copy. The name often comes with the link. Paste it here.</p>
          )}
        </div>
      )}
      {!fetching && lookup === "noshot" && (
        <div className="card highlight">
          <strong>We could not read that screenshot.</strong> Please try one that shows the whole product page. Or just type what it is below.
        </div>
      )}
      {note && <p className="small muted">{note}</p>}

      <label>
        What is it? <span className="hint">For example: Blue sweater, size large</span>
        <input ref={titleInput} value={f.title} onChange={(e) => set({ title: e.target.value })} required maxLength={300} />
      </label>

      {isNew && f.title.trim().length >= 2 && (
        <div className="stack" style={{ gap: 6 }}>
          <a className="btn block" href={amazonSearchUrl(f.title)} target="_blank" rel="noopener noreferrer">
            🔍 Find it on Amazon
          </a>
          <p className="small muted">
            Amazon opens on its own. When you find it, tap <strong>Share</strong>, then <strong>Copy</strong>. Come back here and paste it in the Store link box above.
          </p>
        </div>
      )}

      <div className="stack" style={{ gap: 6 }}>
        <strong style={{ fontSize: 16 }}>Photo</strong>
        <div className="photos">
          {photos.map((p) => (
            <button type="button" key={p} className={p === f.image ? "on" : ""} onClick={() => set({ image: p })} aria-label="Use this photo">
              <img src={imageSrc(p)} alt="" referrerPolicy="no-referrer" />
            </button>
          ))}
          <button type="button" onClick={() => photoInput.current?.click()} aria-label="Upload a photo" disabled={busy}>
            <span className="thumb empty" style={{ width: 72, height: 72, fontSize: 15, fontWeight: 700, color: "var(--brand)" }}>
              + Add
            </span>
          </button>
        </div>
        <input ref={photoInput} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && uploadPhoto(e.target.files[0])} />
      </div>

      <div className="row" style={{ alignItems: "flex-start" }}>
        <label style={{ flex: 1, minWidth: 120 }}>
          Price <span className="hint">(if you know)</span>
          <input value={f.price} onChange={(e) => set({ price: e.target.value })} placeholder="$" maxLength={40} />
        </label>
        {kind === "wish" && (
          <label style={{ width: 110 }}>
            How many
            <input type="number" min={1} max={99} value={f.qty} onChange={(e) => set({ qty: Number(e.target.value) || 1 })} />
          </label>
        )}
      </div>

      {kind === "wish" && (
        <label>
          How much do you want it?
          <select value={f.priority} onChange={(e) => set({ priority: Number(e.target.value) })}>
            <option value={1}>Really want ★</option>
            <option value={2}>Would love</option>
            <option value={3}>Nice to have</option>
          </select>
        </label>
      )}

      <label>
        Notes <span className="hint">{kind === "wish" ? "Size, color, “any brand is fine”…" : "Why it's a good idea, where to find it…"}</span>
        <textarea value={f.notes} onChange={(e) => set({ notes: e.target.value })} maxLength={2000} />
      </label>

      {!f.title.trim() && <p className="small muted center">Type what it is above. Then the Save button will work.</p>}

      <div className="row">
        <button className="btn primary" style={{ flex: 1 }} disabled={busy || !f.title.trim()}>
          Save it
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            clearDraft();
            onCancel();
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
