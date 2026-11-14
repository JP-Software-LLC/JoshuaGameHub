// Room codes: every possible code is checked. Allowed codes never contain a vowel (A E I O U Y),
// never contain a blocked abbreviation, and there are still plenty of them.
"use strict";
const { CODE_CHARS, CODE_BLOCK, codeOK }=require("../server/codes");
const fail=m=>{ console.error("FAIL:",m); process.exit(1); };
if (/[AEIOUY]/.test(CODE_CHARS)) fail("code letters must not include vowels");
let ok=0, total=0;
const L=CODE_CHARS;
for (const a of L) for (const b of L) for (const c of L) for (const d of L){
  const code=a+b+c+d; total++;
  if (!codeOK(code)) continue; ok++;
  if (CODE_BLOCK.some(w=>code.includes(w))) fail("blocked word allowed: "+code);
}
for (const bad of ["WTFX","XKKK","STFU","FCKZ","BBBB","QNGR"]) if (codeOK(bad)) fail("should be blocked: "+bad);
for (const fine of ["BRKT","MPLN","QZRT"]) if (!codeOK(fine)) fail("should be allowed: "+fine);
if (ok<100000) fail("too few codes left: "+ok);
console.log(`OK: room codes — consonants only, ${CODE_BLOCK.length} blocked abbreviations, ${ok.toLocaleString()} of ${total.toLocaleString()} codes allowed`);
