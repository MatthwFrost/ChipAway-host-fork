const SPEEDS = [
  { label: 'Slow', value: '1.7' },
  { label: 'Steady', value: '1.15', selected: true },
  { label: 'Quick', value: '0.65' },
];

export function TableSetup() {
  return (
    <details id="setupBox">
      <summary>Table setup</summary>
      <div className="details-body">
        <div id="setupRows" />
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button className="preset" id="btnRandom" style={{ flex: 1 }} type="button">Randomise seats</button>
          <button className="preset" id="btnRevealProfiles" style={{ flex: 1 }} type="button">Show styles</button>
        </div>
        <SettingLabel>Pace</SettingLabel>
        <div className="speed-row">
          {SPEEDS.map(({ label, value, selected }) => (
            <button className={`speed-btn${selected ? ' on' : ''}`} data-speed={value} type="button" key={value}>{label}</button>
          ))}
        </div>
        <SettingLabel>Showdown guess</SettingLabel>
        <div className="speed-row">
          <button className="speed-btn on" id="guessOn" type="button">Ask every hand</button>
          <button className="speed-btn" id="guessOff" type="button">Off</button>
        </div>
        <SettingLabel>Range guess each street</SettingLabel>
        <div className="speed-row">
          <button className="speed-btn" id="rgOn" type="button">On</button>
          <button className="speed-btn on" id="rgOff" type="button">Off</button>
        </div>
        <div className="mini-note">Styles are hidden by default so you have to read them from how they play. Seat changes apply from the next hand.</div>
      </div>
    </details>
  );
}

function SettingLabel({ children }) {
  return <div className="box-label" style={{ marginTop: 16, marginBottom: 7 }}>{children}</div>;
}
