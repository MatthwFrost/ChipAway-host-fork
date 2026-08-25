const BET_PRESETS = [
  { label: '½ pot', fraction: '0.5' },
  { label: '¾ pot', fraction: '0.75' },
  { label: 'Pot', fraction: '1' },
  { label: 'All in', fraction: 'max' },
];

export function ActionPanel() {
  return (
    <section className="card-box" id="actionBox" aria-labelledby="actionLabel">
      <div className="box-label" id="actionLabel">Your action</div>
      <div className="drift" id="drift" />
      <div className="leak" id="leak" />
      <div className="status" id="status" aria-live="polite">Press <b>Deal hand</b> to start.</div>
      <div className="btn-row">
        <button className="btn-fold" id="btnFold" type="button" disabled>Fold</button>
        <button className="btn-call" id="btnCall" type="button" disabled>Check</button>
        <button className="btn-raise" id="btnRaise" type="button" disabled>Raise</button>
      </div>
      <div className="raise-row">
        <output className="raise-amt" id="raiseAmt" htmlFor="raiseSlider">0</output>
        <input type="range" id="raiseSlider" min="0" max="100" defaultValue="0" disabled aria-label="Raise amount" />
      </div>
      <div className="preset-row">
        {BET_PRESETS.map(({ label, fraction }) => (
          <button className="preset" data-frac={fraction} type="button" key={fraction}>{label}</button>
        ))}
      </div>
      <button className="btn-deal" id="btnDeal" type="button">Deal hand</button>
      <div id="evReview" />
    </section>
  );
}
