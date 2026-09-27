#!/usr/bin/env bash
# Применяет файлы hub/mail/migrations, которых ещё нет в max.migrations, по порядку имён; каждый файл — одна транзакция,
# ролью migrator (SUPABASE_DB_URL). В конце снимает EXECUTE PUBLIC со своих функций схемы max: права только явными grant.
set -euo pipefail
cd "$(dirname "$0")/../hub/mail"
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is required}"
psql=(psql "$SUPABASE_DB_URL" -X -q -v ON_ERROR_STOP=1)
"${psql[@]}" -c "create table if not exists max.migrations (name text primary key, applied_at timestamptz not null default now());"
applied=$("${psql[@]}" -At -c "select name from max.migrations")
n=0
for f in migrations/*.sql; do
  name=$(basename "$f")
  if grep -qxF "$name" <<<"$applied"; then continue; fi
  echo "apply $name"
  "${psql[@]}" -1 -f "$f"
  "${psql[@]}" -c "insert into max.migrations (name) values ('$name') on conflict do nothing;"
  n=$((n + 1))
done
"${psql[@]}" <<'SQL'
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as fn from pg_proc p
           where p.pronamespace = 'max'::regnamespace and pg_get_userbyid(p.proowner) = current_user loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.fn);
  end loop;
end $$;
SQL
echo "migrations applied: $n"
