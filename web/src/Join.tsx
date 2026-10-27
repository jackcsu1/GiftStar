import { useState } from "react";
import { api, session, type PersonSummary } from "./api";
import { StarLogo, useAction } from "./ui";

export function groupByHousehold<T extends PersonSummary>(people: T[]) {
  const groups = new Map<string, T[]>();
  for (const p of people) groups.set(p.household, [...(groups.get(p.household) || []), p]);
  return [...groups.entries()];
}

export function Join({ onJoined }: { onJoined: (personId: string) => void }) {
  const [step, setStep] = useState<"passcode" | "pick" | "code">("passcode");
  const [passcode, setPasscode] = useState("");
  const [people, setPeople] = useState<PersonSummary[]>([]);
  const [chosen, setChosen] = useState<PersonSummary | null>(null);
  const [code, setCode] = useState("");
  const { busy, run } = useAction();

  const checkPasscode = () =>
    run(async () => {
      const res = await api<{ people: PersonSummary[] }>("POST", "/join", { passcode });
      setPeople(res.people);
      setStep("pick");
    });

  const confirm = () =>
    run(async () => {
      const res = await api<{ token: string; personId: string }>("POST", "/pick", { passcode, personId: chosen!.id });
      session.token = res.token;
      session.person = res.personId;
      onJoined(res.personId);
    });

  const redeem = () =>
    run(async () => {
      const res = await api<{ token: string; personId: string }>("POST", "/redeem", { code, token: session.token });
      session.token = res.token;
      session.person = res.personId;
      onJoined(res.personId);
    });

  return (
    <div className="wrap stack-lg" style={{ paddingTop: 40 }}>
      <div className="center stack" style={{ alignItems: "center" }}>
        <div style={{ width: 72, height: 72, background: "var(--brand)", borderRadius: 20, padding: 10 }}>
          <StarLogo />
        </div>
        <h1>GiftStar</h1>
        <p className="muted">Our family's Christmas 2026 wish lists</p>
      </div>

      {step === "passcode" && (
        <form
          className="card stack"
          onSubmit={(e) => {
            e.preventDefault();
            checkPasscode();
          }}
        >
          <label>
            Family passcode
            <input value={passcode} onChange={(e) => setPasscode(e.target.value)} autoComplete="off" autoCapitalize="none" autoFocus />
          </label>
          <button className="btn primary block" disabled={busy || !passcode.trim()}>
            Continue
          </button>
          <button type="button" className="btn ghost" onClick={() => setStep("code")}>
            I have a code from the admin
          </button>
        </form>
      )}

      {step === "pick" && !chosen && (
        <div className="stack-lg">
          <div className="stack">
            <h2>Who are you?</h2>
            <p className="muted">Tap your name. You only do this once on this device.</p>
          </div>
          {people.length === 0 && (
            <div className="card soft">Everyone is already set up. If you need to get in on a new phone or tablet, ask the admin for a code.</div>
          )}
          {groupByHousehold(people).map(([household, members]) => (
            <div className="stack" key={household}>
              <h3 className="muted">{household}</h3>
              <div className="pick-grid">
                {members.map((p) => (
                  <button key={p.id} className="btn" onClick={() => setChosen(p)}>
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <button className="btn ghost" onClick={() => setStep("code")}>
            My name isn't here
          </button>
        </div>
      )}

      {step === "pick" && chosen && (
        <div className="card stack center">
          <h2>Hi, {chosen.name}!</h2>
          <p>This device will remember you. You won't be able to switch to someone else's name later.</p>
          <button className="btn primary block" onClick={confirm} disabled={busy}>
            Yes, I'm {chosen.name}
          </button>
          <button className="btn block" onClick={() => setChosen(null)} disabled={busy}>
            Oops, go back
          </button>
        </div>
      )}

      {step === "code" && (
        <form
          className="card stack"
          onSubmit={(e) => {
            e.preventDefault();
            redeem();
          }}
        >
          <p>If your name was already set up somewhere else, or you share this device, the admin can give you a 6-letter code.</p>
          <label>
            Code
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              autoCapitalize="characters"
              autoComplete="off"
              maxLength={8}
              style={{ letterSpacing: "0.2em", fontWeight: 700 }}
              autoFocus
            />
          </label>
          <button className="btn primary block" disabled={busy || code.trim().length < 6}>
            Use code
          </button>
          <button type="button" className="btn ghost" onClick={() => setStep(people.length ? "pick" : "passcode")}>
            Back
          </button>
        </form>
      )}
    </div>
  );
}
