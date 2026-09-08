/* Plain-language definitions for every stat and term the app puts on screen.
   Written for someone who has never read a poker book. Grouped so the list
   reads as a short tutorial rather than a dictionary. */

export const GLOSSARY = [
  {
    group: 'The basics',
    terms: [
      ['Hand', 'The two cards you are dealt, plus the shared cards in the middle. Also used for "one round of play", from deal to showdown.'],
      ['Street', 'One round of betting. Preflop (no shared cards), flop (three), turn (four), river (five). Each street is a fresh chance to bet.'],
      ['Check', 'Pass the decision on without putting chips in. Only possible when nobody has bet.'],
      ['Call', 'Match the current bet so you stay in the hand.'],
      ['Raise', 'Put in more than the current bet, forcing everyone else to match it or fold. A first bet on a street is also a raise in this sense.'],
      ['Fold', 'Give up the hand. Chips you already put in stay in the pot — they stopped being yours the moment you bet them.'],
      ['All-in', 'Betting every chip you have. You can still win the part of the pot you covered, but no more.'],
      ['Multiway pot', 'A pot with three or more players still in. Your hand has to beat everyone at once, so the same cards are worth less than they are heads-up.'],
      ['Side pot', 'When someone is all-in for less than others are betting, the extra chips form a separate pot that the short player cannot win.'],
    ],
  },
  {
    group: 'Reading the table',
    terms: [
      ['Range', 'All the hands a player could have right now, given how they have played. You never know their exact cards, so you play against the whole set.'],
      ['Profile', 'The hidden playing style of each opponent. There are five: nit, TAG, LAG, calling station and maniac. They are hidden on purpose — working them out from how they bet is the skill this app trains.'],
      ['Nit', 'Plays very few hands and folds constantly. When a nit finally bets big, believe it.'],
      ['TAG', 'Tight and aggressive: few hands, but played hard. The toughest style to play against.'],
      ['LAG', 'Loose and aggressive: plays a lot of hands and applies constant pressure. Bluffs more than they look like they do.'],
      ['Calling station', 'Calls far too often and almost never raises. Never bluff one; value bet relentlessly instead.'],
      ['Maniac', 'Bets and raises relentlessly with almost anything. Most of that aggression is air, so widen the hands you call with.'],
      ['Blocker', 'A card you hold that they therefore cannot have. Holding an ace removes every ace-containing hand from their range, which can turn a fold into a call.'],
      ['Position', 'Where you sit relative to the dealer button, which decides whether you act first or last. Acting last is a real edge: you see what everyone else does before you have to commit.'],
      ['In position / out of position', 'In position means you act after your opponent on every remaining street. Out of position means you act first, and have to guess.'],
    ],
  },
  {
    group: 'The numbers',
    terms: [
      ['Equity', 'Your share of the pot right now, as a percentage — how often you would win if all the remaining cards were dealt out from here.'],
      ['Raw equity', 'Your equity against a completely random hand. A baseline: it ignores everything you know about how this opponent plays.'],
      ['Range-adjusted equity', 'Your equity against the hands this opponent could actually have, given their style and how they have bet. This is the number that should drive your decision.'],
      ['Pot odds', 'The price you are being offered. Calling 50 to win 200 means you need to win 25% of the time to break even. Compare that number to your equity and you have your answer.'],
      ['Fold equity', 'The extra value in betting that comes from opponents folding. Betting wins two ways — they fold, or you have the best hand. Calling only wins one way.'],
      ['EV (Expected Value)', 'The average chips a decision gains or loses if you made it a thousand times. Folding is always exactly 0, because chips already in the pot are not yours any more. Every other option is measured against that zero.'],
    ],
  },
  {
    group: 'Made hands and draws',
    terms: [
      ['Made hand', 'A hand that is already worth something at showdown, like two pair or a flush. It does not need any more cards to win.'],
      ['Draw', 'A hand that is worth nothing yet but becomes strong if the right card arrives — four to a flush, or four to a straight. High equity, nothing made.'],
      ['Outs', 'The cards still to come that would turn your draw into a winner. Count them, and you can work out how often you get there.'],
      ['Semi-bluff', 'Betting a draw. It wins two ways: they fold now, or you hit later. That is why a draw usually plays better as a bet than as a call.'],
      ['Brick', 'A card that changes nothing and misses your draw. When your draw bricks you have nothing, so the hand can only win if they fold.'],
    ],
  },
  {
    group: 'Types of bet',
    terms: [
      ['Value bet', 'Betting because you expect to be called by worse hands. You want the call.'],
      ['Bluff', 'Betting a hand that is probably behind, hoping they fold. Only works against players who actually fold.'],
      ['Bluff catcher', 'A hand too weak to bet for value but good enough to beat a bluff. Whether you call one depends entirely on how often that opponent bluffs.'],
    ],
  },
];
