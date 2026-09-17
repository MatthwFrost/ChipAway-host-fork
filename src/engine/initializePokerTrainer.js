import { buildCoachAdvice, buildCoachNudge, buildHandReview, coachQuip, coachReaction, pctWhole, ci95Points } from './coach.js';
import { buildSpotModel } from './spotModel.js';
import { blockerPct as blockerPctOf, buildRangeIndex as buildRangeIndexFor, calcEquity as calcEquityFor, handPercentile as handPercentileOf } from './equity.js';
import { POS_MULT, decidePostflop, decidePreflop } from './botPolicy.js';
import * as D from './decision.js';
import { buildSidePots as buildSidePotsFor } from './table.js';
import {
  BLUFF_TOP, HERO_PROF, PROFILES, PROFILE_KEYS,
  afterAggro, afterCall, afterCheck, continueThreshold, evBetSe, evCallSe,
  evOfBet, evOfCall, jointResponse, profileOf, projectedHeroRep, rangeWidth, responseTo,
} from './opponentModel.js';
import { analyzeHandShape, describeShape, outsToEquity, unseenCount } from './handShape.js';
import { createHandRecorder } from './handRecorder.js';
import { saveHand } from './handStore.js';
import { snapshotAt, stepCount, visibleSteps } from './handReplay.js';
import { findLeak as findLeakIn, heroMetrics as heroMetricsOf } from './leak.js';
import { endGame, getLiveGame, migrateLegacySession, updateLiveGame } from './games.js';
import { openOnReload } from './screen.js';
import {
  RANK_CHARS, PIPS, makeDeck, shuffle, cardStr, cardTxt,
  cmpScore, evaluateBest, handName,
} from './evaluator.js';

export function initializePokerTrainer(){
  // Returns the replay controller. Initialising twice is a no-op that still
  // hands back the live one, so a remount cannot leave the caller holding
  // nothing.
  if(window.__chipAwayInitialized)return window.__chipAwayApi;
  window.__chipAwayInitialized=true;
const clamp=function(v,a,b){return v<a?a:(v>b?b:v);};
const sigmoid=function(x){return 1/(1+Math.exp(-x));};

/* ============================================================
   3. RANGE MODEL — polarised, sizing-sensitive, blocker-aware
   Each player carries:
     rLo    quantile floor of their VALUE range (0.85 = top 15%)
     rBluff share of their range that is pure air
   A big bet raises rLo AND opens a bluff band, because big bets
   are polarised: nuts and air, with medium hands checking.
   ============================================================ */
// The range index, hand percentile and Monte Carlo engine live in equity.js so
// the headless harness runs the same code the app does. These wrappers just
// supply the board and index the pure functions need.
let rangeIndex=[];
function buildRangeIndex(){ rangeIndex=buildRangeIndexFor(board); }
function handPercentile(hole){ return handPercentileOf(hole,board,rangeIndex); }
// What a bet of this size, from this style, tells everyone else. The rules live
// in opponentModel.js so the coach prices against exactly the range the table
// is showing; these only copy the result back onto the mutable player object.
function profOf(p){ return p.isHero?HERO_PROF:profileOf(p.profile); }
function applyRange(p,next){ p.rLo=next.rLo; p.rBluff=next.rBluff; }
function narrowAggro(p,sizeRatio){ applyRange(p,afterAggro(p,profOf(p),sizeRatio)); }
function narrowCall(p){ applyRange(p,afterCall(p,profOf(p))); }
function narrowCheck(p){ applyRange(p,afterCheck(p)); }
function blockerPct(hole,pl){ return blockerPctOf(hole,pl,rangeIndex); }

/* ============================================================
   4. EQUITY CALCULATOR
   ============================================================ */
function calcEquity(hole,opponents,trials,useRanges){
  return calcEquityFor(hole,board,opponents,trials,useRanges,rangeIndex);
}

/* ============================================================
   5. PROFILES — preflop charts by position + postflop tendencies
   openPct/callPct/threeBetPct are fractions of all starting hands.
   polar drives how split their big-bet range is.
   ============================================================ */
// Profiles, hero's assumed profile and the profile keys all live in
// opponentModel.js — the same table the coach and the opponent tips read.
const SEAT_NAMES=['Marguerite','Idris','Sofia','Bernard','Kaz'];
const POS_NAMES=['BTN','SB','BB','UTG','MP','CO'];
// POS_MULT lives in botPolicy.js alongside the decisions that use it.

/* ============================================================
   6. GAME STATE
   ============================================================ */
const SB=10,BB=20,START_STACK=1000;
const HERO_TRIALS=900,BOT_TRIALS=170,CALLED_TRIALS=380;
let SPEED=1.15;
const T=function(ms){return Math.round(ms*SPEED);};
let players=[],deck=[],board=[],pot=0,street=0,currentBet=0,minRaise=BB;
let dealerIdx=0,actingIdx=0,handLive=false,heroTurn=false,handNo=0;
// guessEnabled off by default: a finished hand shows its result rather than
// stopping to ask you to put the villain on a hand. The question is still
// there for anyone who wants it, behind "Ask every hand" in settings.
let streetRaises=0,revealAll=false,showProfiles=false,guessEnabled=false;
let lastAggressor=-1,pendingResult=null,villainIdx=-1;
const STREETS=['Preflop','Flop','Turn','River','Showdown'];
let seatConfig=[];
const stats={hands:0,vpip:0,pfr:0,f3bOpp:0,f3b:0,aggro:0,calls:0,wtsd:0,guessTotal:0,guessRight:0,rgTotal:0,rgRight:0,byStreet:{}};
let hf={};
function posOf(i){return (i-dealerIdx+players.length)%players.length;}
function posName(i){return POS_NAMES[posOf(i)]||'';}
function posMult(i){return POS_MULT[posOf(i)]||1;}
function randomSeats(){seatConfig=[];for(let i=0;i<SEAT_NAMES.length;i++)seatConfig.push(PROFILE_KEYS[Math.floor(Math.random()*PROFILE_KEYS.length)]);}
function initPlayers(){
  players=[{id:0,name:'You',profile:null,stack:START_STACK,hole:[],folded:false,allIn:false,bet:0,committed:0,acted:false,mayRaise:true,isHero:true,badge:'',badgeCls:'',raises:0,rLo:0,rBluff:0}];
  for(let i=0;i<SEAT_NAMES.length;i++){
    players.push({id:i+1,name:SEAT_NAMES[i],profile:seatConfig[i],stack:START_STACK,hole:[],folded:false,allIn:false,bet:0,committed:0,acted:false,mayRaise:true,isHero:false,badge:'',badgeCls:'',raises:0,rLo:0,rBluff:0});
  }
  dealerIdx=Math.floor(Math.random()*players.length);
}
const SEAT_POS=[{x:50,y:88},{x:11,y:66},{x:16,y:22},{x:50,y:9},{x:84,y:22},{x:89,y:66}];

/* ============================================================
   7. RENDERING
   ============================================================ */
const $=function(id){return document.getElementById(id);};
let seatRefs=[];
function cardHTML(c,small,down,mucked){
  if(down) return '<div class="card back'+(small?' sm':'')+'"></div>';
  const red=(c.suit==='h'||c.suit==='d');
  return '<div class="card'+(small?' sm':'')+(red?' red':'')+(mucked?' mucked':'')+'"><span class="rank">'+RANK_CHARS[c.rank-2]+'</span><span class="pip">'+PIPS[c.suit]+'</span></div>';
}
function buildSeats(){
  const felt=$('felt');
  for(let i=0;i<seatRefs.length;i++) seatRefs[i].el.remove();
  seatRefs=[];
  players.forEach(function(p,i){
    const el=document.createElement('div');
    el.className='seat'+(p.isHero?' hero':'');
    el.style.left=SEAT_POS[i].x+'%';el.style.top=SEAT_POS[i].y+'%';
    el.innerHTML='<div class="act-badge"></div><div class="seat-cards"></div>'+
      '<div class="seat-plate-wrap"><div class="seat-plate">'+
      '<div class="seat-name">'+p.name+'</div><div class="seat-pos"></div><div class="seat-style"></div>'+
      '<div class="seat-stack">'+p.stack+'</div></div><div class="dealer-btn">D</div></div>';
    felt.appendChild(el);
    seatRefs.push({el:el,badge:el.querySelector('.act-badge'),cards:el.querySelector('.seat-cards'),
      pos:el.querySelector('.seat-pos'),style:el.querySelector('.seat-style'),
      stack:el.querySelector('.seat-stack'),dealer:el.querySelector('.dealer-btn'),sig:''});
  });
}
/* The read-only description of the table that the RENDERER works from — the
   same idea as view() above, which does this for decision.js. Everything
   drawn on the felt comes from here and nowhere else, which is what lets the
   history screen hand paint() a reconstructed hand and get pixel-identical
   output without a second renderer to keep in step. */
function tableState(){
  return {players:players,board:board,pot:pot,street:street,handLive:handLive,
          actingIdx:actingIdx,villainIdx:villainIdx,dealerIdx:dealerIdx,
          revealAll:revealAll,handNo:handNo};
}
function posNameIn(s,i){return POS_NAMES[(i-s.dealerIdx+s.players.length)%s.players.length]||'';}
function updateSeats(s){
  s.players.forEach(function(p,i){
    const r=seatRefs[i];
    if(!r) return;
    r.el.classList.toggle('folded',p.folded);
    r.el.classList.toggle('acting',s.handLive&&s.actingIdx===i&&!p.folded&&!p.allIn);
    r.el.classList.toggle('villain',s.villainIdx===i);
    r.dealer.classList.toggle('shown',s.dealerIdx===i);
    if(r.stack.textContent!==String(p.stack)) r.stack.textContent=p.stack;
    const pn=posNameIn(s,i);
    if(r.pos.textContent!==pn) r.pos.textContent=pn;
    const styleTxt=p.isHero?'':(showProfiles&&p.profile?PROFILES[p.profile].label:'');
    if(r.style.textContent!==styleTxt) r.style.textContent=styleTxt;
    r.style.classList.toggle('shown',!!styleTxt);
    const show=p.isHero||s.revealAll;
    const sig=p.hole.map(cardStr).join('')+'|'+(show?'1':'0')+'|'+(p.folded?'f':'');
    if(r.sig!==sig){
      r.sig=sig;
      r.cards.innerHTML=p.hole.length?p.hole.map(function(c){return cardHTML(c,!p.isHero,!show,p.folded&&s.revealAll);}).join(''):'';
    }
    if(r.badge.textContent!==p.badge) r.badge.textContent=p.badge;
    r.badge.className='act-badge'+(p.badge?' show ':' ')+(p.badgeCls||'');
  });
}
// Was a card COUNT, which is enough while a hand only ever gains cards. Replay
// can step backwards onto a different board of the same length, and a count
// would call that unchanged and leave the turn's card on a flop.
let lastBoardSig='';
function updateBoard(s){
  const sig=s.board.map(cardStr).join('');
  if(sig!==lastBoardSig){
    lastBoardSig=sig;
    $('boardCards').innerHTML=s.board.map(function(c){return cardHTML(c,false,false,false);}).join('');
    const kids=$('boardCards').children;
    for(let i=0;i<kids.length;i++) kids[i].style.animationDelay=(i*0.11)+'s';
  }
  const potEl=$('potTag'),txt='Pot '+s.pot;
  if(potEl.textContent!==txt){potEl.textContent=txt;potEl.classList.add('bump');setTimeout(function(){potEl.classList.remove('bump');},300);}
  $('streetTag').textContent=s.handLive?STREETS[Math.min(s.street,4)]:'—';
  $('dealerLine').textContent=s.replay?('Hand #'+s.handNo+' — replay'):(s.handLive?('Hand #'+s.handNo):'Dealer ready');
}
// No argument means "draw the live table". Anything else is a reconstructed
// hand from handReplay.js, which carries the same fields.
function paint(s){const t=s||tableState();updateSeats(t);updateBoard(t);}
function setBadge(p,txt,cls){p.badge=txt;p.badgeCls=cls;}
function clearBadges(){players.forEach(function(p){p.badge='';p.badgeCls='';});}
/* The move list is a three-column table: move number, who acted, what they did.
   #log is the tbody, so every row here is a <tr>. Three shapes go in it —
   logMove for a numbered action, logNote for a named line that is not a move
   (showdown reveals), and log for prose that spans all three columns. */
let moveNo=0;
// One hand at a time. The list used to accumulate every hand of the session,
// which meant that by the third hand the auto-scroll had pushed the start of
// the current hand — the blinds and everyone who acted before you — out of
// view. Cleared on each deal, row one is always the hand's first move.
function resetLog(){
  $('log').innerHTML='';
  moveNo=0;
}
function logRow(cls){
  const tr=document.createElement('tr');
  if(cls)tr.className=cls;
  $('log').appendChild(tr);
  return tr;
}
// Pinned after the cells are in, or scrollHeight would still be measuring an
// empty row. The scroller is the wrapper, not the tbody.
function pinLog(){
  const s=$('log').closest('.log-scroll');
  if(s)s.scrollTop=s.scrollHeight;
}
function log(msg,cls){
  const tr=logRow(cls);
  const td=document.createElement('td');
  td.colSpan=3;td.innerHTML=msg;
  tr.appendChild(td);pinLog();
}
function logCells(cls,no,name,act){
  const tr=logRow(cls);
  tr.innerHTML='<td class="log-no">'+no+'</td><td class="log-who">'+name+
               '</td><td class="log-act">'+act+'</td>';
  pinLog();
}
/* The move list already decided that this is a discrete, ordered, meaningful
   thing that happened — it just wrote it as HTML. `rec` is the same event as
   data, so recording stays at the one chokepoint every action already passes
   through rather than being sprinkled over seven call sites.
   `to` and `allIn` are read off the player AFTER the action has moved the
   money, which is why this is called last at every site. */
function logMove(p,act,rec){
  logCells('move',++moveNo,who(p),act);
  if(rec) recorder.action({seat:p.id,street:street,action:rec.action,
    put:rec.put||0,to:p.bet,potBefore:rec.potBefore||0,toCall:rec.toCall||0,allIn:p.allIn});
}
function logNote(p,text){logCells('note','',who(p),text);}
function who(p){return p.isHero?'<span class="hl">'+p.name+'</span>':p.name;}

// The moves block has two faces: the list while a hand is running, the result
// card once it is over. Nothing is thrown away by flipping -- the rows stay in
// the tbody behind the card, which is what Review puts back on screen.
function setPanelView(v){
  const b=$('actionBox');
  if(b)b.dataset.view=v;
}
// What the hand cost or made, and who took each pot. Read off pendingResult
// and lastOutcome, so it must run after applyResult has moved the chips.
function renderHandResult(){
  const el=$('handResult');
  if(!el) return;
  const net=lastOutcome?lastOutcome.net:0;
  const tone=net>0?'pos':(net<0?'neg':'flat');
  const figure=net>0?('+'+net):(net<0?('−'+Math.abs(net)):'even');
  const pots=(pendingResult||[]).map(function(a,i){
    const names=a.winners.map(function(w){return w.name;}).join(' & ');
    const verb=a.winners.length>1?'split':(a.winners[0].isHero?'take':'takes');
    const label=pendingResult.length>1?((i===0?'Main pot':'Side pot '+i)+' — '):'';
    // Parenthesised rather than "with ...": the article varies by hand name
    // ("a pair", but "two pair", "four of a kind"), and this dodges it.
    const shown=a.contested&&a.best[0]>=0?(' ('+handName(a.best).toLowerCase()+')'):'';
    return '<li>'+label+names+' '+verb+' '+a.amount+shown+'</li>';
  }).join('');
  el.innerHTML='<div class="result-figure '+tone+'">'+figure+'</div>'+
               '<div class="result-sub">chips this hand</div>'+
               '<ul class="result-pots">'+pots+'</ul>';
}

function renderMatchResults(){
  const trail=$('matchResults'),score=$('matchScore');
  if(!trail||!score) return;
  const recent=matchResults.slice(-5);
  let wins=0,losses=0;
  trail.innerHTML=recent.map(function(result,i){
    const kind=result>0?'win':(result<0?'loss':'even');
    if(kind==='win')wins++;
    if(kind==='loss')losses++;
    const mark=kind==='win'?'✓':(kind==='loss'?'×':'−');
    const label=kind==='win'?'Won hand '+(i+1):(kind==='loss'?'Lost hand '+(i+1):'Even hand '+(i+1));
    return '<span class="match-result '+kind+'" title="'+label+'" aria-label="'+label+'">'+mark+'</span>';
  }).join('');
  score.textContent=wins+'-'+losses;
  trail.setAttribute('aria-label',recent.length?wins+' wins, '+losses+' losses':'No hands completed yet');
}

// The session ledger beside the name: everything won or lost since the first
// deal, signed against the stack you sat down with. The minus is a true minus
// sign rather than a hyphen, to match the hand result figure.
function renderSessionNet(){
  const el=$('sessionNet');
  if(!el) return;
  const tone=sessionNet>0?'pos':(sessionNet<0?'neg':'flat');
  const figure=sessionNet>0?('+'+sessionNet):(sessionNet<0?('−'+Math.abs(sessionNet)):'even');
  const label=sessionNet>0?('Up '+sessionNet+' chips for the game'):
              (sessionNet<0?('Down '+Math.abs(sessionNet)+' chips for the game'):'Even for the game');
  // "even" stands on its own; "even chips" reads as a quantity of nothing.
  el.innerHTML='<span class="earned-figure '+tone+'">'+figure+'</span>'+
               (sessionNet?'<span class="earned-sub">chips</span>':'');
  el.setAttribute('aria-label',label);
}

/* ============================================================
   8. EQUITY PANEL
   ============================================================ */

// The bubble is never empty: hero's turn gets the question, everything else
// gets small talk. The quip is keyed to the hand number so it holds steady for
// the whole hand rather than re-rolling every time a bot acts.
// The bubble has exactly three things it can be saying, and one function that
// decides which. Splitting this across the callers is what let a freshly played
// move get overwritten with small talk: recordDecision() set the reaction and
// disableHeroControls() immediately painted over it.
//
// Priority: the question hero is facing, else the move hero just made, else
// small talk. Quips and reactions are keyed to the hand number so they hold
// steady for the whole hand instead of re-rolling every time a bot acts.
let lastHeroAction=null;   // family of hero's most recent move this hand
function paintBubble(){
  const el=$('coachNudge');
  if(heroTurn){
    const flat=adviceSpot();
    if(flat){el.innerHTML=buildCoachNudge(flat,stats.hands);return;}
  }
  if(lastHeroAction&&handLive){el.innerHTML=coachReaction(lastHeroAction,stats.hands);return;}
  el.innerHTML=coachQuip('idle',stats.hands);
}
const RING_C=2*Math.PI*32;
let lastEq=null;          // cached equity for the current spot
let lastEqKey='';

// The equity tab is always on: the two numbers are meant to become familiar,
// not something you go and reveal. Recomputed only when the spot actually
// changes, since each render is ~1400 simulated runouts.
function renderEquityTab(force){
  const hero=players[0];
  const opps=players.filter(function(p){return !p.folded&&!p.isHero;});
  if(!handLive||hero.folded||!hero.hole.length||!opps.length){ clearEquityTab(); return; }
  const key=street+'|'+board.map(cardStr).join('')+'|'+opps.map(function(p){return p.id;}).join(',')+'|'+hero.hole.map(cardStr).join('');
  if(!force&&key===lastEqKey&&lastEq) return;
  const rawTrials=Math.round(HERO_TRIALS*0.6);
  const eqR=calcEquity(hero.hole,opps,HERO_TRIALS,true);     // vs their implied ranges
  const eqU=calcEquity(hero.hole,opps,rawTrials,false);      // vs random hands (baseline)
  // Fix C3: calcEquity can report ok:false rather than fabricating a 0%.
  if(!eqR.ok||!eqU.ok){ clearEquityTab(); return; }
  lastEqKey=key;lastEq={eqR:eqR,eqU:eqU,rawTrials:rawTrials};

  /* whole-number percentages, tie-aware (MATHS.md §2), with visible uncertainty */
  const rawPct=pctWhole(eqU.equity/100);
  const adjPct=pctWhole(eqR.equity/100);
  const ci=ci95Points(eqR.se);
  $('eqAdjNum').innerHTML=adjPct+'<span>%'+(ci===null?'':' ±'+ci)+'</span>';
  $('eqRawNum').innerHTML=rawPct+'<span>%</span>';
  $('eqRing').style.strokeDashoffset=RING_C*(1-clamp(eqR.equity,0,100)/100);
  $('eqHand').textContent=board.length?handName(evaluateBest(hero.hole.concat(board))):'Preflop';
  $('mWin').style.width=eqR.win+'%';$('mTie').style.width=eqR.tie+'%';$('mLose').style.width=eqR.lose+'%';
  $('kWin').textContent='win '+Math.round(eqR.win)+'%';
  $('kTie').textContent='tie '+Math.round(eqR.tie)+'%';
  $('kLose').textContent='lose '+Math.round(eqR.lose)+'%';

  const degradedNote=eqR.degradedShare>0.02
    ? ' You are holding so many of the cards they would need for a strong hand that some of these run-throughs had to fall back on random cards — so take this one as a rough read rather than a precise figure.'
    : '';
  $('eqReliabilityBody').innerHTML='<p>This spot played the hand out <b>'+HERO_TRIALS+'</b> times against the hands they are likely to hold, and <b>'+rawTrials+
    '</b> times against random cards.'+(ci===null?'':' That puts you around <b>'+adjPct+'%</b>, give or take '+ci+
    ' points — realistically somewhere between <b>'+Math.max(0,adjPct-ci)+'%</b> and <b>'+
    Math.min(100,adjPct+ci)+'%</b>.')+degradedNote+'</p>';
}
function clearEquityTab(){
  lastEq=null;lastEqKey='';
  $('eqAdjNum').innerHTML='—<span>%</span>';
  $('eqRawNum').innerHTML='—<span>%</span>';
  $('eqRing').style.strokeDashoffset=RING_C;
  $('eqHand').textContent='';
  ['mWin','mTie'].forEach(function(id){$(id).style.width='0%';});
  $('mLose').style.width='100%';
  $('kWin').textContent='win —';$('kTie').textContent='tie —';$('kLose').textContent='lose —';
  $('eqReliabilityBody').innerHTML='';
}

// Where hero sits, and whether that means acting last for the rest of the hand.
function heroActsLast(){ return D.heroActsLast(view()); }
// What hero is actually holding: a made hand, or a draw chasing one.
function heroShape(){
  const hero=players[0];
  if(!hero.hole.length) return null;
  const shape=analyzeHandShape(hero.hole,board);
  shape.description=describeShape(shape);
  shape.equityFromOuts=outsToEquity(shape.outs,shape.cardsToCome,unseenCount(board));
  if(shape.cardsToCome>=2) shape.riverOnlyEquity=outsToEquity(shape.outs,1,unseenCount(board)-1);
  shape.madeName=board.length>=3?handName(evaluateBest(hero.hole.concat(board))):null;
  return shape;
}

// The flat description of the spot that every advice surface is built from.
// Returns null when there is nothing to describe. Whoever renders, renders this.
function adviceSpot(){
  const hero=players[0];
  if(!handLive||hero.folded||!hero.hole.length) return null;
  const opps=players.filter(function(p){return !p.folded&&!p.isHero;});
  let main=opps[0];
  opps.forEach(function(o){if((o.rLo||0)>(main.rLo||0))main=o;});
  const spot=snapshotSpot();
  // Fix C1/C7: same honest ranking as snapshotSpot -- check dominates fold, and
  // options inside each other's error bars are grouped with the cheapest winning.
  const best=rankOptions(spot.options).recommended;
  const P=spot.pot;
  let bestAggro=null;
  spot.options.forEach(function(o){ if(o.fold!==undefined&&(!bestAggro||o.ev>bestAggro.ev)) bestAggro=o; });
  const refB=bestAggro?bestAggro.amount:Math.max(BB,Math.round(P*0.75));
  const oppInfo=opps.map(function(o){
    return {name:o.name,response:respond(o,refB,P),rangeTopPct:rangeWidth(o),
            airPct:100*(o.rBluff||0),styleLabel:profOf(o).label};
  });
  const eqR=lastEq?lastEq.eqR:null, eqU=lastEq?lastEq.eqU:null;
  return {
    streetName:STREETS[Math.min(street,4)],
    toCall:spot.toCall,
    pot:P,
    rawEquity:eqU?eqU.equity/100:null,
    rangeEquity:eqR?eqR.equity/100:spot.equity,
    decisionEquity:spot.equity,
    equitySe:eqR?eqR.se:null,
    degradedShare:eqR?eqR.degradedShare:0,
    trials:HERO_TRIALS,
    opponents:oppInfo,
    options:spot.options,
    recommended:best,
    revealStyles:showProfiles,
    villain:oppInfo[opps.indexOf(main)],
    field:fieldBreakdown(),
    blockerPct:main?blockerPct(hero.hole,main):0,
    shape:heroShape(),
    position:{name:posName(0),actsLast:heroActsLast(),preflop:street===0,credit:positionalCredit()},
    main:main,
  };
}

// The range bar and blocker line used to sit in the bubble. They are a read on
// the opponent rather than a question for the player, so they travel with the
// decision into the review. Captured live: both depend on range state that
// decays every street, so neither can be rebuilt afterwards.
function opponentReadMarkup(){
  const hero=players[0];
  const opps=players.filter(function(p){return !p.folded&&!p.isHero;});
  if(!opps.length) return '';
  let main=opps[0];
  opps.forEach(function(o){if((o.rLo||0)>(main.rLo||0))main=o;});
  const vLo=(main.rLo||0)*100, bl=(main.rBluff||0);
  const blk=blockerPct(hero.hole,main);
  return '<div class="rangebar"><div class="rb-lab"><span>'+main.name+"'s implied range</span><span>"+
    (bl>0.02?Math.round(bl*100)+'% air':'linear')+'</span></div>'+
    '<div class="rb-track"><div class="rb-val" style="left:'+vLo+'%;right:0"></div>'+
    (bl>0.02?'<div class="rb-bluff" style="width:'+(BLUFF_TOP*100)+'%;opacity:'+Math.min(1,bl*2.2)+'"></div>':'')+'</div></div>'+
    '<div class="eq-sub">your cards block <b>'+Math.round(blk)+'%</b> of '+main.name+"'s value combos</div>";
}

/* ---- the detail surfaces, shared by every place that renders advice ---- */

const CONF={'clear':'clear','solid':'best of the options','marginal':'close','toss-up':'your call'};

function frequencyTableMarkup(frequencies,nContesting){
  return '<table class="val-tab"><tr><th>action</th><th>EV</th><th>they fold</th><th>they raise</th></tr>'+
    frequencies.map(function(f){
      const cls=f.recommended?'ev-pos':'';
      const tag=f.recommended?' ← pick':(f.tied?' <span class="fq-tied">= same call</span>':'');
      return '<tr><td class="'+cls+'">'+f.label+tag+'</td><td class="'+cls+'">'+f.ev+'</td><td>'+(f.fold||'—')+'</td><td>'+(f.raise||'—')+'</td></tr>';
    }).join('')+'</table>'+
    '<div class="mini-note">Frequencies, not commandments. Lines marked <b>= same call</b> rate about the same as the pick — the same decision in chips, and mixing between them is what stops you being readable.</div>'+
    (nContesting?'<div class="mini-note">EV figures price the '+nContesting+' opponent(s) expected to keep going, use your equity against the hands that would actually call, and include a small credit for acting last.</div>':'');
}

function mathsMarkup(maths){
  return maths.map(function(m){return '<div class="coach-maths-line">'+m+'</div>';}).join('');
}


/* ============================================================
   9. SIDE POTS
   ============================================================ */
// Side pots are built by table.js, which is where the headless harness tests
// them. A pot layer above the highest commitment anyone still in the hand has
// made has nobody eligible for it; the shared version folds that dead money
// into the top layer instead of throwing. Found by the 10,000-hand backtest.
function buildSidePots(){ return buildSidePotsFor(players); }
function computeResult(){
  const pots=buildSidePots();
  const awards=[];
  pots.forEach(function(pt,i){
    const elig=pt.eligible;
    // Fix D5: a pot layer with no eligible player cannot arise legally --
    // every layer is built from chips someone committed. Silently handing it
    // to "all live players" would misaward chips instead of surfacing the bug.
    if(!elig.length) throw new Error('pot layer '+i+' has no eligible player');
    let best=null,winners=[];
    elig.forEach(function(p){
      const s=board.length>=5?evaluateBest(p.hole.concat(board)):[-1];
      p.score=s;
      if(best===null||cmpScore(s,best)>0){best=s;winners=[p];}
      else if(cmpScore(s,best)===0) winners.push(p);
    });
    if(elig.length===1){best=[-1];winners=[elig[0]];}
    awards.push({index:i,amount:pt.amount,winners:winners,best:best,contested:elig.length>1});
  });
  return awards;
}
function applyResult(awards){
  awards.forEach(function(a){
    const share=Math.floor(a.amount/a.winners.length);
    const rem=a.amount-share*a.winners.length;
    a.winners.forEach(function(w,i){
      const got=share+(i===0?rem:0);
      w.stack+=got;
      // The odd chip goes to the first winner. Replay has to award the same
      // way or a split pot reconstructs stacks that are one chip out.
      recorder.award(w.id,got);
    });
  });
}

/* ============================================================
   10. BETTING MECHANICS
   ============================================================ */
const liveCount=function(){return players.filter(function(p){return !p.folded;}).length;};
function nextActive(from){
  for(let k=1;k<=players.length;k++){
    const i=(from+k)%players.length;
    if(!players[i].folded&&!players[i].allIn) return i;
  }
  return -1;
}
function roundComplete(){
  if(liveCount()<=1) return true;
  const canAct=players.filter(function(p){return !p.folded&&!p.allIn;});
  if(canAct.length===0) return true;
  return canAct.every(function(p){return p.acted&&p.bet===currentBet;});
}
function postBlind(i,amt){
  const p=players[i],put=Math.min(amt,p.stack);
  p.stack-=put;p.bet+=put;p.committed+=put;
  if(p.stack===0)p.allIn=true;
  return put;
}
function collectBets(){
  players.forEach(function(p){pot+=p.bet;p.bet=0;p.acted=false;p.mayRaise=true;p.raises=0;});
  currentBet=0;minRaise=BB;streetRaises=0;
}
function startHand(){
  handNo++;
  players.forEach(function(p){if(p.stack<=0)p.stack=START_STACK;});
  heroStackStart=players[0].stack;lastOutcome=null;
  deck=shuffle(makeDeck());
  board=[];lastBoardSig='';pot=0;street=0;currentBet=0;minRaise=BB;
  handLive=true;revealAll=false;streetRaises=0;lastAggressor=-1;villainIdx=-1;pendingResult=null;lastMultiway=[];rgAskedStreet=-1;handDecisions=[];heroSpot=null;lastHeroAction=null;tipsOpen=false;$('evReview').innerHTML='';
  players.forEach(function(p){p.hole=[];p.folded=false;p.allIn=false;p.bet=0;p.committed=0;p.acted=false;p.mayRaise=true;p.raises=0;p.badge='';p.badgeCls='';p.rLo=0;p.rBluff=0;p.score=null;});
  hf={vpip:false,pfr:false,raisedPre:false,f3bCounted:false,sawShowdown:false,aggro:0,calls:0};
  paintBubble();$('guessBox').style.display='none';
  dealerIdx=(dealerIdx+1)%players.length;
  buildRangeIndex();
  let di=0;
  for(let r=0;r<2;r++) players.forEach(function(p){p.hole.push(deck[di++]);});
  deck=deck.slice(di);
  // Opened after the deal, before the blinds, so the stacks it captures are
  // the ones everyone sat down with — including the top-up above.
  const liveGame=getLiveGame();
  recorder.begin({handNo:handNo,players:players,dealerIdx:dealerIdx,heroIndex:0,
    sb:SB,bb:BB,startStack:START_STACK,gameId:liveGame?liveGame.id:null});
  const sbIdx=(dealerIdx+1)%players.length,bbIdx=(dealerIdx+2)%players.length;
  const sbPut=postBlind(sbIdx,SB),bbPut=postBlind(bbIdx,BB);
  recorder.blind(players[sbIdx].id,sbPut);recorder.blind(players[bbIdx].id,bbPut);
  currentBet=BB;
  setBadge(players[sbIdx],'SB '+SB,'b-blind');
  setBadge(players[bbIdx],'BB '+BB,'b-blind');
  resetLog();setPanelView('moves');
  // No `rec` argument: the blinds are already recorded above, and posting one
  // is not a decision anybody made.
  logMove(players[sbIdx],'posts '+SB);
  logMove(players[bbIdx],'posts '+BB);
  actingIdx=nextActive(bbIdx);
  paint();
  renderEquityTab(true);
  $('status').innerHTML='Cards are out. You are in <b>'+posName(0)+'</b>.';
  setTimeout(step,T(900));
}
function step(){
  if(!handLive) return;
  if(liveCount()===1) return finishHand();
  if(roundComplete()) return advanceStreet();
  const p=players[actingIdx];
  if(!p||p.folded||p.allIn){actingIdx=nextActive(actingIdx);return step();}
  if(liveCount()>=2) lastMultiway=players.filter(function(x){return !x.folded;});
  paint();
  if(p.isHero){enableHeroControls();}
  else{disableHeroControls();setBadge(p,'thinking','b-think');paint();setTimeout(function(){botAct(p);},T(1250));}
}
function advanceStreet(){
  collectBets();paint();
  setTimeout(function(){
    clearBadges();paint();
    street++;
    if(street>=4||liveCount()===1) return finishHand();
    if(street===1) board.push(deck.pop(),deck.pop(),deck.pop());
    else board.push(deck.pop());
    buildRangeIndex();
    players.forEach(function(p){p.rLo*=0.88;p.rBluff*=0.80;});
    // After the decay: the snapshot is what everyone is repping going INTO
    // this street, not what they were repping leaving the last one.
    recorder.street(street,board,players);
    // No band for the new street: the move list stays moves only. The board
    // itself is on the table, and the street name is on #streetTag.
    actingIdx=nextActive(dealerIdx);
    // A new card is on the table, so a reaction to last street's move has gone
    // stale — the bubble drops back to small talk until hero is asked again.
    lastHeroAction=null;
    paintBubble();renderEquityTab();paint();
    $('status').innerHTML='<b>'+STREETS[street]+'</b> — '+board.map(cardTxt).join(' ');
    const canAct=players.filter(function(p){return !p.folded&&!p.allIn;});
    if(canAct.length<=1){setTimeout(advanceStreet,T(1500));return;}
    setTimeout(step,T(1200));
  },T(850));
}

/* ---- hero ---- */
function potBefore(){return pot+players.reduce(function(s,p){return s+p.bet;},0);}
// The read-only description of the table that decision.js works from. Built
// fresh each call so it always reflects current state.
function view(){
  return {players:players,heroIndex:0,board:board,street:street,pot:pot,
          currentBet:currentBet,minRaise:minRaise,dealerIdx:dealerIdx,
          bigBlind:BB,streetRaises:streetRaises,rangeIndex:rangeIndex,rng:Math.random,
          calledTrials:CALLED_TRIALS,equityTrials:520};
}
function heroFold(){
  const h=players[0];
  const pbFold=potBefore(),tcFold=Math.min(currentBet-h.bet,h.stack);
  h.folded=true;h.acted=true;
  if(street===0&&hf.raisedPre&&currentBet>h.bet&&!hf.f3bCounted){stats.f3bOpp++;stats.f3b++;hf.f3bCounted=true;}
  recordDecision('fold');
  setBadge(h,'fold','b-fold');
  logMove(h,'folds',{action:'fold',put:0,potBefore:pbFold,toCall:tcFold});
  disableHeroControls();paintBubble();clearEquityTab();
  $('status').innerHTML='You folded — the hand plays on. Everything is revealed at the end.';
  paint();actingIdx=nextActive(0);setTimeout(step,T(700));
}
function heroCall(){
  const h=players[0];
  const toCall=Math.min(currentBet-h.bet,h.stack);
  const pbCall=potBefore();
  if(street===0){
    if(toCall>0) hf.vpip=true;
    if(hf.raisedPre&&currentBet>h.bet&&!hf.f3bCounted){stats.f3bOpp++;hf.f3bCounted=true;}
  } else if(toCall>0){stats.calls++;hf.calls++;}
  h.stack-=toCall;h.bet+=toCall;h.committed+=toCall;h.acted=true;
  if(h.stack===0)h.allIn=true;
  recordDecision(toCall===0?'check':'call',toCall);
  if(toCall>0) narrowCall(h); else narrowCheck(h);
  setBadge(h,toCall===0?'check':'call '+toCall,'b-passive');
  logMove(h,toCall===0?'checks':'calls '+toCall,
    {action:toCall===0?'check':'call',put:toCall,potBefore:pbCall,toCall:toCall});
  disableHeroControls();paint();
  actingIdx=nextActive(0);setTimeout(step,T(700));
}
function heroRaise(){
  const h=players[0];
  const pb=potBefore();
  const tcRaise=Math.min(currentBet-h.bet,h.stack);
  const target=+$('raiseSlider').value;
  const put=Math.min(target-h.bet,h.stack);
  if(street===0){
    hf.vpip=true;hf.pfr=true;
    if(hf.raisedPre&&currentBet>h.bet&&!hf.f3bCounted){stats.f3bOpp++;hf.f3bCounted=true;}
    hf.raisedPre=true;
  } else {stats.aggro++;hf.aggro++;}
  h.stack-=put;h.bet+=put;h.committed+=put;
  if(h.stack===0)h.allIn=true;
  const rs=h.bet-currentBet;
  // Fix C2: only a FULL raise (increment >= minRaise) reopens betting. A
  // stack-limited all-in for less does not -- it grows the pot and forces a
  // call/fold decision on opponents who already acted, but must not let them
  // re-raise. The previous code reopened (and grew minRaise) unconditionally.
  const isFullRaise=rs>=minRaise;
  if(isFullRaise)minRaise=rs;
  currentBet=Math.max(currentBet,h.bet);
  h.acted=true;h.mayRaise=false;h.raises++;streetRaises++;lastAggressor=0;
  recordDecision(street===0||currentBet>BB?'raise':'bet',h.bet);
  narrowAggro(h,put/Math.max(1,pb));
  setBadge(h,(h.allIn?'all in ':'raise to ')+h.bet,'b-aggro');
  players.forEach(function(p){if(p!==h&&!p.folded&&!p.allIn){p.acted=false;if(isFullRaise)p.mayRaise=true;}});
  logMove(h,(h.allIn?'all in for ':'raises to ')+h.bet,
    {action:tcRaise>0?'raise':'bet',put:put,potBefore:pb,toCall:tcRaise});
  disableHeroControls();paint();
  actingIdx=nextActive(0);setTimeout(step,T(700));
}

/* ============================================================
   11. BOT DECISIONS — preflop chart, postflop mixed strategy
   ============================================================ */
function applyBotRaise(p,target,toCall,label){
  const pb=potBefore();
  target=Math.max(target,currentBet+minRaise);
  target=Math.min(target,p.bet+p.stack);
  const put=target-p.bet;
  p.stack-=put;p.bet=target;p.committed+=put;
  if(p.stack===0)p.allIn=true;
  const rs=p.bet-currentBet;
  // Fix C2 (see heroRaise): only reopen action on a full raise.
  const isFullRaise=rs>=minRaise;
  if(isFullRaise)minRaise=rs;
  currentBet=Math.max(currentBet,p.bet);
  p.acted=true;p.mayRaise=false;p.raises++;streetRaises++;lastAggressor=players.indexOf(p);
  narrowAggro(p,put/Math.max(1,pb));
  setBadge(p,(p.allIn?'all in ':label+' ')+p.bet,'b-aggro');
  players.forEach(function(x){if(x!==p&&!x.folded&&!x.allIn){x.acted=false;if(isFullRaise)x.mayRaise=true;}});
  logMove(p,(p.allIn?'all in for ':(toCall>0?'raises to ':'bets '))+p.bet,
    {action:toCall>0?'raise':'bet',put:put,potBefore:pb,toCall:toCall});
}
function botFold(p){
  const pbF=potBefore(),tcF=Math.min(currentBet-p.bet,p.stack);
  p.folded=true;p.acted=true;setBadge(p,'fold','b-fold');
  logMove(p,'folds',{action:'fold',put:0,potBefore:pbF,toCall:tcF});
}
function botCheck(p){
  const pbC=potBefore();
  p.acted=true;narrowCheck(p);setBadge(p,'check','b-passive');
  logMove(p,'checks',{action:'check',put:0,potBefore:pbC,toCall:0});
}
function botCall(p,toCall){
  const pbCall=potBefore();
  p.stack-=toCall;p.bet+=toCall;p.committed+=toCall;p.acted=true;
  if(p.stack===0)p.allIn=true;
  narrowCall(p);
  setBadge(p,'call '+toCall,'b-passive');
  logMove(p,'calls '+toCall,{action:'call',put:toCall,potBefore:pbCall,toCall:toCall});
}
// Both decisions are made by botPolicy.js — the same pure functions the
// calibration harness drives. These only translate the answer into table
// actions, so what the app plays and what the harness measures cannot diverge.
function preflopAct(p){
  const idx=players.indexOf(p);
  const d=decidePreflop({
    prof:PROFILES[p.profile],
    pct:handPercentile(p.hole),
    liveOpp:players.filter(function(x){return !x.folded&&x!==p;}).length,
    posMult:posMult(idx), pos:posOf(idx),
    toCall:Math.min(currentBet-p.bet,p.stack),
    currentBet:currentBet, minRaise:minRaise, bigBlind:BB,
    streetRaises:streetRaises, raises:p.raises, mayRaise:p.mayRaise,
    rng:Math.random,
  });
  const toCall=Math.min(currentBet-p.bet,p.stack);
  if(d.action==='raise') return applyBotRaise(p,d.target,toCall,'raise to');
  if(d.action==='call') return botCall(p,toCall);
  if(d.action==='check') return botCheck(p);
  return botFold(p);
}
function postflopAct(p){
  const potNow=potBefore();
  const toCall=Math.min(currentBet-p.bet,p.stack);
  const contesting=players.filter(function(x){return !x.folded&&x!==p&&(x.bet>0||x.allIn);});
  const liveOpp=players.filter(function(x){return !x.folded&&x!==p;});
  const refOpp=(toCall>0&&contesting.length)?contesting:liveOpp;
  const eq=calcEquity(p.hole,refOpp,BOT_TRIALS,true);
  // No completed trial must not read as "definitely behind" -- take the
  // passive line instead of letting a fabricated 0% drive the decision.
  if(!eq.ok) return toCall>0?botFold(p):botCheck(p);
  const prof=PROFILES[p.profile];
  const d=decidePostflop({
    prof:prof, strength:eq.equity/100, nRef:refOpp.length,
    toCall:toCall, potNow:potNow, currentBet:currentBet, bigBlind:BB,
    canRaise:p.raises<prof.maxRaises&&streetRaises<4&&p.mayRaise,
    rng:Math.random,
  });
  if(d.action==='bet') return applyBotRaise(p,d.target,toCall,'bet');
  if(d.action==='raise') return applyBotRaise(p,d.target,toCall,'raise to');
  if(d.action==='call') return botCall(p,toCall);
  if(d.action==='check') return botCheck(p);
  return botFold(p);
}
function botAct(p){
  if(street===0) preflopAct(p); else postflopAct(p);
  paint();actingIdx=nextActive(actingIdx);setTimeout(step,T(800));
}

/* ============================================================
   12. HAND GUESSING + SHOWDOWN
   ============================================================ */
const BUCKETS=['Nothing — missed the board','Weak pair (below top pair)','Top pair or overpair','Two pair or trips','Straight or better'];
function readBucket(hole,brd){
  const s=evaluateBest(hole.concat(brd));
  const cat=s[0];
  if(cat>=4) return 4;
  if(cat===2||cat===3) return 3;
  if(cat===1){
    const pairRank=s[1];
    const hr=hole.map(function(c){return c.rank;});
    const br=brd.map(function(c){return c.rank;});
    if(hr.indexOf(pairRank)<0) return 0;          // pair is on the board, they hold nothing
    const topBoard=Math.max.apply(null,br);
    if(hr[0]===hr[1]&&hr[0]>topBoard) return 2;   // overpair
    if(pairRank>=topBoard) return 2;              // top pair
    return 1;
  }
  return 0;
}
function pickVillain(contenders){
  const nonHero=contenders.filter(function(p){return !p.isHero;});
  if(!nonHero.length) return -1;
  if(lastAggressor>0&&contenders.indexOf(players[lastAggressor])>=0) return lastAggressor;
  let best=nonHero[0];
  nonHero.forEach(function(p){if(p.committed>best.committed)best=p;});
  return players.indexOf(best);
}
function finishHand(){
  collectBets();
  recorder.collect();
  handLive=false;heroTurn=false;disableHeroControls();
  const contenders=players.filter(function(p){return !p.folded;});
  pendingResult=computeResult();
  const showdown=contenders.length>1&&board.length>=5;
  if(showdown&&!players[0].folded) hf.sawShowdown=true;
  if(guessEnabled&&showdown){
    villainIdx=pickVillain(contenders);
    if(villainIdx>=0){paint();return askGuess();}
  }
  concludeHand(null);
}
function askGuess(){
  const v=players[villainIdx];
  $('guessBox').style.display='block';
  $('guessQ').innerHTML='Board: <b style="color:var(--cream)">'+board.map(cardTxt).join(' ')+'</b><br>What do you put <b>'+v.name+'</b> ('+posName(villainIdx)+') on?';
  const wrap=$('guessOpts');wrap.innerHTML='';
  BUCKETS.forEach(function(label,i){
    const b=document.createElement('button');
    b.className='guess-opt';b.textContent=label;
    b.addEventListener('click',function(){concludeHand(i);});
    wrap.appendChild(b);
  });
  $('status').innerHTML='Betting is done. Commit to a read before the cards come up.';
}
function concludeHand(guess){
  $('guessBox').style.display='none';
  let guessLine='';
  if(guess!==null&&villainIdx>=0){
    const v=players[villainIdx];
    const actual=readBucket(v.hole,board);
    const right=(guess===actual);
    stats.guessTotal++;if(right)stats.guessRight++;
    const key=STREETS[Math.min(street,3)];
    if(!stats.byStreet[key])stats.byStreet[key]={t:0,r:0};
    stats.byStreet[key].t++;if(right)stats.byStreet[key].r++;
    guessLine=right?'<span class="guess-result right">Correct — '+v.name+' had '+BUCKETS[actual].toLowerCase()+'.</span>'
                   :'<span class="guess-result wrong">You said '+BUCKETS[guess].toLowerCase()+'; '+v.name+' had '+BUCKETS[actual].toLowerCase()+'.</span>';
    log((right?'<span class="hl">Read correct</span>':'Read missed')+' — put '+v.name+' on '+BUCKETS[guess].toLowerCase()+', actually '+BUCKETS[actual].toLowerCase());
  }
  // Recorded before the chips move, so the replay reveals cards and then pays
  // the pot in the order the table actually does it.
  const atShowdown=players.filter(function(p){return !p.folded;});
  if(atShowdown.length>1&&board.length>=5){
    recorder.showdown(atShowdown.map(function(p){
      return {seat:p.id,hole:p.hole,handName:handName(evaluateBest(p.hole.concat(board)))};
    }));
  }
  applyResult(pendingResult);
  revealAll=true;
  const contenders=players.filter(function(p){return !p.folded;});
  if(pendingResult.length>1) log('<span class="street">Side pots</span>','street');
  pendingResult.forEach(function(a,i){
    const names=a.winners.map(function(w){return w.name;}).join(' & ');
    const label=pendingResult.length>1?(i===0?'Main pot':'Side pot '+i):'Pot';
    log('<span class="hl">'+label+' '+a.amount+'</span> → '+names+(a.contested&&a.best[0]>=0?' ('+handName(a.best).toLowerCase()+')':''));
  });
  if(contenders.length>1&&board.length>=5){
    contenders.forEach(function(p){logNote(p,p.hole.map(cardTxt).join(' ')+' — '+handName(evaluateBest(p.hole.concat(board))));});
  }
  const top=pendingResult[0];
  const names=top?top.winners.map(function(w){return w.name;}).join(' & '):'Nobody';
  $('status').innerHTML=guessLine+'<b>'+names+'</b> take'+(top&&top.winners.length>1?'':'s')+' the main pot. All hands face up.';
  players.forEach(function(p){if(p.folded)setBadge(p,'folded','b-fold');});
  const noShowdown=(contenders.length<2||board.length<5);
  if(noShowdown){
    const cfh=counterfactualHTML();
    if(cfh){
      $('status').innerHTML+=cfh;
      const cf=counterfactual(lastMultiway);
      if(cf){
        cf.sort(function(a,b){return b.pct-a.pct;});
        log('<span class="street">If it had run out</span>','street');
        cf.forEach(function(r){logNote(r.p,r.p.hole.map(cardTxt).join(' ')+' — '+r.pct.toFixed(0)+'% to win');});
      }
    }
  }
  stats.hands++;
  if(hf.vpip)stats.vpip++;
  if(hf.pfr)stats.pfr++;
  if(hf.sawShowdown)stats.wtsd++;
  handLog.push({vpip:hf.vpip,pfr:hf.pfr,aggro:hf.aggro,calls:hf.calls});
  const handCost=handDecisions.reduce(function(a,d){return a+Math.max(0,d.cost);},0);
  evRecords.push({cost:handCost,n:handDecisions.length});
  lastOutcome={net:players[0].stack-heroStackStart,
               showdown:contenders.length>1&&board.length>=5,
               folded:players[0].folded};
  matchResults.push(lastOutcome.net);
  if(matchResults.length>5)matchResults.shift();
  // The hand is over and cannot be replayed to try again, so a storage failure
  // here is swallowed by handStore rather than allowed to break the deal.
  const recorded=recorder.finish({
    net:lastOutcome.net,
    potFinal:(pendingResult||[]).reduce(function(s,a){return s+a.amount;},0),
    showdown:lastOutcome.showdown,
    heroFolded:lastOutcome.folded,
    winners:pendingResult&&pendingResult.length?pendingResult[0].winners.map(function(w){return w.id;}):[],
    decisions:handDecisions,
  });
  if(recorded) saveHand(recorded);
  sessionNet+=lastOutcome.net;
  renderMatchResults();renderSessionNet();
  renderHandResult();setPanelView('result');
  renderHandReview();renderEvCharts();renderLeak();
  renderStats();renderDrift();$('rangeGuessWrap').innerHTML='';
  saveSession();
  villainIdx=-1;paint();
  $('btnDeal').disabled=false;setPhase('post');
}

/* ============================================================
   13. STATS + CLASSIFICATION
   ============================================================ */
const SIGNATURES=[
  {k:'nit',vpip:12,pfr:9,af:1.0},{k:'tag',vpip:22,pfr:18,af:2.5},
  {k:'lag',vpip:34,pfr:26,af:3.0},{k:'station',vpip:45,pfr:6,af:0.4},
  {k:'maniac',vpip:58,pfr:38,af:5.0}
];
// The maths lives in leak.js so the dashboard's lifetime figures and the
// table's session figures are computed by the same code.
function heroMetrics(){ return heroMetricsOf(stats); }
function renderStats(){
  const m=heroMetrics();
  const cells=[['Hands',stats.hands,''],['VPIP',m.vpip.toFixed(0),'%'],['PFR',m.pfr.toFixed(0),'%'],
    ['Aggression',m.af.toFixed(2),''],['Fold to 3-bet',m.f3b===null?'—':m.f3b.toFixed(0),m.f3b===null?'':'%'],
    ['Hand reads',m.read===null?'—':m.read.toFixed(0),m.read===null?'':'%'],
    ['Range reads',stats.rgTotal?Math.round(100*stats.rgRight/stats.rgTotal):'—',stats.rgTotal?'%':'']];
  $('statGrid').innerHTML=cells.map(function(c){
    return '<div class="stat"><div class="k">'+c[0]+'</div><div class="v">'+c[1]+'<small>'+c[2]+'</small></div></div>';
  }).join('');
}
function classify(){
  const out=$('classifyOut');
  out.classList.add('open');
  if(stats.hands<15){out.innerHTML='Need at least 15 hands for this to mean anything — you have played '+stats.hands+'.';return;}
  const m=heroMetrics();
  let best=null,bd=Infinity;
  SIGNATURES.forEach(function(s){
    const d=Math.pow((m.vpip-s.vpip)/25,2)+Math.pow((m.pfr-s.pfr)/20,2)+Math.pow((m.af-s.af)/2,2);
    if(d<bd){bd=d;best=s;}
  });
  const p=PROFILES[best.k];
  const byStreet=Object.keys(stats.byStreet).map(function(k){
    const s=stats.byStreet[k];return k+' '+Math.round(100*s.r/s.t)+'%';
  }).join(' · ');
  out.innerHTML='<span class="big">'+p.label+'</span>Closest match to your '+stats.hands+
    ' hands: VPIP '+m.vpip.toFixed(0)+'%, PFR '+m.pfr.toFixed(0)+'%, aggression factor '+m.af.toFixed(2)+
    '. That profile '+p.note+'.'+(byStreet?'<br><br>Read accuracy by street: '+byStreet:'');
}


/* ============================================================
   13b. FOLD EQUITY — what it costs to make them fold
   A player continues when their hand beats the price. Their range is
   uniform over [rLo,1] plus a bluff band, so the fraction that folds
   to a given size can be read straight off the range, no simulation.
   ============================================================ */
// Everything about "what will they do if I bet" is one call into decision.js,
// which in turn calls opponentModel.js. One answer, one place.
function respond(o,betSize,potSize){ return D.respond(view(),o,betSize,potSize); }
function foldChance(o,betSize,potSize){ return D.foldChance(view(),o,betSize,potSize); }
// Equity against the hands that would actually call a bet of this size. A caller
// holds the top of their range, and almost never pure air, so this is lower than
// unconditional equity -- and it falls further the bigger the bet. Without it,
// EV(bet) rises with size almost without limit and every spot recommends a raise.
function equityIfCalled(hole,opps,betSize,potSize,trials){ return D.equityIfCalled(view(),hole,opps,betSize,potSize,trials); }
function renderFoldEquity(){
  const hero=players[0];
  const opps=players.filter(function(p){return !p.folded&&!p.isHero;});
  const el=$('foldEq');
  if(!opps.length||!handLive){el.innerHTML='';return;}
  const P=potBefore();
  const sizes=[[0.33,'\u2153 pot'],[0.5,'\u00bd pot'],[0.75,'\u00be pot'],[1.0,'pot'],[1.5,'1.5\u00d7 pot']];
  let rows='';
  sizes.forEach(function(sz){
    const B=Math.round(P*sz[0]);
    if(B<BB||B>hero.stack) return;
    const need=B/(P+B);
    const resp=jointResponse(opps.map(function(o){ return respond(o,B,P); }));
    const pf=resp.fold;
    const ok=pf>=need;
    rows+='<tr><td>'+sz[1]+'</td><td>'+B+'</td><td>'+(100*need).toFixed(0)+'%</td>'+
      '<td class="'+(ok?'fe-good':'fe-bad')+'">'+(100*pf).toFixed(0)+'%</td>'+
      '<td>'+(100*resp.raise).toFixed(0)+'%</td></tr>';
  });
  if(!rows){el.innerHTML='';return;}
  el.innerHTML='<table class="fe-tab"><tr><th>bet</th><th>risk</th><th>need fold</th><th>they fold</th><th>they raise</th></tr>'+rows+
    '</table><div class="mini-note">If "they fold" beats "need fold", the bet shows a profit on fold equity alone \u2014 before your hand ever has to win. "They raise" is how often that bet comes back at you instead, which is the part a fold percentage on its own never shows.</div>';
}

/* ============================================================
   13c. COUNTERFACTUAL — who would have won if it had run out
   ============================================================ */
let lastMultiway=[];
function counterfactual(group){
  if(!group||group.length<2) return null;
  const N=2200;
  const used={};
  board.forEach(function(c){used[cardStr(c)]=1;});
  group.forEach(function(p){p.hole.forEach(function(c){used[cardStr(c)]=1;});});
  const pool=makeDeck().filter(function(c){return !used[cardStr(c)];});
  const wins=group.map(function(){return 0;});
  for(let t=0;t<N;t++){
    const run=shuffle(pool);let ri=0;
    const b=board.slice();
    while(b.length<5) b.push(run[ri++]);
    let best=null,idxs=[];
    group.forEach(function(p,i){
      const sc=evaluateBest(p.hole.concat(b));
      if(best===null||cmpScore(sc,best)>0){best=sc;idxs=[i];}
      else if(cmpScore(sc,best)===0) idxs.push(i);
    });
    idxs.forEach(function(i){wins[i]+=1/idxs.length;});
  }
  return group.map(function(p,i){return {p:p,pct:100*wins[i]/N};});
}
function counterfactualHTML(){
  const cf=counterfactual(lastMultiway);
  if(!cf) return '';
  cf.sort(function(a,b){return b.pct-a.pct;});
  const heroRow=cf.filter(function(r){return r.p.isHero;})[0];
  const lines=cf.map(function(r){
    const cls=(r===cf[0])?'cf-win':(r.p.isHero?'cf-lose':'');
    return '<span class="'+cls+'">'+r.p.name+' '+r.pct.toFixed(0)+'%</span>';
  }).join(' &nbsp;·&nbsp; ');
  let verdict='';
  if(heroRow){
    const bestOther=cf.filter(function(r){return !r.p.isHero;})[0];
    if(bestOther&&heroRow.pct>bestOther.pct) verdict='<br>You were ahead \u2014 that fold cost you the best of it.';
    else verdict='<br>You were behind \u2014 the fold saved you money.';
  }
  return '<div class="cf-line">Had it run out from here: '+lines+verdict+'</div>';
}

/* ============================================================
   13d. TABLE IMAGE + PER-STREET RANGE GUESS
   ============================================================ */
function renderHeroImage(){
  const h=players[0];
  const el=$('heroImage');
  if(!handLive||!h.hole.length){el.textContent='Your table image appears once you act.';return;}
  const wdt=rangeWidth(h), air=(h.rBluff||0)*100;
  if((h.rLo||0)<0.02&&air<2){el.innerHTML='You have shown nothing yet \u2014 your range still looks like <b>any two cards</b>.';return;}
  el.innerHTML='Your actions represent roughly the top <b>'+wdt.toFixed(0)+'%</b> of hands'+
    (air>3?', of which about <b>'+air.toFixed(0)+'%</b> reads as air':' \u2014 a linear, value-weighted range')+
    '. That is what they are pricing against.';
}
const RG_BANDS=[[0,15,'Very tight (under 15%)'],[15,35,'Tight (15\u201335%)'],[35,60,'Wide (35\u201360%)'],[60,101,'Very wide (60%+)']];
let rgOn=false, rgAskedStreet=-1;
function renderRangeGuess(){
  const wrap=$('rangeGuessWrap');
  if(!rgOn||!handLive||street===0||players[0].folded){wrap.innerHTML='';return;}
  const opps=players.filter(function(p){return !p.folded&&!p.isHero;});
  if(!opps.length){wrap.innerHTML='';return;}
  let main=opps[0];
  opps.forEach(function(o){if((o.rLo||0)>(main.rLo||0))main=o;});
  if(rgAskedStreet===street){wrap.innerHTML=wrap.dataset.last||'';return;}
  let html='<div class="rg-out" style="margin-top:11px">How wide is <b style="color:#D2705C">'+main.name+"</b>'s range right now?</div><div class=\"rg-row\">";
  RG_BANDS.forEach(function(b,i){html+='<button class="rg-btn" data-rg="'+i+'">'+b[2]+'</button>';});
  html+='</div>';
  wrap.innerHTML=html;
  wrap.querySelectorAll('[data-rg]').forEach(function(btn){
    btn.addEventListener('click',function(){
      const i=+btn.dataset.rg, w=rangeWidth(main);
      const right=(w>=RG_BANDS[i][0]&&w<RG_BANDS[i][1]);
      stats.rgTotal++;if(right)stats.rgRight++;
      rgAskedStreet=street;
      const out='<div class="rg-out">'+(right?'<span style="color:#7FCBB2">Right.</span>':'<span style="color:#D2705C">Not quite.</span>')+
        ' '+main.name+' is representing about <b>'+w.toFixed(0)+'%</b> of hands'+
        ((main.rBluff||0)>0.03?' with <b>'+((main.rBluff||0)*100).toFixed(0)+'%</b> air in there':'')+'.</div>';
      wrap.dataset.last=out;wrap.innerHTML=out;
    });
  });
}

/* ============================================================
   13e. STYLE DRIFT WATCH
   ============================================================ */
const handLog=[];
function driftCheck(){
  if(handLog.length<20) return '';
  const recent=handLog.slice(-12);
  const af=function(a){let g=0,c=0;a.forEach(function(h){g+=h.aggro;c+=h.calls;});return g/Math.max(1,c);};
  const vp=function(a){return 100*a.filter(function(h){return h.vpip;}).length/a.length;};
  const rAF=af(recent),sAF=af(handLog),rV=vp(recent),sV=vp(handLog);
  if(sAF>=1.3&&rAF<sAF*0.55)
    return 'Passive drift \u2014 your last 12 hands are far more call-heavy than your session average (aggression '+rAF.toFixed(2)+' vs '+sAF.toFixed(2)+'). Either re-engage or tighten up; drifting into calling-station mode is where the money goes.';
  if(rV>sV+18)
    return 'You are entering '+rV.toFixed(0)+'% of pots lately against a session average of '+sV.toFixed(0)+'%. Classic fatigue leak \u2014 worth tightening.';
  return '';
}
function renderDrift(){
  const msg=driftCheck();
  const el=$('drift');
  el.textContent=msg;
  el.classList.toggle('on',!!msg);
  syncTips();
}


/* ============================================================
   13f. EV ENGINE — was that decision actually right?
   Net EV of each option, in chips. Folding is the baseline at 0:
   money already in the pot is not yours any more.
     call  : win the pot that was there, or lose what you put in
     bet   : they fold and you take it, or you play a bigger pot
   ============================================================ */
// EV formulas, their standard errors and the response model behind them all
// live in opponentModel.js.
const rankOptions=D.rankOptions;

// One recorder for the whole session: begin() opens a hand, finish() closes it
// and hands back the record. Shared with the headless table in table.js, so
// what the round-trip tests verify is this exact module.
const recorder=createHandRecorder();

let handDecisions=[];   // every hero decision this hand
let heroStackStart=START_STACK;
let evRecords=[];       // one entry per hand, persisted
let matchResults=[];    // compact win/loss trail for the player strip
// Chips won or lost since the session began, kept as a running sum rather than
// read off the stack: a busted seat is rebought to START_STACK in startHand(),
// so current-stack-minus-start would quietly forget every bust.
let sessionNet=0;

// Field composition, the positional credit and hero's equity are all priced by
// decision.js so the coach panel and the headless backtest agree exactly.
function contestingOpps(){ return D.contestingOpps(view()); }
function fieldBreakdown(){ return D.fieldBreakdown(view()); }
function positionalCredit(){ return D.positionalCredit(view()); }
function heroEquityNow(){ return D.heroEquityNow(view()); }
function nOppLive(){return players.filter(function(p){return !p.folded&&!p.isHero;}).length;}
function snapshotSpot(){ return D.snapshotSpot(view()); }
function recordDecision(kind,amount){
  // Set before the early return: hero played a move either way, and the bubble
  // should answer it even in the spots the review has nothing to record.
  lastHeroAction=kind;
  if(!heroSpot) return;
  let opt=null,label=kind;
  if(kind==='fold'||kind==='check'){
    opt=heroSpot.options.filter(function(o){return o.label===kind;})[0];
  } else if(kind==='call'){
    opt=heroSpot.options.filter(function(o){return o.label.indexOf('call')===0;})[0];
    label='call '+amount;
  } else {
    // match the aggressive option nearest the size actually used
    const aggro=heroSpot.options.filter(function(o){return o.fold!==undefined;});
    aggro.forEach(function(o){
      if(!opt||Math.abs(o.amount-amount)<Math.abs(opt.amount-amount)) opt=o;
    });
    // a size larger than any modelled option: price it directly
    if(opt&&amount>opt.amount*1.35){
      const live=players.filter(function(o2){ return !o2.folded&&!o2.isHero; });
      const resp=jointResponse(live.map(function(o2){ return respond(o2,amount,heroSpot.pot); }));
      opt={label:kind+' '+amount,ev:evOfBet(heroSpot.equity,heroSpot.pot,amount,resp),
           amount:amount,fold:resp.fold,raise:resp.raise};
      if(opt.ev>heroSpot.best.ev) heroSpot.best=opt;
    }
    label=(opt?opt.label:kind+' '+amount);
  }
  const evTaken=opt?opt.ev:0;
  handDecisions.push({street:heroSpot.street,streetName:STREETS[Math.min(heroSpot.street,4)],
    taken:label,evTaken:evTaken,best:heroSpot.best,cost:Math.max(0,heroSpot.best.ev-evTaken),
    equity:heroSpot.equity,pot:heroSpot.pot,toCall:heroSpot.toCall,nOpp:nOppLive(),
    detail:heroDetail});
  heroSpot=null;heroDetail=null;
}
let heroSpot=null;
// The coach's full answer for the spot hero is facing, captured the moment the
// spot is snapshotted rather than when they act. By the time heroFold() calls
// recordDecision() it has already set hero.folded, and adviceSpot() returns
// null for a folded hero — so capturing at action time would silently lose the
// advice for every fold, which is the decision most worth reviewing.
let heroDetail=null;
function captureHeroDetail(){
  const flat=adviceSpot();
  heroDetail=flat?{
    advice:buildCoachAdvice(flat),
    opponentRead:opponentReadMarkup(),
    valueBet:valueBetMarkup(),
    nContesting:contestingOpps().length,
  }:null;
}

// Task 6: decision quality and outcome are separate facts, and the review says
// so out loud. Layer 1 is a plain-language verdict, layer 2 the coach's full
// answer for each street, folded away by default.

// One street, opened up: what the coach would have said had it been willing to
// say it while the hand was live. The bubble only ever asked the question.
function streetSectionMarkup(d){
  const head=d.streetName+' — you '+d.taken+
    (d.cost>1?' <span class="ev-neg">(−'+d.cost.toFixed(0)+' chips)</span>':'');
  if(!d.detail){
    return '<details class="coach-disc"><summary>'+head+'</summary><div class="coach-disc-body">'+
      '<p class="mini-note">No read was available for this spot.</p></div></details>';
  }
  const a=d.detail.advice;
  let body='<div class="coach-head"><div class="coach-verdict">'+a.verdict+'</div>'+
    '<span class="coach-conf conf-'+a.clarity.replace('-','')+'">'+(CONF[a.clarity]||'')+'</span></div>'+
    '<div class="coach-reason">'+a.reason+'</div>';
  if(a.points.length) body+='<ul class="coach-points">'+a.points.map(function(p){return '<li>'+p+'</li>';}).join('')+'</ul>';
  body+=d.detail.opponentRead+d.detail.valueBet;
  if(a.lines.length){
    body+='<details class="coach-disc"><summary>Why this</summary><div class="coach-lines coach-disc-body">'+
      a.lines.map(function(l){return '<p>'+l+'</p>';}).join('')+'</div></details>';
  }
  body+='<details class="coach-disc"><summary>Action frequencies</summary><div class="coach-disc-body">'+
    frequencyTableMarkup(a.frequencies,d.detail.nContesting)+'</div></details>';
  body+='<details class="coach-disc"><summary>Show the maths</summary><div class="coach-disc-body">'+
    mathsMarkup(a.maths)+'</div></details>';
  return '<details class="coach-disc"><summary>'+head+'</summary><div class="coach-disc-body">'+body+'</div></details>';
}

let lastOutcome=null;
function renderHandReview(){
  const el=$('evReview');
  const review=buildHandReview(handDecisions,lastOutcome);
  if(!review){el.innerHTML='';return;}
  const cls=review.clean?'ev-good':'ev-miss';
  let html='<div class="ev-box"><div class="review-verdict '+(review.clean?'good':'warn')+'">'+review.verdict+'</div>';
  html+='<div class="'+cls+'">'+review.lines.map(function(l){return '<p>'+l+'</p>';}).join('')+'</div>';
  html+='<div class="review-streets"><div class="box-label">What the coach saw</div>'+
    handDecisions.map(streetSectionMarkup).join('')+'</div>';
  html+='<details class="coach-disc"><summary>Cost of the hand</summary><div class="coach-disc-body">'+
    mathsMarkup(review.maths)+'</div></details>';
  el.innerHTML=html+'</div>';
}

/* ============================================================
   13g. SESSION CHARTS — skill line vs luck line
   ============================================================ */
function sparkline(series,colour,zeroLine){
  if(series.length<2) return '<div class="mini-note">Needs a few more hands.</div>';
  const W=260,H=52;
  const mn=Math.min.apply(null,series),mx=Math.max.apply(null,series);
  const span=(mx-mn)||1;
  const x=function(i){return (i/(series.length-1))*W;};
  const y=function(v){return H-((v-mn)/span)*(H-6)-3;};
  let d='';
  series.forEach(function(v,i){ d+=(i?'L':'M')+x(i).toFixed(1)+','+y(v).toFixed(1); });
  let zl='';
  if(zeroLine&&mn<0&&mx>0) zl='<line x1="0" y1="'+y(0).toFixed(1)+'" x2="'+W+'" y2="'+y(0).toFixed(1)+'" stroke="#33443D" stroke-width="1" stroke-dasharray="3 3"/>';
  const last=series[series.length-1];
  return '<svg class="spark" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none">'+zl+
    '<path d="'+d+'" fill="none" stroke="'+colour+'" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>'+
    '<circle cx="'+x(series.length-1).toFixed(1)+'" cy="'+y(last).toFixed(1)+'" r="2.6" fill="'+colour+'"/></svg>';
}
function renderEvCharts(){
  if(!evRecords.length){$('evTotals').innerHTML='';$('evChartWrap').innerHTML='';$('vpipChartWrap').innerHTML='';return;}
  let run=0; const evSeries=evRecords.map(function(r){run+=r.cost;return -run;});
  const totalCost=run;
  const cls=totalCost<=1?'ev-pos':'ev-neg';
  $('evTotals').innerHTML='<div class="ev-tot '+cls+'">'+(totalCost<=1?'':'\u2212')+Math.abs(totalCost).toFixed(0)+
    '<small>chips lost to non-optimal decisions</small></div>';
  $('evChartWrap').innerHTML='<div class="spark-head"><span>Decision quality</span><span>'+
    (totalCost<=1?'holding steady':'\u2212'+totalCost.toFixed(0)+' cumulative')+'</span></div>'+
    sparkline(evSeries,totalCost<=1?'#2E9E7B':'#D2705C',true)+
    '<div class="mini-note">Falling means EV is leaking. Flat means you are taking the best line available.</div>';
  const win=12;
  if(handLog.length>=win){
    const vp=[];
    for(let i=win;i<=handLog.length;i++){
      const w=handLog.slice(i-win,i);
      vp.push(100*w.filter(function(h){return h.vpip;}).length/w.length);
    }
    const cur=vp[vp.length-1];
    $('vpipChartWrap').innerHTML='<div class="spark-head"><span>How wide you are playing</span><span>'+cur.toFixed(0)+'% last '+win+'</span></div>'+
      sparkline(vp,'#C9A227',false)+
      '<div class="mini-note">Your VPIP over a rolling '+win+'-hand window. Watch for drift across a session.</div>';
  } else {
    $('vpipChartWrap').innerHTML='<div class="spark-head"><span>How wide you are playing</span><span>'+(win-handLog.length)+' more hands</span></div>';
  }
}

/* ============================================================
   13h. LEAK OF THE SESSION — surface one thing, not twenty
   ============================================================ */
// Thresholds and wording live in leak.js; this only supplies the live game's
// numbers. The dashboard calls the same function with lifetime totals.
function findLeak(){ return findLeakIn(stats,evRecords); }
function renderLeak(){
  const el=$('leak'),msg=findLeak();
  el.innerHTML=msg?('<b>Worth fixing:</b> '+msg):'';
  el.classList.toggle('on',!!msg);
  syncTips();
}
// Both notes now live in the tips modal, so nothing on screen says they are
// there. The bulb in the Game moves heading is that signal: lit when either
// note has something, dim when neither does.
function syncTips(){
  const any=$('drift').classList.contains('on')||$('leak').classList.contains('on');
  const box=$('tipsBox');
  if(box) box.dataset.tips=any?'on':'off';
  const btn=$('btnTips');
  if(btn) btn.classList.toggle('has-tips',any);
}

/* ============================================================
   13i. PERSISTENCE
   ============================================================ */
// The payload is unchanged from when it sat at the root of its own key; it is
// now the `state` slot of a game record, and the running chip total is lifted
// out to the record itself so the dashboard can read a game's result without
// parsing its state. games.js owns the storage — this only decides what goes
// in and what comes back out.
function saveSession(){
  updateLiveGame({
    state:{stats:stats,handLog:handLog,evRecords:evRecords,matchResults:matchResults,handNo:handNo},
    net:sessionNet,
  });
}
function loadSession(){
  const game=getLiveGame();
  if(!game) return null;
  const d=game.state||{};
  if(d.stats) for(const k in d.stats) stats[k]=d.stats[k];
  if(d.handLog) d.handLog.forEach(function(h){handLog.push(h);});
  if(d.evRecords) evRecords=d.evRecords;
  if(d.matchResults) matchResults=d.matchResults;
  if(d.handNo) handNo=d.handNo;
  // Games migrated from the old save have no figure to restore, and the trail
  // is capped at five hands so it cannot be rebuilt — they start the running
  // total from level rather than from a wrong number.
  sessionNet=Number(game.net)||0;
  return game;
}
// Ending is what "start fresh" used to mean. The reload stays because every
// bit of engine state lives in this closure and the listeners are bound once:
// there is no route back to a clean table without a fresh page.
function endCurrentGame(){
  const game=getLiveGame();
  if(game) endGame(game.id);
  openOnReload('home');
  location.reload();
}


/* ============================================================
   13j. VALUE EXTRACTION — how much can this hand actually win?
   With equity e, betting B into P yields
       EV = f*P + (1-f)[e(P+B) - (1-e)B]
   The part that varies with size is the "called" branch, so the
   question is not "how big can I bet" but "which size maximises
   (money they put in) x (chance they put it in)".
   ============================================================ */
function valueCurve(){
  const hero=players[0];
  const opps=players.filter(function(p){return !p.folded&&!p.isHero;});
  if(!opps.length) return null;
  const eq=calcEquity(hero.hole,opps,700,true);
  if(!eq.ok) return null;
  const e=eq.equity/100;
  const P=potBefore();
  const rows=[];
  [[0.25,'\u00bc pot'],[0.33,'\u2153 pot'],[0.5,'\u00bd pot'],[0.75,'\u00be pot'],[1,'pot'],[1.5,'1.5\u00d7 pot']].forEach(function(sz){
    const B=Math.round(P*sz[0]);
    if(B<BB||B>hero.stack) return;
    let f=1;
    opps.forEach(function(o){ f*=respond(o,B,P).fold; });
    // Getting paid is priced against the hands that actually call, not against
    // their whole range -- otherwise the biggest size always looks the best.
    const eqC=equityIfCalled(hero.hole,opps,B,P,CALLED_TRIALS);
    const ec=eqC.ok?clamp(eqC.equity/100,0,1):e;
    const called=(1-f)*(ec*(P+B)-(1-ec)*B);   // what the called branch is worth
    const ev=f*P+called;
    rows.push({label:sz[1],B:B,f:f,called:called,ev:ev,extra:(1-f)*B*ec});
  });
  if(!rows.length) return null;
  let peak=rows[0];
  rows.forEach(function(r){ if(r.ev>peak.ev) peak=r; });
  return {e:e,P:P,rows:rows,peak:peak};
}
// Returns markup rather than writing it: the sizing curve is an answer, so it
// is captured with the decision and rendered later in the review.
function valueBetMarkup(){
  const hero=players[0];
  if(!handLive||hero.folded||!board.length) return '';
  const v=valueCurve();
  if(!v||v.e<0.55) return '';   // only meaningful when you are ahead
  const mx=Math.max.apply(null,v.rows.map(function(r){return r.ev;}));
  let rows='';
  v.rows.forEach(function(r){
    const w=Math.max(2,Math.round(46*r.ev/Math.max(1,mx)));
    rows+='<tr'+(r===v.peak?' class="peak"':'')+'><td>'+r.label+'</td><td>'+r.B+'</td>'+
      '<td>'+(100*(1-r.f)).toFixed(0)+'%</td><td>'+r.ev.toFixed(0)+'</td>'+
      '<td><span class="val-bar" style="width:'+w+'px"></span></td></tr>';
  });
  const pk=v.peak;
  let note;
  if(pk.f>0.6){
    note='They fold to <b>'+pk.label+'</b> about '+(100*pk.f).toFixed(0)+'% of the time. You are strong enough that folding them out costs you money \u2014 a smaller bet keeps them in.';
  } else {
    note='<b>'+pk.label+'</b> ('+pk.B+') extracts most. They continue <b>'+(100*(1-pk.f)).toFixed(0)+'%</b> of the time, so you get paid without pricing them out.';
  }
  return '<div class="val-box"><div class="val-head">Getting paid \u2014 you have '+(100*v.e).toFixed(0)+'% equity</div>'+
    '<table class="val-tab"><tr><th>size</th><th>bet</th><th>they call</th><th>EV</th><th></th></tr>'+rows+'</table>'+
    '<div class="val-note">'+note+'</div></div>';
}

/* ============================================================
   13k. HOW TO PLAY THIS OPPONENT
   ============================================================ */
let tipsOpen=false;
function renderCounterTips(){
  const el=$('counterTips');
  const opps=players.filter(function(p){return !p.folded&&!p.isHero;});
  if(!handLive||!opps.length){el.innerHTML='';return;}
  let main=opps[0];
  opps.forEach(function(o){if((o.rLo||0)>(main.rLo||0))main=o;});
  if(!showProfiles&&!tipsOpen){
    el.innerHTML='<button class="ct-toggle" id="ctBtn">Show how to play '+main.name+'</button>';
    const b=$('ctBtn');
    if(b) b.addEventListener('click',function(){tipsOpen=true;renderCounterTips();});
    return;
  }
  // Derived from the same model the coach reads, so these bullets cannot
  // contradict the recommendation the way a hand-written table of tips did.
  const flat=adviceSpot();
  const c=flat?buildSpotModel(flat).counter:null;
  if(!c){el.innerHTML='';return;}
  el.innerHTML='<div class="ct-wrap"><div class="ct-head">'+c.head+'</div>'+
    '<ul class="ct-list">'+c.bullets.map(function(b){return '<li>'+b+'</li>';}).join('')+'</ul>'+
    (showProfiles?'':'<button class="ct-toggle" id="ctHide">Hide</button>')+'</div>';
  const hb=$('ctHide');
  if(hb) hb.addEventListener('click',function(){tipsOpen=false;renderCounterTips();});
}

/* ============================================================
   14. CONTROLS + WIRING
   ============================================================ */
// The bottom dock has three faces -- before the first hand, during a hand, and
// after one -- and the engine is what knows which. CSS does the showing; this
// only ever moves the flag. Nothing is unmounted, so the listeners bound at the
// bottom of this file stay attached for the life of the session.
function setPhase(p){
  const dock=$('actionDock');
  if(!dock) return;
  dock.dataset.phase=p;
  if(p!=='live'){closeRaise();hideCallAmount();}
}
// The raise slider is tucked into the dock and only comes out when a raise is
// being sized, so Raise is a two-step: press to open, press again to commit.
// The chip figure rides in the tab above the button, never in the label -- a
// label that grows with the number drags the other two buttons out of shape.
function syncRaiseLabel(){
  const h=players[0],v=+$('raiseSlider').value;
  const b=$('btnRaise');
  if(b) b.textContent=(h&&v>=h.bet+h.stack)?'All in':'Raise';
  const amt=$('raiseAmt');
  if(amt) amt.textContent=v;
}
function openRaise(){
  const dock=$('actionDock');
  if(dock) dock.dataset.raise='open';
}
function closeRaise(){
  const dock=$('actionDock');
  if(dock) delete dock.dataset.raise;
}
// Same again for the price of calling: the button says Call or Check, the tab
// above it says how much.
function showCallAmount(toCall){
  const dock=$('actionDock');
  if(!dock) return;
  if(toCall>0){
    const amt=$('callAmt');
    if(amt) amt.textContent=toCall;
    dock.dataset.call='on';
  } else delete dock.dataset.call;
}
function hideCallAmount(){
  const dock=$('actionDock');
  if(dock) delete dock.dataset.call;
}
function raiseIsOpen(){
  const dock=$('actionDock');
  return !!dock&&dock.dataset.raise==='open';
}
function enableHeroControls(){
  heroTurn=true;
  const h=players[0];
  const toCall=Math.min(currentBet-h.bet,h.stack);
  $('btnFold').disabled=false;$('btnCall').disabled=false;
  $('btnCall').textContent=toCall>0?'Call':'Check';
  showCallAmount(toCall);
  const minT=Math.min(currentBet+minRaise,h.bet+h.stack),maxT=h.bet+h.stack;
  const sl=$('raiseSlider');
  sl.min=minT;sl.max=maxT;sl.step=5;
  sl.value=Math.min(maxT,Math.max(minT,Math.round(potBefore()*0.66)));
  // Fix C2: betting was not reopened for hero either, if the last raise was a
  // stack-limited all-in below a full raise.
  const raiseLocked=maxT<=minT||!h.mayRaise;
  sl.disabled=raiseLocked;
  $('btnRaise').disabled=raiseLocked;
  closeRaise();syncRaiseLabel();
  $('status').innerHTML='Your move in <b>'+posName(0)+'</b> — '+(toCall>0?('<b>'+toCall+'</b> to call'):'checked to you')+'.';
  renderEquityTab();
  heroSpot=snapshotSpot();
  captureHeroDetail();
  paintBubble();
  renderHeroImage();renderRangeGuess();renderCounterTips();renderDrift();
}
function disableHeroControls(){
  heroTurn=false;
  // The nudge is a question about a decision that is now made. Leaving it up
  // would have it hanging over the table asking about a spot that has gone.
  paintBubble();
  ['btnFold','btnCall','btnRaise'].forEach(function(id){$(id).disabled=true;});
  $('raiseSlider').disabled=true;
  closeRaise();hideCallAmount();
}
$('raiseSlider').addEventListener('input',syncRaiseLabel);
document.querySelectorAll('.preset').forEach(function(btn){
  if(!btn.dataset.frac) return;
  btn.addEventListener('click',function(){
    if(!heroTurn)return;
    const h=players[0],sl=$('raiseSlider');
    let v=btn.dataset.frac==='max'?(h.bet+h.stack):(currentBet+Math.round(potBefore()*parseFloat(btn.dataset.frac)));
    v=Math.max(+sl.min,Math.min(+sl.max,v));
    sl.value=v;syncRaiseLabel();
  });
});
$('btnFold').addEventListener('click',heroFold);
$('btnCall').addEventListener('click',heroCall);
$('btnRaise').addEventListener('click',function(){
  if(!heroTurn) return;
  if(raiseIsOpen()) heroRaise(); else openRaise();
});
function dealNextHand(){setPhase('live');startHand();}
$('btnDeal').addEventListener('click',dealNextHand);
$('btnNewHand').addEventListener('click',dealNextHand);
// Review turns the result card back into the move list. Which face the panel
// is showing is engine state -- it flips on its own at the start and end of
// every hand -- so the button belongs here with the rest of the dock.
$('btnReview').addEventListener('click',function(){setPanelView('moves');});
$('btnSkipGuess').addEventListener('click',function(){concludeHand(null);});
$('btnClassify').addEventListener('click',classify);
// This used to wipe every stat you had. Now that games are kept, the same
// button files the current one away and drops you back on the dashboard —
// clearing history outright is a separate, clearly-labelled control there.
$('btnReset').addEventListener('click',function(){ if(confirm('End this game and return to your dashboard?')) endCurrentGame(); });
function buildSetupRows(){
  const wrap=$('setupRows');wrap.innerHTML='';
  SEAT_NAMES.forEach(function(nm,i){
    const row=document.createElement('div');
    row.className='setup-row';
    row.innerHTML='<label>'+nm+'</label><select data-seat="'+i+'"><option value="random">Surprise me</option>'+
      PROFILE_KEYS.map(function(k){return '<option value="'+k+'">'+PROFILES[k].label+' — '+PROFILES[k].note+'</option>';}).join('')+'</select>';
    wrap.appendChild(row);
  });
  wrap.querySelectorAll('select').forEach(function(sel){
    sel.addEventListener('change',function(e){
      const i=+e.target.dataset.seat;
      seatConfig[i]=e.target.value==='random'?PROFILE_KEYS[Math.floor(Math.random()*PROFILE_KEYS.length)]:e.target.value;
      players[i+1].profile=seatConfig[i];paint();saveSetup();
    });
  });
}
// Settings are the only place a game's setup can be changed now that Play deals
// straight away, so a change made there has to outlive the tab. Every handler
// below writes the whole setup back to the live game record, which applySetup
// reads on the next boot.
function saveSetup(){
  updateLiveGame({setup:{
    pace:String(SPEED),
    showdownGuess:guessEnabled,
    rangeGuess:rgOn,
    seats:seatConfig.slice(),
  }});
}
$('btnRandom').addEventListener('click',function(){
  randomSeats();
  players.forEach(function(p,i){if(i>0)p.profile=seatConfig[i-1];});
  document.querySelectorAll('#setupRows select').forEach(function(s){s.value='random';});
  showProfiles=false;$('btnRevealProfiles').textContent='Show styles';paint();saveSetup();
});
// Revealing styles is a view of the table, not a property of it, so it stays
// out of the saved setup -- coming back should hide them again.
$('btnRevealProfiles').addEventListener('click',function(){
  showProfiles=!showProfiles;
  $('btnRevealProfiles').textContent=showProfiles?'Hide styles':'Show styles';paint();
});
document.querySelectorAll('.speed-btn').forEach(function(b){
  if(!b.dataset.speed) return;
  b.addEventListener('click',function(){
    document.querySelectorAll('.speed-btn[data-speed]').forEach(function(x){x.classList.remove('on');});
    b.classList.add('on');SPEED=parseFloat(b.dataset.speed);saveSetup();
  });
});
$('guessOn').addEventListener('click',function(){guessEnabled=true;$('guessOn').classList.add('on');$('guessOff').classList.remove('on');saveSetup();});
$('guessOff').addEventListener('click',function(){guessEnabled=false;$('guessOff').classList.add('on');$('guessOn').classList.remove('on');saveSetup();});
$('rgOn').addEventListener('click',function(){rgOn=true;$('rgOn').classList.add('on');$('rgOff').classList.remove('on');renderRangeGuess();saveSetup();});
$('rgOff').addEventListener('click',function(){rgOn=false;$('rgOff').classList.add('on');$('rgOn').classList.remove('on');$('rangeGuessWrap').innerHTML='';saveSetup();});

/* ---- build stamp + feedback ---- */
const BUILD='v7';
$('buildTag').textContent='build '+BUILD+' · quote this when reporting a bug';
$('fbBuild').value=BUILD+' · '+navigator.userAgent.slice(0,90);
$('fbForm').addEventListener('submit',function(e){
  e.preventDefault();
  const msg=$('fbMsg');
  const data=new URLSearchParams(new FormData(e.target)).toString();
  msg.className='fb-msg on';msg.textContent='Sending…';
  fetch('/',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:data})
    .then(function(r){
      if(!r.ok) throw new Error('status '+r.status);
      msg.className='fb-msg on ok';msg.textContent='Thanks — that came through.';
      e.target.reset();
    })
    .catch(function(){
      msg.className='fb-msg on err';
      msg.innerHTML='Could not send from here — the form only works on the hosted Netlify version. Copy your notes and send them over directly.';
    });
});

// A game's setup is fixed when it is created, so the table you come back to is
// the table you left — not a fresh random draw on every reload. Runs after the
// setup rows are built, because it writes the chosen values back into them.
function applySetup(setup){
  if(!setup) return;
  if(Array.isArray(setup.seats)&&setup.seats.length===SEAT_NAMES.length){
    seatConfig=setup.seats.slice();
    players.forEach(function(p,i){if(i>0)p.profile=seatConfig[i-1];});
    $('setupRows').querySelectorAll('select').forEach(function(sel,i){
      if(seatConfig[i]) sel.value=seatConfig[i];
    });
  }
  if(setup.pace){
    SPEED=parseFloat(setup.pace)||SPEED;
    document.querySelectorAll('.speed-btn[data-speed]').forEach(function(b){
      b.classList.toggle('on',b.dataset.speed===setup.pace);
    });
  }
  guessEnabled=!!setup.showdownGuess;
  $('guessOn').classList.toggle('on',guessEnabled);
  $('guessOff').classList.toggle('on',!guessEnabled);
  rgOn=!!setup.rangeGuess;
  $('rgOn').classList.toggle('on',rgOn);
  $('rgOff').classList.toggle('on',!rgOn);
}

// Before anything reads storage: a player mid-session when games shipped keeps
// their stats and hand log rather than losing them to a key rename.
migrateLegacySession();
randomSeats();initPlayers();buildSeats();buildSetupRows();
const liveGame=loadSession();
applySetup(liveGame&&liveGame.setup);
// A game created by pressing Play has no seats recorded yet, only the random
// draw this boot just made. Writing it down now is what stops the table being
// reshuffled under you on the next reload.
if(liveGame&&!(liveGame.setup&&liveGame.setup.seats&&liveGame.setup.seats.length)) saveSetup();
renderMatchResults();renderSessionNet();
buildRangeIndex();paintBubble();clearEquityTab();renderStats();renderEvCharts();renderLeak();renderDrift();paint();
$('metaLine').textContent="6-max · no-limit hold'em · "+SB+"/"+BB+" · "+START_STACK+" stacks";

/* ============================================================
   14. REPLAY — drawing a hand that is already over

   The history screen owns which hand and which step; this owns the felt. It is
   a controller, not a renderer: it reconstructs a snapshot and hands it to the
   same paint() the live table uses, so a replayed hand and a live one are
   drawn by identical code and cannot look different.

   Replay is only entered between hands. The hand loop advances on chained
   setTimeouts, and a timer firing mid-replay would repaint live state over the
   top; refusing to start while a hand is live is a cheaper and more honest
   guard than trying to cancel timers that are already queued.
   ============================================================ */
let replayHand=null;
const api={
  // False means a hand is in progress, and the caller should say so rather
  // than silently doing nothing.
  canReplay:function(){return !handLive;},
  isReplaying:function(){return !!replayHand;},
  enter:function(hand){
    if(handLive||!hand) return false;
    replayHand=hand;
    return true;
  },
  // Steps are indexes into the recorded event log. -1 is the table before the
  // cards are out.
  stepCount:function(){return replayHand?stepCount(replayHand):0;},
  visibleSteps:function(){return replayHand?visibleSteps(replayHand):[];},
  show:function(n){
    if(!replayHand) return;
    const snap=snapshotAt(replayHand,n);
    snap.replay=true;
    paint(snap);
  },
  exit:function(){
    replayHand=null;
    // The board signature cache was last written by a replayed board, so the
    // live board has to be treated as changed or the felt keeps the replay's
    // cards.
    lastBoardSig='';
    seatRefs.forEach(function(r){r.sig='';});
    paint();
  },
};
window.__chipAwayApi=api;
return api;
}
