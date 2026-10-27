import { useState } from "react";
import { api } from "./api";
import { Sheet, Spinner, useAction } from "./ui";

type Idea = { title: string; why: string; price: string; search: string };

export function AiIdeas({
  targetId,
  title,
  addLabel,
  onAdd,
  onClose,
}: {
  targetId: string;
  title: string;
  addLabel: string;
  onAdd: (idea: Idea) => Promise<void>;
  onClose: () => void;
}) {
  const [request, setRequest] = useState("");
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const { busy, run } = useAction();

  const generate = () =>
    run(async () => {
      setIdeas(null);
      const res = await api<{ ideas: Idea[] }>("POST", "/ai/ideas", { targetId, request });
      setIdeas(res.ideas);
    });

  return (
    <Sheet title={`✨ ${title}`} onClose={onClose}>
      <p className="small muted">Suggestions are based on their list, “About me” and the family's ideas. They're only suggestions, so double-check before buying.</p>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          generate();
        }}
      >
        <label>
          Anything to steer it? <span className="hint">Optional, e.g. “under $30”, “something for the kitchen”</span>
          <input value={request} onChange={(e) => setRequest(e.target.value)} maxLength={500} />
        </label>
        <button className="btn primary block" disabled={busy}>
          {ideas ? "Get different ideas" : "Get ideas"}
        </button>
      </form>
      {busy && (
        <div className="row muted" style={{ justifyContent: "center", padding: 20 }}>
          <Spinner /> Thinking…
        </div>
      )}
      {ideas?.map((idea) => (
        <div className="card stack" key={idea.title} style={{ gap: 6 }}>
          <div className="spread">
            <strong>{idea.title}</strong>
            <span className="small muted">{idea.price}</span>
          </div>
          <p className="small">{idea.why}</p>
          <p className="small muted">Search for: “{idea.search}”</p>
          <button
            className="btn small"
            disabled={added.includes(idea.title)}
            onClick={() =>
              run(async () => {
                await onAdd(idea);
                setAdded((a) => [...a, idea.title]);
              }, "Added.")
            }
          >
            {added.includes(idea.title) ? "Added ✓" : addLabel}
          </button>
        </div>
      ))}
    </Sheet>
  );
}
