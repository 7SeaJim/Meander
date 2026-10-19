// 把引擎(.ts,唯一的规则源) + web/ 打成自包含的单文件页面,双击即可打开。
// 无依赖:用 Node 自带的类型擦除。 运行: node build.mjs
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

process.removeAllListeners("warning"); // stripTypeScriptTypes 的 ExperimentalWarning

const root = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");

// 输出页面 -> 模板、引擎、界面脚本、样式。对弈页是首页,沙盘页另起一页,两页互链。
const PAGES = {
  "index.html": { template: "web/duel.html", engines: ["diffusion.ts", "duel.ts"], app: "web/duel.js", css: ["web/duel.css"] },
  "sandbox.html": { template: "web/index.html", engines: ["diffusion.ts"], app: "web/app.js", css: ["web/style.css"] },
};

// 引擎之间的相对 import 在拼成一个模块后不再需要(名字已在同一作用域)
const engineJs = (file) =>
  stripTypeScriptTypes(read(file), { mode: "strip" }).replace(/^import\b[^;]*from "\.\/[^"]+";$/gm, "");

rmSync(join(root, "dist/duel.html"), { force: true }); // 旧版文件名
mkdirSync(join(root, "dist"), { recursive: true });
for (const [page, { template, engines, app, css }] of Object.entries(PAGES)) {
  const html = read(template)
    .replace("/*__CSS__*/", () => css.map(read).join("\n"))
    .replace("/*__ENGINE__*/", () => engines.map(engineJs).join("\n"))
    .replace("/*__APP__*/", () => read(app));
  writeFileSync(join(root, "dist", page), html);
  console.log(`dist/${page}  ${(html.length / 1024).toFixed(1)} KB`);
}

// 发布到 claude.ai Artifact 用的主页面:去掉文档外壳(平台发布时会自己包上),内容与 dist/index.html 相同。
// 发布时把它作为主页面,dist/sandbox.html 作为附带页面,两页互链照常可用。
const bare = read("dist/index.html")
  .replace(/<!doctype html>\s*/i, "")
  .replace(/<\/?html[^>]*>\s*/g, "")
  .replace(/<\/?head>\s*/g, "")
  .replace(/<\/?body[^>]*>\s*/g, "")
  .replace(/<meta (charset|name="viewport")[^>]*>\s*/g, "");
mkdirSync(join(root, "dist/artifact"), { recursive: true });
rmSync(join(root, "dist/artifact/duel.html"), { force: true });
writeFileSync(join(root, "dist/artifact/index.html"), bare);
console.log(`dist/artifact/index.html  ${(bare.length / 1024).toFixed(1)} KB`);
