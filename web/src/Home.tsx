import { useEffect, useState } from "react";
import { api, type PersonSummary } from "./api";
import { groupByHousehold } from "./Join";
import { Avatar, Loading, useToast } from "./ui";
import { go } from "./router";

type HomeData = {
  me: { id: string; name: string; is_kid: number; in_drawing: number };
  people: (PersonSummary & { ideas: number; signed_in: number })[];
  assignment: { id: string; name: string } | null;
  removed: { id: string; title: string; owner_id: string; owner_name: string }[];
  unanswered: number;
  answers: { id: string; question: string; answer: string; target_id: string; target_name: string }[];
  myClaims: { id: string; title: string; status: string; owner_id: string; owner_name: string }[];
};

export function Home() {
  const [data, setData] = useState<HomeData | null>(null);
  const toast = useToast();

  useEffect(() => {
    api<HomeData>("GET", "/home").then(setData, (e) => toast(e.message));
  }, [toast]);

  if (!data) return <Loading />;
  const { me } = data;
  const mine = data.people.find((p) => p.id === me.id);
  const others = data.people.filter((p) => p.id !== me.id);
  const shoppingByPerson = groupBy(data.myClaims, (c) => c.owner_name);

  return (
    <div className="stack-lg">
      <h1 style={{ paddingTop: 20 }}>Merry Christmas, {me.name.replace(/^(Grandpa|Grandma)\s+/, "")}!</h1>

      {!!me.in_drawing && (
        <div className="card highlight stack">
          {data.assignment ? (
            <>
              <p className="small muted" style={{ fontWeight: 700 }}>
                THIS CHRISTMAS YOU'RE BUYING FOR
              </p>
              <button className="person" style={{ background: "transparent", border: 0, boxShadow: "none", padding: 0 }} onClick={() => go(`/p/${data.assignment!.id}`)}>
                <span className="row">
                  <Avatar id={data.assignment.id} name={data.assignment.name} />
                  <h2>{data.assignment.name} →</h2>
                </span>
              </button>
              <p className="small muted">And everyone shops for the kids!</p>
            </>
          ) : (
            <p>
              <strong>Cathy drawing names soon - stay tuned!</strong>
            </p>
          )}
        </div>
      )}

      {(data.unanswered > 0 || data.removed.length > 0 || data.answers.length > 0) && (
        <div className="stack">
          {data.unanswered > 0 && (
            <button className="card brand spread" style={{ font: "inherit", textAlign: "left", cursor: "pointer", color: "inherit" }} onClick={() => go(`/p/${me.id}`)}>
              <span>
                <strong>Someone has a question</strong> about your list
              </span>
              <span className="badge">{data.unanswered}</span>
            </button>
          )}
          {data.removed.map((r) => (
            <button key={r.id} className="card brand" style={{ font: "inherit", textAlign: "left", cursor: "pointer", color: "inherit" }} onClick={() => go(`/p/${r.owner_id}`)}>
              <strong>Heads up:</strong> {r.owner_name} removed “{r.title}” from their list, and you had claimed it.
            </button>
          ))}
          {data.answers.map((a) => (
            <button key={a.id} className="card soft stack" style={{ font: "inherit", textAlign: "left", cursor: "pointer", color: "inherit" }} onClick={() => go(`/p/${a.target_id}`)}>
              <span className="small muted">{a.target_name} answered your question</span>
              <span>
                “{a.question}” — <strong>{a.answer}</strong>
              </span>
            </button>
          ))}
        </div>
      )}

      <button className="btn primary block" style={{ minHeight: 64, fontSize: 20 }} onClick={() => go(`/p/${me.id}`)}>
        My wish list{mine?.items ? ` (${mine.items})` : ""}
      </button>

      <div className="stack">
        <h2>Family lists</h2>
        {groupByHousehold(others).map(([household, members]) => (
          <div className="stack" key={household}>
            <h3 className="muted">{household}</h3>
            <div className="people">
              {members.map((p) => (
                <button key={p.id} className="person" onClick={() => go(`/p/${p.id}`)}>
                  <Avatar id={p.id} name={p.name} />
                  <strong>{p.name}</strong>
                  <span className="small muted">{listStatus(p)}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {data.myClaims.length > 0 && (
        <div className="stack">
          <h2>My shopping list</h2>
          <div className="card stack">
            {[...shoppingByPerson.entries()].map(([name, claims]) => (
              <div key={name} className="stack" style={{ gap: 4 }}>
                <strong>For {name}</strong>
                {claims.map((c) => (
                  <button
                    key={c.id}
                    className="spread"
                    style={{ font: "inherit", background: "none", border: 0, padding: "4px 0", color: "inherit", cursor: "pointer", textAlign: "left" }}
                    onClick={() => go(`/p/${c.owner_id}`)}
                  >
                    <span>{c.title}</span>
                    <span className={`chip ${c.status}`}>{c.status === "bought" ? "Bought" : "Reserved"}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function listStatus(p: { items?: number; ideas: number; signed_in: number }) {
  const parts = [];
  if (p.items) parts.push(`${p.items} wish${p.items === 1 ? "" : "es"}`);
  if (p.ideas) parts.push(`${p.ideas} idea${p.ideas === 1 ? "" : "s"}`);
  if (parts.length) return parts.join(" · ");
  return p.signed_in ? "No list yet" : "Yet to sign in";
}

function groupBy<T>(list: T[], key: (t: T) => string) {
  const m = new Map<string, T[]>();
  for (const x of list) m.set(key(x), [...(m.get(key(x)) || []), x]);
  return m;
}
