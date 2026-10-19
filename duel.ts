/**
 * 擴散對戰(草案 4)— 分配泉量 + 兩層水 + 3×3 奪格
 *
 * 兩方各有一層水,每層都是一塊用 Ver.2 鄰域規則的 DiffusionBoard,互不干擾地擴散;
 * 牆對兩層相同。同一格可以同時有兩方的水。
 *
 * 回合:每回合得到 budget 個泉,自由分配 —— 每放 1 個泉,該格己方水量 +1(單格上限 9)。
 * 可以全壓在一格,也可以每格放 1,或任意拆分。不能放在牆或對方佔領的格上。
 * 確認後只有落子方那一層擴散到靜止(泉是一次性倒下的水,之後不再補)。
 *
 * 歸屬在盤面靜止時結算,只有有水的格才有主(沒有任何一方水的格永遠無主,誰都能放):
 * 比較該格 3×3 範圍內(含本格)雙方的水量總和,多的一方佔有(對方多則被吃);
 * 相等則僵持,維持原主(原本無主的仍無主)。
 * resolve = "round" 時一輪(雙方各一回合)結束才結算;"turn" 時每回合結束都結算。
 * alternate 時每輪交換先手(橙青、青橙、橙青……),否則每輪都是橙先。
 *
 * 一輪結束時佔領過半者勝;否則打滿 maxRounds 後比佔領格數。
 */

import { DiffusionBoard, WALL } from "./diffusion.ts";
import type { Pos, Rule, StepResult, Strategy } from "./diffusion.ts";

export type Side = 1 | -1;
export type Owner = Side | 0;
export type ResolveMode = "round" | "turn";

export interface DuelStep extends StepResult { side: Side }

export interface DuelOptions {
  maxRounds?: number;
  budget?: number;
  resolve?: ResolveMode;
  alternate?: boolean;
  rule?: Rule;
  walls?: Pos[];
  strategy?: Strategy;
}

export const CELL_MAX = 9;

export class DuelGame {
  readonly rows: number;
  readonly cols: number;
  readonly maxRounds: number;
  readonly budget: number;
  readonly resolve: ResolveMode;
  readonly alternate: boolean;
  readonly rule: Rule;
  readonly strategy: Strategy;

  private orange: DiffusionBoard;
  private cyan: DiffusionBoard;
  private owners: Owner[];

  turn: Side = 1;
  round = 1;
  /** 本回合還剩幾個泉 */
  left: number;
  /** 本回合已放的泉,逐個記錄,供撤回 */
  placed: Pos[] = [];
  /** null 未結束;0 平局 */
  winner: Owner | null = null;
  /** 累計易主次數(從一方直接到另一方) */
  captures = 0;

  constructor(rows: number, cols: number, opts: DuelOptions = {}) {
    this.rows = rows;
    this.cols = cols;
    this.maxRounds = opts.maxRounds ?? 12;
    this.budget = opts.budget ?? 9;
    this.resolve = opts.resolve ?? "round";
    this.alternate = opts.alternate ?? true;
    this.rule = opts.rule ?? "block";
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
      maxRounds: this.maxRounds, budget: this.budget,
      resolve: this.resolve, alternate: this.alternate, rule: this.rule, strategy: this.strategy,
    });
    g.orange = this.orange.clone();
    g.cyan = this.cyan.clone();
    g.owners = this.owners.slice();
    g.turn = this.turn;
    g.round = this.round;
    g.left = this.left;
    g.placed = this.placed.slice();
    g.winner = this.winner;
    g.captures = this.captures;
    return g;
  }

  /** 該輪的先手 */
  firstOf(round: number): Side {
    return this.alternate && round % 2 === 0 ? -1 : 1;
  }

  private layer(side: Side): DiffusionBoard {
    return side === 1 ? this.orange : this.cyan;
  }

  isWall(r: number, c: number): boolean { return this.orange.get(r, c) === WALL; }

  /** side 一方在該格的水量(牆為 0) */
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

  /** 本回合在該格已放了幾個泉 */
  placedAt(r: number, c: number): number {
    return this.placed.filter(p => p.r === r && p.c === c).length;
  }

  canAdd(r: number, c: number): boolean {
    if (this.winner !== null || this.left <= 0 || this.isWall(r, c)) return false;
    if (this.owner(r, c) === -this.turn) return false;
    return this.value(r, c, this.turn) < CELL_MAX;
  }

  legalCells(): Pos[] {
    const out: Pos[] = [];
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++)
        if (this.canAdd(r, c)) out.push({ r, c });
    return out;
  }

  /** 在該格放 1 個泉(己方水量 +1) */
  add(r: number, c: number): boolean {
    if (!this.canAdd(r, c)) return false;
    const b = this.layer(this.turn);
    b.set(r, c, b.get(r, c) + 1);
    this.placed.push({ r, c });
    this.left--;
    return true;
  }

  /** 收回本回合放在該格的 1 個泉;不給座標則收回最後放的那個 */
  take(r?: number, c?: number): boolean {
    let i = this.placed.length - 1;
    if (r !== undefined) while (i >= 0 && (this.placed[i].r !== r || this.placed[i].c !== c)) i--;
    if (i < 0) return false;
    const [p] = this.placed.splice(i, 1);
    const b = this.layer(this.turn);
    b.set(p.r, p.c, b.get(p.r, p.c) - 1);
    this.left++;
    return true;
  }

  /** 落子方那一層擴散一步;已靜止返回 null */
  step(): DuelStep | null {
    const res = this.layer(this.turn).step(this.strategy);
    return res ? { ...res, side: this.turn } : null;
  }

  settle(): number {
    return this.layer(this.turn).settle(this.strategy).length;
  }

  /** side 一方在該格 3×3 範圍內(含本格)的水量總和 */
  blockSum(r: number, c: number, side: Side): number {
    const b = this.layer(side);
    return b.get(r, c) + b.neighborhoodSum(r, c);
  }

  /** 靜止時結算歸屬:只有有水的格才有主;3×3 內水多的一方佔有,相等僵持 */
  resolveOwners(): void {
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
  }

  /** 盤面靜止後調用:結算歸屬、判定勝負、換手。沒用完的泉作廢 */
  endTurn(): void {
    const closing = this.turn === -this.firstOf(this.round); // 本輪後手下完,一輪結束
    if (this.resolve === "turn" || closing) this.resolveOwners();
    const { a, b, open } = this.count();
    const byCount = (): Owner => (a > b ? 1 : b > a ? -1 : 0);
    if (closing) {
      if (a * 2 > open) this.winner = 1;
      else if (b * 2 > open) this.winner = -1;
      else if (this.round >= this.maxRounds) this.winner = byCount();
      else this.round++;
    }
    if (this.winner !== null) return;
    this.turn = closing ? this.firstOf(this.round) : this.turn === 1 ? -1 : 1;
    this.left = this.budget;
    this.placed = [];
  }

  /** 不要動畫時:按 cells 逐個放泉(可重複同一格),然後沉降並換手 */
  playTurn(cells: Pos[]): void {
    for (const p of cells) this.add(p.r, p.c);
    this.settle();
    this.endTurn();
  }

  /** 假設此刻確認並結算,當前方的格數差(預演,不改本局) */
  preview(): number {
    const g = this.clone();
    g.settle();
    g.resolveOwners();
    const { a, b } = g.count();
    return this.turn * (a - b);
  }
}

/**
 * 貪心:分別試「每堆 9 / 3 / 1 個泉」三種拆法,每一堆都放到預演格數差最大的格,
 * 最後取三種拆法裡結果最好的。返回本回合要放的格(同一格重複 = 疊放)。
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
        if (g.value(cell.r, cell.c, g.turn) + size > CELL_MAX) continue;
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
