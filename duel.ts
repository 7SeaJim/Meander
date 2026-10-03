/**
 * 擴散對戰(草案 2)— 兩層水 + 倍數奪格
 *
 * 兩方各有一層水,每層都是一塊 Ver.1.1 的 DiffusionBoard,互不干擾地擴散;
 * 牆對兩層相同。同一格可以同時有兩方的水。
 *
 * 歸屬只在盤面靜止時結算,對每一格(己方值 x、對方值 y):
 *  - x > 0 且 x ≥ ratio·y  → 歸己方(y = 0 時任何正值即可佔領)
 *  - 雙方都不滿足           → sticky 時維持原主,否則變為無主
 * 即:要從對方手裡奪格,或拿下雙方都有水的爭奪格,須達到對方的 ratio 倍。
 *
 * 對局:每回合固定 perTurn 個泉,可放在任意幾個合法格(非牆、無泉、非對方佔領格)。
 * 泉注入時把己方那一層的該格重置為 9。一輪(雙方各一回合)結束時佔領過半者勝;
 * 否則打滿 maxRounds 後比佔領格數。
 *
 * 注入時機(InjectMode):
 *  - "round" 雙方都放完後一起注入一次(預設)
 *  - "all"   每回合之後全部泉注入
 *  - "mine"  每回合之後只注入落子方的泉
 */

import { DiffusionBoard, WALL } from "./diffusion.ts";
import type { Pos, StepResult, Strategy } from "./diffusion.ts";

export type Side = 1 | -1;
export type Owner = Side | 0;
export type InjectMode = "all" | "mine" | "round";

export interface Spring extends Pos { side: Side }
export interface DuelStep extends StepResult { side: Side }

export interface DuelOptions {
  maxRounds?: number;
  perTurn?: number;
  ratio?: number;
  sticky?: boolean;
  inject?: InjectMode;
  walls?: Pos[];
  strategy?: Strategy;
}

export const SPRING_VALUE = 9;

export class DuelGame {
  readonly rows: number;
  readonly cols: number;
  readonly maxRounds: number;
  readonly perTurn: number;
  readonly ratio: number;
  readonly sticky: boolean;
  readonly inject: InjectMode;
  readonly strategy: Strategy;

  private orange: DiffusionBoard;
  private cyan: DiffusionBoard;
  private owners: Owner[];

  springs: Spring[] = [];
  turn: Side = 1;
  round = 1;
  /** 本回合還能放幾個泉 */
  left: number;
  /** null 未結束;0 平局 */
  winner: Owner | null = null;
  /** 累計易主次數(從一方直接到另一方) */
  captures = 0;

  constructor(rows: number, cols: number, opts: DuelOptions = {}) {
    this.rows = rows;
    this.cols = cols;
    this.maxRounds = opts.maxRounds ?? 8;
    this.perTurn = opts.perTurn ?? 2;
    this.ratio = opts.ratio ?? 2;
    this.sticky = opts.sticky ?? true;
    this.inject = opts.inject ?? "round";
    this.strategy = opts.strategy ?? "fifo";
    this.orange = new DiffusionBoard(rows, cols);
    this.cyan = new DiffusionBoard(rows, cols);
    this.owners = new Array(rows * cols).fill(0);
    this.left = this.perTurn;
    for (const w of opts.walls ?? []) {
      this.orange.set(w.r, w.c, WALL);
      this.cyan.set(w.r, w.c, WALL);
    }
  }

  clone(): DuelGame {
    const g = new DuelGame(this.rows, this.cols, {
      maxRounds: this.maxRounds, perTurn: this.perTurn, ratio: this.ratio,
      sticky: this.sticky, inject: this.inject, strategy: this.strategy,
    });
    g.orange = this.orange.clone();
    g.cyan = this.cyan.clone();
    g.owners = this.owners.slice();
    g.springs = this.springs.slice();
    g.turn = this.turn;
    g.round = this.round;
    g.left = this.left;
    g.winner = this.winner;
    g.captures = this.captures;
    return g;
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

  springAt(r: number, c: number): Spring | undefined {
    return this.springs.find(s => s.r === r && s.c === c);
  }

  canPlace(r: number, c: number, side: Side = this.turn): boolean {
    if (this.winner !== null || this.left <= 0 || this.isWall(r, c)) return false;
    if (this.springAt(r, c)) return false;
    return this.owner(r, c) !== -side;
  }

  legalCells(side: Side = this.turn): Pos[] {
    const out: Pos[] = [];
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++)
        if (this.canPlace(r, c, side)) out.push({ r, c });
    return out;
  }

  /** 把泉所在格重置為 9;給 side 則只注入該方的泉 */
  injectSprings(side?: Side): void {
    for (const s of this.springs)
      if (side === undefined || s.side === side)
        this.layer(s.side).set(s.r, s.c, SPRING_VALUE);
  }

  /**
   * 放一個泉。本回合的泉放完(left 歸零,或已無合法格)時按注入時機注入;
   * 之後盤面需沉降(逐步 step 做動畫,或 settle),再調 endTurn。
   */
  place(r: number, c: number): boolean {
    if (!this.canPlace(r, c)) return false;
    this.springs.push({ r, c, side: this.turn });
    this.left--;
    if (this.left > 0 && this.legalCells().length === 0) this.left = 0;
    if (this.left === 0) {
      if (this.inject === "all") this.injectSprings();
      else if (this.inject === "mine") this.injectSprings(this.turn);
      else if (this.turn === -1) this.injectSprings();
    }
    return true;
  }

  /** 兩層各自擴散;每步取主格值較大的那一層,只為讓動畫交錯 */
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

  /** 靜止時結算歸屬(倍數奪格) */
  resolveOwners(): void {
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) {
        if (this.isWall(r, c)) continue;
        const i = r * this.cols + c;
        const a = this.orange.get(r, c), b = this.cyan.get(r, c);
        const wantA = a > 0 && a >= this.ratio * b;
        const wantB = b > 0 && b >= this.ratio * a;
        const cur = this.owners[i];
        const next: Owner =
          wantA === wantB ? (this.sticky ? cur : 0) : wantA ? 1 : -1;
        if (cur !== 0 && next === -cur) this.captures++;
        this.owners[i] = next;
      }
  }

  /** 盤面靜止後調用:結算歸屬、判定勝負、換手 */
  endTurn(): void {
    this.resolveOwners();
    const { a, b, open } = this.count();
    const byCount = (): Owner => (a > b ? 1 : b > a ? -1 : 0);
    if (this.turn === -1) {
      if (a * 2 > open) this.winner = 1;
      else if (b * 2 > open) this.winner = -1;
      else if (this.round >= this.maxRounds) this.winner = byCount();
      else this.round++;
    }
    if (this.winner !== null) return;
    this.turn = this.turn === 1 ? -1 : 1;
    this.left = this.perTurn;
    if (this.legalCells().length === 0) this.winner = byCount();
  }

  /** 不要動畫時:放一個泉,回合放完就沉降並換手 */
  play(r: number, c: number): boolean {
    if (!this.place(r, c)) return false;
    if (this.left === 0) {
      this.settle();
      this.endTurn();
    }
    return true;
  }

  /** 假設此刻全部泉注入並沉降,side 一方的格數差(預演,不改本局) */
  preview(side: Side): number {
    const g = this.clone();
    g.injectSprings();
    g.settle();
    g.resolveOwners();
    const { a, b } = g.count();
    return side * (a - b);
  }
}

/** 貪心:為當前這一個泉選預演格數差最大的位置,同分隨機 */
export function greedyMove(game: DuelGame, random: () => number = Math.random): Pos | null {
  const side = game.turn;
  let best: Pos[] = [], bestScore = -Infinity;
  for (const cell of game.legalCells()) {
    const g = game.clone();
    g.springs.push({ ...cell, side });
    const score = g.preview(side);
    if (score > bestScore) { bestScore = score; best = [cell]; }
    else if (score === bestScore) best.push(cell);
  }
  return best.length ? best[Math.floor(random() * best.length)] : null;
}
