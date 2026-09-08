export function EquityPanel() {
  return (
    <section className="card-box" aria-labelledby="equityLabel">
      <div className="box-label" id="equityLabel">Equity check</div>
      <div className="eq-hidden" id="eqHidden">
        <p>Make your read first. Reveal only to check yourself — it re-hides each street.</p>
        <button className="btn-reveal" id="btnRevealEq" type="button">Reveal equity</button>
      </div>
      <div className="eq-body" id="eqBody">
        <div className="equity-figure" id="eqNum">—<span>%</span></div>
        <div className="eq-sub" id="eqSub" />
        <div className="equity-hand" id="eqHand" />
        <div className="meter" aria-hidden="true">
          <i className="m-win" id="mWin" style={{ width: '0%' }} />
          <i className="m-tie" id="mTie" style={{ width: '0%' }} />
          <i className="m-lose" id="mLose" style={{ width: '100%' }} />
        </div>
        <div className="meter-key"><span id="kWin">win —</span><span id="kTie">tie —</span><span id="kLose">lose —</span></div>
        <div className="rangebar" id="rangeBar" />
        <div className="odds-note" id="oddsNote" />
        <div id="valueBet" />
      </div>
    </section>
  );
}
