export function PokerTable() {
  return (
    <>
      <section className="table-outer" aria-label="Poker table">
        <div className="felt" id="felt">
          <div className="centre">
            <div className="dealer-strip">
              <div className="deck-stub" aria-hidden="true" />
              <span id="dealerLine">Dealer ready</span>
            </div>
            <div className="board-cards" id="boardCards" aria-label="Community cards" />
            <div className="pot-tag" id="potTag">Pot 0</div>
            <div className="street-tag" id="streetTag">—</div>
          </div>
        </div>
      </section>
      <p className="footnote">
        Opponents open by position from a percentile chart, then their range narrows by how much they bet and splits into value and bluff portions when they bet big. Your own cards block combos out of their range. Decisions are mixed, not fixed thresholds — the same spot won&apos;t always play the same way.
      </p>
    </>
  );
}
