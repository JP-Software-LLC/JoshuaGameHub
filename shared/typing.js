// Typing Cowboys — shared rules (browser: window.TYPING, Node: require).
// Type the word shown. Spell it right and your cowboy gallops one step (the word completes by itself,
// no space or Enter needed). Press Space or Enter on a wrong spelling and you just get the next word:
// no penalty, you simply don't move. First to T.dist correct words reaches the finish line.
// Pacing: easy 2–5 letter words, ~4 letters each. A 20 wpm typist (100 keys a minute) finishes in about a minute.
(function(root,factory){
  if (typeof module==="object" && module.exports) module.exports=factory();
  else root.TYPING=factory();
})(typeof self!=="undefined"?self:this,function(){
  "use strict";
  const T={ dist:22, listLen:120 };

  // Short, common, kid-safe words (all lower case, letters only)
  const WORDS=("cat dog sun hat run red big top cup map pig box fox bus bed egg fun yes ten six van jam leg pen "+
    "rain tree frog fish bird duck cake milk book ball kite star moon farm barn corn hill road boot rope gold "+
    "jump swim play sing read draw blue pink gray tall fast slow warm cold soft kind nice good help home time "+
    "horse ranch apple water green happy lucky snack river trail cloud dusty saddle cactus spurs pony hay "+
    "lamb goat cow hen nest seed leaf rock sand wind snow park desk door bell wave ship bike lamp fork spoon "+
    "train truck plant grass bread lemon grape peach mango zebra tiger panda koala whale shark puppy kitten "+
    "smile laugh dance paint music story chair table clock house light night lunch "+
    "boots hats wagon fence camp fire song west").split(/\s+/).filter(Boolean);

  function rng(seed){ let s=(seed>>>0)||1; return ()=>{ s^=s<<13; s>>>=0; s^=s>>>17; s^=s<<5; s>>>=0; return s/4294967296; }; }
  // Everyone in a race gets the same words in the same order.
  function wordList(seed){
    const r=rng(seed*7+3), out=[]; let prev="";
    while (out.length<T.listLen){ const w=WORDS[r()*WORDS.length|0]; if (w!==prev){ out.push(w); prev=w; } }
    return out;
  }
  // Solo bots: a typing speed (wpm) and a small chance to fumble a word.
  function makeBot(seed,skill){ const r=rng(seed); return { r, wpm:9+skill*16, miss:0.12-skill*0.08, wait:0.6+r()*0.6 }; }
  // advance a bot by dt seconds; returns true when it lands a word
  function botStep(b,run,dt){
    if (run.d>=T.dist) return false;
    b.wait-=dt; if (b.wait>0) return false;
    const w=run.words[run.i]||"word";
    run.i++;
    const hit=b.r()>=b.miss; if (hit){ run.d++; } else run.missed++;
    b.wait=(w.length+1)/(b.wpm*5/60)*(0.8+b.r()*0.4);
    return hit;
  }
  function newRun(seed){ return { words:wordList(seed), i:0, d:0, missed:0, t:0, finishT:null }; }
  return { T, WORDS, wordList, newRun, makeBot, botStep, rng };
});
