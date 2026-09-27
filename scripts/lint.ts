// Сторож выката (27.09): детерминированная проверка кода функций и новых миграций репо hub перед выкатом. Живёт в
// отдельном репо выката, до которого сессии Routine не дотягиваются, поэтому его нельзя выключить тем же коммитом.
// deno run --allow-read scripts/lint.ts <корень hub> [изменённые файлы… | --all]   (без списка — только функции)
// Функции (mail/functions/**/index.ts и общие модули): _egress.ts совпадает с эталоном canon/_egress.ts побайтно; первые
// строки каждой функции — import { guard } … и guard("<имя папки>"); импорты только из списка (версии закреплены здесь)
// и относительные внутри mail/functions; нет обходов сторожа (присваивание fetch, Deno.connect, WebSocket, eval,
// динамический import, запуск процессов, файлы); probe не знает ни базы, ни service-role ключа.
// Миграции: на тексте без литералов и комментариев — нет чужих схем (me, health, food, invest, vault, auth, storage,
// extensions, net, cron), ролей и членства, grant к public/anon/authenticated/service_role/postgres, set role, execute
// (динамического SQL), copy, файлов сервера, chr/decode/convert_from/U& (обфускация), max.config / max.oauth, адресов
// http(s). Любое нарушение — сборка падает, ничего не выкатывается.
const ALLOWED_IMPORTS = ["npm:postgres@3.4.5", "jsr:@supabase/supabase-js@2.117.2"];
const FUNCTION_RULES: [RegExp, string][] = [
  [/\b(globalThis|self|window)\s*\.\s*fetch\s*=/, "fetch reassigned"],
  [/(?<![.\w])fetch\s*=[^=]/, "fetch reassigned"],
  [/\bDeno\s*\.\s*(connect|connectTls|listen|listenTls|createHttpClient|run|Command|dlopen|openKv|readFile|readTextFile|writeFile|writeTextFile|remove|mkdir|open|serveHttp)\b/, "forbidden Deno API"],
  [/\bnew\s+WebSocket\b|\bEventSource\b|\bWebAssembly\b|\bnavigator\s*\.\s*sendBeacon\b/, "forbidden network API"],
  [/\bimport\s*\(/, "dynamic import"],
  [/\beval\s*\(|\bnew\s+Function\s*\(/, "dynamic code"],
];
const PROBE_FORBIDDEN = /SUPABASE_SERVICE_ROLE_KEY|supabase-js|npm:postgres|SUPABASE_URL|\bDeno\s*\.\s*env\s*\.\s*(get|toObject)\s*\(\s*["'](?!PROBE_TOKEN["'])/;
const SQL_RULES: [RegExp, string][] = [
  [/\b(me|health|food|invest|vault|auth|storage|pgsodium|extensions|net|cron)\s*\./i, "foreign schema"],
  [/\b(alter|create|drop)\s+(role|user|group)\b/i, "role"],
  [/\bgrant\s+[a-z_]+\s+to\b/i, "role membership"],
  [/\bto\s+(public|anon|authenticated|service_role|postgres|supabase_admin|dashboard_user)\b/i, "grant to a system role"],
  [/\b(set|reset)\s+(session\s+)?(role|authorization)\b/i, "set role"],
  [/\bexecute\b(?!\s+on\b)/i, "dynamic sql"],
  [/\bcopy\b/i, "copy"],
  [/\b(pg_read_file|pg_read_binary_file|pg_ls_dir|lo_import|lo_export|dblink|pg_net)\b/i, "server files or net"],
  [/\bchr\s*\(|\bdecode\s*\(|\bconvert_from\s*\(|\bu&["']/i, "obfuscation"],
  [/\bmax\s*\.\s*(config|oauth)\b/i, "secrets table"],
  [/\balter\s+default\s+privileges\b/i, "default privileges"],
  [/https?:\/\//i, "url"],
];
// the text with every string literal replaced by '' and every comment by a space, in one pass (the same rule as hubdb)
export function blank(src: string): string {
  let out = "", i = 0;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === "-" && n === "-") { while (i < src.length && src[i] !== "\n") i++; out += " "; continue; }
    if (c === "/" && n === "*") { const e = src.indexOf("*/", i + 2); i = e < 0 ? src.length : e + 2; out += " "; continue; }
    if (c === "'" || ((c === "e" || c === "E") && n === "'" && !/[\w$]/.test(src[i - 1] || ""))) {
      const esc = c !== "'";
      i += esc ? 2 : 1;
      while (i < src.length) {
        if (esc && src[i] === "\\") { i += 2; continue; }
        if (src[i] === "'") { if (src[i + 1] === "'") { i += 2; continue; } i++; break; }
        i++;
      }
      out += "''"; continue;
    }
    out += c; i++;
  }
  return out;
}
// comments only removed: the url rule looks inside string literals too (an address is a literal)
export function blankComments(src: string): string {
  let out = "", i = 0;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === "-" && n === "-") { while (i < src.length && src[i] !== "\n") i++; out += " "; continue; }
    if (c === "/" && n === "*") { const e = src.indexOf("*/", i + 2); i = e < 0 ? src.length : e + 2; out += " "; continue; }
    if (c === "'") { let j = i + 1; while (j < src.length) { if (src[j] === "'") { if (src[j + 1] === "'") { j += 2; continue; } j++; break; } j++; } out += src.slice(i, j); i = j; continue; }
    out += c; i++;
  }
  return out;
}
export function lintSql(name: string, src: string): string[] {
  const t = blank(src), raw = blankComments(src), out = new Set<string>();
  for (const [re, what] of SQL_RULES) { const m = re.exec(what === "url" ? raw : t); if (m) out.add(name + ": " + what + " — «" + m[0] + "»"); }
  return [...out];
}
export function lintFunction(name: string, dir: string, src: string, shared: boolean): string[] {
  const out: string[] = [];
  if (!shared) {
    const head = src.split("\n").filter((l) => l.trim() && !l.trim().startsWith("//")).slice(0, 2);
    if (head[0] !== 'import { guard } from "../_egress.ts";' || head[1] !== 'guard("' + dir + '");') out.push(name + ": the first two lines must install the egress guard for " + dir);
  }
  for (const m of src.matchAll(/^\s*import\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/gm)) {
    const spec = m[1];
    if (spec.startsWith("./") || spec.startsWith("../")) { if (spec.includes("../..") || /^\.\.\/\.\./.test(spec)) out.push(name + ": import outside mail/functions — " + spec); continue; }
    if (!ALLOWED_IMPORTS.includes(spec)) out.push(name + ": import not allowed — " + spec);
  }
  for (const [re, what] of FUNCTION_RULES) { const m = re.exec(src); if (m) out.push(name + ": " + what + " — «" + m[0].trim() + "»"); }
  if (dir === "probe") { const m = PROBE_FORBIDDEN.exec(src); if (m) out.push(name + ": probe must not know the base or its secrets — «" + m[0] + "»"); }
  // the postgres driver opens sockets past the egress guard: only hubdb may use it, once, to the host connFor checked
  if (/npm:postgres@/.test(src) || /\bpostgres\s*\(/.test(src)) {
    if (dir !== "hubdb") out.push(name + ": the postgres driver belongs to hubdb only");
    const calls = src.match(/\bpostgres\s*\(\s*\{/g) || [];
    if (calls.length !== 1 || !/\bpostgres\s*\(\s*\{\s*host:\s*c\.host\b/.test(src) || !/\.supabase\\\.\(co\|com\)\$\/i\.test\(u\.hostname\)/.test(src)) out.push(name + ": one postgres() connection to c.host of the project's database, checked in connFor");
  }
  return [...new Set(out)];
}
async function main() {
  const [root, ...changed] = Deno.args;
  if (!root) { console.error("usage: lint.ts <hub root> [changed files…]"); Deno.exit(2); }
  const problems: string[] = [];
  const fnDir = root + "/mail/functions";
  const canon = await Deno.readTextFile(new URL("../canon/_egress.ts", import.meta.url));
  const live = await Deno.readTextFile(fnDir + "/_egress.ts").catch(() => "");
  if (live !== canon) problems.push("mail/functions/_egress.ts differs from canon/_egress.ts");
  for await (const e of Deno.readDir(fnDir)) {
    if (e.isDirectory) {
      for await (const f of Deno.readDir(fnDir + "/" + e.name)) {
        if (!f.isFile || !f.name.endsWith(".ts") || f.name.endsWith("_test.ts")) continue;
        problems.push(...lintFunction("mail/functions/" + e.name + "/" + f.name, e.name, await Deno.readTextFile(fnDir + "/" + e.name + "/" + f.name), f.name !== "index.ts"));
      }
    } else if (e.isFile && e.name.endsWith(".ts") && !e.name.endsWith("_test.ts") && e.name !== "_egress.ts") {
      problems.push(...lintFunction("mail/functions/" + e.name, "", await Deno.readTextFile(fnDir + "/" + e.name), true));
    }
  }
  // the migrations to check come from the list (changed since the last deploy, or not yet applied); --all takes every file
  const migrations = changed.includes("--all") ? [] : changed.filter((f) => /^mail\/migrations\/.*\.sql$/.test(f));
  if (changed.includes("--all")) for await (const f of Deno.readDir(root + "/mail/migrations")) if (f.isFile && f.name.endsWith(".sql")) migrations.push("mail/migrations/" + f.name);
  for (const f of migrations.sort()) {
    const src = await Deno.readTextFile(root + "/" + f).catch(() => null);
    if (src === null) continue;   // deleted in this change
    problems.push(...lintSql(f, src));
  }
  if (problems.length) { console.error("guard: " + problems.length + " problem(s)\n" + problems.map((p) => "  - " + p).join("\n")); Deno.exit(1); }
  console.log("guard ok: functions and " + migrations.length + " migration file(s)");
}
if (import.meta.main) await main();
