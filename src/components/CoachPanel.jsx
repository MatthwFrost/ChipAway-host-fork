export function CoachPanel() {
  return (
    <section className="card-box" aria-labelledby="coachLabel">
      <div className="box-label" id="coachLabel">ChipAway Poker Coach</div>
      <div className="eq-hidden" id="eqHidden">
        <p>Make your read first. Ask the coach only to check yourself — it re-hides each street.</p>
        <button className="btn-reveal" id="btnRevealEq" type="button">Ask the coach</button>
      </div>
      <div className="eq-body" id="eqBody">
        <div className="coach-verdict" id="coachVerdict" />
        <div className="coach-lines" id="coachLines" />

        <div className="rangebar" id="rangeBar" />
        <div className="eq-sub" id="eqSub" />

        <details className="coach-disc">
          <summary>Action frequencies</summary>
          <div className="coach-disc-body" id="coachFreqBody" />
        </details>
        <details className="coach-disc">
          <summary>Show the maths</summary>
          <div className="coach-disc-body" id="coachMathsBody" />
        </details>
        <div id="valueBet" />
      </div>
    </section>
  );
}
