/**
 * 擴散對戰(草案 5)— 同時落子 + 兩層水 + 3×3 奪格
 *
 * 兩方各有一層水,每層都是一塊用 Ver.2 鄰域規則的 DiffusionBoard,互不干擾地擴散;
 * 牆對兩層相同。同一格可以同時有兩方的水。
 *
 * 每輪雙方同時落子:各得 budget 個泉,自由分配 —— 每放 1 個泉,該格己方水量 +1
 * (單格上限 9)。可以全壓在一格,也可以每格放 1,或任意拆分。不能放在牆或對方佔領的格上。
 * 放的泉先記為「待放」,彼此看不見;雙方都確認後一起揭曉,兩層水一起擴散到靜止,然後結算。
 * 泉是一次性倒下的水,之後不再補。
 *
 * 歸屬只有有水的格才有(沒有任何一方水的格永遠無主,誰都能放):
 * 比較該格 3×3 範圍內(含本格)雙方的水量總和,多的一方佔有(對方多則被吃);
 * 相等則僵持,維持原主(原本無主的仍無主)。
 * 被吃時,輸的一方留在該格的水(capture):
 *  - "keep"    不動,只換主人(於是會出現「佔了一格、格裡卻沒有自己的水」)
 *  - "remove"  清掉;若贏的一方在該格也沒有水,這格變回無主空地(預設)
 *  - "convert" 換邊,併入贏的一方(單格上限 9)
 *
 * 結算後佔領過半者勝;否則打滿 maxRounds 後比佔領格數。
 */

import { DiffusionBoard, WALL } from "./diffusion.ts";
import type { Pos, Rule, StepResult, Strategy } from "./diffusion.ts";

export type Side = 1 | -1;
export type Owner = Side | 0;
/** place:輪到 turn 一方落子;flow:已揭曉,兩層水擴散中 */
export type Phase = "place" | "flow";
export type CaptureMode = "keep" | "remove" | "convert";

export interface DuelStep extends StepResult { side: Side }

export interface DuelOptions {
  maxRounds?: number;
  budget?: number;
  rule?: Rule;
  capture?: CaptureMode;
  walls?: Pos[];
  strategy?: Strategy;
}

export const CELL_MAX = 9;

export class DuelGame {
  readonly rows: number;
  readonly cols: number;
  readonly maxRounds: number;
  /** 每輪泉數(教學關可逐關調整) */
  budget: number;
  readonly rule: Rule;
  readonly capture: CaptureMode;
  readonly strategy: Strategy;

  private orange: DiffusionBoard;
  private cyan: DiffusionBoard;
  private owners: Owner[];
  /** 本輪各方的待放泉(逐個記錄,同一格重複 = 疊放) */
  private pending: Record<Side, Pos[]> = { 1: [], [-1]: [] };

  phase: Phase = "place";
  /** 落子階段輪到誰(輸入順序固定橙先青後,但彼此看不見,等同同時) */
  turn: Side = 1;
  round = 1;
  /** 當前落子方還剩幾個泉 */
  left: number;
  /** 最近一次揭曉時雙方放的泉 */
  revealed: Record<Side, Pos[]> = { 1: [], [-1]: [] };
  /** null 未結束;0 平局 */
  winner: Owner | null = null;
  /** 累計易主次數(從一方直接到另一方) */
  captures = 0;

  constructor(rows: number, cols: number, opts: DuelOptions = {}) {
    this.rows = rows;
    this.cols = cols;
    this.maxRounds = opts.maxRounds ?? 12;
    this.budget = opts.budget ?? 9;
    this.rule = opts.rule ?? "block";
    this.capture = opts.capture ?? "remove";
    this.strategy = opts.strategy ?? "fifo";
    this.orange = new DiffusionBoard(rows, cols, undefined, this.rule);
    this.cyan = new DiffusionBoard(rows, cols, undefined, this.rule);
    this.owners = new Array(rows * cols).fill(0);
    this.left = this.budget;
    for (const w of opts.walls ?? []) {
      this.orange.set(w.r, w.c, WALL);
      this.cyan.set(w.r, w.c, WALL);
    }
  }

  clone(): DuelGame {
    const g = new DuelGame(this.rows, this.cols, {
      maxRounds: this.maxRounds, budget: this.budget, rule: this.rule,
      capture: this.capture, strategy: this.strategy,
    });
    g.orange = this.orange.clone();
    g.cyan = this.cyan.clone();
    g.owners = this.owners.slice();
    g.pending = { 1: this.pending[1].slice(), [-1]: this.pending[-1].slice() };
    g.phase = this.phase;
    g.turn = this.turn;
    g.round = this.round;
    g.left = this.left;
    g.revealed = this.revealed;
    g.winner = this.winner;
    g.captures = this.captures;
    return g;
  }

  private layer(side: Side): DiffusionBoard {
    return side === 1 ? this.orange : this.cyan;
  }

  isWall(r: number, c: number): boolean { return this.orange.get(r, c) === WALL; }

  /** side 一方在該格已落定的水量(不含待放;牆為 0) */
  value(r: number, c: number, side: Side): number {
    return this.isWall(r, c) ? 0 : this.layer(side).get(r, c);
  }

  owner(r: number, c: number): Owner { return this.owners[r * this.cols + c]; }

  /** 各方佔領格數;open 為非牆格總數 */
  count(): { a: number; b: number; open: number } {
    let a = 0, b = 0, open = 0;
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) {
        if (this.isWall(r, c)) continue;
        open++;
        const o = this.owner(r, c);
        if (o === 1) a++;
        else if (o === -1) b++;
      }
    return { a, b, open };
  }

  /** 當前落子方本輪的待放泉 */
  get placed(): Pos[] { return this.pending[this.turn]; }

  /** 當前落子方本輪在該格放了幾個泉 */
  placedAt(r: number, c: number): number {
    return this.placed.filter(p => p.r === r && p.c === c).length;
  }

  canAdd(r: number, c: number): boolean {
    if (this.winner !== null || this.phase !== "place" || this.left <= 0) return false;
    if (this.isWall(r, c) || this.owner(r, c) === -this.turn) return false;
    return this.value(r, c, this.turn) + this.placedAt(r, c) < CELL_MAX;
  }

  legalCells(): Pos[] {
    const out: Pos[] = [];
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++)
        if (this.canAdd(r, c)) out.push({ r, c });
    return out;
  }

  /** 放 1 個待放泉 */
  add(r: number, c: number): boolean {
    if (!this.canAdd(r, c)) return false;
    this.placed.push({ r, c });
    this.left--;
    return true;
  }

  /** 收回本輪放在該格的 1 個泉;不給座標則收回最後放的那個 */
  take(r?: number, c?: number): boolean {
    if (this.phase !== "place") return false;
    const list = this.placed;
    let i = list.length - 1;
    if (r !== undefined) while (i >= 0 && (list[i].r !== r || list[i].c !== c)) i--;
    if (i < 0) return false;
    list.splice(i, 1);
    this.left++;
    return true;
  }

  private pour(side: Side): void {
    const b = this.layer(side);
    for (const p of this.pending[side]) b.set(p.r, p.c, b.get(p.r, p.c) + 1);
  }

  /**
   * 當前一方確認(沒用完的泉作廢)。橙方確認後輪到青方;青方確認後揭曉:
   * 雙方的待放泉一起倒進盤面,進入 flow,之後逐步 step 或 settle,再調 endRound。
   */
  commit(): void {
    if (this.phase !== "place" || this.winner !== null) return;
    if (this.turn === 1) {
      this.turn = -1;
      this.left = this.budget;
      return;
    }
    this.pour(1);
    this.pour(-1);
    this.revealed = this.pending;
    this.pending = { 1: [], [-1]: [] };
    this.phase = "flow";
  }

  /** 兩層各自擴散;每步取主格值較大的那一層,只為讓動畫交錯。已靜止返回 null */
  step(): DuelStep | null {
    const pa = this.orange.pickSource(this.strategy);
    const pb = this.cyan.pickSource(this.strategy);
    if (!pa && !pb) return null;
    const side: Side =
      !pb || (pa && this.orange.get(pa.r, pa.c) >= this.cyan.get(pb.r, pb.c)) ? 1 : -1;
    const res = this.layer(side).step(this.strategy)!;
    return { ...res, side };
  }

  settle(): number {
    return this.orange.settle(this.strategy).length + this.cyan.settle(this.strategy).length;
  }

  /** 直接設定 side 一方在該格的水量(教學關佈局用) */
  setWater(side: Side, r: number, c: number, v: number): void {
    this.layer(side).set(r, c, v);
  }

  /** side 一方在該格 3×3 範圍內(含本格)的水量總和 */
  blockSum(r: number, c: number, side: Side): number {
    const b = this.layer(side);
    return b.get(r, c) + b.neighborhoodSum(r, c);
  }

  /** 靜止時結算歸屬:只有有水的格才有主;3×3 內水多的一方佔有,相等僵持 */
  resolveOwners(): void {
    // 先按結算前的水量逐格定歸屬(同時判定),再處理被吃的水
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) {
        if (this.isWall(r, c)) continue;
        const i = r * this.cols + c;
        const cur = this.owners[i];
        let next: Owner = 0;
        if (this.orange.get(r, c) > 0 || this.cyan.get(r, c) > 0) {
          const a = this.blockSum(r, c, 1), b = this.blockSum(r, c, -1);
          next = a > b ? 1 : b > a ? -1 : cur;
        }
        if (cur !== 0 && next === -cur) this.captures++;
        this.owners[i] = next;
      }
    if (this.capture === "keep") return;
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) {
        const i = r * this.cols + c, owner = this.owners[i];
        if (owner === 0 || this.isWall(r, c)) continue;
        const win = this.layer(owner), lose = this.layer(owner === 1 ? -1 : 1);
        const eaten = lose.get(r, c);
        if (eaten === 0) continue;
        lose.set(r, c, 0);
        if (this.capture === "convert") win.set(r, c, Math.min(CELL_MAX, win.get(r, c) + eaten));
        else if (win.get(r, c) === 0) this.owners[i] = 0;
      }
  }

  /** 揭曉後的盤面靜止時調用:結算歸屬、判定勝負、開始下一輪 */
  endRound(): void {
    if (this.phase !== "flow") return;
    this.resolveOwners();
    const { a, b, open } = this.count();
    if (a * 2 > open) this.winner = 1;
    else if (b * 2 > open) this.winner = -1;
    else if (this.round >= this.maxRounds) this.winner = a > b ? 1 : b > a ? -1 : 0;
    else this.round++;
    this.phase = "place";
    this.turn = 1;
    this.left = this.budget;
  }

  /** 不要動畫時:當前一方按 cells 逐個放泉並確認;若因此揭曉,就沉降並結算。返回擴散步數 */
  playTurn(cells: Pos[]): number {
    for (const p of cells) this.add(p.r, p.c);
    this.commit();
    if (this.phase !== "flow") return 0;
    const steps = this.settle();
    this.endRound();
    return steps;
  }

  /**
   * 預演:只倒入當前一方自己的待放泉、讓自己那層沉降,再結算,返回己方的格數差。
   * 看不到對方本輪的待放泉,所以電腦當後手也無法偷看。
   */
  preview(): number {
    const { a, b } = this.previewGame().game.count();
    return this.turn * (a - b);
  }

  /**
   * 演算:返回「當前一方的待放泉倒入、己方那層沉降、結算」之後的局面(不改本局),
   * 以及沉降的步數。對方本輪的待放泉不計入。
   */
  previewGame(): { game: DuelGame; steps: number } {
    const g = this.clone();
    const side = this.turn;
    g.pour(side);
    g.pending[side] = [];
    const steps = g.layer(side).settle(g.strategy).length;
    g.resolveOwners();
    return { game: g, steps };
  }
}

/**
 * 貪心:分別試「每堆 9 / 3 / 1 個泉」三種拆法,每一堆都放到預演格數差最大的格,
 * 最後取三種拆法裡結果最好的。返回本輪要放的格(同一格重複 = 疊放)。
 */
export function greedyTurn(game: DuelGame, random: () => number = Math.random): Pos[] {
  let bestPlan: Pos[] = [], bestScore = -Infinity;
  for (const stack of [9, 3, 1]) {
    const g = game.clone();
    const plan: Pos[] = [];
    while (g.left > 0) {
      const size = Math.min(stack, g.left);
      let cells: Pos[] = [], top = -Infinity;
      for (const cell of g.legalCells()) {
        if (g.value(cell.r, cell.c, g.turn) + g.placedAt(cell.r, cell.c) + size > CELL_MAX) continue;
        const t = g.clone();
        for (let i = 0; i < size; i++) t.add(cell.r, cell.c);
        const score = t.preview();
        if (score > top) { top = score; cells = [cell]; }
        else if (score === top) cells.push(cell);
      }
      if (!cells.length) break;
      const pick = cells[Math.floor(random() * cells.length)];
      for (let i = 0; i < size; i++) { g.add(pick.r, pick.c); plan.push(pick); }
    }
    const score = g.preview();
    if (score > bestScore) { bestScore = score; bestPlan = plan; }
  }
  return bestPlan;
}
