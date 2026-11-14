// Headless check: 4 bots play a full match on the shared sim at the server tick rate.
const CG = require("../shared/sim.js");
const players = [0,1,2,3].map(id => ({ id, name: CG.BOT_NAMES[id], bot: true }));
const g = new CG.Game(players);
g.start();
const dt = 1/30; let steps = 0; const counts = {};
while (g.state !== "results" && steps < 30*60*30) {
  g.update(dt); steps++;
  for (const e of g.drainEvents()) counts[e.type] = (counts[e.type]||0) + 1;
}
if (g.state !== "results") { console.error("FAIL: match did not finish", g.state, counts); process.exit(1); }
const snap = JSON.stringify(g.snapshot());
console.log(`OK: match finished in ${(steps*dt/60).toFixed(1)} sim-minutes`, counts);
console.log("scores:", g.players.map(p => `${p.name}=${g.score(p)}`).join(" "), "| snapshot bytes:", snap.length);
