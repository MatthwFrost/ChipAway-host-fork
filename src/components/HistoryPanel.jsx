import { useCallback, useEffect, useMemo, useState } from 'react';
import { getHand, listSummaries } from '../engine/handStore';
import { describeStep } from '../engine/handReplay';

/* ============================================================
   HISTORY — the hands you have already played, played back.

   This panel replaces the side panel on the history screen, and drives the
   real felt rather than drawing its own. It owns "which hand, which step"; the
   engine's replay controller owns the pixels. That split is why a replayed
   hand looks exactly like a live one — there is only ever one renderer.
   ============================================================ */

const RED = /[hd]$/;

function Card({ code }) {
  const rank = code.slice(0, -1);
  const pip = { s: '♠', h: '♥', d: '♦', c: '♣' }[code.slice(-1)];
  return <span className={`hist-card${RED.test(code) ? ' is-red' : ''}`}>{rank}{pip}</span>;
}

function Cards({ codes, empty }) {
  if (!codes || !codes.length) return <span className="hist-none">{empty}</span>;
  return <span className="hist-cards">{codes.map((c, i) => <Card key={c + i} code={c} />)}</span>;
}

function netClass(n) {
  if (n > 0) return 'hist-net up';
  if (n < 0) return 'hist-net down';
  return 'hist-net';
}

function HandRow({ summary, selected, onSelect }) {
  const { net } = summary;
  return (
    <button
      type="button"
      className={`hist-row${selected ? ' is-selected' : ''}`}
      aria-current={selected ? 'true' : undefined}
      onClick={() => onSelect(summary.id)}
    >
      <span className="hist-no">#{summary.handNo}</span>
      <Cards codes={summary.hole} empty="—" />
      <span className={netClass(net)}>{net > 0 ? '+' : ''}{net}</span>
      {/* Chips lost to non-optimal decisions, which is the number worth
          scanning a list for — a hand can win chips and still be the worst one
          you played. */}
      {summary.cost > 1 ? <span className="hist-cost">−{Math.round(summary.cost)} EV</span> : <span className="hist-cost" />}
    </button>
  );
}

function ReplayControls({ hand, step, steps, onStep, onExit }) {
  const at = steps.indexOf(step);
  const first = at <= 0;
  const last = at >= steps.length - 1;
  return (
    <div className="hist-replay">
      <div className="hist-replay-head">
        <span className="box-label">Replaying hand #{hand.handNo}</span>
        <button type="button" className="hist-exit" onClick={onExit}>Done</button>
      </div>
      <div className="hist-caption">{describeStep(hand, step) || 'Before the deal'}</div>
      <div className="hist-buttons">
        <button type="button" onClick={() => onStep(steps[0])} disabled={first} aria-label="First step">⏮</button>
        <button type="button" onClick={() => onStep(steps[Math.max(0, at - 1)])} disabled={first} aria-label="Previous step">◀</button>
        <span className="hist-progress">{at + 1} / {steps.length}</span>
        <button type="button" onClick={() => onStep(steps[Math.min(steps.length - 1, at + 1)])} disabled={last} aria-label="Next step">▶</button>
        <button type="button" onClick={() => onStep(steps[steps.length - 1])} disabled={last} aria-label="Last step">⏭</button>
      </div>
      <input
        className="hist-scrub"
        type="range"
        min={0}
        max={Math.max(0, steps.length - 1)}
        value={Math.max(0, at)}
        onChange={(e) => onStep(steps[+e.target.value])}
        aria-label="Scrub through the hand"
      />
      {hand.decisions && hand.decisions.length ? (
        <ul className="hist-decisions">
          {hand.decisions.map((d, i) => (
            <li key={i} className={d.cost > 1 ? 'is-costly' : undefined}>
              <span>{d.streetName} — you {d.taken}</span>
              {d.cost > 1 ? <span className="hist-cost">−{Math.round(d.cost)}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function HistoryPanel({ active, getApi }) {
  // A getter rather than the controller itself: the engine is created in App's
  // layout effect, after this component's first render, and a plain prop would
  // hand us the null that existed before it ran.
  const api = getApi();
  // Loaded at mount if the panel is already showing, because the refresh below
  // only fires on a CHANGE of `active` — landing directly on History (a reload
  // that restored the screen intent) would otherwise show an empty list.
  const [summaries, setSummaries] = useState(() => (active ? listSummaries() : []));
  const [hand, setHand] = useState(null);
  const [step, setStep] = useState(-1);
  const [blocked, setBlocked] = useState(false);

  // Adjusting state during render rather than in an effect, which is React's
  // own answer for "a prop changed and some state is now stale". An effect
  // would render the old list first and then immediately render again.
  //
  // Handing the FELT back on the way out is App's job, not this one's — it
  // owns the screen transition, and doing DOM work during render here would
  // be a side effect in the wrong phase.
  const [wasActive, setWasActive] = useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    // A hand played since the last visit should be at the top of the list
    // without a reload.
    if (active) setSummaries(listSummaries());
    else if (hand) { setHand(null); setStep(-1); setBlocked(false); }
  }

  const steps = useMemo(() => (hand && api ? api.visibleSteps() : []), [hand, api]);

  const leave = useCallback(() => {
    if (api) api.exit();
    setHand(null);
    setStep(-1);
  }, [api]);

  const select = useCallback((id) => {
    if (!api) return;
    if (!api.canReplay()) { setBlocked(true); return; }
    const full = getHand(id);
    if (!full || !api.enter(full)) return;
    setBlocked(false);
    setHand(full);
    const visible = api.visibleSteps();
    const firstStep = visible.length ? visible[0] : -1;
    setStep(firstStep);
    api.show(firstStep);
  }, [api]);

  const goto = useCallback((n) => {
    if (n === undefined || !api) return;
    setStep(n);
    api.show(n);
  }, [api]);

  // Arrow keys are how anyone expects to step through a replay.
  useEffect(() => {
    if (!hand || !steps.length) return undefined;
    function onKey(e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Escape') return;
      e.preventDefault();
      if (e.key === 'Escape') return leave();
      const at = steps.indexOf(step);
      const next = e.key === 'ArrowRight'
        ? steps[Math.min(steps.length - 1, at + 1)]
        : steps[Math.max(0, at - 1)];
      return goto(next);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [hand, steps, step, goto, leave]);

  return (
    <aside className="side-panel history-panel" aria-label="Hand history">
      <div className="side-panel-header">
        <span className="side-panel-icon" aria-hidden="true" />
        <span>Hand history</span>
      </div>
      <div className="side-panel-scroll">
        {blocked ? (
          <p className="hist-blocked">Finish the hand you are playing first — the table is in use.</p>
        ) : null}

        {hand ? (
          <ReplayControls hand={hand} step={step} steps={steps} onStep={goto} onExit={leave} />
        ) : null}

        {summaries.length ? (
          <div className="hist-list">
            {summaries.map((s) => (
              <HandRow key={s.id} summary={s} selected={hand && hand.id === s.id} onSelect={select} />
            ))}
          </div>
        ) : (
          <p className="hist-empty">
            No hands yet. Every hand you play from here is recorded and can be replayed, step by step.
          </p>
        )}
      </div>
    </aside>
  );
}
