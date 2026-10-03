// 对战界面。引擎(DuelGame / greedyMove)由 build.mjs 从 duel.ts 擦除类型后拼在本文件前面。

const $ = (id) => document.getElementById(id);
const NAME = { 1: "橙方", [-1]: "青方" };
const RGB = { 1: [255, 159, 67], [-1]: [62, 198, 224], 0: [22, 22, 29] };
const TICK_MS = 30;
const ANIM_TICKS = 45; // 一次沉降的动画大约分这么多帧播完

let game = null;
let busy = false; // 正在播扩散动画或等电脑落子
let timer = null;
let last = null; // 最近一步 DuelStep

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
  game = new DuelGame(n, n, Number($("rounds").value), wallPreset(n, $("walls").value), $("inject").value);
  busy = false;
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

const botPlays = () => $("rival").value === "bot" && game.turn === -1 && game.winner === null;

function log(text, side) {
  const li = document.createElement("li");
  li.textContent = text;
  li.className = side === 1 ? "la" : side === -1 ? "lb" : "";
  $("log").prepend(li);
}

function move(r, c) {
  const side = game.turn, round = game.round;
  if (!game.place(r, c)) return;
  busy = true;
  last = null;
  log(`第 ${round} 轮 ${NAME[side]} 放泉 (${r},${c})`, side);
  animate(() => {
    game.endTurn();
    busy = false;
    last = null;
    if (game.winner !== null) {
      const { a, b } = game.board.count();
      log(game.winner === 0 ? `平局 ${a} : ${b}` : `${NAME[game.winner]}胜 ${a} : ${b}`, game.winner);
    }
    render();
    botIfNeeded();
  });
}

function animate(done) {
  const b = game.board;
  if ($("skip").checked) {
    b.settle(game.strategy);
    return done();
  }
  const total = b.clone().settle(game.strategy).length;
  const batch = Math.max(1, Math.ceil(total / ANIM_TICKS));
  const tick = () => {
    for (let i = 0; i < batch; i++) {
      const s = b.step(game.strategy);
      if (!s) return done();
      last = s;
    }
    render();
    timer = setTimeout(tick, TICK_MS);
  };
  render();
  tick();
}

function botIfNeeded() {
  if (!botPlays()) return;
  busy = true;
  render();
  timer = setTimeout(() => {
    const m = greedyMove(game);
    busy = false;
    if (m) move(m.r, m.c);
  }, 350);
}

$("board").addEventListener("click", (ev) => {
  const d = ev.target.closest(".cell");
  if (!d || busy || botPlays()) return;
  move(Number(d.dataset.r), Number(d.dataset.c));
});

function shade(side, mag) {
  const t = 0.16 + (mag / 9) * 0.84, a = RGB[side], z = RGB[0];
  return `rgb(${a.map((x, i) => Math.round(z[i] + (x - z[i]) * t)).join(",")})`;
}

function render() {
  const b = game.board;
  const canClick = !busy && game.winner === null && !botPlays();

  for (const d of $("board").children) {
    const r = Number(d.dataset.r), c = Number(d.dataset.c);
    const v = b.get(r, c), wall = b.isWall(r, c);
    const side = v > 0 ? 1 : v < 0 ? -1 : 0;
    const spring = game.springAt(r, c);
    d.className = "cell";
    d.removeAttribute("data-v");
    d.textContent = wall ? "✕" : Math.abs(v);
    d.style.background = wall ? "" : side ? shade(side, Math.abs(v)) : "";
    d.style.color = wall ? "" : Math.abs(v) >= 5 ? "#12100c" : side ? "#f2efe8" : "";
    if (wall) d.classList.add("wall");
    else if (!side) d.dataset.v = 0;
    if (spring) d.classList.add("source", spring.side === 1 ? "sa" : "sb");
    if (canClick && game.canPlace(r, c)) d.classList.add("legal");
    if (last && last.src.r === r && last.src.c === c) d.classList.add("src");
    if (last && last.dst.r === r && last.dst.c === c) d.classList.add("dst");
  }

  const { a, b: nb, open } = b.count();
  $("bar-a").style.width = `${(100 * a) / open}%`;
  $("bar-b").style.width = `${(100 * nb) / open}%`;
  $("bar-n").style.width = `${(100 * (open - a - nb)) / open}%`;
  $("n-a").textContent = a;
  $("n-b").textContent = nb;
  $("n-half").textContent = `过半需 ${Math.floor(open / 2) + 1} 格`;

  const st = $("status");
  const cls = (s) => (s === 1 ? "ta" : "tb");
  if (game.winner !== null) {
    st.innerHTML = game.winner === 0
      ? `<b>平局</b>，${a} : ${nb}。`
      : `<b class="${cls(game.winner)}">${NAME[game.winner]}获胜</b>，${a} : ${nb}。`;
  } else {
    const who = `<b class="${cls(game.turn)}">${NAME[game.turn]}</b>`;
    const doing = busy ? (botPlays() ? "思考中…" : "扩散中…") : "放泉";
    st.innerHTML = `第 ${game.round} / ${game.maxRounds} 轮 · ${who} ${doing}`;
  }
  document.body.dataset.turn = game.winner === null ? game.turn : 0;
}

$("new").addEventListener("click", newGame);
for (const id of ["size", "rounds", "walls", "rival", "inject"]) $(id).addEventListener("change", newGame);

newGame();
