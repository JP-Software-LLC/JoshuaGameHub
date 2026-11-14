// Kid-safe room codes.
"use strict";
// Room codes are 4 letters chosen from consonants only (no A E I O U Y), so they can never spell a
// word. Vowel-less rude abbreviations are blocked too, and so is any code with 3 of the same letter.
const CODE_CHARS="BCDFGHJKLMNPQRSTVWXZ";                       // 20 letters → 160,000 codes
const CODE_BLOCK=["FCK","FK","FKN","FCKN","FGT","FGGT","KKK","NGR","NGGR","NZ","PNS","DCK","DK","CNT","CNTS","SHT","SHTS","STFU","STF","WTF","WTFF","BTCH","BTC","SX","SXX","XXX","XX","PRN","PRNS","HTLR","NZS","KYS","KMS","GTFO","FML","DMN","DMNT","CRP","CRPS","TTS","TT","BJ","HJ","MLF","MLFS","DLD","DLDS","SLT","SLTS","WHR","WHRS","FKR","FKRS","PSS","PSSY","PNIS","CCK","CK","FCKR","JZZ","JZ","CMSHT","DMBS","DMB","STPD","TRD","LMF","LMFS","GDDM","GD","JSS","PP","PPP","DD","DDD","TTT","NN"];
function codeOK(code){
  code=String(code).toUpperCase();
  if (CODE_BLOCK.some(b=>code.includes(b))) return false;
  if (/(.)\1\1/.test(code)) return false;                    // no AAA-style triples
  return true;
}

// a fresh random code that passes the checks
function randomCode(rand=Math.random){ for (;;){ const c=Array.from({length:4},()=>CODE_CHARS[rand()*CODE_CHARS.length|0]).join(""); if (codeOK(c)) return c; } }
module.exports={ CODE_CHARS, CODE_BLOCK, codeOK, randomCode };
