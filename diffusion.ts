/**
 * 擴散規則 Ver.1.1 — TypeScript 引擎
 *
 * 規則:
 *  - 每格存 0–9,WALL(-1) 為牆
 *  - 一次擴散 = 一對格子:主格依 上→右→下→左 找第一個差 >1 的鄰居,
 *    搬運 floor((a-b)/2) 使差 ≤1
 *  - 每次擴散後重新全盤選值最大的可擴散格;同值平手由調度策略決定
 *  - 無可擴散格時演化結束
 *
 * 附帶:
 *  - steadyState(): 反覆注入直到不動點(吸引子)
 *  - conePrediction(): 「源強度 − 測地距離」錐面預測,用於驗證穩態假設
 *
 * 運行: npx tsx diffusion.ts   (或 deno run diffusion.ts / Node ≥22 --experimental-strip-types)
 */

export const WALL = -1;

export type Strategy = "scan" | "fifo" | "lifo";

export interface Pos { r: number; c: number }

export interface StepResult {
  src: Pos;
  dst: Pos;
  moved: number;      // 本次搬運量
}

export interface Source { pos: Pos; value: number }

/** 上→右→下→左,規則 3 的固定順序 */
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0], [0, 1], [1, 0], [0, -1],
];

export class DiffusionBoard {
  readonly rows: number;
  readonly cols: number;
  private grid: number[];      // 扁平存儲 r*cols+c
  private changed: number[];   // 每格最後變動的邏輯時鐘,供 FIFO/LIFO 平手裁決
  private clock = 1;

  constructor(rows: number, cols: number, init?: number[][]) {
    this.rows = rows;
    this.cols = cols;
    this.grid = new Array(rows * cols).fill(0);
    this.changed = new Array(rows * cols).fill(0);
    if (init) {
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) this.set(r, c, init[r][c]);
    }
  }

  private idx(r: number, c: number): number { return r * this.cols + c; }

  get(r: number, c: number): number { return this.grid[this.idx(r, c)]; }

  set(r: number, c: number, v: number): void {
    this.grid[this.idx(r, c)] = v;
    this.changed[this.idx(r, c)] = this.clock++;
  }

  clone(): DiffusionBoard {
    const b = new DiffusionBoard(this.rows, this.cols);
    b.grid = this.grid.slice();
    b.changed = this.changed.slice();
    b.clock = this.clock;
    return b;
  }

  toMatrix(): number[][] {
    const m: number[][] = [];
    for (let r = 0; r < this.rows; r++)
      m.push(this.grid.slice(r * this.cols, (r + 1) * this.cols));
    return m;
  }

  equals(other: DiffusionBoard): boolean {
    return this.grid.length === other.grid.length &&
      this.grid.every((v, i) => v === other.grid[i]);
  }

  private inBounds(r: number, c: number): boolean {
    return r >= 0 && r < this.rows && c >= 0 && c < this.cols;
  }

  /** 可擴散:存在非牆鄰居使 a − b > 1 */
  isDiffusible(r: number, c: number): boolean {
    const a = this.get(r, c);
    if (a === WALL) return false;
    for (const [dr, dc] of DIRS) {
      const rr = r + dr, cc = c + dc;
      if (!this.inBounds(rr, cc)) continue;
      const b = this.get(rr, cc);
      if (b !== WALL && a - b > 1) return true;
    }
    return false;
  }

  /** 規則 6+7:全盤選值最大的可擴散格,平手依策略 */
  pickSource(strategy: Strategy): Pos | null {
    let best: { r: number; c: number; v: number; t: number } | null = null;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (!this.isDiffusible(r, c)) continue;
        const v = this.get(r, c);
        const t = this.changed[this.idx(r, c)];
        if (!best || v > best.v) { best = { r, c, v, t }; continue; }
        if (v < best.v) continue;
        // 同值平手
        if (strategy === "fifo" && t < best.t) best = { r, c, v, t };
        if (strategy === "lifo" && t > best.t) best = { r, c, v, t };
        // scan:先掃到者(行優先)已是 best,不換
      }
    }
    return best ? { r: best.r, c: best.c } : null;
  }

  /** 執行一次成對擴散;無可擴散格時返回 null */
  step(strategy: Strategy = "fifo"): StepResult | null {
    const src = this.pickSource(strategy);
    if (!src) return null;
    const a = this.get(src.r, src.c);
    for (const [dr, dc] of DIRS) {
      const rr = src.r + dr, cc = src.c + dc;
      if (!this.inBounds(rr, cc)) continue;
      const b = this.get(rr, cc);
      if (b === WALL || a - b <= 1) continue;
      const moved = Math.floor((a - b) / 2);   // while(a-b>1){a--;b++} 的閉式解
      this.set(src.r, src.c, a - moved);
      this.set(rr, cc, b + moved);
      return { src, dst: { r: rr, c: cc }, moved };
    }
    return null; // 理論上不可達:isDiffusible 已保證有方向
  }

  /** 跑到演化結束,返回全部步驟(可作 combo 計分或動畫腳本) */
  settle(strategy: Strategy = "fifo", maxSteps = 1_000_000): StepResult[] {
    const log: StepResult[] = [];
    for (let i = 0; i < maxSteps; i++) {
      const s = this.step(strategy);
      if (!s) break;
      log.push(s);
    }
    return log;
  }

  /**
   * 吸引子:反覆「把各源格設回源值 → settle」直到盤面不動。
   * 對應你的觀察:同一格反覆放同一個數,極限形態容易算。
   */
  steadyState(
    sources: Source[],
    strategy: Strategy = "fifo",
    maxRounds = 500,
  ): { board: number[][]; rounds: number; converged: boolean } {
    for (let round = 1; round <= maxRounds; round++) {
      const before = this.clone();
      for (const s of sources) this.set(s.pos.r, s.pos.c, s.value);
      this.settle(strategy);
      // 收斂判據:注入+沉降後盤面與上一輪相同
      const probe = this.clone();
      for (const s of sources) probe.set(s.pos.r, s.pos.c, s.value);
      probe.settle(strategy);
      if (probe.equals(this)) {
        return { board: this.toMatrix(), rounds: round, converged: true };
      }
      if (before.equals(this)) {
        return { board: this.toMatrix(), rounds: round, converged: true };
      }
    }
    return { board: this.toMatrix(), rounds: maxRounds, converged: false };
  }
}

/* ------------------------------------------------------------------ */
/* 錐面預測:穩態假設「格值 = max over 源 (源強度 − 測地距離)」        */
/* ------------------------------------------------------------------ */

/** BFS 測地距離(繞牆),不可達為 Infinity */
export function geodesicDistance(
  walls: boolean[][], from: Pos,
): number[][] {
  const rows = walls.length, cols = walls[0].length;
  const dist = walls.map(row => row.map(() => Infinity));
  const q: Pos[] = [from];
  dist[from.r][from.c] = 0;
  while (q.length) {
    const { r, c } = q.shift()!;
    for (const [dr, dc] of DIRS) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
      if (walls[rr][cc] || dist[rr][cc] !== Infinity) continue;
      dist[rr][cc] = dist[r][c] + 1;
      q.push({ r: rr, c: cc });
    }
  }
  return dist;
}

/** 逐點取各源錐面的 max,牆為 WALL,低於 0 截為 0 */
export function conePrediction(
  rows: number, cols: number, walls: boolean[][], sources: Source[],
): number[][] {
  const pred = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => (walls[r][c] ? WALL : 0)),
  );
  for (const s of sources) {
    const d = geodesicDistance(walls, s.pos);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        if (walls[r][c]) continue;
        const v = s.value - d[r][c];
        if (v > pred[r][c]) pred[r][c] = v;
      }
  }
  return pred;
}

/** 比較穩態與錐面預測,返回不一致的格子(驗證假設用) */
export function diffBoards(a: number[][], b: number[][]): Pos[] {
  const out: Pos[] = [];
  for (let r = 0; r < a.length; r++)
    for (let c = 0; c < a[0].length; c++)
      if (a[r][c] !== b[r][c]) out.push({ r, c });
  return out;
}

/* ------------------------------------------------------------------ */
/* Demo:直接運行本文件時執行                                          */
/* ------------------------------------------------------------------ */

function fmt(m: number[][]): string {
  return m.map(row =>
    row.map(v => (v === WALL ? "✕" : String(v))).join(" "),
  ).join("\n");
}

function demo(): void {
  const rows = 5, cols = 5;
  const walls = Array.from({ length: rows }, () => Array(cols).fill(false));
  walls[1][2] = walls[2][2] = walls[3][2] = true; // 一道豎牆,留上下缺口? 上缺口 (0,2) 通

  const init = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => (walls[r][c] ? WALL : 0)),
  );

  const src: Source = { pos: { r: 2, c: 0 }, value: 9 };

  for (const strat of ["scan", "fifo", "lifo"] as Strategy[]) {
    const board = new DiffusionBoard(rows, cols, init);
    const { board: steady, rounds, converged } =
      board.steadyState([src], strat, 200);
    console.log(`\n=== 策略 ${strat} — ${rounds} 輪${converged ? "收斂" : "未收斂"} ===`);
    console.log(fmt(steady));
  }

  const pred = conePrediction(rows, cols, walls, [src]);
  console.log("\n=== 錐面預測(源強度 − 測地距離) ===");
  console.log(fmt(pred));

  const board = new DiffusionBoard(rows, cols, init);
  const steady = board.steadyState([src], "fifo").board;
  const mismatch = diffBoards(steady, pred);
  console.log(
    mismatch.length === 0
      ? "\n假設成立:FIFO 穩態 ≡ 錐面預測"
      : `\n有 ${mismatch.length} 格不符:${mismatch.map(p => `(${p.r},${p.c})`).join(" ")}`,
  );
}

// 直接執行時跑 demo(作為模塊 import 時不跑)
const isMain = typeof process !== "undefined" &&
  process.argv[1]?.endsWith("diffusion.ts");
if (isMain) demo();
