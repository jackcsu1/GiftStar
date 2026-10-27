import { useCallback, useEffect, useState } from "react";
import { api, ApiError, session, type PersonSummary } from "./api";
import { Join } from "./Join";
import { Home } from "./Home";
import { PersonPage } from "./PersonPage";
import { Admin } from "./Admin";
import { Loading, Sheet, StarLogo, ToastProvider, useAction } from "./ui";
import { go, useRoute } from "./router";

export function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}

function Shell() {
  const route = useRoute();
  const [people, setPeople] = useState<PersonSummary[] | null>(null);
  const [current, setCurrent] = useState(session.person);
  const [failed, setFailed] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    if (!session.token) {
      setPeople([]);
      return;
    }
    try {
      const res = await api<{ people: PersonSummary[] }>("GET", "/me");
      setPeople(res.people);
      const keep = res.people.find((p) => p.id === session.person) || res.people[0];
      session.person = keep?.id || "";
      setCurrent(session.person);
      setFailed("");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        session.token = "";
        session.person = "";
        setPeople([]);
      } else {
        setFailed((e as Error).message);
      }
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (route === "/admin") {
    return (
      <>
        <Header />
        <main className="wrap">
          <Admin />
        </main>
      </>
    );
  }

  if (failed) {
    return (
      <main className="wrap stack center" style={{ paddingTop: 80 }}>
        <p>{failed}</p>
        <button className="btn primary" onClick={() => load()}>
          Try again
        </button>
      </main>
    );
  }
  if (people === null) return <Loading />;
  if (!people.length || !current) {
    return (
      <Join
        onJoined={(id) => {
          setCurrent(id);
          go("/");
          load();
        }}
      />
    );
  }

  const switchTo = (id: string) => {
    session.person = id;
    setCurrent(id);
    go("/");
  };

  const personMatch = route.match(/^\/p\/([\w-]+)$/);
  return (
    <>
      <Header people={people} current={current} onSwitch={switchTo} onAdd={() => setAdding(true)} />
      <main className="wrap" key={current}>
        {personMatch ? <PersonPage id={personMatch[1]} meId={current} /> : <Home />}
      </main>
      {adding && (
        <AddToDevice
          onClose={() => setAdding(false)}
          onAdded={(id) => {
            setAdding(false);
            session.person = id;
            load();
            go("/");
          }}
        />
      )}
    </>
  );
}

function Header({ people, current, onSwitch, onAdd }: { people?: PersonSummary[]; current?: string; onSwitch?: (id: string) => void; onAdd?: () => void }) {
  return (
    <header className="top">
      <div className="top-inner">
        <a className="logo" href="#/" onClick={() => window.scrollTo(0, 0)}>
          <StarLogo /> GiftStar
        </a>
        {people && people.length > 0 && (
          <select
            className="who"
            aria-label="Who's using GiftStar"
            value={current}
            onChange={(e) => (e.target.value === "__add" ? onAdd?.() : onSwitch?.(e.target.value))}
          >
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            <option value="__add">+ Add someone to this device…</option>
          </select>
        )}
      </div>
    </header>
  );
}

function AddToDevice({ onClose, onAdded }: { onClose: () => void; onAdded: (id: string) => void }) {
  const [code, setCode] = useState("");
  const { busy, run } = useAction();
  return (
    <Sheet title="Add someone to this device" onClose={onClose}>
      <p>For a shared phone or tablet. Ask Matt for that person's 6-letter code.</p>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const res = await api<{ token: string; personId: string }>("POST", "/redeem", { code, token: session.token });
            session.token = res.token;
            onAdded(res.personId);
          });
        }}
      >
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="ABC123"
          autoCapitalize="characters"
          maxLength={8}
          style={{ letterSpacing: "0.2em", fontWeight: 700 }}
          autoFocus
        />
        <button className="btn primary block" disabled={busy || code.trim().length < 6}>
          Add
        </button>
      </form>
    </Sheet>
  );
}
