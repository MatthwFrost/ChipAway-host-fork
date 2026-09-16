import { buildCoachAdvice, buildHandReview, pctWhole, ci95Points } from './coach.js';
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
import {
  RANK_CHARS, PIPS, makeDeck, shuffle, cardStr, cardTxt,
  cmpScore, evaluateBest, handName,
} from './evaluator.js';

export function initializePokerTrainer(){
  if(window.__chipAwayInitialized)return;
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
let streetRaises=0,revealAll=false,showProfiles=false,guessEnabled=true;
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
function updateSeats(){
  players.forEach(function(p,i){
    const r=seatRefs[i];
    r.el.classList.toggle('folded',p.folded);
    r.el.classList.toggle('acting',handLive&&actingIdx===i&&!p.folded&&!p.allIn);
    r.el.classList.toggle('villain',villainIdx===i);
    r.dealer.classList.toggle('shown',dealerIdx===i);
    if(r.stack.textContent!==String(p.stack)) r.stack.textContent=p.stack;
    const pn=posName(i);
    if(r.pos.textContent!==pn) r.pos.textContent=pn;
    const styleTxt=p.isHero?'':(showProfiles?PROFILES[p.profile].label:'');
    if(r.style.textContent!==styleTxt) r.style.textContent=styleTxt;
    r.style.classList.toggle('shown',!!styleTxt);
    const show=p.isHero||revealAll;
    const sig=p.hole.map(cardStr).join('')+'|'+(show?'1':'0')+'|'+(p.folded?'f':'');
    if(r.sig!==sig){
      r.sig=sig;
      r.cards.innerHTML=p.hole.length?p.hole.map(function(c){return cardHTML(c,!p.isHero,!show,p.folded&&revealAll);}).join(''):'';
    }
    if(r.badge.textContent!==p.badge) r.badge.textContent=p.badge;
    r.badge.className='act-badge'+(p.badge?' show ':' ')+(p.badgeCls||'');
  });
}
let lastBoardCount=-1;
function updateBoard(){
  if(board.length!==lastBoardCount){
    lastBoardCount=board.length;
    $('boardCards').innerHTML=board.map(function(c){return cardHTML(c,false,false,false);}).join('');
    const kids=$('boardCards').children;
    for(let i=0;i<kids.length;i++) kids[i].style.animationDelay=(i*0.11)+'s';
  }
  const potEl=$('potTag'),txt='Pot '+pot;
  if(potEl.textContent!==txt){potEl.textContent=txt;potEl.classList.add('bump');setTimeout(function(){potEl.classList.remove('bump');},300);}
  $('streetTag').textContent=handLive?STREETS[Math.min(street,4)]:'—';
  $('dealerLine').textContent=handLive?('Hand #'+handNo):'Dealer ready';
}
function paint(){updateSeats();updateBoard();}
function setBadge(p,txt,cls){p.badge=txt;p.badgeCls=cls;}
function clearBadges(){players.forEach(function(p){p.badge='';p.badgeCls='';});}
function log(msg,cls){
  const l=$('log');
  if(l.dataset.fresh!=='1'){l.innerHTML='';l.dataset.fresh='1';}
  const d=document.createElement('div');
  if(cls)d.className=cls;
  d.innerHTML=msg;l.appendChild(d);l.scrollTop=l.scrollHeight;
}

/* ============================================================
   8. EQUITY PANEL
   ============================================================ */

function hideCoach(){$('eqBody').classList.remove('open');$('eqHidden').style.display='block';}
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

function showCoach(){
  const hero=players[0];
  if(!handLive||hero.folded||!hero.hole.length) return;
  renderEquityTab();
  if(!lastEq){
    $('coachVerdict').textContent='Equity is temporarily unavailable in this spot.';
    ['coachLines','coachReason','coachPoints'].forEach(function(id){$(id).innerHTML='';});
    $('coachConf').textContent='';
  }
  $('eqHidden').style.display='none';
  $('eqBody').classList.add('open');
  if(!lastEq) return;
  const opps=players.filter(function(p){return !p.folded&&!p.isHero;});

  let main=opps[0];
  opps.forEach(function(o){if((o.rLo||0)>(main.rLo||0))main=o;});
  const blk=main?blockerPct(hero.hole,main):0;
  $('eqSub').innerHTML=main?('your cards block <b>'+Math.round(blk)+'%</b> of '+main.name+"'s value combos"):'';
  if(main){
    const vLo=(main.rLo||0)*100, bl=(main.rBluff||0);
    $('rangeBar').innerHTML='<div class="rb-lab"><span>'+main.name+"'s implied range</span><span>"+
      (bl>0.02?Math.round(bl*100)+'% air':'linear')+'</span></div>'+
      '<div class="rb-track"><div class="rb-val" style="left:'+vLo+'%;right:0"></div>'+
      (bl>0.02?'<div class="rb-bluff" style="width:'+(BLUFF_TOP*100)+'%;opacity:'+Math.min(1,bl*2.2)+'"></div>':'')+'</div>';
  } else $('rangeBar').innerHTML='';

  const flat=adviceSpot();
  if(!flat) return;
  const advice=buildCoachAdvice(flat);
  const CONF={'clear':'clear','solid':'best of the options','marginal':'close','toss-up':'your call'};
  $('coachVerdict').innerHTML=advice.verdict;
  $('coachConf').textContent=CONF[advice.clarity]||'';
  $('coachConf').className='coach-conf conf-'+advice.clarity.replace('-','');
  $('coachReason').innerHTML=advice.reason;
  $('coachPoints').innerHTML=advice.points.map(function(p){return '<li>'+p+'</li>';}).join('');
  $('coachLines').innerHTML=advice.lines.map(function(l){return '<p>'+l+'</p>';}).join('');
  $('coachFreqBody').innerHTML='<table class="val-tab"><tr><th>action</th><th>EV</th><th>they fold</th><th>they raise</th></tr>'+
    advice.frequencies.map(function(f){
      const cls=f.recommended?'ev-pos':'';
      const tag=f.recommended?' ← pick':(f.tied?' <span class="fq-tied">= same call</span>':'');
      return '<tr><td class="'+cls+'">'+f.label+tag+'</td><td class="'+cls+'">'+f.ev+'</td><td>'+(f.fold||'—')+'</td><td>'+(f.raise||'—')+'</td></tr>';
    }).join('')+'</table>'+
    '<div class="mini-note">Frequencies, not commandments. Lines marked <b>= same call</b> rate about the same as the pick — the same decision in chips, and mixing between them is what stops you being readable.</div>';
  $('coachMathsBody').innerHTML=advice.maths.map(function(m){return '<div class="coach-maths-line">'+m+'</div>';}).join('')+
    '<div class="mini-note">EV figures price the '+contestingOpps().length+' opponent(s) expected to keep going, use your equity against the hands that would actually call, and include a small credit for acting last. The equity tab above is against all '+opps.length+' player(s) still in, so the two differ by a point or two.</div>';
  renderValueBet();
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
    a.winners.forEach(function(w,i){w.stack+=share+(i===0?rem:0);});
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
  board=[];lastBoardCount=-1;pot=0;street=0;currentBet=0;minRaise=BB;
  handLive=true;revealAll=false;streetRaises=0;lastAggressor=-1;villainIdx=-1;pendingResult=null;lastMultiway=[];rgAskedStreet=-1;handDecisions=[];heroSpot=null;tipsOpen=false;$('evReview').innerHTML='';
  players.forEach(function(p){p.hole=[];p.folded=false;p.allIn=false;p.bet=0;p.committed=0;p.acted=false;p.mayRaise=true;p.raises=0;p.badge='';p.badgeCls='';p.rLo=0;p.rBluff=0;p.score=null;});
  hf={vpip:false,pfr:false,raisedPre:false,f3bCounted:false,sawShowdown:false,aggro:0,calls:0};
  hideCoach();$('guessBox').style.display='none';
  dealerIdx=(dealerIdx+1)%players.length;
  buildRangeIndex();
  let di=0;
  for(let r=0;r<2;r++) players.forEach(function(p){p.hole.push(deck[di++]);});
  deck=deck.slice(di);
  const sbIdx=(dealerIdx+1)%players.length,bbIdx=(dealerIdx+2)%players.length;
  postBlind(sbIdx,SB);postBlind(bbIdx,BB);
  currentBet=BB;
  setBadge(players[sbIdx],'SB '+SB,'b-blind');
  setBadge(players[bbIdx],'BB '+BB,'b-blind');
  log('<span class="street">Hand #'+handNo+' · preflop</span>','street');
  log(players[sbIdx].name+' posts '+SB+', '+players[bbIdx].name+' posts '+BB);
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
    log('<span class="street">'+STREETS[street]+' · '+board.map(cardTxt).join(' ')+'</span>','street');
    actingIdx=nextActive(dealerIdx);
    hideCoach();renderEquityTab();paint();
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
  const h=players[0];h.folded=true;h.acted=true;
  if(street===0&&hf.raisedPre&&currentBet>h.bet&&!hf.f3bCounted){stats.f3bOpp++;stats.f3b++;hf.f3bCounted=true;}
  recordDecision('fold');
  setBadge(h,'fold','b-fold');log('<span class="hl">You</span> fold');
  disableHeroControls();hideCoach();clearEquityTab();
  $('status').innerHTML='You folded — the hand plays on. Everything is revealed at the end.';
  paint();actingIdx=nextActive(0);setTimeout(step,T(700));
}
function heroCall(){
  const h=players[0];
  const toCall=Math.min(currentBet-h.bet,h.stack);
  if(street===0){
    if(toCall>0) hf.vpip=true;
    if(hf.raisedPre&&currentBet>h.bet&&!hf.f3bCounted){stats.f3bOpp++;hf.f3bCounted=true;}
  } else if(toCall>0){stats.calls++;hf.calls++;}
  h.stack-=toCall;h.bet+=toCall;h.committed+=toCall;h.acted=true;
  if(h.stack===0)h.allIn=true;
  recordDecision(toCall===0?'check':'call',toCall);
  if(toCall>0) narrowCall(h); else narrowCheck(h);
  setBadge(h,toCall===0?'check':'call '+toCall,'b-passive');
  log('<span class="hl">You</span> '+(toCall===0?'check':'call '+toCall));
  disableHeroControls();paint();
  actingIdx=nextActive(0);setTimeout(step,T(700));
}
function heroRaise(){
  const h=players[0];
  const pb=potBefore();
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
  log('<span class="hl">You</span> '+(h.allIn?'move all in for':'raise to')+' '+h.bet);
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
  log(p.name+' '+(p.allIn?'moves all in for':(toCall>0?'raises to':'bets'))+' '+p.bet);
}
function botFold(p){p.folded=true;p.acted=true;setBadge(p,'fold','b-fold');log(p.name+' folds');}
function botCheck(p){p.acted=true;narrowCheck(p);setBadge(p,'check','b-passive');log(p.name+' checks');}
function botCall(p,toCall){
  p.stack-=toCall;p.bet+=toCall;p.committed+=toCall;p.acted=true;
  if(p.stack===0)p.allIn=true;
  narrowCall(p);
  setBadge(p,'call '+toCall,'b-passive');log(p.name+' calls '+toCall);
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
    contenders.forEach(function(p){log(p.name+': '+p.hole.map(cardTxt).join(' ')+' — '+handName(evaluateBest(p.hole.concat(board))));});
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
        cf.forEach(function(r){log(r.p.name+': '+r.p.hole.map(cardTxt).join(' ')+' — '+r.pct.toFixed(0)+'% to win');});
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
  renderHandReview();renderEvCharts();renderLeak();
  renderStats();renderDrift();$('rangeGuessWrap').innerHTML='';
  saveSession();
  villainIdx=-1;paint();
  $('btnDeal').disabled=false;$('btnDeal').textContent='Deal next hand';
}

/* ============================================================
   13. STATS + CLASSIFICATION
   ============================================================ */
const SIGNATURES=[
  {k:'nit',vpip:12,pfr:9,af:1.0},{k:'tag',vpip:22,pfr:18,af:2.5},
  {k:'lag',vpip:34,pfr:26,af:3.0},{k:'station',vpip:45,pfr:6,af:0.4},
  {k:'maniac',vpip:58,pfr:38,af:5.0}
];
function heroMetrics(){
  const h=Math.max(1,stats.hands);
  return {vpip:100*stats.vpip/h,pfr:100*stats.pfr/h,af:stats.aggro/Math.max(1,stats.calls),
    wtsd:100*stats.wtsd/h,f3b:stats.f3bOpp?100*stats.f3b/stats.f3bOpp:null,
    read:stats.guessTotal?100*stats.guessRight/stats.guessTotal:null};
}
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

let handDecisions=[];   // every hero decision this hand
let heroStackStart=START_STACK;
let evRecords=[];       // one entry per hand, persisted

// Field composition, the positional credit and hero's equity are all priced by
// decision.js so the coach panel and the headless backtest agree exactly.
function contestingOpps(){ return D.contestingOpps(view()); }
function fieldBreakdown(){ return D.fieldBreakdown(view()); }
function positionalCredit(){ return D.positionalCredit(view()); }
function heroEquityNow(){ return D.heroEquityNow(view()); }
function nOppLive(){return players.filter(function(p){return !p.folded&&!p.isHero;}).length;}
function snapshotSpot(){ return D.snapshotSpot(view()); }
function recordDecision(kind,amount){
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
    equity:heroSpot.equity,pot:heroSpot.pot,toCall:heroSpot.toCall,nOpp:nOppLive()});
  heroSpot=null;
}
let heroSpot=null;

// Task 6: decision quality and outcome are separate facts, and the review says
// so out loud. Layer 1 is a plain-language verdict, layer 2 the per-street
// frequencies, layer 3 the maths -- both optional, both folded away by default.
let lastOutcome=null;
function renderHandReview(){
  const el=$('evReview');
  const review=buildHandReview(handDecisions,lastOutcome);
  if(!review){el.innerHTML='';return;}
  const cls=review.clean?'ev-good':'ev-miss';
  let html='<div class="ev-box"><div class="review-verdict '+(review.clean?'good':'warn')+'">'+review.verdict+'</div>';
  html+='<div class="'+cls+'">'+review.lines.map(function(l){return '<p>'+l+'</p>';}).join('')+'</div>';
  html+='<details class="coach-disc"><summary>Street by street</summary><div class="coach-disc-body">'+
    '<table class="val-tab"><tr><th>street</th><th>you</th><th>EV</th><th>best</th></tr>'+
    review.frequencies.map(function(f){
      return '<tr><td>'+f.street+'</td><td>'+f.taken+'</td><td class="'+(f.best?'ev-neg':'ev-pos')+'">'+f.ev+'</td>'+
        '<td>'+(f.best?f.best+' ('+f.bestEv+')'+(f.fold?' · folds '+f.fold:''):'best available')+'</td></tr>';
    }).join('')+'</table></div></details>';
  html+='<details class="coach-disc"><summary>Show the maths</summary><div class="coach-disc-body">'+
    review.maths.map(function(m){return '<div class="coach-maths-line">'+m+'</div>';}).join('')+'</div></details>';
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
function findLeak(){
  if(stats.hands<12) return '';
  const m=heroMetrics();
  const cand=[];
  if(stats.f3bOpp>=4&&m.f3b!==null&&m.f3b>75)
    cand.push({w:3,t:'You fold to 3-bets <b>'+m.f3b.toFixed(0)+'%</b> of the time. Above about 70% and observant players can 3-bet you relentlessly with anything.'});
  if(m.af<0.6&&stats.calls>=8)
    cand.push({w:4,t:'Aggression factor <b>'+m.af.toFixed(2)+'</b> \u2014 you are calling far more than betting. Calling only wins when you have the best hand; betting can win either way.'});
  if(m.vpip>55&&stats.hands>=15)
    cand.push({w:3,t:'You are playing <b>'+m.vpip.toFixed(0)+'%</b> of hands. Even the loosest winning regulars sit near 35% at 6-max.'});
  if(m.vpip<14&&stats.hands>=20)
    cand.push({w:2,t:'You are playing just <b>'+m.vpip.toFixed(0)+'%</b> of hands. Folding this much means the blinds grind you down \u2014 look for steals in late position.'});
  if(m.vpip>0&&(m.vpip-m.pfr)>28&&stats.hands>=15)
    cand.push({w:3,t:'You enter <b>'+m.vpip.toFixed(0)+'%</b> of pots but raise only <b>'+m.pfr.toFixed(0)+'%</b>. That gap is limping and calling \u2014 it plays big pots out of position with weak ranges.'});
  if(stats.guessTotal>=8&&m.read!==null&&m.read<35)
    cand.push({w:2,t:'Your hand reads are landing <b>'+m.read.toFixed(0)+'%</b> of the time. Reveal the equity panel more often after acting, and check what their betting actually represented.'});
  if(evRecords.length>=10){
    const avg=evRecords.reduce(function(a,r){return a+r.cost;},0)/evRecords.length;
    if(avg>12) cand.push({w:5,t:'You are leaking about <b>'+avg.toFixed(0)+'</b> chips of EV per hand. The decision review under each hand shows exactly where \u2014 most of it is usually one street.'});
  }
  if(!cand.length) return '';
  cand.sort(function(a,b){return b.w-a.w;});
  return cand[0].t;
}
function renderLeak(){
  const el=$('leak'),msg=findLeak();
  el.innerHTML=msg?('<b>Worth fixing:</b> '+msg):'';
  el.classList.toggle('on',!!msg);
}

/* ============================================================
   13i. PERSISTENCE
   ============================================================ */
const SAVE_KEY='chipaway.session.v1';
function saveSession(){
  try{
    localStorage.setItem(SAVE_KEY,JSON.stringify({stats:stats,handLog:handLog,evRecords:evRecords,handNo:handNo}));
  }catch(e){}
}
function loadSession(){
  try{
    const raw=localStorage.getItem(SAVE_KEY);
    if(!raw) return;
    const d=JSON.parse(raw);
    if(d.stats) for(const k in d.stats) stats[k]=d.stats[k];
    if(d.handLog) d.handLog.forEach(function(h){handLog.push(h);});
    if(d.evRecords) evRecords=d.evRecords;
    if(d.handNo) handNo=d.handNo;
  }catch(e){}
}
function resetSession(){
  try{localStorage.removeItem(SAVE_KEY);}catch(e){}
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
function renderValueBet(){
  const el=$('valueBet');
  const hero=players[0];
  if(!handLive||hero.folded||!board.length){el.innerHTML='';return;}
  const v=valueCurve();
  if(!v||v.e<0.55){el.innerHTML='';return;}   // only meaningful when you are ahead
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
  el.innerHTML='<div class="val-box"><div class="val-head">Getting paid \u2014 you have '+(100*v.e).toFixed(0)+'% equity</div>'+
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
function enableHeroControls(){
  heroTurn=true;
  const h=players[0];
  const toCall=Math.min(currentBet-h.bet,h.stack);
  $('btnFold').disabled=false;$('btnCall').disabled=false;
  $('btnCall').textContent=toCall>0?('Call '+toCall):'Check';
  const minT=Math.min(currentBet+minRaise,h.bet+h.stack),maxT=h.bet+h.stack;
  const sl=$('raiseSlider');
  sl.min=minT;sl.max=maxT;sl.step=5;
  sl.value=Math.min(maxT,Math.max(minT,Math.round(potBefore()*0.66)));
  // Fix C2: betting was not reopened for hero either, if the last raise was a
  // stack-limited all-in below a full raise.
  const raiseLocked=maxT<=minT||!h.mayRaise;
  sl.disabled=raiseLocked;
  $('btnRaise').disabled=raiseLocked;
  $('btnRaise').textContent=(+sl.value>=maxT)?'All in':'Raise';
  $('raiseAmt').textContent=sl.value;
  $('status').innerHTML='Your move in <b>'+posName(0)+'</b> — '+(toCall>0?('<b>'+toCall+'</b> to call'):'checked to you')+'.';
  renderEquityTab();
  heroSpot=snapshotSpot();
  renderHeroImage();renderRangeGuess();renderCounterTips();renderDrift();
}
function disableHeroControls(){
  heroTurn=false;
  ['btnFold','btnCall','btnRaise'].forEach(function(id){$(id).disabled=true;});
  $('raiseSlider').disabled=true;
}
$('raiseSlider').addEventListener('input',function(e){
  $('raiseAmt').textContent=e.target.value;
  const h=players[0];
  $('btnRaise').textContent=(+e.target.value>=h.bet+h.stack)?'All in':'Raise';
});
document.querySelectorAll('.preset').forEach(function(btn){
  if(!btn.dataset.frac) return;
  btn.addEventListener('click',function(){
    if(!heroTurn)return;
    const h=players[0],sl=$('raiseSlider');
    let v=btn.dataset.frac==='max'?(h.bet+h.stack):(currentBet+Math.round(potBefore()*parseFloat(btn.dataset.frac)));
    v=Math.max(+sl.min,Math.min(+sl.max,v));
    sl.value=v;$('raiseAmt').textContent=v;
    $('btnRaise').textContent=(v>=h.bet+h.stack)?'All in':'Raise';
  });
});
$('btnFold').addEventListener('click',heroFold);
$('btnCall').addEventListener('click',heroCall);
$('btnRaise').addEventListener('click',heroRaise);
$('btnDeal').addEventListener('click',function(){$('btnDeal').disabled=true;$('btnDeal').textContent='Hand in play';startHand();});
$('btnRevealEq').addEventListener('click',showCoach);
$('btnSkipGuess').addEventListener('click',function(){concludeHand(null);});
$('btnClassify').addEventListener('click',classify);
$('btnReset').addEventListener('click',function(){ if(confirm('Clear all saved stats and start fresh?')) resetSession(); });
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
      players[i+1].profile=seatConfig[i];paint();
    });
  });
}
$('btnRandom').addEventListener('click',function(){
  randomSeats();
  players.forEach(function(p,i){if(i>0)p.profile=seatConfig[i-1];});
  document.querySelectorAll('#setupRows select').forEach(function(s){s.value='random';});
  showProfiles=false;$('btnRevealProfiles').textContent='Show styles';paint();
});
$('btnRevealProfiles').addEventListener('click',function(){
  showProfiles=!showProfiles;
  $('btnRevealProfiles').textContent=showProfiles?'Hide styles':'Show styles';paint();
});
document.querySelectorAll('.speed-btn').forEach(function(b){
  if(!b.dataset.speed) return;
  b.addEventListener('click',function(){
    document.querySelectorAll('.speed-btn[data-speed]').forEach(function(x){x.classList.remove('on');});
    b.classList.add('on');SPEED=parseFloat(b.dataset.speed);
  });
});
$('guessOn').addEventListener('click',function(){guessEnabled=true;$('guessOn').classList.add('on');$('guessOff').classList.remove('on');});
$('guessOff').addEventListener('click',function(){guessEnabled=false;$('guessOff').classList.add('on');$('guessOn').classList.remove('on');});
$('rgOn').addEventListener('click',function(){rgOn=true;$('rgOn').classList.add('on');$('rgOff').classList.remove('on');renderRangeGuess();});
$('rgOff').addEventListener('click',function(){rgOn=false;$('rgOff').classList.add('on');$('rgOn').classList.remove('on');$('rangeGuessWrap').innerHTML='';});

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

randomSeats();initPlayers();buildSeats();buildSetupRows();
loadSession();
buildRangeIndex();hideCoach();clearEquityTab();renderStats();renderEvCharts();renderLeak();renderDrift();paint();
$('metaLine').textContent="6-max · no-limit hold'em · "+SB+"/"+BB+" · "+START_STACK+" stacks";
}
