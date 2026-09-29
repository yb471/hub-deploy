#!/usr/bin/env bash
# Карантин после выката функций: ждёт QUARANTINE_WAIT секунд (по умолчанию 180), затем проверяет ролью migrator: relay
# отвечает на op status (ключ cron через max.fn_call), mailer отвечает status, hubdb выполняет select 1, тики после выката
# дали не меньше двух ответов 200 и ни одного 5xx, в max.errors нет своих отказов (500, ≥503, cron*; ci и 502 не в счёт).
# Пройденный карантин запоминает коммит (ci_last_good_sha) — цель отката для следующего провала. Токены не печатаются.
# Недоступная база или её шлюз (PostgREST «db: Bad Gateway»/«Gateway Timeout») — не вина выката: тогда вердикт inconclusive (в GITHUB_OUTPUT verdict=), без отката и без записи.
set -euo pipefail
since="${1:?deploy start timestamp (UTC) required}"
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is required}"
q() { psql "$SUPABASE_DB_URL" -X -q -At -v ON_ERROR_STOP=1 -c "$1"; }
say() { echo "quarantine: $*"; }
verdict() { echo "verdict=$1" >> "${GITHUB_OUTPUT:-/dev/null}"; }
fail=0
sleep "${QUARANTINE_WAIT:-180}"
if ! q "select 1" >/dev/null 2>&1; then sleep 30; if ! q "select 1" >/dev/null 2>&1; then say "database unreachable: verdict inconclusive, no rollback"; verdict inconclusive; exit 0; fi; fi
if q "select (max.fn_call('relay', '{\"op\":\"status\"}'::jsonb, 'src=cron')) ? 'events_new'" | grep -q t; then say "relay ok"; else say "relay FAILED"; fail=1; fi
if [ "$(q "select coalesce((max.mailer('status', '{}'::jsonb))->>'connected', 'false')")" = "true" ]; then say "mailer ok"; else say "mailer FAILED"; fail=1; fi
if q "select (max.fn_call('hubdb', '{\"sql\":\"select 1 as ok\"}'::jsonb))->>'ok'" | grep -q true; then say "hubdb ok"; else say "hubdb FAILED"; fail=1; fi
read -r ok bad <<<"$(q "select count(*) filter (where status_code = 200), count(*) filter (where status_code >= 500) from net._http_response where created > '$since'" | tr '|' ' ')"
if [ "${ok:-0}" -ge 2 ] && [ "${bad:-0}" -eq 0 ]; then say "ticks ok ($ok x 200)"; else say "ticks FAILED: 200=${ok:-0} 5xx=${bad:-0}"; fail=1; fi
# a gateway of the database (PostgREST «db: Bad Gateway» / «db: Gateway Timeout») is not the code's fault: such rows are
# left out of the count, and if they are the only trouble the verdict is inconclusive — no rollback, no good mark (29.09:
# two such rows during the quarantine of 0f94078 rolled back a sound relay)
gw="message like 'db: %' and status >= 500"
cond="at > '$since' and source <> 'ci' and (status = 500 or status >= 503 or (source = 'relay' and coalesce(action, '') like 'cron%')) and not ($gw)"
n=$(q "select count(*) from max.errors where $cond")
g=$(q "select count(*) from max.errors where at > '$since' and $gw")
if [ "$n" = "0" ]; then say "errors ok"; else say "errors FAILED: $n since $since"; q "select to_char(at, 'HH24:MI:SS') || ' ' || source || ' ' || coalesce(action, '') || ' ' || status || ' ' || left(message, 120) from max.errors where $cond order by at desc limit 10"; fail=1; fi
if [ "$fail" = 0 ] && [ "${g:-0}" != "0" ]; then say "database gateway errors: $g — verdict inconclusive, no rollback"; verdict inconclusive; exit 0; fi
if [ "$fail" = 0 ]; then verdict ok; else verdict fail; fi
if [ "$fail" = 0 ]; then
  q "insert into max.deps (name, kind, ok, checked_at, last_ok_at, last_error, note) values ('ci', 'pipeline', true, now(), now(), null, 'run ${GITHUB_RUN_ID:-local} ok') on conflict (name) do update set ok = true, checked_at = now(), last_ok_at = now(), last_error = null, note = excluded.note"
  if [ -n "${HEAD_SHA:-}" ]; then q "select max.set_setting('ci_last_good_sha', '${HEAD_SHA}')"; fi
else
  q "insert into max.deps (name, kind, ok, checked_at, last_error, note) values ('ci', 'pipeline', false, now(), 'quarantine failed', 'run ${GITHUB_RUN_ID:-local}') on conflict (name) do update set ok = false, checked_at = now(), last_error = excluded.last_error, note = excluded.note"
fi
exit $fail
