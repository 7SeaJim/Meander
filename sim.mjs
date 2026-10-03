// 对战规则的随机/贪心对局检验:先后手胜率、终局占领比例、易主次数。
// 运行: node sim.mjs [quick]
import { DuelGame, greedyMove } from "./duel.ts";

const QUICK = process.argv[2] === "quick";
const rnd = (n) => Math.floor(Math.random() * n);
const randomMove = (g) => { const l = g.legalCells(); return l[rnd(l.length)]; };

function match(n, opts, botA, botB) {
  const g = new DuelGame(n, n, opts);
  while (g.winner === null) {
    const m = (g.turn === 1 ? botA : botB)(g);
    g.play(m.r, m.c);
  }
  const { a, b, open } = g.count();
  return { winner: g.winner, a, b, open, captures: g.captures, rounds: g.round };
}

function series(title, games, n, opts, botA, botB) {
  let w = 0, l = 0, d = 0, owned = 0, margin = 0, captures = 0, rounds = 0;
  for (let i = 0; i < games; i++) {
    const m = match(n, opts, botA, botB);
    if (m.winner === 1) w++; else if (m.winner === -1) l++; else d++;
    owned += (m.a + m.b) / m.open; margin += Math.abs(m.a - m.b);
    captures += m.captures; rounds += m.rounds;
  }
  const avg = (x, k = 1) => (x / games).toFixed(k);
  console.log(`  ${title.padEnd(16)} 先:后:平 ${w}:${l}:${d} | 平均 ${avg(rounds)} 轮, 终局已占领 ${(100 * owned / games).toFixed(0)}%, 分差 ${avg(margin)} 格, 易主 ${avg(captures)} 次/局`);
}

function suite(label, n, opts) {
  console.log(`\n== ${label} ==`);
  series("随机 vs 随机", QUICK ? 60 : 200, n, opts, randomMove, randomMove);
  series("贪心 vs 贪心", QUICK ? 8 : 24, n, opts, greedyMove, greedyMove);
  series("贪心(先) vs 随机", QUICK ? 8 : 20, n, opts, greedyMove, randomMove);
  series("随机(先) vs 贪心", QUICK ? 8 : 20, n, opts, randomMove, greedyMove);
}

const base = { maxRounds: 8, perTurn: 2, ratio: 2, sticky: true, inject: "round" };
suite("7×7 默认: 每回合 2 泉, 2 倍夺格, 原主保留", 7, base);
suite("不保留原主(不足倍数即变无主)", 7, { ...base, sticky: false });
suite("1.5 倍夺格", 7, { ...base, ratio: 1.5 });
suite("3 倍夺格", 7, { ...base, ratio: 3 });
suite("每回合 1 泉", 7, { ...base, perTurn: 1 });
suite("每回合 3 泉", 7, { ...base, perTurn: 3, maxRounds: 6 });
suite("注入时机 all", 7, { ...base, inject: "all" });
suite("注入时机 mine", 7, { ...base, inject: "mine" });
