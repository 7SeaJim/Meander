# 扩散规则 Ver.1.1

规则与设计见 [规则书.md](规则书.md)。`diffusion.ts` 是规则引擎，也是代码里唯一的规则源；
`web/` 是它的网页界面。

```sh
npm run open    # 构建并在浏览器打开 dist/index.html
npm run build   # 只构建
npm run demo    # 命令行跑引擎自带的 demo
npm run verify  # 随机检验规则书「待验证」清单(稳态 vs 锥面预测 / 策略无关性)
```

需要 Node ≥ 22.13（用自带的类型擦除，无任何依赖）。`dist/index.html` 是自包含的单文件，
可直接双击打开或拷走。改了 `diffusion.ts` 或 `web/` 后重新 `npm run build`。

## 网页操作

- **画笔**：数字 0–9（键盘 `0`–`9`）、墙（`W`）、源（`S`）。数字和墙可拖动连画。
  「源」以当前数字把格子标记为注入点，再点一次取消标记。
- **演化**：单步（空格）、播放/暂停（回车）、沉降到底。最近一步的主格为实线框，
  客格为虚线框，箭头旁的数字是搬运量。
- **平手策略**：scan / fifo / lifo，对应引擎的 `Strategy`。
- **源与稳态**：「注入一次」把各源设回源值；「求稳态」调用 `steadyState()`。
  勾选「对比锥面预测」后，每格右下角显示 `conePrediction()` 的值，不符的格标红。

## 结构

- `build.mjs` 把擦除类型后的引擎与 `web/app.js` 拼进同一个 `<script type="module">`，
  所以 `app.js` 直接使用 `DiffusionBoard` 等名字，不写 import。
