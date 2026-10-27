import { useCallback, useEffect, useState } from "react";
import { api, type Group, type Idea, type Item, type PersonView, type Question } from "./api";
import { ItemForm, type ItemFields } from "./ItemForm";
import { AiIdeas } from "./AiIdeas";
import { Avatar, Loading, PRIORITY, Sheet, Thumb, cents, hostOf, money, useAction, useToast } from "./ui";
import { go } from "./router";

export function PersonPage({ id, meId }: { id: string; meId: string }) {
  const [view, setView] = useState<PersonView | null>(null);
  const toast = useToast();
  const reload = useCallback(
    () => api<PersonView>("GET", `/people/${id}`).then(setView, (e) => toast(e.message)),
    [id, toast],
  );
  useEffect(() => {
    setView(null);
    reload();
  }, [reload]);

  if (!view) return <Loading />;
  return view.isMe ? <MyList view={view} reload={reload} /> : <TheirList view={view} meId={meId} reload={reload} />;
}

function ItemCard({ item, children, footer }: { item: Item | Idea; children?: React.ReactNode; footer?: React.ReactNode }) {
  const priority = "priority" in item ? item.priority : 0;
  return (
    <div className={`card item${"deleted_at" in item && item.deleted_at ? " removed" : ""}`}>
      <Thumb image={item.image} alt={item.title} />
      <div className="stack" style={{ gap: 6, minWidth: 0 }}>
        <h3>{item.title}</h3>
        <div className="row small" style={{ gap: 6 }}>
          {item.price && <strong>{item.price}</strong>}
          {priority === 1 && <span className="chip must">★ Really wants</span>}
          {priority === 3 && <span className="chip">Nice to have</span>}
          {"qty" in item && item.qty > 1 && <span className="chip">Wants {item.qty}</span>}
        </div>
        {item.notes && <p className="small" style={{ whiteSpace: "pre-wrap" }}>{item.notes}</p>}
        {item.url && (
          <a className="small" href={item.url} target="_blank" rel="noopener noreferrer">
            View at {hostOf(item.url) || "store"} ↗
          </a>
        )}
        {children}
      </div>
      {footer && <div className="item-actions">{footer}</div>}
    </div>
  );
}

// ---------------- My own list ----------------

function MyList({ view, reload }: { view: PersonView; reload: () => void }) {
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const { busy, run } = useAction();
  const items = view.items;
  const open = view.questions.filter((q) => !q.answer);
  const answered = view.questions.filter((q) => q.answer);

  const save = async (f: ItemFields) => {
    if (editing === "new") await api("POST", "/items", f);
    else await api("PATCH", `/items/${(editing as Item).id}`, f);
    setEditing(null);
    reload();
  };

  const move = (index: number, delta: number) =>
    run(async () => {
      const ids = items.map((i) => i.id);
      const [moved] = ids.splice(index, 1);
      ids.splice(index + delta, 0, moved);
      await api("POST", "/items/reorder", { ids });
      reload();
    });

  const remove = (item: Item) => {
    if (!confirm(`Remove “${item.title}” from your list?`)) return;
    run(async () => {
      await api("DELETE", `/items/${item.id}`);
      reload();
    }, "Removed.");
  };

  return (
    <div className="stack-lg">
      <div className="spread" style={{ paddingTop: 20 }}>
        <h1>My wish list</h1>
      </div>
      <div className="row">
        <button className="btn primary" style={{ flex: 1 }} onClick={() => setEditing("new")}>
          + Add a wish
        </button>
        <button className="btn" onClick={() => setAiOpen(true)}>
          ✨ Ideas
        </button>
      </div>

      {open.length > 0 && (
        <div className="stack">
          <h2>Questions for you</h2>
          <p className="small muted">You won't see who asked. Your answer is shown to everyone shopping for you.</p>
          {open.map((q) => (
            <AnswerBox key={q.id} q={q} item={items.find((i) => i.id === q.item_id)} reload={reload} />
          ))}
        </div>
      )}

      {items.length === 0 ? (
        <div className="card soft center stack">
          <p style={{ fontSize: 40 }}>🎄</p>
          <p>Your list is empty. Add things you'd love this Christmas: paste a link from any store, snap a photo, or just type it in.</p>
        </div>
      ) : (
        <div className="stack">
          <p className="small muted">You won't see what's been bought. That's the fun part!</p>
          {items.map((item, i) => (
            <ItemCard
              key={item.id}
              item={item}
              footer={
                <>
                  <button className="btn small" onClick={() => setEditing(item)}>
                    Edit
                  </button>
                  <button className="btn small" onClick={() => move(i, -1)} disabled={busy || i === 0} aria-label="Move up">
                    ↑
                  </button>
                  <button className="btn small" onClick={() => move(i, 1)} disabled={busy || i === items.length - 1} aria-label="Move down">
                    ↓
                  </button>
                  <button className="btn small ghost danger" onClick={() => remove(item)}>
                    Remove
                  </button>
                </>
              }
            />
          ))}
        </div>
      )}

      {answered.length > 0 && (
        <div className="stack">
          <h2>Questions you've answered</h2>
          {answered.map((q) => (
            <QA key={q.id} q={q} item={items.find((i) => i.id === q.item_id)} />
          ))}
        </div>
      )}

      <div className="card soft stack">
        <div className="spread">
          <h2>About me</h2>
          <button className="btn small" onClick={() => setProfileOpen(true)}>
            Edit
          </button>
        </div>
        <ProfileSummary person={view.person} empty="Add your sizes, favorite things and anything you'd rather not get. It helps everyone shop for you." />
      </div>

      {editing && (
        <Sheet title={editing === "new" ? "Add a wish" : "Edit wish"} onClose={() => setEditing(null)}>
          <ItemForm kind="wish" initial={editing === "new" ? undefined : editing} onSave={save} onCancel={() => setEditing(null)} />
        </Sheet>
      )}
      {profileOpen && <ProfileEditor person={view.person} onClose={() => setProfileOpen(false)} reload={reload} />}
      {aiOpen && (
        <AiIdeas
          targetId={view.person.id}
          title="Ideas for my list"
          addLabel="Add to my list"
          onAdd={async (idea) => {
            await api("POST", "/items", { title: idea.title, notes: idea.why, price: idea.price });
            reload();
          }}
          onClose={() => setAiOpen(false)}
        />
      )}
    </div>
  );
}

function AnswerBox({ q, item, reload }: { q: Question; item?: Item; reload: () => void }) {
  const [answer, setAnswer] = useState("");
  const { busy, run } = useAction();
  return (
    <form
      className="card brand stack"
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          await api("POST", `/questions/${q.id}/answer`, { answer });
          reload();
        }, "Answered. Everyone shopping for you can see it.");
      }}
    >
      {item && <span className="small muted">About “{item.title}”</span>}
      <strong>“{q.question}”</strong>
      <input value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Your answer" maxLength={1000} />
      <div className="row">
        <button className="btn primary small" disabled={busy || !answer.trim()}>
          Answer
        </button>
        <button
          type="button"
          className="btn ghost small"
          onClick={() =>
            run(async () => {
              await api("DELETE", `/questions/${q.id}`);
              reload();
            })
          }
        >
          Dismiss
        </button>
      </div>
    </form>
  );
}

function QA({ q, item }: { q: Question; item?: Item }) {
  return (
    <div className="qa stack" style={{ gap: 2 }}>
      {item && <span className="small muted">About “{item.title}”</span>}
      <span>
        Q: {q.question} {q.mine && <span className="chip">You asked</span>}
      </span>
      {q.answer ? <strong>A: {q.answer}</strong> : <span className="small muted">Waiting for an answer…</span>}
    </div>
  );
}

function ProfileSummary({ person, empty }: { person: PersonView["person"]; empty: string }) {
  const rows = [
    ["Sizes", person.sizes],
    ["Loves", person.favorites],
    ["Please don't buy", person.dont_buy],
    ["About", person.about],
  ].filter(([, v]) => v);
  if (!rows.length) return <p className="small muted">{empty}</p>;
  return (
    <div className="stack" style={{ gap: 6 }}>
      {rows.map(([k, v]) => (
        <p key={k} style={{ whiteSpace: "pre-wrap" }}>
          <strong>{k}:</strong> {v}
        </p>
      ))}
    </div>
  );
}

function ProfileEditor({ person, onClose, reload }: { person: PersonView["person"]; onClose: () => void; reload: () => void }) {
  const [p, setP] = useState({ sizes: person.sizes, favorites: person.favorites, dont_buy: person.dont_buy, about: person.about });
  const { busy, run } = useAction();
  return (
    <Sheet title="About me" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            await api("PUT", "/profile", p);
            reload();
            onClose();
          }, "Saved.");
        }}
      >
        <label>
          Sizes <span className="hint">Shirt, pants, shoes, ring…</span>
          <textarea value={p.sizes} onChange={(e) => setP({ ...p, sizes: e.target.value })} />
        </label>
        <label>
          Things I love <span className="hint">Colors, hobbies, teams, stores, snacks</span>
          <textarea value={p.favorites} onChange={(e) => setP({ ...p, favorites: e.target.value })} />
        </label>
        <label>
          Please don't buy me…
          <textarea value={p.dont_buy} onChange={(e) => setP({ ...p, dont_buy: e.target.value })} />
        </label>
        <label>
          Anything else <span className="hint">e.g. “I'm 9 and love Minecraft”</span>
          <textarea value={p.about} onChange={(e) => setP({ ...p, about: e.target.value })} />
        </label>
        <button className="btn primary block" disabled={busy}>
          Save
        </button>
      </form>
    </Sheet>
  );
}

// ---------------- Someone else's list ----------------

function TheirList({ view, meId, reload }: { view: PersonView; meId: string; reload: () => void }) {
  const { person } = view;
  const [asking, setAsking] = useState<{ itemId?: string; title?: string } | null>(null);
  const [ideaForm, setIdeaForm] = useState<Idea | "new" | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [groupFor, setGroupFor] = useState<Item | null>(null);
  const { busy, run } = useAction();
  const first = person.name.replace(/^(Grandpa|Grandma)\s+/, "");
  const live = view.items.filter((i) => !i.deleted_at);
  const removed = view.items.filter((i) => i.deleted_at && i.claims?.some((c) => c.claimer_id === meId));
  const generalQs = view.questions.filter((q) => !q.item_id);

  const claim = (path: string, status: "reserved" | "bought", msg: string) =>
    run(async () => {
      await api("POST", `${path}/claim`, { status });
      reload();
    }, msg);
  const unclaim = (path: string) =>
    run(async () => {
      await api("DELETE", `${path}/claim`);
      reload();
    }, "Unclaimed.");

  const saveIdea = async (f: ItemFields) => {
    if (ideaForm === "new") await api("POST", "/ideas", { ...f, targetId: person.id });
    else await api("PATCH", `/ideas/${(ideaForm as Idea).id}`, f);
    setIdeaForm(null);
    reload();
  };

  return (
    <div className="stack-lg">
      <div className="row" style={{ paddingTop: 20 }}>
        <Avatar id={person.id} name={person.name} />
        <h1>{person.name}'s list</h1>
      </div>

      {(person.sizes || person.favorites || person.dont_buy || person.about) && (
        <div className="card soft">
          <ProfileSummary person={person} empty="" />
        </div>
      )}

      <p className="small muted">
        {first} can't see anything you reserve, buy, suggest or ask here.
      </p>

      {live.length === 0 && <div className="card soft center">Nothing on {first}'s list yet. Try the family ideas below.</div>}

      <div className="stack">
        {live.map((item) => {
          const claims = item.claims || [];
          const mine = claims.find((c) => c.claimer_id === meId);
          const taken = claims.reduce((n, c) => n + c.qty, 0);
          const left = item.qty - taken;
          const itemQs = view.questions.filter((q) => q.item_id === item.id);
          return (
            <ItemCard
              key={item.id}
              item={item}
              footer={
                <>
                  {!mine && left > 0 && (
                    <>
                      <button className="btn small primary" disabled={busy} onClick={() => claim(`/items/${item.id}`, "reserved", "Reserved for you. Nobody else will buy it.")}>
                        I'll get this
                      </button>
                      <button className="btn small" disabled={busy} onClick={() => claim(`/items/${item.id}`, "bought", "Marked as bought.")}>
                        Already bought
                      </button>
                    </>
                  )}
                  {mine?.status === "reserved" && (
                    <button className="btn small green" disabled={busy} onClick={() => claim(`/items/${item.id}`, "bought", "Marked as bought.")}>
                      I bought it
                    </button>
                  )}
                  {mine && !item.group && (
                    <button className="btn small ghost" disabled={busy} onClick={() => unclaim(`/items/${item.id}`)}>
                      Unclaim
                    </button>
                  )}
                  {!item.group && (left > 0 || mine) && (
                    <button className="btn small ghost" onClick={() => setGroupFor(item)}>
                      Go in on it together
                    </button>
                  )}
                  <button className="btn small ghost" onClick={() => setAsking({ itemId: item.id, title: item.title })}>
                    Ask {first}
                  </button>
                </>
              }
            >
              {item.suggested_by_name && <span className="chip author">💡 {item.suggested_by_name} suggested this too</span>}
              {claims.length > 0 && (
                <div className="row" style={{ gap: 6 }}>
                  {claims.map((c) => (
                    <span key={c.claimer_id} className={`chip ${c.status}`}>
                      {c.status === "bought" ? "Bought" : "Reserved"} by {c.claimer_id === meId ? "you" : c.claimer_name}
                      {item.qty > 1 ? ` (${c.qty})` : ""}
                    </span>
                  ))}
                  {item.qty > 1 && left > 0 && <span className="chip">{left} still needed</span>}
                </div>
              )}
              {item.group && <GroupPanel group={item.group} meId={meId} ownerId={person.id} reload={reload} />}
              {itemQs.map((q) => (
                <QA key={q.id} q={q} />
              ))}
            </ItemCard>
          );
        })}
      </div>

      {removed.length > 0 && (
        <div className="stack">
          <h2>Removed from the list</h2>
          {removed.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              footer={
                <button className="btn small" onClick={() => unclaim(`/items/${item.id}`)}>
                  OK, remove my claim
                </button>
              }
            >
              <span className="error small">{first} removed this after you claimed it.</span>
            </ItemCard>
          ))}
        </div>
      )}

      <div className="stack">
        <div className="spread">
          <h2>Questions</h2>
          <button className="btn small" onClick={() => setAsking({})}>
            Ask {first}
          </button>
        </div>
        <p className="small muted">{first} sees your question but not your name. Everyone shopping for {first} sees the answer.</p>
        {generalQs.map((q) => (
          <QA key={q.id} q={q} />
        ))}
      </div>

      <div className="stack">
        <div className="spread">
          <h2>Family ideas</h2>
        </div>
        <p className="small muted">Gift ideas from the family. {first} can't see these.</p>
        <div className="row">
          <button className="btn" style={{ flex: 1 }} onClick={() => setIdeaForm("new")}>
            + Add an idea
          </button>
          <button className="btn" onClick={() => setAiOpen(true)}>
            ✨ Ideas for {first}
          </button>
        </div>
        {(view.ideas || []).map((idea) => (
          <ItemCard
            key={idea.id}
            item={idea}
            footer={
              <>
                {!idea.claimer_id && (
                  <button className="btn small primary" disabled={busy} onClick={() => claim(`/ideas/${idea.id}`, "reserved", "Reserved for you.")}>
                    I'll get this
                  </button>
                )}
                {idea.claimer_id === meId && idea.status === "reserved" && (
                  <button className="btn small green" disabled={busy} onClick={() => claim(`/ideas/${idea.id}`, "bought", "Marked as bought.")}>
                    I bought it
                  </button>
                )}
                {idea.claimer_id === meId && (
                  <button className="btn small ghost" disabled={busy} onClick={() => unclaim(`/ideas/${idea.id}`)}>
                    Unclaim
                  </button>
                )}
                {idea.author_id === meId && (
                  <>
                    <button className="btn small ghost" onClick={() => setIdeaForm(idea)}>
                      Edit
                    </button>
                    <button
                      className="btn small ghost danger"
                      onClick={() =>
                        confirm("Delete this idea?") &&
                        run(async () => {
                          await api("DELETE", `/ideas/${idea.id}`);
                          reload();
                        })
                      }
                    >
                      Delete
                    </button>
                  </>
                )}
              </>
            }
          >
            <div className="row" style={{ gap: 6 }}>
              <span className="chip author">💡 Added by {idea.author_id === meId ? "you" : idea.author_name}</span>
              {idea.claimer_id && (
                <span className={`chip ${idea.status}`}>
                  {idea.status === "bought" ? "Bought" : "Reserved"} by {idea.claimer_id === meId ? "you" : idea.claimer_name}
                </span>
              )}
            </div>
            {idea.similar_item_id && (
              <div className="card soft stack" style={{ padding: 10, gap: 6 }}>
                <span className="small">
                  {first}'s own list has something similar: <strong>“{idea.similar_item_title}”</strong>
                </span>
                <button
                  className="btn small"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await api("POST", `/ideas/${idea.id}/merge`, { itemId: idea.similar_item_id });
                      reload();
                    }, "Merged into their wish. Any claim moved over.")
                  }
                >
                  Same thing, merge
                </button>
              </div>
            )}
          </ItemCard>
        ))}
      </div>

      {asking && <AskSheet targetId={person.id} name={first} {...asking} onClose={() => setAsking(null)} reload={reload} />}
      {ideaForm && (
        <Sheet title={ideaForm === "new" ? `Idea for ${first}` : "Edit idea"} onClose={() => setIdeaForm(null)}>
          <ItemForm kind="idea" initial={ideaForm === "new" ? undefined : ideaForm} onSave={saveIdea} onCancel={() => setIdeaForm(null)} />
        </Sheet>
      )}
      {aiOpen && (
        <AiIdeas
          targetId={person.id}
          title={`Ideas for ${first}`}
          addLabel="Save as family idea"
          onAdd={async (idea) => {
            await api("POST", "/ideas", { targetId: person.id, title: idea.title, notes: idea.why, price: idea.price });
            reload();
          }}
          onClose={() => setAiOpen(false)}
        />
      )}
      {groupFor && <StartGroup item={groupFor} onClose={() => setGroupFor(null)} reload={reload} />}
      <button className="btn ghost" onClick={() => go("/")}>
        ← Back to everyone
      </button>
    </div>
  );
}

function AskSheet({ targetId, itemId, title, name, onClose, reload }: { targetId: string; itemId?: string; title?: string; name: string; onClose: () => void; reload: () => void }) {
  const [question, setQuestion] = useState("");
  const { busy, run } = useAction();
  return (
    <Sheet title={`Ask ${name}`} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            await api("POST", "/questions", { targetId, itemId, question });
            reload();
            onClose();
          }, `Sent. ${name} won't know it was you.`);
        }}
      >
        {title && <p className="muted">About “{title}”</p>}
        <textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Which color? What size are you now?" maxLength={500} autoFocus />
        <button className="btn primary block" disabled={busy || !question.trim()}>
          Send anonymously
        </button>
      </form>
    </Sheet>
  );
}

// ---------------- Group gifts ----------------

function StartGroup({ item, onClose, reload }: { item: Item; onClose: () => void; reload: () => void }) {
  const [total, setTotal] = useState(item.price || "");
  const [note, setNote] = useState("");
  const { busy, run } = useAction();
  return (
    <Sheet title="Go in on it together" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            await api("POST", `/items/${item.id}/group`, { total_cents: cents(total), note });
            reload();
            onClose();
          }, "Group gift started. Others can now chip in.");
        }}
      >
        <p>
          You'll organize a group gift for <strong>{item.title}</strong>. Others can join and say how much they're putting in. You keep track of who's paid you back. No money
          moves through GiftStar.
        </p>
        <label>
          Total cost
          <input value={total} onChange={(e) => setTotal(e.target.value)} placeholder="$" inputMode="decimal" />
        </label>
        <label>
          Note for the group <span className="hint">e.g. “Venmo me @name”</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </label>
        <button className="btn primary block" disabled={busy}>
          Start group gift
        </button>
      </form>
    </Sheet>
  );
}

function GroupPanel({ group, meId, ownerId, reload }: { group: Group; meId: string; ownerId: string; reload: () => void }) {
  const { busy, run } = useAction();
  const [amount, setAmount] = useState("");
  const isOrganizer = group.organizer_id === meId;
  const me = group.people.find((p) => p.person_id === meId);
  const pledged = group.people.reduce((n, p) => n + p.amount_cents, 0);
  const evenShare = group.total_cents && group.people.length ? Math.ceil(group.total_cents / group.people.length) : 0;

  const put = (pid: string, amount_cents: number, paid: boolean, msg?: string) =>
    run(async () => {
      await api("PUT", `/groups/${group.id}/people/${pid}`, { amount_cents, paid });
      reload();
    }, msg);

  return (
    <div className="card soft stack" style={{ padding: 12 }}>
      <div className="spread">
        <strong>👥 Group gift</strong>
        <span className="small muted">Organized by {isOrganizer ? "you" : group.organizer_name}</span>
      </div>
      {group.total_cents > 0 && (
        <p className="small">
          Total {money(group.total_cents)} · pledged {money(pledged)}
          {evenShare > 0 && ` · even split ${money(evenShare)} each`}
        </p>
      )}
      {group.note && <p className="small">“{group.note}”</p>}
      <table className="small">
        <tbody>
          {group.people.map((p) => (
            <tr key={p.person_id}>
              <td>{p.person_id === meId ? "You" : p.name}</td>
              <td>{p.amount_cents ? money(p.amount_cents) : "—"}</td>
              <td>
                {p.person_id === group.organizer_id ? (
                  <span className="chip bought">Organizer</span>
                ) : isOrganizer ? (
                  <label className="row" style={{ flexDirection: "row", fontWeight: 400, gap: 6 }}>
                    <input type="checkbox" style={{ width: 22, height: 22 }} checked={!!p.paid} disabled={busy} onChange={(e) => put(p.person_id, p.amount_cents, e.target.checked)} />
                    Paid
                  </label>
                ) : (
                  <span className={`chip ${p.paid ? "bought" : "reserved"}`}>{p.paid ? "Paid" : "Not paid yet"}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {meId !== ownerId && (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            put(meId, cents(amount || (evenShare ? String(evenShare / 100) : "0")), !!me?.paid, me ? "Updated." : "You're in!");
            setAmount("");
          }}
        >
          <input
            style={{ flex: 1, minWidth: 100 }}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={me ? `My share (${money(me.amount_cents)})` : evenShare ? `My share (${money(evenShare)})` : "My share $"}
            inputMode="decimal"
          />
          <button className="btn small primary" disabled={busy}>
            {me ? "Update" : "Count me in"}
          </button>
        </form>
      )}
      <div className="row">
        {me && !isOrganizer && (
          <button
            className="btn small ghost"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api("DELETE", `/groups/${group.id}/people/${meId}`);
                reload();
              }, "You're out.")
            }
          >
            Leave group
          </button>
        )}
        {isOrganizer && (
          <button
            className="btn small ghost danger"
            disabled={busy}
            onClick={() =>
              confirm("Cancel this group gift?") &&
              run(async () => {
                await api("DELETE", `/groups/${group.id}`);
                reload();
              })
            }
          >
            Cancel group gift
          </button>
        )}
      </div>
    </div>
  );
}
