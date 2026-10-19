// 对弈界面。引擎(DuelGame / greedyTurn)由 build.mjs 从 diffusion.ts + duel.ts
// 擦除类型后拼在本文件前面。黑方 = 引擎的 1(玩家),白方 = -1(电脑或同屏另一人)。

const $ = (id) => document.getElementById(id);
const NAME = { 1: "黑方", [-1]: "白方" };
const ARROWS = ["↑", "→", "↓", "←"]; // 与引擎 上→右→下→左 的顺序一致
const STEP_DIRS = [[-1, 0], [0, 1], [1, 0], [0, -1]];
const BOT_THINK_MS = 400;
const CAPTURE_TEXT = {
  remove: "被吃掉的水会消失；如果赢的一方在这格也没有水，它就变回空地。",
  keep: "被吃掉的水留在原地，只换主人。",
  convert: "被吃掉的水换边，归赢的一方（一格最多 9）。",
};

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 隐私模式等 */ } },
};

let game = null;
let mode = "game"; // game 对局 | tutorial 教学
// place 落子 | handover 同屏交接 | flow 揭晓后流动 | review 教学关结束等待下一步 | over 终局
let phase = "place";
let paused = false;
let timer = null;
let last = null; // 最近一步 DuelStep
let flowSteps = 0;
let stepMs = 450;
let simOn = false;
let tut = null; // { i, snapshot, result }

/* ---------------- 教学关 ---------------- */

const pile = (r, c, n) => Array.from({ length: n }, () => ({ r, c }));

const LESSONS = [
  {
    title: "放水",
    budget: 8,
    focus: [3, 3],
    white: [],
    ask: "每轮你都有一些泉。点中间那格 8 次，把 8 个泉都放进去，然后按「确认放置」。",
    ready: (g) => g.placedAt(3, 3) === 8,
    after: () => ({
      ok: true,
      text: "一格的水比周围 8 格加起来还多，就会按上、右、下、左轮流分出去，直到不再多。8 变成了中间 4、四周各 1。有水的格都归你，现在你占 5 格，颜色深的就是你的地盘。",
    }),
  },
  {
    title: "吃子",
    budget: 3,
    focus: [1, 5],
    white: [],
    setup: (g) => { g.setWater(-1, 1, 5, 1); g.resolveOwners(); },
    ask: "右上那颗白子是白方的水。一格归谁，看它周围 3×3 里谁的水多。在它旁边放泉，让那片区域里你的水比白方多，就能吃掉它。拿不准就先按「演算」看看。",
    ready: (g) => g.placed.length > 0,
    after: (g) => g.value(1, 5, -1) === 0
      ? { ok: true, text: "吃掉了。被吃掉的水会消失，那一格变回空地。只放 1 个泉只能和白子打平，打平时格子还归原来的主人。" }
      : { ok: false, text: "这次没吃掉：那片 3×3 里你的水还不比白方多。按「重试」再来，试着在白子旁边的一格放 2 个以上。" },
  },
  {
    title: "同时落子",
    budget: 9,
    white: [...pile(4, 5, 3), ...pile(5, 3, 3), ...pile(2, 5, 3)],
    ask: "正式对局里双方同时落子：你看不到白方放在哪，都确认后一起揭晓、一起流动、一起结算。这一轮白方会贴着你的地盘放水。用 9 个泉守住它，或者反过来吃掉白方。",
    ready: () => true,
    after: (g) => {
      const { a, b } = g.count();
      return {
        ok: true, last: true,
        text: `这一轮结束，黑 ${a} 格，白 ${b} 格。正式对局在 13×13 的棋盘上打 12 轮，一方占到过半立刻获胜，否则打满回合比格数。`,
      };
    },
  },
];

function startTutorial() {
  clearTimeout(timer);
  mode = "tutorial";
  game = new DuelGame(7, 7, { maxRounds: 99, budget: 8, capture: "remove" });
  buildBoard(7);
  $("log").textContent = "";
  closeDrawers();
  tut = { i: 0, snapshot: null, result: null };
  beginLesson();
}

function beginLesson() {
  const L = LESSONS[tut.i];
  L.setup?.(game);
  game.budget = game.left = L.budget;
  tut.snapshot = game.clone();
  tut.result = null;
  last = null;
  simOn = false;
  phase = "place";
  render();
}

function retryLesson() {
  game = tut.snapshot.clone();
  tut.result = null;
  last = null;
  simOn = false;
  phase = "place";
  render();
}

function nextLesson() {
  if (tut.i === LESSONS.length - 1) {
    store.set("duel-tutorial-done", "1");
    return newGame();
  }
  tut.i++;
  beginLesson();
}

/* ---------------- 对局 ---------------- */

function wallPreset(n, kind) {
  const m = (n - 1) / 2, out = [];
  if (kind === "pillars")
    for (const [dr, dc] of [[0, 0], [-2, -2], [-2, 2], [2, -2], [2, 2]]) out.push({ r: m + dr, c: m + dc });
  if (kind === "river") // 副对角线上的一道墙,留两处渡口;关于中心对称,对双方公平
    for (let i = 0; i < n; i++) if (i !== 1 && i !== n - 2) out.push({ r: i, c: n - 1 - i });
  return out;
}

function buildBoard(n) {
  const b = $("board");
  b.style.setProperty("--cols", n);
  b.textContent = "";
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      const d = document.createElement("div");
      d.className = "cell";
      d.dataset.r = r;
      d.dataset.c = c;
      b.append(d);
    }
}

function newGame() {
  clearTimeout(timer);
  mode = "game";
  tut = null;
  const n = Number($("size").value);
  game = new DuelGame(n, n, {
    maxRounds: Number($("rounds").value),
    budget: Number($("budget").value),
    walls: wallPreset(n, $("walls").value),
    capture: $("capture").value,
  });
  $("r-capture").textContent = CAPTURE_TEXT[game.capture];
  paused = false;
  last = null;
  simOn = false;
  $("log").textContent = "";
  buildBoard(n);
  startPlacing();
}

const rival = () => (mode === "tutorial" ? "script" : $("rival").value);
const hotSeat = () => rival() === "human";
const botPlays = () => rival() !== "human" && game.turn === -1 && phase === "place";
const humanPlacing = () => phase === "place" && !botPlays();
const lessonBlocks = () => mode === "tutorial" && game.turn === 1 && !LESSONS[tut.i].ready(game);

/** 进入当前一方的落子;同屏两人时先盖住盘面,让另一方回避 */
function startPlacing() {
  phase = hotSeat() ? "handover" : "place";
  render();
  botIfNeeded();
}

function log(text, side) {
  const li = document.createElement("li");
  li.textContent = text;
  li.className = side === 1 ? "lb" : side === -1 ? "lw" : "";
  $("log").prepend(li);
}

function describe(list) {
  const piles = new Map();
  for (const p of list) piles.set(`${p.r},${p.c}`, (piles.get(`${p.r},${p.c}`) ?? 0) + 1);
  return [...piles].map(([k, n]) => `(${k}) ${n} 个`).join("，") || "没有落子";
}

function confirmPlacement() {
  if (phase !== "place" || lessonBlocks()) return;
  simOn = false;
  game.commit();
  if (game.phase === "place") return startPlacing(); // 黑方放完,轮到白方
  log(`第 ${game.round} 轮黑方：${describe(game.revealed[1])}`, 1);
  log(`第 ${game.round} 轮白方：${describe(game.revealed[-1])}`, -1);
  phase = "flow";
  paused = false;
  last = null;
  flowSteps = 0;
  render();
  flowTick();
}

function botIfNeeded() {
  if (!botPlays()) return;
  render();
  timer = setTimeout(() => {
    const plan = mode === "tutorial" ? LESSONS[tut.i].white : greedyTurn(game);
    for (const p of plan) game.add(p.r, p.c);
    confirmPlacement();
  }, mode === "tutorial" ? 150 : BOT_THINK_MS);
}

/* ---------------- 流动 ---------------- */

function flowStep() {
  const s = game.step();
  if (!s) return finishRound(), false;
  last = s;
  flowSteps++;
  return true;
}

function flowTick() {
  clearTimeout(timer);
  if (phase !== "flow" || paused) return;
  if (stepMs === 0) {
    while (flowStep());
    return;
  }
  if (flowStep()) {
    render();
    timer = setTimeout(flowTick, stepMs);
  }
}

function finishRound() {
  clearTimeout(timer);
  const before = game.captures, was = game.count();
  game.endRound();
  last = null;
  const now = game.count();
  const gain = (x) => (x >= 0 ? `+${x}` : `${x}`);
  log(`结算：黑 ${now.a}（${gain(now.a - was.a)}），白 ${now.b}（${gain(now.b - was.b)}）`
    + (game.captures > before ? `，${game.captures - before} 格易主` : ""));
  if (mode === "tutorial") {
    tut.result = LESSONS[tut.i].after(game);
    phase = "review";
    return render();
  }
  if (game.winner !== null) {
    phase = "over";
    log(game.winner === 0 ? `平局，${now.a} 比 ${now.b}` : `${NAME[game.winner]}获胜，${now.a} 比 ${now.b}`, game.winner);
    return render();
  }
  startPlacing();
}

/* ---------------- 输入 ---------------- */

function cellOf(ev) {
  const d = ev.target.closest(".cell");
  return d ? [Number(d.dataset.r), Number(d.dataset.c)] : null;
}

$("board").addEventListener("click", (ev) => {
  const p = cellOf(ev);
  if (p && humanPlacing() && game.add(...p)) render();
});
$("board").addEventListener("contextmenu", (ev) => {
  const p = cellOf(ev);
  if (!p) return;
  ev.preventDefault();
  if (humanPlacing() && game.take(...p)) render();
});

const undo = () => { if (humanPlacing() && game.take()) render(); };
const toggleSim = () => { if (humanPlacing()) { simOn = !simOn; render(); } };
const uncover = () => { if (phase === "handover") { phase = "place"; render(); } };
const togglePause = () => {
  if (phase !== "flow") return;
  paused = !paused;
  render();
  flowTick();
};
const oneStep = () => {
  if (phase !== "flow") return;
  paused = true;
  clearTimeout(timer);
  flowStep();
  render();
};
const skipFlow = () => {
  if (phase !== "flow") return;
  clearTimeout(timer);
  while (flowStep());
};

function closeDrawers() {
  for (const id of ["settings", "rules"]) {
    $(id).hidden = true;
    $(`toggle-${id}`).setAttribute("aria-expanded", "false");
  }
}
for (const id of ["settings", "rules"])
  $(`toggle-${id}`).addEventListener("click", () => {
    const open = $(id).hidden;
    closeDrawers();
    $(id).hidden = !open;
    $(`toggle-${id}`).setAttribute("aria-expanded", String(open));
  });

$("tutor").addEventListener("click", startTutorial);
$("lesson-next").addEventListener("click", nextLesson);
$("lesson-retry").addEventListener("click", retryLesson);
$("lesson-quit").addEventListener("click", () => { store.set("duel-tutorial-done", "1"); newGame(); });
$("undo").addEventListener("click", undo);
$("sim").addEventListener("click", toggleSim);
$("confirm").addEventListener("click", () => { if (humanPlacing()) confirmPlacement(); });
$("cover").addEventListener("click", uncover);
$("pause").addEventListener("click", togglePause);
$("one").addEventListener("click", oneStep);
$("skip").addEventListener("click", skipFlow);
$("new").addEventListener("click", () => { closeDrawers(); newGame(); });
for (const id of ["size", "rounds", "budget", "walls", "capture", "rival"])
  $(id).addEventListener("change", newGame);

for (const b of $("speed").children)
  b.addEventListener("click", () => {
    stepMs = Number(b.dataset.ms);
    for (const x of $("speed").children) x.classList.toggle("on", x === b);
    flowTick();
  });

window.addEventListener("keydown", (ev) => {
  if (ev.target.matches?.("select, input") || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if (ev.key === "Enter" && !ev.target.matches?.("button")) {
    if (phase === "handover") uncover();
    else if (humanPlacing()) confirmPlacement();
  }
  else if (ev.key === "z" || ev.key === "Z" || ev.key === "Backspace") undo();
  else if (ev.key === "p" || ev.key === "P") toggleSim();
  else if (ev.key === " ") { ev.preventDefault(); togglePause(); }
  else if (ev.key === "ArrowRight") oneStep();
});

/* ---------------- 渲染 ---------------- */

function el(tag, cls, text) {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function stone(side, v) {
  const s = el("span", `stone ${side === 1 ? "sb" : "sw"}`, v);
  s.style.setProperty("--v", v);
  return s;
}

/** 一步的各方向分出量:[方向, 数量] */
function stepArrows(s) {
  if (s.spread) return s.spread.map((n, dir) => [dir, n]).filter(([, n]) => n > 0);
  const dir = s.dst.r < s.src.r ? 0 : s.dst.c > s.src.c ? 1 : s.dst.r > s.src.r ? 2 : 3;
  return [[dir, s.moved]];
}
const isReceiver = (s, r, c) =>
  stepArrows(s).some(([dir]) => s.src.r + STEP_DIRS[dir][0] === r && s.src.c + STEP_DIRS[dir][1] === c);

function render() {
  const placing = humanPlacing();
  // 演算时盘面显示 view(本方待放泉倒入、流动、结算后的局面),其余仍以 game 为准
  const sim = placing && simOn && game.placed.length ? game.previewGame() : null;
  const view = sim ? sim.game : game;
  const focus = mode === "tutorial" && phase === "place" && LESSONS[tut.i].focus;
  $("board").classList.toggle("simulating", !!sim);

  for (const d of $("board").children) {
    const r = Number(d.dataset.r), c = Number(d.dataset.c);
    d.className = "cell";
    d.textContent = "";
    if (game.isWall(r, c)) { d.classList.add("wall"); continue; }

    const a = view.value(r, c, 1), b = view.value(r, c, -1), owner = view.owner(r, c);
    if (owner) d.classList.add(owner === 1 ? "tb" : "tw");
    if (a && b) { d.classList.add("both"); d.append(stone(1, a), stone(-1, b)); }
    else if (a) d.append(stone(1, a));
    else if (b) d.append(stone(-1, b));
    else d.classList.add("empty");

    const pending = placing ? game.placedAt(r, c) : 0;
    if (pending) {
      const g = el("span", `ghost ${game.turn === 1 ? "gb" : "gw"}`);
      g.append(el("b", "", `+${pending}`));
      d.append(g);
    }
    if (placing && game.canAdd(r, c)) d.classList.add("legal");
    if (focus && focus[0] === r && focus[1] === c) d.classList.add("focus");
    if (sim) {
      const before = game.owner(r, c), me = game.turn;
      if (owner === me && before !== me) d.classList.add("gain");
      else if (before === me && owner !== me) d.classList.add("loss");
    }
    if (last && last.src.r === r && last.src.c === c) {
      d.classList.add("src");
      for (const [dir, n] of stepArrows(last)) d.append(el("span", `arrow d${dir}`, `${ARROWS[dir]}${n}`));
    }
    if (last && isReceiver(last, r, c)) d.classList.add("dst");
  }

  // 比分
  const { a, b, open } = view.count();
  $("n-b").textContent = a;
  $("n-w").textContent = b;
  $("bar-b").style.width = `${(100 * a) / open}%`;
  $("bar-w").style.width = `${(100 * b) / open}%`;
  $("round").textContent = mode === "tutorial"
    ? `教学 ${tut.i + 1} / ${LESSONS.length}`
    : `第 ${game.round} / ${game.maxRounds} 轮，过半要 ${Math.floor(open / 2) + 1} 格`;

  // 状态
  const tag = (s) => `<b>${NAME[s]}</b>`;
  let html;
  if (phase === "over") {
    html = game.winner === 0 ? `<b>平局</b>，${a} 比 ${b}。` : `${tag(game.winner)}获胜，${a} 比 ${b}。`;
  } else if (phase === "review") {
    html = "";
  } else if (phase === "flow") {
    html = last
      ? `${tag(last.side)}的水在 (${last.src.r},${last.src.c}) 分出 <b>${last.moved}</b>：${stepArrows(last).map(([dir, n]) => ARROWS[dir] + n).join(" ")}${paused ? "（已暂停）" : ""}`
      : "双方落子揭晓，水开始流动。";
  } else if (phase === "handover") {
    html = `轮到${tag(game.turn)}落子。`;
  } else if (botPlays()) {
    html = `${tag(-1)}正在落子。`;
  } else {
    const hidden = game.turn === -1 ? `${tag(1)}已经放好，你看不到。` : "";
    html = `${hidden}${tag(game.turn)}还剩 <b>${game.left}</b> 个泉。`;
    if (simOn) {
      const now = game.count(), gain = (x) => (x >= 0 ? `+${x}` : `${x}`);
      html += sim
        ? `<span class="sim">演算（假设对方这轮不落子）：黑 ${a}（${gain(a - now.a)}），白 ${b}（${gain(b - now.b)}），流动 ${sim.steps} 步</span>`
        : `<span class="sim">演算已打开，放下泉就能看到结果。</span>`;
    }
  }
  $("status").innerHTML = html;

  // 教学说明
  $("lesson").hidden = mode !== "tutorial";
  if (mode === "tutorial") {
    const L = LESSONS[tut.i];
    $("lesson-step").textContent = `${tut.i + 1}. ${L.title}`;
    $("lesson-text").textContent = tut.result ? tut.result.text : L.ask;
    $("lesson-next").hidden = !tut.result?.ok;
    $("lesson-next").textContent = tut.result?.last ? "开始对局" : "下一步";
    $("lesson-retry").hidden = !tut.result || tut.result.ok;
  }

  // 交接遮罩
  const cover = $("cover");
  cover.hidden = phase !== "handover";
  if (phase === "handover") {
    cover.querySelector("b").textContent = `轮到${NAME[game.turn]}落子`;
    cover.querySelector("span").textContent = `请${NAME[-game.turn]}回避，点这里或按回车开始。`;
  }

  $("act-place").hidden = phase === "flow" || phase === "review" || phase === "over";
  $("act-flow").hidden = phase !== "flow";
  $("undo").disabled = !placing || game.placed.length === 0;
  $("sim").disabled = !placing;
  $("sim").classList.toggle("on", placing && simOn);
  $("sim").textContent = placing && simOn ? "关闭演算" : "演算";
  $("confirm").disabled = !placing || lessonBlocks();
  $("confirm").textContent = placing && game.left > 0 && game.placed.length
    ? `确认放置（${game.left} 个作废）` : "确认放置";
  $("pause").textContent = paused ? "继续" : "暂停";
}

if (store.get("duel-tutorial-done")) newGame();
else startTutorial();
