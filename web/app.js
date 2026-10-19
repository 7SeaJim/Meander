// 网页界面。引擎(DiffusionBoard / WALL / conePrediction / diffBoards)由 build.mjs
// 从 diffusion.ts 擦除类型后拼在本文件前面,同处一个模块作用域。

const $ = (id) => document.getElementById(id);
const ARROWS = ["↑", "→", "↓", "←"]; // 与引擎 上→右→下→左 的顺序一致
const MAX_SIZE = 16;
const LOG_KEEP = 60;

const state = {
  rows: 7,
  cols: 7,
  board: null,
  sources: new Map(), // "r,c" -> 源值
  digit: 9,
  tool: "digit", // digit | wall | source
  strategy: "fifo",
  rule: "block", // block = Ver.2 邻域规则,pair = Ver.1.1 成对规则
  timer: null,
  steps: 0,
  moved: 0,
  last: null, // 最近一步 StepResult
  note: "",
};

const key = (r, c) => `${r},${c}`;

function exampleLayout() {
  state.rows = 7;
  state.cols = 7;
  state.board = new DiffusionBoard(7, 7, undefined, state.rule);
  state.sources.clear();
  for (let r = 1; r <= 5; r++) state.board.set(r, 3, WALL); // 一道竖墙,上下各留缺口
  state.board.set(3, 0, 9);
  state.sources.set(key(3, 0), 9);
}

function resize(rows, cols) {
  const old = state.board;
  const next = new DiffusionBoard(rows, cols, undefined, state.rule);
  for (let r = 0; r < Math.min(rows, state.rows); r++)
    for (let c = 0; c < Math.min(cols, state.cols); c++) next.set(r, c, old.get(r, c));
  for (const k of [...state.sources.keys()]) {
    const [r, c] = k.split(",").map(Number);
    if (r >= rows || c >= cols) state.sources.delete(k);
  }
  state.rows = rows;
  state.cols = cols;
  state.board = next;
}

function sourceList() {
  return [...state.sources].map(([k, value]) => {
    const [r, c] = k.split(",").map(Number);
    return { pos: { r, c }, value };
  });
}

function resetCount() {
  state.steps = 0;
  state.moved = 0;
  state.last = null;
  state.note = "";
  $("log").textContent = "";
}

/* ---------------- 演化 ---------------- */

function record(s) {
  state.steps++;
  state.moved += s.moved;
  state.last = s;
  const li = document.createElement("li");
  li.textContent =
    `#${state.steps} (${s.src.r},${s.src.c})→(${s.dst.r},${s.dst.c}) 搬 ${s.moved}`;
  const log = $("log");
  log.prepend(li);
  while (log.children.length > LOG_KEEP) log.lastChild.remove();
}

function stepOnce() {
  const s = state.board.step(state.strategy);
  if (s) record(s);
  else stop();
  render();
  return s;
}

function delay() {
  return Math.round(900 / Number($("speed").value) ** 1.4);
}

function play() {
  if (state.timer) return;
  const tick = () => {
    state.timer = null;
    if (stepOnce()) state.timer = setTimeout(tick, delay());
    else render();
  };
  state.timer = setTimeout(tick, 0);
  render();
}

function stop() {
  clearTimeout(state.timer);
  state.timer = null;
}

function settleAll() {
  stop();
  const log = state.board.settle(state.strategy);
  for (const s of log) record(s);
  render();
}

function inject() {
  if (!state.sources.size) return void say("先用「◆ 源」标记至少一个注入点。");
  stop();
  resetCount();
  for (const s of sourceList()) state.board.set(s.pos.r, s.pos.c, s.value);
  if ($("auto").checked) play();
  else render();
}

function steady() {
  if (!state.sources.size) return void say("先用「◆ 源」标记至少一个注入点。");
  stop();
  resetCount();
  const res = state.board.steadyState(sourceList(), state.strategy);
  state.note = res.converged
    ? `反复注入 <b>${res.rounds}</b> 轮后到达稳态。`
    : `<span class="bad">${res.rounds} 轮内未收敛。</span>`;
  render();
}

function say(msg) {
  state.note = msg;
  render();
}

/* ---------------- 画笔 ---------------- */

let stroke = null; // 一次拖动中已画过的格,避免重复应用

function paint(r, c) {
  const k = key(r, c);
  const b = state.board;
  if (state.tool === "source") {
    if (state.sources.has(k)) state.sources.delete(k);
    else {
      state.sources.set(k, state.digit);
      b.set(r, c, state.digit);
    }
  } else if (state.tool === "wall") {
    state.sources.delete(k);
    b.set(r, c, b.get(r, c) === WALL ? 0 : WALL);
  } else {
    state.sources.delete(k);
    b.set(r, c, state.digit);
  }
}

function cellAt(ev) {
  const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.(".cell");
  return el && $("board").contains(el) ? el : null;
}

function onPointer(ev) {
  const el = cellAt(ev);
  if (!el || stroke.has(el.dataset.k)) return;
  stroke.add(el.dataset.k);
  paint(Number(el.dataset.r), Number(el.dataset.c));
  render();
}

$("board").addEventListener("pointerdown", (ev) => {
  if (ev.button !== 0) return;
  ev.preventDefault();
  stop();
  resetCount();
  stroke = new Set();
  onPointer(ev);
});
window.addEventListener("pointermove", (ev) => {
  if (stroke && state.tool !== "source") onPointer(ev);
});
window.addEventListener("pointerup", () => {
  if (!stroke) return;
  stroke = null;
  if ($("auto").checked) play();
});

/* ---------------- 渲染 ---------------- */

function buildBoard() {
  const el = $("board");
  el.style.setProperty("--cols", state.cols);
  el.textContent = "";
  for (let r = 0; r < state.rows; r++)
    for (let c = 0; c < state.cols; c++) {
      const d = document.createElement("div");
      d.className = "cell";
      d.dataset.r = r;
      d.dataset.c = c;
      d.dataset.k = key(r, c);
      el.append(d);
    }
  $("rows").value = state.rows;
  $("cols").value = state.cols;
}

function prediction() {
  if (!$("cone").checked || !state.sources.size) return null;
  const m = state.board.toMatrix();
  const walls = m.map((row) => row.map((v) => v === WALL));
  const pred = conePrediction(state.rows, state.cols, walls, sourceList());
  const miss = new Set(diffBoards(m, pred).map((p) => key(p.r, p.c)));
  return { pred, miss };
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
  const b = state.board;
  const cone = prediction();
  const last = state.last;
  let sum = 0;

  for (const d of $("board").children) {
    const r = Number(d.dataset.r), c = Number(d.dataset.c);
    const v = b.get(r, c);
    const wall = v === WALL;
    if (!wall) sum += v;
    d.dataset.v = wall ? "" : v;
    d.textContent = wall ? "✕" : v;
    d.className = "cell";
    d.classList.toggle("wall", wall);
    d.classList.toggle("source", state.sources.has(d.dataset.k));

    if (last && last.src.r === r && last.src.c === c) {
      d.classList.add("src");
      for (const [dir, n] of stepArrows(last)) {
        const a = document.createElement("span");
        a.className = `arrow d${dir}`;
        a.textContent = `${ARROWS[dir]}${n}`;
        d.append(a);
      }
    }
    if (last && isReceiver(last, r, c)) d.classList.add("dst");

    if (cone && !wall) {
      const p = document.createElement("span");
      p.className = "pred";
      p.textContent = cone.pred[r][c];
      d.append(p);
      d.classList.toggle("miss", cone.miss.has(d.dataset.k));
    }
  }

  $("s-steps").textContent = state.steps;
  $("s-moved").textContent = state.moved;
  $("s-sum").textContent = sum;

  $("play").textContent = state.timer ? "暂停" : "播放";
  for (const x of $("digits").children)
    x.classList.toggle("on", state.tool !== "wall" && Number(x.dataset.d) === state.digit);
  for (const x of document.querySelectorAll(".tool"))
    x.classList.toggle("on", x.dataset.tool === state.tool);
  for (const x of $("strategy").children)
    x.classList.toggle("on", x.dataset.s === state.strategy);
  for (const x of $("rule").children)
    x.classList.toggle("on", x.dataset.rule === state.rule);

  const done = b.pickSource(state.strategy) === null;
  const parts = [];
  if (state.note) parts.push(state.note);
  if (state.timer) parts.push("演化中…");
  else if (done) parts.push(state.steps ? `演化结束，共 <b>${state.steps}</b> 步。` : "盘面静止，没有可扩散的格。");
  else parts.push("仍有可扩散的格。");
  if ($("cone").checked) {
    if (!cone) parts.push("锥面预测需要至少一个源。");
    else if (cone.miss.size === 0) parts.push('<span class="ok">盘面 ≡ 锥面预测</span>');
    else parts.push(`<span class="bad">${cone.miss.size} 格与锥面预测不符</span>（右下角为预测值）`);
  }
  $("status").innerHTML = parts.join(" ");
}

/* ---------------- 控件 ---------------- */

for (let d = 0; d <= 9; d++) {
  const x = document.createElement("button");
  x.textContent = d;
  x.dataset.d = d;
  x.style.background = `var(--v${d})`;
  x.style.color = d >= 7 ? "#1d0d05" : d === 0 ? "#8a8797" : "#fff";
  x.addEventListener("click", () => pickDigit(d));
  $("digits").append(x);
}

function pickDigit(d) {
  state.digit = d;
  if (state.tool === "wall") state.tool = "digit";
  render();
}

function pickTool(t) {
  state.tool = state.tool === t ? "digit" : t;
  render();
}

for (const x of document.querySelectorAll(".tool"))
  x.addEventListener("click", () => pickTool(x.dataset.tool));
for (const x of $("strategy").children)
  x.addEventListener("click", () => { state.strategy = x.dataset.s; render(); });
for (const x of $("rule").children)
  x.addEventListener("click", () => {
    stop();
    state.rule = state.board.rule = x.dataset.rule;
    resetCount();
    render();
  });

$("step").addEventListener("click", () => { stop(); stepOnce(); });
$("play").addEventListener("click", () => { if (state.timer) { stop(); render(); } else play(); });
$("settle").addEventListener("click", settleAll);
$("inject").addEventListener("click", inject);
$("steady").addEventListener("click", steady);
$("cone").addEventListener("change", render);

$("clear").addEventListener("click", () => {
  stop();
  resetCount();
  for (let r = 0; r < state.rows; r++)
    for (let c = 0; c < state.cols; c++)
      if (state.board.get(r, c) !== WALL) state.board.set(r, c, 0);
  render();
});

$("reset").addEventListener("click", () => {
  stop();
  resetCount();
  exampleLayout();
  buildBoard();
  render();
});

for (const id of ["rows", "cols"])
  $(id).addEventListener("change", () => {
    const clamp = (v, fallback) => Math.min(MAX_SIZE, Math.max(2, Math.floor(Number(v)) || fallback));
    stop();
    resetCount();
    resize(clamp($("rows").value, state.rows), clamp($("cols").value, state.cols));
    buildBoard();
    render();
  });

window.addEventListener("keydown", (ev) => {
  if (ev.target.matches?.("input") || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if (/^[0-9]$/.test(ev.key)) pickDigit(Number(ev.key));
  else if (ev.key === "w" || ev.key === "W") pickTool("wall");
  else if (ev.key === "s" || ev.key === "S") pickTool("source");
  else if (ev.key === " ") { ev.preventDefault(); stop(); stepOnce(); }
  else if (ev.key === "Enter" && !ev.target.matches?.("button")) $("play").click();
});

exampleLayout();
buildBoard();
render();
