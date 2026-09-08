import { useLayoutEffect } from 'react';
import { initializePokerTrainer } from './engine/initializePokerTrainer';
import { Header } from './components/Header';
import { PokerTable } from './components/PokerTable';
import { SessionPanels } from './components/SessionPanels';
import { ActionPanel } from './components/ActionPanel';
import { EquityPanel } from './components/EquityPanel';
import { CoachPanel } from './components/CoachPanel';
import { ReadsPanel } from './components/ReadsPanel';
import { TableSetup } from './components/TableSetup';

export function App() {
  useLayoutEffect(() => {
    initializePokerTrainer();
  }, []);

  return (
    <div className="shell">
      <Header />
      <main className="board-grid">
        <div>
          <PokerTable />
          <SessionPanels />
        </div>
        <aside className="panel" aria-label="Game controls and analysis">
          <EquityPanel />
          <ActionPanel />
          <GuessPanel />
          <CoachPanel />
          <ReadsPanel />
          <TableSetup />
        </aside>
      </main>
    </div>
  );
}

function GuessPanel() {
  return (
    <section className="card-box hot" id="guessBox" style={{ display: 'none' }} aria-labelledby="guessLabel">
      <div className="box-label" id="guessLabel">Put them on a hand</div>
      <div className="guess-q" id="guessQ" />
      <div id="guessOpts" />
      <button className="guess-skip" id="btnSkipGuess" type="button">Skip and reveal</button>
    </section>
  );
}
