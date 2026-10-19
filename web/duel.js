// 对战界面。引擎(DuelGame / greedyTurn)由 build.mjs 从 diffusion.ts + duel.ts
// 擦除类型后拼在本文件前面。

const $ = (id) => document.getElementById(id);
const NAME = { 1: "橙方", [-1]: "青方" };
const RGB = { 1: [255, 159, 67], [-1]: [62, 198, 224], 0: [22, 22, 29] };
const ARROWS = ["↑", "→", "↓", "←"]; // 与引擎 上→右→下→左 的顺序一致
const BOT_SHOW_MS = 700; // 电脑放好后停一下,让人看清它放在哪

let game = null;
let phase = "place"; // place 放泉 | flow 扩散中 | over 终局
let paused = false;
let timer = null;
let last = null; // 最近一步 DuelStep
let flowSteps = 0;
let stepMs = 450;

function wallPreset(n, kind) {
  const m = (n - 1) / 2, out = [];
  if (kind === "pillars")
    for (const [dr, dc] of [[0, 0], [-2, -2], [-2, 2], [2, -2], [2, 2]]) out.push({ r: m + dr, c: m + dc });
  if (kind === "river") // 副对角线上的一道墙,留两处渡口;关于中心对称,对双方公平
    for (let i = 0; i < n; i++) if (i !== 1 && i !== n - 2) out.push({ r: i, c: n - 1 - i });
  return out;
}

function newGame() {
  clearTimeout(timer);
  const n = Number($("size").value);
  game = new DuelGame(n, n, {
    maxRounds: Number($("rounds").value),
    budget: Number($("budget").value),
    walls: wallPreset(n, $("walls").value),
  });
  phase = "place";
  paused = false;
  last = null;
  $("log").textContent = "";
  const el = $("board");
  el.style.setProperty("--cols", n);
  el.textContent = "";
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      const d = document.createElement("div");
      d.className = "cell";
      d.dataset.r = r;
      d.dataset.c = c;
      el.append(d);
    }
  render();
  botIfNeeded();
}

const botPlays = () => $("rival").value === "bot" && game.turn === -1 && phase === "place";
const humanPlacing = () => phase === "place" && !botPlays();

function log(text, side) {
  const li = document.createElement("li");
  li.textContent = text;
  li.className = side === 1 ? "la" : side === -1 ? "lb" : "";
  $("log").prepend(li);
}

/* ---------------- 放泉 ---------------- */

function describePlacement() {
  const piles = new Map();
  for (const p of game.placed) piles.set(`${p.r},${p.c}`, (piles.get(`${p.r},${p.c}`) ?? 0) + 1);
  return [...piles].map(([k, n]) => `(${k})×${n}`).join(" ") || "未放";
}

function confirmPlacement() {
  if (phase !== "place") return;
  log(`第 ${game.round} 轮 ${NAME[game.turn]} ${describePlacement()}`, game.turn);
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
    for (const p of greedyTurn(game)) game.add(p.r, p.c);
    render();
    timer = setTimeout(confirmPlacement, stepMs ? BOT_SHOW_MS : 0);
  }, 50);
}

/* ---------------- 扩散 ---------------- */

function flowStep() {
  const s = game.step();
  if (!s) return finishTurn(), false;
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

function finishTurn() {
  clearTimeout(timer);
  const closing = game.turn === -game.firstOf(game.round); // 本轮后手下完,要结算
  const before = game.captures, was = game.count();
  game.endTurn();
  last = null;
  const now = game.count();
  if (closing || game.resolve === "turn") {
    const gain = (x) => (x >= 0 ? `+${x}` : `${x}`);
    log(`结算：橙 ${now.a}（${gain(now.a - was.a)}） 青 ${now.b}（${gain(now.b - was.b)}）`
      + (game.captures > before ? `，易主 ${game.captures - before} 格` : ""));
  }
  if (game.winner !== null) {
    phase = "over";
    log(game.winner === 0 ? `平局 ${now.a} : ${now.b}` : `${NAME[game.winner]}胜 ${now.a} : ${now.b}`, game.winner);
  } else phase = "place";
  render();
  botIfNeeded();
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

$("undo").addEventListener("click", undo);
$("confirm").addEventListener("click", () => { if (humanPlacing()) confirmPlacement(); });
$("pause").addEventListener("click", togglePause);
$("one").addEventListener("click", oneStep);
$("skip").addEventListener("click", skipFlow);

for (const b of $("speed").children)
  b.addEventListener("click", () => {
    stepMs = Number(b.dataset.ms);
    for (const x of $("speed").children) x.classList.toggle("on", x === b);
    flowTick();
  });

window.addEventListener("keydown", (ev) => {
  if (ev.target.matches?.("select, input") || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if (ev.key === "Enter" && !ev.target.matches?.("button")) { if (humanPlacing()) confirmPlacement(); }
  else if (ev.key === "z" || ev.key === "Z" || ev.key === "Backspace") undo();
  else if (ev.key === " ") { ev.preventDefault(); togglePause(); }
  else if (ev.key === "ArrowRight") oneStep();
});

/* ---------------- 渲染 ---------------- */

function shade(side, mag) {
  const t = 0.3 + (mag / 9) * 0.7, a = RGB[side], z = RGB[0];
  return `rgb(${a.map((x, i) => Math.round(z[i] + (x - z[i]) * t)).join(",")})`;
}

function span(cls, text) {
  const s = document.createElement("span");
  s.className = cls;
  s.textContent = text;
  return s;
}

/** 一步的各方向搬运量:[方向, 数量];成对规则只有一个方向 */
function stepArrows(s) {
  if (s.spread) return s.spread.map((n, dir) => [dir, n]).filter(([, n]) => n > 0);
  const dir = s.dst.r < s.src.r ? 0 : s.dst.c > s.src.c ? 1 : s.dst.r > s.src.r ? 2 : 3;
  return [[dir, s.moved]];
}

const STEP_DIRS = [[-1, 0], [0, 1], [1, 0], [0, -1]];
const isReceiver = (s, r, c) =>
  stepArrows(s).some(([dir]) => s.src.r + STEP_DIRS[dir][0] === r && s.src.c + STEP_DIRS[dir][1] === c);

function render() {
  const placing = humanPlacing();

  for (const d of $("board").children) {
    const r = Number(d.dataset.r), c = Number(d.dataset.c);
    d.className = "cell";
    d.removeAttribute("data-v");
    d.style.background = d.style.color = "";
    d.textContent = "";

    if (game.isWall(r, c)) {
      d.classList.add("wall");
      d.textContent = "✕";
      continue;
    }
    const a = game.value(r, c, 1), b = game.value(r, c, -1), owner = game.owner(r, c);
    if (owner) {
      const mine = owner === 1 ? a : b, theirs = owner === 1 ? b : a;
      d.style.background = shade(owner, mine);
      d.style.color = mine >= 4 ? "#12100c" : "#f2efe8";
      d.textContent = mine;
      if (theirs > 0) d.append(span(`foe ${owner === 1 ? "fb" : "fa"}`, theirs));
    } else if (a || b) {
      d.classList.add("contested");
      if (a) d.append(span("va", a));
      if (b) d.append(span("vb", b));
    } else {
      d.dataset.v = 0;
      d.textContent = 0;
    }

    const pending = phase === "place" ? game.placedAt(r, c) : 0;
    if (pending) {
      d.classList.add("pending", game.turn === 1 ? "pa" : "pb");
      d.append(span("plus", `+${pending}`));
    }
    if (placing && game.canAdd(r, c)) d.classList.add("legal");
    if (last && last.src.r === r && last.src.c === c) {
      d.classList.add("src");
      for (const [dir, n] of stepArrows(last)) d.append(span(`arrow d${dir}`, `${ARROWS[dir]}${n}`));
    }
    if (last && isReceiver(last, r, c)) d.classList.add("dst");
  }

  const { a, b, open } = game.count();
  $("bar-a").style.width = `${(100 * a) / open}%`;
  $("bar-b").style.width = `${(100 * b) / open}%`;
  $("bar-n").style.width = `${(100 * (open - a - b)) / open}%`;
  $("n-a").textContent = a;
  $("n-b").textContent = b;
  $("n-half").textContent = `过半需 ${Math.floor(open / 2) + 1} 格`;

  const st = $("status");
  const cls = (s) => (s === 1 ? "ta" : "tb");
  const who = `<b class="${cls(game.turn)}">${NAME[game.turn]}</b>`;
  const head = `第 ${game.round} / ${game.maxRounds} 轮 · ${who}`;
  if (phase === "over") {
    st.innerHTML = game.winner === 0
      ? `<b>平局</b>，${a} : ${b}。`
      : `<b class="${cls(game.winner)}">${NAME[game.winner]}获胜</b>，${a} : ${b}。`;
  } else if (phase === "flow") {
    st.innerHTML = last
      ? `${head} 扩散第 <b>${flowSteps}</b> 步：(${last.src.r},${last.src.c}) 给出 <b>${last.moved}</b>（${stepArrows(last).map(([d, n]) => ARROWS[d] + n).join(" ")}）${paused ? " · 已暂停" : ""}`
      : `${head} 扩散中…`;
  } else if (botPlays()) {
    st.innerHTML = `${head} ${game.placed.length ? "已放好" : "思考中…"}`;
  } else {
    st.innerHTML = `${head} 放泉，还剩 <b>${game.left}</b> / ${game.budget} 个`;
  }

  $("act-place").hidden = phase === "flow";
  $("act-flow").hidden = phase !== "flow";
  $("undo").disabled = !placing || game.placed.length === 0;
  $("confirm").disabled = !placing;
  $("confirm").textContent = placing && game.left > 0 && game.placed.length
    ? `确认放置（${game.left} 个作废）` : "确认放置";
  $("pause").textContent = paused ? "继续" : "暂停";
  document.body.dataset.turn = phase === "over" ? 0 : game.turn;
}

$("new").addEventListener("click", newGame);
for (const id of ["size", "rounds", "budget", "walls", "rival"])
  $(id).addEventListener("change", newGame);

newGame();
