import { useCallback, useEffect, useState } from "react";
import { api, session, ApiError } from "./api";
import { Loading, Sheet, useAction, useToast } from "./ui";
import { go } from "./router";

type AdminPerson = { id: string; name: string; household: string; is_kid: number; devices: number; items: number };
type Data = { people: AdminPerson[]; assignments: { giver_id: string; recipient_id: string }[] };

export function Admin() {
  const [authed, setAuthed] = useState(!!session.admin);
  const [pass, setPass] = useState("");
  const [data, setData] = useState<Data | null>(null);
  const [code, setCode] = useState<{ name: string; code: string } | null>(null);
  const [pairs, setPairs] = useState<Record<string, string>>({});
  const [newPerson, setNewPerson] = useState({ name: "", household: "", is_kid: false });
  const toast = useToast();
  const { busy, run } = useAction();

  const load = useCallback(async () => {
    try {
      const d = await api<Data>("GET", "/admin/people", undefined, { admin: true });
      setData(d);
      setPairs(Object.fromEntries(d.assignments.map((a) => [a.giver_id, a.recipient_id])));
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        session.admin = "";
        setAuthed(false);
      }
      toast((e as Error).message);
    }
  }, [toast]);

  useEffect(() => {
    if (authed) load();
  }, [authed, load]);

  if (!authed) {
    return (
      <form
        className="card stack"
        style={{ marginTop: 32 }}
        onSubmit={(e) => {
          e.preventDefault();
          session.admin = pass.trim();
          setAuthed(true);
        }}
      >
        <h2>Admin</h2>
        <label>
          Admin passcode
          <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoFocus />
        </label>
        <button className="btn primary block" disabled={!pass.trim()}>
          Open admin
        </button>
        <button type="button" className="btn ghost" onClick={() => go("/")}>
          Back
        </button>
      </form>
    );
  }
  if (!data) return <Loading />;

  const grownups = data.people.filter((p) => !p.is_kid);
  const receiving = Object.values(pairs).filter(Boolean);
  const doubled = grownups.filter((p) => receiving.filter((r) => r === p.id).length > 1);
  const left = grownups.filter((p) => !receiving.includes(p.id));

  return (
    <div className="stack-lg" style={{ paddingTop: 20 }}>
      <div className="spread">
        <h1>Admin</h1>
        <button
          className="btn small ghost"
          onClick={() => {
            session.admin = "";
            setAuthed(false);
            setData(null);
          }}
        >
          Lock
        </button>
      </div>

      <div className="stack">
        <h2>Family</h2>
        <p className="small muted">
          <strong>Code</strong> lets someone get in on a new or shared device. <strong>Reset</strong> signs that name out everywhere so it can be picked again.
        </p>
        <div className="card" style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Set up</th>
                <th>Wishes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.people.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.name}
                    <div className="small muted">
                      {p.household}
                      {p.is_kid ? " · kid" : ""}
                    </div>
                  </td>
                  <td>{p.devices ? `✓ ${p.devices > 1 ? `(${p.devices})` : ""}` : <span className="muted">—</span>}</td>
                  <td>{p.items}</td>
                  <td>
                    <div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                      <button
                        className="btn small"
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            const r = await api<{ code: string }>("POST", "/admin/code", { personId: p.id }, { admin: true });
                            setCode({ name: p.name, code: r.code });
                          })
                        }
                      >
                        Code
                      </button>
                      {p.devices > 0 && (
                        <button
                          className="btn small ghost danger"
                          disabled={busy}
                          onClick={() =>
                            confirm(`Sign ${p.name} out of every device? Their list stays.`) &&
                            run(async () => {
                              await api("POST", "/admin/reset", { personId: p.id }, { admin: true });
                              await load();
                            }, `${p.name} can now pick their name again.`)
                          }
                        >
                          Reset
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="stack">
        <h2>Who buys for whom (grown-ups)</h2>
        <p className="small muted">Kids are left out. Everyone shops for them.</p>
        <div className="card stack">
          {grownups.map((g) => (
            <label key={g.id} className="row" style={{ flexDirection: "row", alignItems: "center" }}>
              <span style={{ width: 130 }}>{g.name}</span>
              <span className="muted">→</span>
              <select style={{ flex: 1, minWidth: 140 }} value={pairs[g.id] || ""} onChange={(e) => setPairs({ ...pairs, [g.id]: e.target.value })}>
                <option value="">Not set</option>
                {grownups
                  .filter((r) => r.id !== g.id)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
              </select>
            </label>
          ))}
          {doubled.length > 0 && <p className="error small">Getting two gifts: {doubled.map((p) => p.name).join(", ")}</p>}
          {receiving.length > 0 && left.length > 0 && <p className="small muted">Not assigned a buyer yet: {left.map((p) => p.name).join(", ")}</p>}
          <button
            className="btn primary"
            disabled={busy}
            onClick={() =>
              run(
                () =>
                  api(
                    "PUT",
                    "/admin/assignments",
                    { pairs: Object.entries(pairs).filter(([, r]) => r).map(([giver_id, recipient_id]) => ({ giver_id, recipient_id })) },
                    { admin: true },
                  ),
                "Saved. Everyone sees theirs on the home screen.",
              )
            }
          >
            Save pairings
          </button>
        </div>
      </div>

      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            await api("POST", "/admin/people", newPerson, { admin: true });
            setNewPerson({ name: "", household: newPerson.household, is_kid: false });
            await load();
          }, "Added.");
        }}
      >
        <h2>Add someone</h2>
        <div className="card stack">
          <label>
            Name
            <input value={newPerson.name} onChange={(e) => setNewPerson({ ...newPerson, name: e.target.value })} />
          </label>
          <label>
            Household
            <input list="households" value={newPerson.household} onChange={(e) => setNewPerson({ ...newPerson, household: e.target.value })} />
            <datalist id="households">
              {[...new Set(data.people.map((p) => p.household))].map((h) => (
                <option key={h} value={h} />
              ))}
            </datalist>
          </label>
          <label className="row" style={{ flexDirection: "row" }}>
            <input type="checkbox" style={{ width: 22, height: 22 }} checked={newPerson.is_kid} onChange={(e) => setNewPerson({ ...newPerson, is_kid: e.target.checked })} />
            This is a kid
          </label>
          <button className="btn" disabled={busy || !newPerson.name.trim() || !newPerson.household.trim()}>
            Add
          </button>
        </div>
      </form>

      {code && (
        <Sheet title={`Code for ${code.name}`} onClose={() => setCode(null)}>
          <p className="center" style={{ fontSize: 44, fontWeight: 700, letterSpacing: "0.2em", fontFamily: "ui-monospace, monospace" }}>
            {code.code}
          </p>
          <p>
            Have {code.name} open GiftStar, tap <strong>“I have a code from the admin”</strong> (or <strong>“Add someone to this device”</strong> on a shared device), and enter
            this code. It works once and expires in 7 days.
          </p>
        </Sheet>
      )}
    </div>
  );
}
