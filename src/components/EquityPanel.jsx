// Win chance is a single glanceable bar, nothing else — no number, no detail
// toggle. The fill is the whole story. The engine still computes and writes
// the fuller numbers (raw equity, hand name, reliability); those elements
// stay in the DOM so it never errors, just hidden — nothing here removes
// that data, it's just not on stage.
const RING_R = 32;
const RING_C = 2 * Math.PI * RING_R;

export function EquityPanel() {
  return (
    <div className="panel-block" aria-labelledby="equityLabel">
      <div className="panel-head">
        <div className="box-label" id="equityLabel">Equity</div>
        <div className="panel-head-actions">
          <button
            type="button"
            className="panel-head-btn"
            aria-label="Equity information"
            title="Equity information"
          >
            ⓘ
          </button>
        </div>
      </div>
      <div className="win-bar" aria-label="Win chance">
        <svg className="eq-ring-hidden" viewBox="0 0 76 76" aria-hidden="true" focusable="false">
          <circle
            className="eq-ring-fill"
            id="eqRing"
            cx="38"
            cy="38"
            r={RING_R}
            strokeDasharray={RING_C}
            strokeDashoffset={RING_C}
          />
        </svg>
        <div className="win-bar-track">
          <div className="meter" aria-hidden="true">
            <i className="m-win" id="mWin" style={{ width: '0%' }} />
            <i className="m-tie" id="mTie" style={{ width: '0%' }} />
            <i className="m-lose" id="mLose" style={{ width: '100%' }} />
          </div>
        </div>
        <div className="win-bar-hidden" aria-hidden="true">
          <span id="eqAdjNum">—<span>%</span></span>
          <span id="eqRawNum">—<span>%</span></span>
          <div id="eqHand" />
          <span id="kWin">win —</span><span id="kTie">tie —</span><span id="kLose">lose —</span>
          <div id="eqReliabilityBody" />
        </div>
      </div>
    </div>
  );
}
