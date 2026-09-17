import { findLeak } from '../engine/leak';
import { lifetimeStats } from '../engine/games';

// The dashboard. It reads games.js directly and never touches the engine —
// everything here is derived from storage, so it renders correctly whether or
// not a hand has ever been played in this tab.

const DATE_FMT = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

function formatNet(net) {
  if (net > 0) return '+' + net;
  if (net < 0) return '−' + Math.abs(net);
  return 'even';
}

function netTone(net) {
  return net > 0 ? 'pos' : (net < 0 ? 'neg' : 'flat');
}

function describeSetup(setup) {
  if (!setup) return '6-max';
  const drills = [];
  if (setup.showdownGuess) drills.push('showdown guess');
  if (setup.rangeGuess) drills.push('range guess');
  const pace = { 1.7: 'slow', 1.15: 'steady', 0.65: 'quick' }[parseFloat(setup.pace)] || 'steady';
  return ['6-max', pace + ' pace'].concat(drills).join(' · ');
}

function StatCell({ label, value, unit }) {
  return (
    <div className="stat">
      <div className="k">{label}</div>
      <div className="v">{value}<small>{unit}</small></div>
    </div>
  );
}

// Hidden entirely when nothing has been played: a row of zeroes is noise, not
// information.
function LifetimeStrip({ life }) {
  if (!life.hands) return null;
  return (
    <section className="home-block">
      <div className="box-label">All time</div>
      <div className="stat-grid">
        <StatCell label="Games" value={life.games} unit="" />
        <StatCell label="Hands" value={life.hands} unit="" />
        <StatCell label="Net" value={formatNet(life.net)} unit="" />
        <StatCell label="VPIP" value={life.vpip.toFixed(0)} unit="%" />
        <StatCell label="PFR" value={life.pfr.toFixed(0)} unit="%" />
        <StatCell label="Aggression" value={life.af.toFixed(2)} unit="" />
        <StatCell label="WTSD" value={life.wtsd.toFixed(0)} unit="%" />
        <StatCell label="Hand reads" value={life.read === null ? '—' : life.read.toFixed(0)} unit={life.read === null ? '' : '%'} />
      </div>
    </section>
  );
}

// The same "Worth fixing" line the table shows, over lifetime totals instead of
// one game. Absent when findLeak has nothing to say, exactly as renderLeak
// hides itself on the table.
function LeakNote({ life }) {
  const msg = findLeak(life.stats, life.evRecords);
  if (!msg) return null;
  // findLeak returns a fixed set of sentences with <b> around numbers it
  // formatted itself from the stats counters. No user input reaches it, which
  // is why this can go in as markup rather than being parsed apart.
  return (
    <section className="home-leak">
      <span className="home-leak-who">Coach Tom</span>
      <p dangerouslySetInnerHTML={{ __html: '<b>Worth fixing:</b> ' + msg }} />
    </section>
  );
}

function LiveGameCard({ game, onResume, onEnd }) {
  const hands = (game.state && game.state.stats && game.state.stats.hands) || 0;
  const net = Number(game.net) || 0;
  return (
    <section className="home-live">
      <div className="home-live-head">
        <span className="home-live-tag">Still playing</span>
        <span className={'home-net ' + netTone(net)}>{formatNet(net)}</span>
      </div>
      <div className="home-live-meta">
        {describeSetup(game.setup)} · {hands} {hands === 1 ? 'hand' : 'hands'}
        {game.migrated ? <span className="home-live-note">net counted from upgrade</span> : null}
      </div>
      <div className="home-live-actions">
        <button type="button" className="btn-primary" onClick={onResume}>Resume</button>
        <button type="button" className="home-btn-quiet" onClick={onEnd}>End session</button>
      </div>
    </section>
  );
}

function PastGames({ games }) {
  if (!games.length) return null;
  return (
    <section className="home-block">
      <div className="box-label">Past games</div>
      <ul className="home-games">
        {games.map((g) => {
          const hands = (g.state && g.state.stats && g.state.stats.hands) || 0;
          const net = Number(g.net) || 0;
          return (
            <li key={g.id} className="home-game">
              <span className="home-game-date">{DATE_FMT.format(new Date(g.createdAt))}</span>
              <span className="home-game-meta">{hands} {hands === 1 ? 'hand' : 'hands'}</span>
              <span className={'home-net ' + netTone(net)}>{formatNet(net)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function HomeScreen({ games, liveGame, onNewGame, onResume, onEndGame, onClearHistory }) {
  const past = games.filter((g) => g.status === 'ended');
  const life = lifetimeStats(games);

  // A section, not a <main>: the board grid is already the document's main
  // landmark and both screens are mounted at once, so a second one would leave
  // the page with two.
  return (
    <section className="home-screen" aria-label="Dashboard">
      <div className="home-inner">
        <header className="home-head">
          <h2>Your table</h2>
          <p className="home-sub">A game is one sitting: play as many hands as you like, then end it to file it away.</p>
        </header>

        {liveGame ? <LiveGameCard game={liveGame} onResume={onResume} onEnd={onEndGame} /> : null}

        <button type="button" className="home-new" onClick={onNewGame}>
          <span aria-hidden="true">+</span> New game
        </button>

        <LeakNote life={life} />
        <LifetimeStrip life={life} />
        <PastGames games={past} />

        {!games.length ? (
          <p className="home-empty">Nothing played yet. Start a game and it will show up here when you end it.</p>
        ) : null}

        {past.length ? (
          <button type="button" className="reset-btn" onClick={onClearHistory}>Clear all history</button>
        ) : null}
      </div>
    </section>
  );
}
