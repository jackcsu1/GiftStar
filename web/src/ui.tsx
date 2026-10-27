import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { imageSrc } from "./api";

export function StarLogo() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path d="M32 6l7.6 15.9 17.4 2.3-12.7 12 3.2 17.3L32 45.2l-15.5 8.3 3.2-17.3L7 24.2l17.4-2.3z" fill="#f6c453" />
    </svg>
  );
}

const AVATAR_COLORS = ["#a3233a", "#1f5c48", "#b8641a", "#5a4a8a", "#2f6690", "#8a3b6b", "#6b7f2a"];

export function Avatar({ name, id }: { name: string; id: string }) {
  const hash = [...id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const letter = name.replace(/^(Grandpa|Grandma)\s+/, "").charAt(0);
  return (
    <span className="avatar" style={{ background: AVATAR_COLORS[hash % AVATAR_COLORS.length] }}>
      {letter}
    </span>
  );
}

export function Thumb({ image, alt }: { image: string; alt: string }) {
  const [broken, setBroken] = useState(false);
  if (!image || broken) return <div className="thumb empty" aria-hidden="true">🎁</div>;
  return <img className="thumb" src={imageSrc(image)} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);
  return (
    <div className="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet stack" role="dialog" aria-modal="true" aria-label={title}>
        <div className="spread">
          <h2>{title}</h2>
          <button className="btn ghost" onClick={onClose} aria-label="Close">
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState("");
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(""), 3200);
    return () => clearTimeout(t);
  }, [msg]);
  return (
    <ToastCtx.Provider value={setMsg}>
      {children}
      {msg && (
        <div className="toast" role="status">
          {msg}
        </div>
      )}
    </ToastCtx.Provider>
  );
}

// Wraps an async action with a busy flag and shows failures as a toast.
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      setBusy(true);
      try {
        const out = await fn();
        if (success) toast(success);
        return out;
      } catch (e) {
        toast(e instanceof Error ? e.message : "Something went wrong.");
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  return { busy, run };
}

export function Spinner() {
  return <div className="spinner" role="progressbar" aria-label="Loading" />;
}

export function Loading() {
  return (
    <div className="row" style={{ padding: "48px 0", justifyContent: "center" }}>
      <Spinner />
    </div>
  );
}

export const PRIORITY: Record<number, string> = { 1: "Really want", 2: "Would love", 3: "Nice to have" };

export function money(cents: number) {
  return `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
}

export function cents(input: string) {
  const n = Number(input.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
