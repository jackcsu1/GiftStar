import { useRef, useState } from "react";
import { api, blobToDataUrl, imageSrc, shrinkImage } from "./api";
import { Spinner, useAction } from "./ui";

export type ItemFields = { title: string; url: string; image: string; price: string; notes: string; priority: number; qty: number };

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
  const { busy, run } = useAction();
  const photoInput = useRef<HTMLInputElement>(null);
  const snapInput = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<ItemFields>) => setF((prev) => ({ ...prev, ...patch }));
  const isNew = !initial?.title;

  async function fetchDetails(url: string) {
    if (!/^https?:\/\//i.test(url.trim())) return;
    setFetching(true);
    setNote("");
    try {
      const d = await api<{ url: string; title: string; image: string; price: string; images: string[] }>("POST", "/unfurl", { url: url.trim() });
      setF((prev) => ({
        ...prev,
        title: prev.title || d.title,
        price: prev.price || d.price,
        image: prev.image || d.image,
      }));
      setPhotos((prev) => [...new Set([...prev, ...d.images])]);
      if (!d.image) setNote("We couldn't grab a photo from that store. You can add your own below.");
    } catch {
      setNote("We couldn't read that link. Fill in the details yourself.");
    } finally {
      setFetching(false);
    }
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
          <p className="small muted center">or paste a link from any store</p>
        </>
      )}

      <label>
        Link
        <input
          type="url"
          inputMode="url"
          placeholder="https://…"
          value={f.url}
          onChange={(e) => set({ url: e.target.value })}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData("text");
            setTimeout(() => fetchDetails(pasted), 0);
          }}
          onBlur={() => isNew && !f.title && fetchDetails(f.url)}
        />
      </label>
      {fetching && (
        <div className="row muted small">
          <Spinner /> Getting details from the store…
        </div>
      )}
      {busy && !fetching && (
        <div className="row muted small">
          <Spinner /> Working on it…
        </div>
      )}
      {note && <p className="small muted">{note}</p>}

      <label>
        What is it?
        <input value={f.title} onChange={(e) => set({ title: e.target.value })} required maxLength={300} />
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
          Price
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

      <div className="row">
        <button className="btn primary" style={{ flex: 1 }} disabled={busy || !f.title.trim()}>
          Save
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
