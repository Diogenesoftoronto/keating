import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import type { HabitRankings as RankingsAuthority, RankCommand } from "../../../server/utils/habit-rankings";
import { ensureCourseAccountSession } from "../../courses/account-session";
import { learningIntelligenceAccount, subscribeLearningIntelligence } from "../../keating/learning-intelligence/account";
import { loadDeclaredProfile, subscribeDeclaredProfile } from "../../keating/learner-profile-store";
import { beginNotOrganicAuthorization } from "../../notorganic-provider";
import "./habit-rankings.css";

type Board = Awaited<ReturnType<RankingsAuthority["board"]>>;
type Account = Awaited<ReturnType<RankingsAuthority["account"]>>;
type RankedSubject = Extract<RankCommand, { type: "start" }>["subject"];
type Receipt = NonNullable<NonNullable<Account["result"]>["receipt"]>;
type BoardKind = "cohort" | "subject" | "recess";

const ROUTE = "/api/habits/rankings";
const adultBands = new Set(["18-24", "25-34", "35-49", "50-64", "65-plus"]);
const readAdultDeclaration = () => adultBands.has(loadDeclaredProfile().ageBand);
const readScope = () => learningIntelligenceAccount().scope;
const noScope = () => null;
const serverAdult = () => false;

async function request<T>(path: string, signal: AbortSignal, body?: RankCommand): Promise<T> {
  const response = await fetch(ROUTE + path, {
    credentials: "same-origin", cache: "no-store", signal,
    ...(body ? {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    } : {}),
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error("Sign in to use public rankings.");
    if ([409, 429].includes(response.status)) {
      const data = await response.json().catch(() => null) as { statusMessage?: unknown } | null;
      if (typeof data?.statusMessage === "string") throw new Error(data.statusMessage);
    }
    throw new Error("Rankings are temporarily unavailable. Please try again.");
  }
  return response.json() as Promise<T>;
}

function localDate(ms: number): string {
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(ms);
}

function Standings({ rows, self, promotion, demotion }: {
  rows: Board["rows"]; self?: string; promotion?: boolean; demotion?: boolean;
}) {
  return <table className="habit-rankings__standings" aria-label="Public standings">
    <thead><tr><th scope="col">Rank</th><th scope="col">Alias</th><th scope="col">Division</th><th scope="col">LP</th></tr></thead>
    <tbody>{rows.map(entry => {
      const zone = entry.rank !== null && (promotion && entry.rank <= 6 ? "promotion" : demotion && entry.rank >= 25 ? "demotion" : undefined);
      return <tr key={entry.alias} data-self={entry.alias === self || undefined} data-zone={zone || undefined}>
        <td>{entry.rank ?? "—"}</td>
        <th scope="row">{entry.alias}{entry.alias === self && <span className="habit-rankings__you"> (you)</span>}</th>
        <td>{entry.division}</td><td>{entry.lp}</td>
      </tr>;
    })}</tbody>
  </table>;
}

export function HabitRankings({ enabled, onVerifiedStudy }: {
  enabled: boolean;
  onVerifiedStudy?: (receipt: Receipt) => void | Promise<void>;
}) {
  const adult = useSyncExternalStore(subscribeDeclaredProfile, readAdultDeclaration, serverAdult);
  const scope = useSyncExternalStore(subscribeLearningIntelligence, readScope, noScope);
  const headingId = useId();
  const [kind, setKind] = useState<BoardKind>("cohort");
  const [subject, setSubject] = useState<RankedSubject>("maths");
  const [division, setDivision] = useState(0);
  const [cohort, setCohort] = useState(1);
  const [boardState, setBoardState] = useState<{ data: Board; path: string; revision: number } | null>(null);
  const [boardIssue, setBoardIssue] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [accountState, setAccountState] = useState<{ scope: string; value: Account } | null>(null);
  const account = accountState?.scope === scope ? accountState?.value : undefined;
  const [attested, setAttested] = useState(false);
  const [choice, setChoice] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const action = useRef<AbortController | null>(null);
  const activeAccount = useRef<AbortController | null>(null);
  const [accountRefresh, setAccountRefresh] = useState(0);

  const boardPath = kind === "subject" ? `?subject=${subject}` : `?division=${division}&cohort=${cohort}`;
  const board = boardState?.path === boardPath && boardState.revision === refresh ? boardState.data : null;
  useEffect(() => {
    if (kind === "recess") return;
    const controller = new AbortController();
    setBoardIssue("");
    void request<Board>(boardPath, AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]))
      .then(data => { if (!controller.signal.aborted) setBoardState({ data, path: boardPath, revision: refresh }); })
      .catch(reason => { if (!controller.signal.aborted) setBoardIssue(reason.message); });
    return () => controller.abort();
  }, [boardPath, kind, refresh]);

  useEffect(() => {
    if (!scope) return;
    const controller = new AbortController();
    activeAccount.current = controller;
    const current = () => !controller.signal.aborted && readScope() === scope;
    setError("");
    void (async () => {
      await ensureCourseAccountSession();
      if (!current()) return;
      const data = await request<Account>("/me", AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]));
      if (current()) {
        setAccountState({ scope, value: data });
        if (data.active) {
          setDivision(data.scope.division);
          setCohort(data.scope.cohort);
        }
      }
    })().catch(reason => { if (current()) setError(reason.message); });
    return () => {
      controller.abort();
      action.current?.abort();
      action.current = null;
      setPending(false);
      setAttested(false);
      setChoice(null);
    };
  }, [scope, accountRefresh]);

  async function change(command: RankCommand) {
    if (!scope || action.current || activeAccount.current?.signal.aborted) return;
    const controller = new AbortController();
    action.current = controller;
    const current = () => !controller.signal.aborted && readScope() === scope;
    setPending(true);
    setError("");
    try {
      await ensureCourseAccountSession();
      if (!current()) return;
      if (command.type === "enroll" && !readAdultDeclaration()) return;
      const data = await request<Account>("/me", AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]), command);
      if (!current()) return;
      setAccountState({ scope, value: data });
      setChoice(null);
      if (command.type === "withdraw") setAttested(false);
      if (command.type === "enroll" || command.type === "accept-demotion" || command.type === "answer") {
        setDivision(data.scope.division);
        setCohort(data.scope.cohort);
      }
      if (command.type !== "start") setRefresh(value => value + 1);
      const receipt = data.result?.receipt;
      if (receipt && onVerifiedStudy) {
        // Private habit storage can fail independently after the standings are committed.
        void Promise.resolve().then(() => onVerifiedStudy(receipt)).catch(() => {});
      }
    } catch (reason) {
      if (current()) setError(reason instanceof Error ? reason.message : "Rankings are temporarily unavailable.");
    } finally {
      if (action.current === controller) {
        action.current = null;
        setPending(false);
      }
    }
  }

  function signIn() {
    setError("");
    void beginNotOrganicAuthorization().catch(reason => setError(reason instanceof Error ? reason.message : "Could not start sign-in."));
  }

  const divisions = boardState?.data.divisions;
  const subjects = boardState?.data.subjects;
  const closesAt = board?.closesAt ?? account?.closesAt;
  const questionEnds = account?.attempt?.expiresAt;
  useEffect(() => {
    if (!questionEnds) return;
    const timer = setTimeout(() => setAccountRefresh(value => value + 1), Math.max(questionEnds - Date.now() + 50, 0));
    return () => clearTimeout(timer);
  }, [questionEnds]);
  useEffect(() => {
    if (!closesAt) return;
    const timer = setTimeout(() => {
      setRefresh(value => value + 1);
      setAccountRefresh(value => value + 1);
    }, Math.max(closesAt - Date.now() + 50, 0));
    return () => clearTimeout(timer);
  }, [closesAt]);
  const promotion = kind === "cohort" && division < 7 && (board?.rows.length ?? 0) >= 7;
  const demotion = kind === "cohort" && division > 0 && (board?.rows.length ?? 0) >= 25;
  const canAnswer = enabled && adult && account?.active;

  return <section className="habit-rankings" aria-labelledby={headingId}>
    <header className="habit-rankings__heading">
      {divisions && <span className="habit-rankings__badge" aria-hidden="true" style={{
        backgroundPosition: `${((account?.scope.division ?? division) % 4) * 100 / 3}% ${(account?.scope.division ?? division) >= 4 ? 100 : 0}%`,
      }} />}
      <div>
        <h3 id={headingId}>Rankings</h3>
        <p>{account ? `${account.row.division} Division · ${account.active ? "Public listing" : "Private practice"}` : "Weekly leagues and subject standings"}</p>
        {closesAt && <p className="habit-rankings__time">Closes {localDate(closesAt)}</p>}
      </div>
    </header>
    <div className="habit-rankings__switch" role="group" aria-label="Choose ranking board">
      <button type="button" aria-pressed={kind === "cohort"} onClick={() => setKind("cohort")}>Weekly cohort</button>
      <button type="button" aria-pressed={kind === "subject"} onClick={() => setKind("subject")}>Subject board</button>
      <button type="button" aria-pressed={kind === "recess"} onClick={() => setKind("recess")}>Fair Recess</button>
    </div>
    {kind === "recess" ? <p>Find your personal best in Recess. Scores stay on this device.</p> : <>
      <div className="habit-rankings__filters">
        {kind === "cohort" && divisions && <>
          <label>Division <select value={division} onChange={event => { setDivision(Number(event.target.value)); setCohort(1); }}>
            {divisions.map((name, index) => <option key={name} value={index}>{name}</option>)}
          </select></label>
          <label>Cohort <input type="number" min={1} max={999999} value={cohort} onChange={event => {
            const value = event.target.valueAsNumber;
            if (Number.isInteger(value) && value >= 1 && value <= 999999) setCohort(value);
          }} /></label>
          {account?.active && (cohort !== account.scope.cohort || division !== account.scope.division) && <button type="button" onClick={() => {
            setDivision(account.scope.division); setCohort(account.scope.cohort);
          }}>My cohort</button>}
        </>}
        {kind === "subject" && subjects && <label>Subject <select value={subject} onChange={event => setSubject(event.target.value as RankedSubject)}>
          {subjects.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select></label>}
      </div>
      {boardIssue ? <div className="habit-rankings__status" role="status"><span>{boardIssue}</span><button type="button" onClick={() => setRefresh(value => value + 1)}>Retry board</button></div>
        : !board ? <p role="status">Loading standings…</p>
          : board.rows.length ? <>
            {(promotion || demotion) && <p className="habit-rankings__zones">
              {promotion && "Top six with points qualify for promotion. "}
              {demotion && "Places 25–30 can appeal demotion with a review."}
            </p>}
            <Standings rows={board.rows} self={account?.row.alias} promotion={promotion} demotion={demotion} />
          </> : <p>No learners on this board yet.</p>}
    </>}
    <div className="habit-rankings__enrollment">
      {account?.active ? <>
        <p>Your listing shows {account.row.alias}, your division, rank, and League Points (LP).</p>
        <button type="button" disabled={pending} onClick={() => void change({ type: "withdraw" })}>Switch to private</button>
      </> : !enabled ? <p>Ranked practice is paused while Companion is Off.</p>
        : !adult ? <p>Public rankings are available to adults who opt in. Your practice stays private.</p>
          : !scope ? <button type="button" onClick={signIn}>Sign in to join public rankings</button>
            : account ? <>
              <p>Preview your public listing</p>
              <Standings rows={[account.row]} />
              <label className="habit-rankings__consent"><input type="checkbox" checked={attested} onChange={event => setAttested(event.target.checked)} />
                I am 18 or older and agree to publish my generated alias, division, rank, and League Points.
              </label>
              <button type="button" className="habit-rankings__primary" disabled={!attested || pending} onClick={() => void change({ type: "enroll", adultAttested: true })}>Join public rankings</button>
            </> : error ? <button type="button" onClick={() => setAccountRefresh(value => value + 1)}>Retry account</button> : <p role="status">Loading your ranking preview…</p>}
    </div>
    {account?.active && !canAnswer && <p>Ranked practice is paused. You can switch your public listing to private anytime.</p>}
    {canAnswer && account && <div className="habit-rankings__challenge">
      <h4>{account.appeal ? "Division appeal" : "Ranked study"}</h4>
      {account.previous && <p>Last week: {account.previous.lp} LP{account.previous.rank ? `, rank ${account.previous.rank}` : ""}. Division {account.previous.result}.</p>}
      {account.appeal && <>
        <p>Complete two different review questions by {localDate(account.appeal.endsAt)} to stay in your division. {account.appeal.passed}/2 complete.</p>
        <button type="button" disabled={pending} onClick={() => void change({ type: "accept-demotion" })}>Accept demotion</button>
      </>}
      {account.attempt ? <form onSubmit={event => {
        event.preventDefault();
        if (choice !== null && account.attempt) void change({ type: "answer", attemptId: account.attempt.id, choice });
      }}>
        <fieldset>
          <legend>{account.attempt.prompt}</legend>
          {account.attempt.choices.map((answer, index) => <label key={answer} className="habit-rankings__choice">
            <input type="radio" name={account.attempt?.id} checked={choice === index} onChange={() => setChoice(index)} />{answer}
          </label>)}
        </fieldset>
        <button type="submit" className="habit-rankings__primary" disabled={choice === null || pending}>Check answer</button>
      </form> : <>
        {subjects && <label className="habit-rankings__subject">Practice subject <select value={subject} onChange={event => setSubject(event.target.value as RankedSubject)}>
          {subjects.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select></label>}
        <button type="button" className="habit-rankings__primary" disabled={pending} onClick={() => void change({ type: "start", subject })}>{account.appeal ? "Start review question" : "Start ranked question"}</button>
      </>}
      {account.result && <p className="habit-rankings__feedback" role="status">
        <strong>{account.result.correct ? "Correct. " : "Good try. "}</strong>
        {account.result.explanation}{account.result.receipt && ` You earned ${account.result.receipt.points} LP.`}
      </p>}
    </div>}
    {error && <p className="habit-rankings__error" role="alert">{error}</p>}
  </section>;
}
