// 规则书「待验证」清单的随机检验。 运行: node verify.mjs [每项试验次数]
// 每次试验:随机尺寸、随机墙、空盘起手,求稳态后与锥面预测 / 其他策略比较。
import { DiffusionBoard, WALL, conePrediction, diffBoards } from "./diffusion.ts";

const TRIALS = Number(process.argv[2]) || 500;
const STRATS = ["scan", "fifo", "lifo"];
const rnd = (n) => Math.floor(Math.random() * n);
const show = (m) => m.map((row) => row.map((v) => (v === WALL ? "✕" : v)).join(" ")).join("\n");

function trial(nSources, fixedValue) {
  const rows = 3 + rnd(6), cols = 3 + rnd(6);
  const walls = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => Math.random() < 0.2));
  const sources = [];
  while (sources.length < nSources) {
    const pos = { r: rnd(rows), c: rnd(cols) };
    if (sources.some((s) => s.pos.r === pos.r && s.pos.c === pos.c)) continue;
    walls[pos.r][pos.c] = false;
    sources.push({ pos, value: fixedValue ?? 2 + rnd(8) });
  }
  const init = walls.map((row) => row.map((w) => (w ? WALL : 0)));
  const steady = {};
  let converged = true;
  for (const s of STRATS) {
    const res = new DiffusionBoard(rows, cols, init).steadyState(sources, s, 2000);
    steady[s] = res.board;
    converged &&= res.converged;
  }
  const cone = conePrediction(rows, cols, walls, sources);
  return { sources, steady, cone, converged };
}

function run(title, nSources, fixedValue) {
  let coneMiss = 0, stratMiss = 0, unconverged = 0, example = null;
  for (let i = 0; i < TRIALS; i++) {
    const n = typeof nSources === "function" ? nSources() : nSources;
    const t = trial(n, fixedValue);
    if (!t.converged) unconverged++;
    const badCone = STRATS.some((s) => diffBoards(t.steady[s], t.cone).length);
    const badStrat = STRATS.some((s) => diffBoards(t.steady[s], t.steady.fifo).length);
    if (badCone) coneMiss++;
    if (badStrat) stratMiss++;
    if ((badCone || badStrat) && !example) example = t;
  }
  console.log(`\n${title} — ${TRIALS} 次`);
  console.log(`  稳态 ≠ 锥面预测: ${coneMiss}   三种策略稳态不一致: ${stratMiss}   未收敛: ${unconverged}`);
  if (example) {
    console.log(`  反例  源: ${example.sources.map((s) => `(${s.pos.r},${s.pos.c})=${s.value}`).join(" ")}`);
    console.log("  FIFO 稳态:\n" + show(example.steady.fifo).replace(/^/gm, "    "));
    console.log("  锥面预测:\n" + show(example.cone).replace(/^/gm, "    "));
  }
}

run("单源,强度 9(泉)", 1, 9);
run("单源,强度 2–9", 1);
run("多源 2–4 个,强度均为 9", () => 2 + rnd(3), 9);
run("多源 2–4 个,强度 2–9 各异", () => 2 + rnd(3));
