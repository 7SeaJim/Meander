// 对战规则的随机对局检验:不变量(越界/相邻差/异色相邻)与先后手胜率。 运行: node sim.mjs
import { DuelGame, greedyMove } from "./duel.ts";

const rnd = (n) => Math.floor(Math.random() * n);
const randomMove = (g) => { const l = g.legalCells(); return l[rnd(l.length)]; };

function checkInvariants(g) {
  const b = g.board;
  for (let r = 0; r < b.rows; r++) for (let c = 0; c < b.cols; c++) {
    const v = b.get(r, c);
    if (Math.abs(v) > 9) return "越界";
    for (const [dr, dc] of [[0, 1], [1, 0]]) {
      const rr = r + dr, cc = c + dc;
      if (rr >= b.rows || cc >= b.cols || b.isWall(r, c) || b.isWall(rr, cc)) continue;
      if (Math.abs(v - b.get(rr, cc)) > 1) return "静止时相邻差 >1";
      if (v * b.get(rr, cc) < 0) return "异色直接相邻";
    }
  }
  return null;
}

let MODE = "all";
function match(n, rounds, botA, botB) {
  const g = new DuelGame(n, n, rounds, [], MODE);
  let turns = 0, bad = null, maxSteps = 0;
  while (g.winner === null) {
    const m = (g.turn === 1 ? botA : botB)(g);
    g.place(m.r, m.c);
    maxSteps = Math.max(maxSteps, g.board.settle().length);
    bad ??= checkInvariants(g);
    g.endTurn();
    turns++;
  }
  const { a, b, open } = g.board.count();
  return { winner: g.winner, turns, a, b, open, bad, maxSteps, early: g.round < rounds || (a * 2 > open || b * 2 > open) };
}

function series(title, games, n, rounds, botA, botB) {
  let w = 0, l = 0, d = 0, turns = 0, bad = 0, steps = 0, early = 0, margin = 0;
  for (let i = 0; i < games; i++) {
    const m = match(n, rounds, botA, botB);
    if (m.winner === 1) w++; else if (m.winner === -1) l++; else d++;
    turns += m.turns; if (m.bad) bad++; steps = Math.max(steps, m.maxSteps);
    if (m.early) early++; margin += Math.abs(m.a - m.b);
  }
  console.log(`${title}: 先手胜 ${w} 后手胜 ${l} 平 ${d} | 平均 ${(turns / games).toFixed(1)} 手, 过半提前结束 ${early}, 平均分差 ${(margin / games).toFixed(1)} 格, 单次沉降最多 ${steps} 步, 不变量违例 ${bad}`);
}

for (MODE of ["all", "mine", "round"]) {
  console.log(`\n== 注入时机: ${MODE} ==`);
  series("7×7 8轮 随机 vs 随机", 300, 7, 8, randomMove, randomMove);
  series("9×9 10轮 随机 vs 随机", 150, 9, 10, randomMove, randomMove);
  series("7×7 8轮 贪心 vs 贪心", 40, 7, 8, greedyMove, greedyMove);
  series("7×7 8轮 贪心(先) vs 随机", 30, 7, 8, greedyMove, randomMove);
  series("7×7 8轮 随机(先) vs 贪心", 30, 7, 8, randomMove, greedyMove);
}
