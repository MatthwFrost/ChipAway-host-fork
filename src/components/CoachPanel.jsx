// The bubble prompts, it never answers. Everything the coach actually concludes
// — verdict, reason, points, frequencies, maths — is captured per decision and
// paid out in the hand review, once it can no longer be copied into a decision.
export function CoachPanel() {
  return (
    <section className="panel-block coach-card" aria-label="ChipAway Poker Coach">
      <div className="coach-chat">
        <div className="coach-avatar" aria-hidden="true">👾</div>
        <div className="coach-bubble">
          <div className="coach-nudge" id="coachNudge" />
        </div>
      </div>
    </section>
  );
}
