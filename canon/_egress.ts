// Сторож выхода в сеть (27.09, лучшие практики: конвейер и код вне доверия к одному коммиту). Каждая функция первой
// строкой вызывает guard("<имя>"): с этого момента любой fetch идёт только к хостам из HOSTS для этой функции. Чужой
// хост — ошибка «egress blocked» без запроса. Сокеты здесь не перехватываются: единственный, кто их открывает, — драйвер
// postgres в hubdb через node-полифилл, который резолвит имя в IP до вызова Deno.connect (перехват по имени хоста ломал
// соединение с базой, 27.09 12:49 и 13:00); хост базы проверяет connFor в hubdb, а линтер репо выката не пускает драйвер
// никуда, кроме hubdb. Список хостов живёт здесь и нигде больше; отдельное репо выката сверяет этот файл побайтно с эталоном
// и проверяет, что вызов guard стоит в каждой функции и имя совпадает с папкой, так что подменить его одним коммитом
// в hub нельзя. probe открывает сайты дилеров — ему разрешён любой публичный хост, кроме локальных, IP и этого проекта.
export const PROJECT = "pjuwipjyxzxlmhebzdct.supabase.co";
const GOOGLE = ["www.googleapis.com", "oauth2.googleapis.com", "gmail.googleapis.com", "sheets.googleapis.com", "accounts.google.com", "docs.google.com"];
export const HOSTS: Record<string, string[] | "public"> = {
  relay: [PROJECT, "api.linear.app", "linear.app", "api.anthropic.com", ...GOOGLE],
  mailer: [PROJECT, ...GOOGLE],
  gapps: [PROJECT, ...GOOGLE],
  hubdb: [PROJECT],
  ebay: [PROJECT, "api.ebay.com", "apiz.ebay.com", "uploads.linear.app"],
  probe: "public",
};
// a public host: a name with a dot that is not an IP, a local name or this project (the same rule as probe's safeUrl)
export function publicHost(h: string): boolean {
  h = String(h || "").toLowerCase();
  return h.includes(".") && !/^[\d.]+$/.test(h) && !h.startsWith("[") && h !== "localhost" && !h.endsWith(".localhost") && !h.endsWith(".local") && !h.endsWith(".internal") && !h.endsWith(".supabase.co") && !h.endsWith(".supabase.com");
}
export function allowedHost(h: string, allowed: string[] | "public" | undefined): boolean {
  h = String(h || "").toLowerCase();
  if (!allowed) return false;
  if (allowed === "public") return publicHost(h);
  return allowed.includes(h);
}
function hostOf(input: unknown): string {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input instanceof Request ? input.url : String(input);
  try { return new URL(url).hostname; } catch { return ""; }
}
let installed = "";
export function guard(name: string): void {
  if (installed) { if (installed !== name) throw new Error("egress guard already installed for " + installed); return; }
  const allowed = HOSTS[name];
  if (!allowed) throw new Error("egress guard: unknown function " + name);
  installed = name;
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: unknown, init?: RequestInit) => {
    const h = hostOf(input);
    if (!allowedHost(h, allowed)) return Promise.reject(new Error("egress blocked: " + (h || "bad url") + " (" + name + ")"));
    return realFetch(input as string | URL | Request, init);
  }) as typeof fetch;
}
