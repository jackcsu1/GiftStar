import { useRef, useState } from "react";
import { api, blobToDataUrl, imageSrc, shrinkImage } from "./api";
import { parseShared, storeName } from "./links";
import { Spinner, useAction } from "./ui";

export type ItemFields = { title: string; url: string; image: string; price: string; notes: string; priority: number; qty: number };

type Unfurl = { url: string; title: string; image: string; price: string; images: string[]; found: boolean };
type Lookup = "idle" | "good" | "nophoto" | "guessed" | "failed" | "nolink";

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
  const [f, setF] = useState<ItemFields>({ ...EMPTY, ...initial });
  const [photos, setPhotos] = useState<string[]>(initial?.image ? [initial.image] : []);
  const [fetching, setFetching] = useState(false);
  const [note, setNote] = useState("");
  const [lookup, setLookup] = useState<Lookup>("idle");
  const [store, setStore] = useState("");
  const looked = useRef(new Set<string>());
  const titleInput = useRef<HTMLInputElement>(null);
  const { busy, run } = useAction();
  const photoInput = useRef<HTMLInputElement>(null);
  const snapInput = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<ItemFields>) => setF((prev) => ({ ...prev, ...patch }));
  const isNew = !initial?.title;

  async function fetchDetails(raw: string) {
    const url = raw.trim();
    if (!/^https?:\/\//i.test(url) || looked.current.has(url)) return;
    looked.current.add(url);
    setFetching(true);
    setNote("");
    setLookup("idle");
    try {
      const d = await api<Unfurl>("POST", "/unfurl", { url });
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
    }
  }

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
        if (f.title.trim()) run(() => onSave(f));
      }}
    >
      {isNew && (
        <>
          <button type="button" className="btn block" onClick={() => snapInput.current?.click()} disabled={busy}>
            📷 Snap a photo of it
          </button>
          <input ref={snapInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.target.files?.[0] && snap(e.target.files[0])} />
          <p className="small muted center">or paste a link from any store below</p>
        </>
      )}

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
          <Spinner /> <span>Looking at the store page. This can take a few seconds.</span>
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
          {store === "Amazon" && (
            <p className="small muted">Tip: in the Amazon app, tap Share, then Copy. The name often comes with the link. Paste it here.</p>
          )}
        </div>
      )}
      {note && <p className="small muted">{note}</p>}

      <label>
        What is it? <span className="hint">For example: Blue sweater, size large</span>
        <input ref={titleInput} value={f.title} onChange={(e) => set({ title: e.target.value })} required maxLength={300} />
      </label>

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
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
