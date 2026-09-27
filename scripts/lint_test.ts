import { lintFunction, lintSql, blank } from "./lint.ts";
function eq(a: unknown, b: unknown, what = "") { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error((what ? what + ": " : "") + "expected " + y + ", got " + x); }

Deno.test("lintSql: a clean migration passes, every way out or up is named", () => {
  eq(lintSql("a.sql", "-- net.http_post in a comment is fine\ncreate table max.x (id int); insert into max.x values (1); select max.fn_call('mailer', '{}'); -- https://x\ncomment on table max.x is 'me. health. execute';"), []);
  const bad = [
    ["select net.http_post('https://x')", ["foreign schema", "url"]],
    ["grant select on health.labs to hub_app", ["foreign schema"]],
    ["grant migrator to postgres", ["role membership", "grant to a system role"]],
    ["alter role hub_app password 'x'", ["role"]],
    ["do $$ begin execute 'x'; end $$", ["dynamic sql"]],
    ["select chr(110)", ["obfuscation"]],
    ["select value from max.config where key = 'mailer_token'", ["secrets table"]],
    ["set role postgres", ["set role"]],
  ] as [string, string[]][];
  for (const [sql, whats] of bad) eq(lintSql("b.sql", sql).map((p) => p.split(": ")[1].split(" — ")[0]), whats, sql);
});

Deno.test("lintFunction: guard first, imports pinned, no way around fetch", () => {
  const ok = 'import { guard } from "../_egress.ts";\nguard("relay");\nimport { createClient } from "jsr:@supabase/supabase-js@2";\nconst x = 1;\n';
  eq(lintFunction("relay/index.ts", "relay", ok, false), []);
  eq(lintFunction("relay/index.ts", "relay", ok.replace('guard("relay")', 'guard("probe")'), false).length, 1, "wrong name");
  eq(lintFunction("relay/index.ts", "relay", 'import { createClient } from "jsr:@supabase/supabase-js@2";\n' + ok, false).length, 1, "guard not first");
  eq(lintFunction("relay/index.ts", "relay", ok + 'globalThis.fetch = realFetch;', false).map((p) => p.split(" — ")[0].split(": ")[1]), ["fetch reassigned"]);
  eq(lintFunction("relay/index.ts", "relay", ok + 'const c = await Deno.connect({ hostname: "x", port: 1 });', false).map((p) => p.split(": ")[1].split(" — ")[0]), ["forbidden Deno API"]);
  eq(lintFunction("relay/index.ts", "relay", ok + 'import x from "npm:left-pad@1";', false).length, 1, "unpinned import");
  eq(lintFunction("relay/index.ts", "relay", ok + 'const m = await import("./x.ts");', false).length, 1, "dynamic import");
  eq(lintFunction("probe/index.ts", "probe", 'import { guard } from "../_egress.ts";\nguard("probe");\nconst k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");', false).length, 1, "probe with the service key");
  eq(lintFunction("probe/index.ts", "probe", 'import { guard } from "../_egress.ts";\nguard("probe");\nconst k = Deno.env.get("PROBE_TOKEN");', false), []);
  const hub = 'import { guard } from "../_egress.ts";\nguard("hubdb");\nimport postgres from "npm:postgres@3.4.5";\nif (!/\\.supabase\\.(co|com)$/i.test(u.hostname)) throw new HubError("x", 503);\nconst sql = postgres({ host: c.host, port: c.port });\n';
  eq(lintFunction("hubdb/index.ts", "hubdb", hub, false), []);
  eq(lintFunction("hubdb/index.ts", "hubdb", hub + 'const s2 = postgres({ host: "evil" });', false).length, 1, "a second connection");
  eq(lintFunction("relay/index.ts", "relay", ok + 'import postgres from "npm:postgres@3.4.5";', false).length, 2, "the driver outside hubdb");
});

Deno.test("blank: literals and comments go in one pass", () => {
  eq(blank("select 'a -- b', E'c\\'d' -- x\n/* y */ z"), "select '', ''  \n  z");
  eq(lintSql("c.sql", "-- https://in-a-comment\nselect 1"), []);
});
