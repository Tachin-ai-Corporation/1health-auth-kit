#!/usr/bin/env node
// Docs robustness checks. Exit 1 on any failure.
//
// 1. Template copies in the white papers. A fenced code block whose previous non-blank line is
//      <!-- template: <path under skill/1health-launch-sso/templates/> -->
//    must equal that template file byte for byte (ignoring one trailing newline). `--write` rewrites the blocks
//    from the templates instead of failing.
// 2. Skill self-containment. The skill directory is installed alone (~/.claude/skills/1health-launch-sso), so its
//    files must not point outside it (reference/, white-papers/, ../..), and every `templates/…` or `references/…`
//    path they mention must exist.
//
// Usage: node scripts/check-docs.mjs [--write]
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skill = join(root, "skill/1health-launch-sso");
const write = process.argv.includes("--write");
const errors = [];

// ── 1. template copies ─────────────────────────────────────────────────────────────────────────
const MARKER = /^<!--\s*template:\s*(\S+)\s*-->\s*$/;
let checked = 0;
for (const name of readdirSync(join(root, "white-papers")).filter((f) => f.endsWith(".md"))) {
  const file = join(root, "white-papers", name);
  const lines = readFileSync(file, "utf8").split("\n");
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(MARKER);
    if (!m) continue;
    let open = i + 1;
    while (open < lines.length && lines[open].trim() === "") open++;
    const fence = lines[open]?.match(/^(`{3,})/)?.[1];
    if (!fence) { errors.push(`${name}:${i + 1}: template marker not followed by a code block`); continue; }
    let close = open + 1;
    while (close < lines.length && lines[close] !== fence) close++;
    if (close >= lines.length) { errors.push(`${name}:${open + 1}: unclosed code block`); continue; }
    const src = join(skill, "templates", m[1]);
    if (!existsSync(src)) { errors.push(`${name}:${i + 1}: template not found: templates/${m[1]}`); continue; }
    checked++;
    const want = readFileSync(src, "utf8").replace(/\n$/, "");
    const have = lines.slice(open + 1, close).join("\n");
    if (have === want) continue;
    if (write) {
      lines.splice(open + 1, close - open - 1, ...want.split("\n"));
      changed = true;
      i = open + want.split("\n").length;
    } else {
      const a = have.split("\n"), b = want.split("\n");
      const at = a.findIndex((l, k) => l !== b[k]);
      errors.push(`${name}:${open + 2 + (at < 0 ? a.length : at)}: code block differs from templates/${m[1]} ` +
        `(first difference here; run node scripts/check-docs.mjs --write)`);
    }
  }
  if (changed) { writeFileSync(file, lines.join("\n")); console.log(`rewrote template copies in ${name}`); }
}

// ── 2. skill self-containment ──────────────────────────────────────────────────────────────────
const OUTSIDE = [/(^|[^\w-])reference\//, /white-papers\//, /\.\.\/\.\.\//, /(^|[\s`(])notes\//];
const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return f === "node_modules" ? [] : statSync(p).isDirectory() ? walk(p) : [p];
});
for (const file of walk(skill).filter((f) => /\.(md|ts|tsx|mts|mjs|py|sql)$/.test(f))) {
  const rel = relative(skill, file);
  readFileSync(file, "utf8").split("\n").forEach((line, n) => {
    for (const re of OUTSIDE) if (re.test(line)) errors.push(`skill/${rel}:${n + 1}: points outside the skill: ${line.trim().slice(0, 100)}`);
    if (!rel.endsWith(".md")) return;
    for (const [, p] of line.matchAll(/`((?:templates|references)\/[^`\s*]+?)[`*]/g)) {
      const clean = p.replace(/[),.:]+$/, "");
      if (!existsSync(join(skill, clean))) errors.push(`skill/${rel}:${n + 1}: missing path ${clean}`);
    }
  });
}

if (errors.length) {
  console.error(errors.join("\n"));
  console.error(`\n${errors.length} problem(s).`);
  process.exit(1);
}
console.log(`docs ok: ${checked} template copies match; skill directory is self-contained`);
