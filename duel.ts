/**
 * 擴散對戰(草案)— 帶符號的擴散
 *
 * 在 Ver.1.1 的成對擴散上只加一件事:數值帶符號。
 *  - 先手(橙)的水為正,後手(青)的水為負,每格 −9…9;牆另存,不佔數值
 *  - 主格 = |值| 最大的可擴散格;它按 上→右→下→左 找第一個
 *    「沿自己符號方向差 >1」的鄰格,搬運 floor(差/2)
 *  - 異色相鄰時差必 >1,搬運即抵消;靜止時兩方之間必隔至少一格 0(無主地帶)
 *  - 帶符號總和守恆、平方和嚴格遞減,停機證明與原規則相同
 *
 * 對局:輪流放泉(不可放在對方佔領格)→ 泉重置為 ±9 → 沉降。
 * 一輪結束時某方佔領過半即勝;否則打滿 maxRounds 後比佔領格數。
 *
 * 注入時機(InjectMode)尚未定稿,影響先手優勢:
 *  - "all"   每手之後全部泉注入(先手的泉永遠多注入一次)
 *  - "mine"  每手之後只有落子方的泉注入
 *  - "round" 雙方都落子後才一起注入一次(後手看得到先手的落點)
 */

export type Side = 1 | -1;
export type DuelStrategy = "scan" | "fifo" | "lifo";
export type InjectMode = "all" | "mine" | "round";

export interface Cell { r: number; c: number }
export interface DuelStep { src: Cell; dst: Cell; moved: number; side: Side }
export interface Spring extends Cell { side: Side }

export const SPRING_VALUE = 9;

const DUEL_DIRS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0], [0, 1], [1, 0], [0, -1],
];

export class DuelBoard {
  readonly rows: number;
  readonly cols: number;
  private v: number[];
  private wall: boolean[];
  private changed: number[];
  private clock = 1;

  constructor(rows: number, cols: number) {
    this.rows = rows;
    this.cols = cols;
    this.v = new Array(rows * cols).fill(0);
    this.wall = new Array(rows * cols).fill(false);
    this.changed = new Array(rows * cols).fill(0);
  }

  private idx(r: number, c: number): number { return r * this.cols + c; }

  get(r: number, c: number): number { return this.v[this.idx(r, c)]; }

  set(r: number, c: number, value: number): void {
    this.v[this.idx(r, c)] = value;
    this.changed[this.idx(r, c)] = this.clock++;
  }

  isWall(r: number, c: number): boolean { return this.wall[this.idx(r, c)]; }

  setWall(r: number, c: number, on = true): void {
    this.wall[this.idx(r, c)] = on;
    if (on) this.v[this.idx(r, c)] = 0;
  }

  /** 佔領者:1 橙、−1 青、0 無主(含牆) */
  owner(r: number, c: number): Side | 0 {
    const x = this.get(r, c);
    return x > 0 ? 1 : x < 0 ? -1 : 0;
  }

  clone(): DuelBoard {
    const b = new DuelBoard(this.rows, this.cols);
    b.v = this.v.slice();
    b.wall = this.wall.slice();
    b.changed = this.changed.slice();
    b.clock = this.clock;
    return b;
  }

  /** 各方佔領格數;open 為非牆格總數 */
  count(): { a: number; b: number; open: number } {
    let a = 0, b = 0, open = 0;
    for (let i = 0; i < this.v.length; i++) {
      if (this.wall[i]) continue;
      open++;
      if (this.v[i] > 0) a++;
      else if (this.v[i] < 0) b++;
    }
    return { a, b, open };
  }

  private target(r: number, c: number): Cell | null {
    const a = this.get(r, c);
    if (a === 0 || this.isWall(r, c)) return null;
    const s = a > 0 ? 1 : -1;
    for (const [dr, dc] of DUEL_DIRS) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || rr >= this.rows || cc < 0 || cc >= this.cols) continue;
      if (this.isWall(rr, cc)) continue;
      if (s * (a - this.get(rr, cc)) > 1) return { r: rr, c: cc };
    }
    return null;
  }

  /** 全盤選 |值| 最大的可擴散格,平手依策略 */
  pickSource(strategy: DuelStrategy): Cell | null {
    let best: { r: number; c: number; m: number; t: number } | null = null;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const m = Math.abs(this.get(r, c));
        if (best && m < best.m) continue;
        if (!this.target(r, c)) continue;
        const t = this.changed[this.idx(r, c)];
        if (!best || m > best.m) { best = { r, c, m, t }; continue; }
        if (strategy === "fifo" && t < best.t) best = { r, c, m, t };
        if (strategy === "lifo" && t > best.t) best = { r, c, m, t };
      }
    }
    return best ? { r: best.r, c: best.c } : null;
  }

  step(strategy: DuelStrategy = "fifo"): DuelStep | null {
    const src = this.pickSource(strategy);
    if (!src) return null;
    const dst = this.target(src.r, src.c)!;
    const a = this.get(src.r, src.c), b = this.get(dst.r, dst.c);
    const side: Side = a > 0 ? 1 : -1;
    const moved = Math.floor((side * (a - b)) / 2);
    this.set(src.r, src.c, a - side * moved);
    this.set(dst.r, dst.c, b + side * moved);
    return { src, dst, moved, side };
  }

  settle(strategy: DuelStrategy = "fifo", maxSteps = 1_000_000): DuelStep[] {
    const log: DuelStep[] = [];
    for (let i = 0; i < maxSteps; i++) {
      const s = this.step(strategy);
      if (!s) break;
      log.push(s);
    }
    return log;
  }
}

export class DuelGame {
  board: DuelBoard;
  springs: Spring[] = [];
  readonly maxRounds: number;
  readonly strategy: DuelStrategy;
  readonly inject: InjectMode;
  turn: Side = 1;
  round = 1;
  /** null 未結束;0 平局 */
  winner: Side | 0 | null = null;

  constructor(
    rows: number, cols: number, maxRounds = 10,
    walls: Cell[] = [], inject: InjectMode = "round", strategy: DuelStrategy = "fifo",
  ) {
    this.board = new DuelBoard(rows, cols);
    this.maxRounds = maxRounds;
    this.inject = inject;
    this.strategy = strategy;
    for (const w of walls) this.board.setWall(w.r, w.c);
  }

  clone(): DuelGame {
    const g = new DuelGame(
      this.board.rows, this.board.cols, this.maxRounds, [], this.inject, this.strategy);
    g.board = this.board.clone();
    g.springs = this.springs.slice();
    g.turn = this.turn;
    g.round = this.round;
    g.winner = this.winner;
    return g;
  }

  springAt(r: number, c: number): Spring | undefined {
    return this.springs.find(s => s.r === r && s.c === c);
  }

  canPlace(r: number, c: number, side: Side = this.turn): boolean {
    if (this.winner !== null || this.board.isWall(r, c)) return false;
    if (this.springAt(r, c)) return false;
    return this.board.owner(r, c) !== -side;
  }

  legalCells(side: Side = this.turn): Cell[] {
    const out: Cell[] = [];
    for (let r = 0; r < this.board.rows; r++)
      for (let c = 0; c < this.board.cols; c++)
        if (this.canPlace(r, c, side)) out.push({ r, c });
    return out;
  }

  /** 把泉重置為 ±9;給 side 則只注入該方的泉 */
  injectSprings(side?: Side): void {
    for (const s of this.springs)
      if (side === undefined || s.side === side)
        this.board.set(s.r, s.c, s.side * SPRING_VALUE);
  }

  /** 放泉並按注入時機注入。之後盤面需沉降(可逐步 step 做動畫),再調 endTurn */
  place(r: number, c: number): boolean {
    if (!this.canPlace(r, c)) return false;
    this.springs.push({ r, c, side: this.turn });
    if (this.inject === "all") this.injectSprings();
    else if (this.inject === "mine") this.injectSprings(this.turn);
    else if (this.turn === -1) this.injectSprings();
    return true;
  }

  /** 盤面靜止後調用:判定勝負、換手 */
  endTurn(): void {
    const { a, b, open } = this.board.count();
    const byCount = (): Side | 0 => (a > b ? 1 : b > a ? -1 : 0);
    if (this.turn === -1) {
      if (a * 2 > open) this.winner = 1;
      else if (b * 2 > open) this.winner = -1;
      else if (this.round >= this.maxRounds) this.winner = byCount();
      else this.round++;
    }
    if (this.winner !== null) return;
    this.turn = this.turn === 1 ? -1 : 1;
    if (this.legalCells().length === 0) this.winner = byCount();
  }

  /** 不要動畫時的一步到位 */
  play(r: number, c: number): boolean {
    if (!this.place(r, c)) return false;
    this.board.settle(this.strategy);
    this.endTurn();
    return true;
  }
}

/** 貪心一步:選放下後「己方格數 − 對方格數」最大的位置,同分隨機 */
export function greedyMove(game: DuelGame, random: () => number = Math.random): Cell | null {
  const side = game.turn;
  let best: Cell[] = [], bestScore = -Infinity;
  for (const cell of game.legalCells()) {
    const g = game.clone();
    g.play(cell.r, cell.c);
    if (game.inject === "round" && side === 1) { // 本手尚未注入,先預演一次才看得出好壞
      g.injectSprings();
      g.board.settle(g.strategy);
    }
    const { a, b } = g.board.count();
    const score = side * (a - b);
    if (score > bestScore) { bestScore = score; best = [cell]; }
    else if (score === bestScore) best.push(cell);
  }
  return best.length ? best[Math.floor(random() * best.length)] : null;
}
