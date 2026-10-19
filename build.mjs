// 把引擎(.ts,唯一的规则源) + web/ 打成自包含的单文件页面,双击即可打开。
// 无依赖:用 Node 自带的类型擦除。 运行: node build.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

process.removeAllListeners("warning"); // stripTypeScriptTypes 的 ExperimentalWarning

const root = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");

const PAGES = {
  "index.html": { engines: ["diffusion.ts"], app: "web/app.js", css: ["web/style.css"] },
  "duel.html": { engines: ["diffusion.ts", "duel.ts"], app: "web/duel.js", css: ["web/duel.css"] },
};

// 引擎之间的相对 import 在拼成一个模块后不再需要(名字已在同一作用域)
const engineJs = (file) =>
  stripTypeScriptTypes(read(file), { mode: "strip" }).replace(/^import\b[^;]*from "\.\/[^"]+";$/gm, "");

mkdirSync(join(root, "dist"), { recursive: true });
for (const [page, { engines, app, css }] of Object.entries(PAGES)) {
  const html = read(`web/${page}`)
    .replace("/*__CSS__*/", () => css.map(read).join("\n"))
    .replace("/*__ENGINE__*/", () => engines.map(engineJs).join("\n"))
    .replace("/*__APP__*/", () => read(app));
  writeFileSync(join(root, "dist", page), html);
  console.log(`dist/${page}  ${(html.length / 1024).toFixed(1)} KB`);
}
