// 把 diffusion.ts(唯一的规则源) + web/ 打成单文件 dist/index.html,双击即可打开。
// 无依赖:用 Node 自带的类型擦除。 运行: node build.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

process.removeAllListeners("warning"); // stripTypeScriptTypes 的 ExperimentalWarning

const root = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");

const engine = stripTypeScriptTypes(read("diffusion.ts"), { mode: "strip" });
const html = read("web/index.html")
  .replace("/*__CSS__*/", () => read("web/style.css"))
  .replace("/*__ENGINE__*/", () => engine)
  .replace("/*__APP__*/", () => read("web/app.js"));

mkdirSync(join(root, "dist"), { recursive: true });
writeFileSync(join(root, "dist/index.html"), html);
console.log(`dist/index.html  ${(html.length / 1024).toFixed(1)} KB`);
