// The equity tab sits directly above Your action and is always on, so the two
// numbers become familiar furniture rather than something you go looking for.
// The ring fills with range-adjusted equity — the figure that should drive the
// decision — with raw equity beside it, smaller, as the baseline it moved from.
const RING_R = 32;
const RING_C = 2 * Math.PI * RING_R;

export function EquityPanel() {
  return (
    <section className="card-box equity-tab" aria-labelledby="equityTabLabel">
      <div className="box-label" id="equityTabLabel">Your equity</div>
      <div className="eq-main">
        <div className="eq-ring">
          <svg viewBox="0 0 76 76" aria-hidden="true">
            <circle className="eq-ring-track" cx="38" cy="38" r={RING_R} />
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
          <div className="eq-ring-num" id="eqAdjNum">—<span>%</span></div>
        </div>
        <div className="eq-side">
          <div className="eq-side-cap">Range-adjusted</div>
          <div className="eq-side-sub">vs the hands they can actually have</div>
          <div className="eq-raw">
            <span className="eq-raw-num" id="eqRawNum">—<span>%</span></span>
            <span className="eq-raw-cap">raw<small>vs a random hand</small></span>
          </div>
        </div>
      </div>
      <div className="equity-hand" id="eqHand" />
      <div className="meter" aria-hidden="true">
        <i className="m-win" id="mWin" style={{ width: '0%' }} />
        <i className="m-tie" id="mTie" style={{ width: '0%' }} />
        <i className="m-lose" id="mLose" style={{ width: '100%' }} />
      </div>
      <div className="meter-key"><span id="kWin">win —</span><span id="kTie">tie —</span><span id="kLose">lose —</span></div>
      <details className="coach-disc">
        <summary>How reliable is this?</summary>
        <div className="coach-disc-body">
          <p>
            Equity is estimated by dealing the rest of the hand out thousands of times and counting how
            often you win. The number shown is an estimate, not a certainty. More runouts mean less
            uncertainty but take longer to work out, so the figure carries a margin of error — treat a
            couple of points either way as noise.
          </p>
          <div id="eqReliabilityBody" />
        </div>
      </details>
    </section>
  );
}
