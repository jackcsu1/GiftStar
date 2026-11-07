import { useEffect, useState } from "react";
import { api, type PersonSummary } from "./api";
import { groupByHousehold } from "./Join";
import { Loading, Sheet, useAction } from "./ui";

type FamilyPerson = PersonSummary & { devices: number };

// Matt hands out one-time sign-in codes without opening the admin page.
export function FamilyCodes({ onClose }: { onClose: () => void }) {
  const [people, setPeople] = useState<FamilyPerson[] | null>(null);
  const [code, setCode] = useState<{ name: string; code: string } | null>(null);
  const { busy, run } = useAction();

  useEffect(() => {
    run(async () => setPeople((await api<{ people: FamilyPerson[] }>("GET", "/family")).people));
  }, [run]);

  if (code) {
    return (
      <Sheet title={`Code for ${code.name}`} onClose={onClose}>
        <p className="center" style={{ fontSize: 44, fontWeight: 700, letterSpacing: "0.2em", fontFamily: "ui-monospace, monospace" }}>
          {code.code}
        </p>
        <p>
          Have {code.name} open GiftStar, tap <strong>“I have a code from Matt”</strong> (or <strong>“Add someone to this device”</strong> on a shared device), and enter
          this code. It works once and expires in 7 days.
        </p>
        <button className="btn block" onClick={() => setCode(null)}>
          Back to the list
        </button>
      </Sheet>
    );
  }

  return (
    <Sheet title="Family codes" onClose={onClose}>
      {!people ? (
        <Loading />
      ) : (
        groupByHousehold(people).map(([household, members]) => (
          <div key={household} className="stack" style={{ gap: 4 }}>
            <strong>{household}</strong>
            {members.map((p) => (
              <div key={p.id} className="spread">
                <span>
                  {p.name}
                  {p.devices === 0 && <span className="small muted"> · not set up</span>}
                </span>
                <button
                  className="btn small"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const r = await api<{ code: string }>("POST", "/family/code", { personId: p.id });
                      setCode({ name: p.name, code: r.code });
                    })
                  }
                >
                  Get code
                </button>
              </div>
            ))}
          </div>
        ))
      )}
    </Sheet>
  );
}
