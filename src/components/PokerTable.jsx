import { avatarInitial, profileLabel } from './profileLabel';

export function PokerTable({ user = null, displayName = null }) {
  // Same label and same initial as the nav rail -- see profileLabel.js. The
  // two used to be independent, and the avatar here was a hardcoded letter, so
  // any player who was not called Matty got somebody else's name on the felt.
  const label = profileLabel(user, displayName);
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
      <div className="table-player-bar" role="region" aria-label="Player profile and match results">
        <div className="table-player-avatar" aria-hidden="true">{avatarInitial(label)}</div>
        <div className="table-player-copy">
          <div className="table-player-name">{label} <span aria-label="United Kingdom">🇬🇧</span></div>
          {/* Chips won or lost across the whole session, counted from the
              starting stack. The engine rewrites it after every hand. */}
          <div className="table-player-earned" id="sessionNet" aria-label="Even for the game">
            <span className="earned-figure flat">even</span>
          </div>
        </div>
        <div className="table-match-record">
          <span className="table-match-label">This match</span>
          <div className="table-match-results" id="matchResults" aria-label="No hands completed yet" />
        </div>
        <div className="table-match-score" id="matchScore">0-0</div>
      </div>
    </>
  );
}
