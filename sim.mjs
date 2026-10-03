// 对战规则的随机/贪心对局检验:先后手胜率、拆法(集中 vs 分散)相克、易主次数。
// 运行: node sim.mjs [quick]
import { DuelGame, greedyTurn } from "./duel.ts";

const QUICK = process.argv[2] === "quick";
const rnd = (n) => Math.floor(Math.random() * n);

// 把本回合的泉按每堆 size 个放到随机合法格
const stacker = (size) => (g) => {
  const t = g.clone(), plan = [];
  while (t.left > 0) {
    const n = Math.min(size, t.left);
    const cells = t.legalCells().filter((p) => t.value(p.r, p.c, t.turn) + n <= 9);
    if (!cells.length) break;
    const p = cells[rnd(cells.length)];
    for (let i = 0; i < n; i++) { t.add(p.r, p.c); plan.push(p); }
  }
  return plan;
};
const BOTS = { "集中9": stacker(9), "三堆3": stacker(3), "九个1": stacker(1), "贪心": greedyTurn };

function match(n, opts, botA, botB) {
  const g = new DuelGame(n, n, opts);
  let steps = 0, turns = 0;
  while (g.winner === null) {
    const plan = (g.turn === 1 ? botA : botB)(g);
    for (const p of plan) g.add(p.r, p.c);
    steps += g.settle(); turns++;
    g.endTurn();
  }
  const { a, b, open } = g.count();
  return { winner: g.winner, a, b, open, captures: g.captures, rounds: g.round, steps: steps / turns };
}

function series(nameA, nameB, games, n, opts) {
  let w = 0, l = 0, d = 0, owned = 0, margin = 0, captures = 0, rounds = 0, steps = 0;
  for (let i = 0; i < games; i++) {
    const m = match(n, opts, BOTS[nameA], BOTS[nameB]);
    if (m.winner === 1) w++; else if (m.winner === -1) l++; else d++;
    owned += (m.a + m.b) / m.open; margin += Math.abs(m.a - m.b);
    captures += m.captures; rounds += m.rounds; steps += m.steps;
  }
  const avg = (x, k = 1) => (x / games).toFixed(k);
  console.log(`  ${(nameA + "(先) vs " + nameB).padEnd(16)} 先:后:平 ${w}:${l}:${d} | ${avg(rounds)} 轮, 已占领 ${(100 * owned / games).toFixed(0)}%, 分差 ${avg(margin)} 格, 易主 ${avg(captures)} 次/局, 每回合扩散 ${avg(steps)} 步`);
}

function suite(label, n, opts) {
  console.log(`\n== ${label} ==`);
  const many = QUICK ? 100 : 400, few = QUICK ? 10 : 30;
  for (const s of ["集中9", "三堆3", "九个1"]) series(s, s, many, n, opts);
  for (const [x, y] of [["集中9", "三堆3"], ["集中9", "九个1"], ["三堆3", "九个1"]]) {
    series(x, y, many, n, opts);
    series(y, x, many, n, opts);
  }
  series("贪心", "贪心", few, n, opts);
  series("贪心", "三堆3", few, n, opts);
  series("三堆3", "贪心", few, n, opts);
}

const base = { maxRounds: 8, budget: 9, ratio: 2, sticky: true, resolve: "round" };
suite("9×9 默认: 每回合 9 泉, 2 倍夺格, 一轮结算一次", 9, base);
suite("9×9 每回合结束都结算", 9, { ...base, resolve: "turn" });
suite("9×9 1.5 倍夺格", 9, { ...base, ratio: 1.5 });
