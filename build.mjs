// 把引擎(.ts,唯一的规则源) + web/ 打成自包含的单文件页面,双击即可打开。
// 无依赖:用 Node 自带的类型擦除。 运行: node build.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

process.removeAllListeners("warning"); // stripTypeScriptTypes 的 ExperimentalWarning

const root = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");

// 页面 -> [引擎, 界面脚本, 样式...]
const PAGES = {
  "index.html": ["diffusion.ts", "web/app.js", "web/style.css"],
  "duel.html": ["duel.ts", "web/duel.js", "web/style.css", "web/duel.css"],
};

mkdirSync(join(root, "dist"), { recursive: true });
for (const [page, [engine, app, ...css]] of Object.entries(PAGES)) {
  const html = read(`web/${page}`)
    .replace("/*__CSS__*/", () => css.map(read).join("\n"))
    .replace("/*__ENGINE__*/", () => stripTypeScriptTypes(read(engine), { mode: "strip" }))
    .replace("/*__APP__*/", () => read(app));
  writeFileSync(join(root, "dist", page), html);
  console.log(`dist/${page}  ${(html.length / 1024).toFixed(1)} KB`);
}
