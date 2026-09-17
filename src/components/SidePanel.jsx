import { CoachPanel } from './CoachPanel';
import { EquityPanel } from './EquityPanel';
import { ActionPanel } from './ActionPanel';
import { ReviewModal } from './ReviewModal';

const BET_PRESETS = [
  { label: '½ pot', fraction: '0.5' },
  { label: '¾ pot', fraction: '0.75' },
  { label: 'Pot', fraction: '1' },
  { label: 'All in', fraction: 'max' },
];

function GuessPanel() {
  return (
    <section className="card-box hot" id="guessBox" style={{ display: 'none' }} aria-labelledby="guessLabel">
      <div className="box-label" id="guessLabel">Put them on a hand</div>
      <div className="guess-q" id="guessQ" />
      <div id="guessOpts" />
      <button className="guess-skip" id="btnSkipGuess" type="button">Skip and reveal</button>
    </section>
  );
}

// The dock is a single element with three faces. The engine owns which one is
// showing (data-phase) and whether the raise slider is out (data-raise); every
// button stays mounted throughout so the listeners bound at startup hold.
function ActionDock() {
  return (
    <div className="action-dock" id="actionDock" data-phase="pre">
      <div className="raise-tray">
        <div className="raise-row">
          <input type="range" id="raiseSlider" min="0" max="100" defaultValue="0" disabled aria-label="Raise amount" />
        </div>
        <div className="preset-row">
          {BET_PRESETS.map(({ label, fraction }) => (
            <button className="preset" data-frac={fraction} type="button" key={fraction}>{label}</button>
          ))}
        </div>
      </div>
      <div className="action-row-fixed">
        <div className="phase-group phase-pre">
          <button className="btn-primary" id="btnDeal" type="button">Deal hand</button>
        </div>
        <div className="phase-group phase-live">
          <button className="btn-fold" id="btnFold" type="button" disabled>Fold</button>
          <button className="btn-call" id="btnCall" type="button" disabled>Check</button>
          <button className="btn-raise" id="btnRaise" type="button" disabled>Raise</button>
          {/* Amounts sit on top of their button rather than inside it, so a
              four-digit figure never shoves the other two buttons about. */}
          <output className="amt-tab amt-call" id="callAmt">0</output>
          <output className="amt-tab amt-raise" id="raiseAmt" htmlFor="raiseSlider">0</output>
        </div>
        <div className="phase-group phase-post">
          <button className="btn-primary" id="btnNewHand" type="button">New hand</button>
          {/* Review is bound in the engine, like every other dock button: it
              flips the moves block from the result card back to the move list. */}
          <button className="btn-review" id="btnReview" type="button">Review</button>
        </div>
      </div>
    </div>
  );
}

export function SidePanel({ onOpenSettings }) {
  return (
    <aside className="side-panel" aria-label="Game controls and analysis">
      <div className="side-panel-header">
        <span className="side-panel-icon" aria-hidden="true" />
        <h2>Coach Tom</h2>
      </div>
      <div className="side-panel-scroll">
        <CoachPanel />
        <EquityPanel />
        <GuessPanel />
      </div>
      {/* Deliberately outside the scrolling column. As a flex child in there it
          got squeezed towards nothing whenever the coach ran long, which pushed
          the live end of the move list below the fold — the newest move was
          then a panel-scroll away. Out here it is a fixed region above the
          dock, so its own bottom-pinned scroller is always on screen. */}
      <ActionPanel onOpenSettings={onOpenSettings} />
      <ActionDock />
      {/* Kept mounted and closed: renderHandReview() writes the finished hand
          into #evReview by id every time a hand ends, so the node has to exist.
          Nothing opens it now that Review flips the panel instead. */}
      <ReviewModal open={false} onClose={() => {}} />
    </aside>
  );
}