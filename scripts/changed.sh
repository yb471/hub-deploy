#!/usr/bin/env bash
# Что менялось в hub с последнего просмотренного коммита (max.config ci_seen_sha). Выход: deploy=true|false, head=<sha>
# в GITHUB_OUTPUT и список изменённых файлов в changed_files.txt (все миграции, если прежний коммит неизвестен).
set -euo pipefail
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is required}"
head=$(git -C hub rev-parse HEAD)
seen=$(psql "$SUPABASE_DB_URL" -X -q -At -c "select coalesce(max.get_setting('ci_seen_sha'), '')")
echo "head=$head" >> "${GITHUB_OUTPUT:-/dev/null}"
: > changed_files.txt
if [ "$seen" = "$head" ]; then
  echo "nothing new since $seen"; echo "deploy=false" >> "${GITHUB_OUTPUT:-/dev/null}"; exit 0
fi
if [ -z "$seen" ] || ! git -C hub cat-file -e "$seen^{commit}" 2>/dev/null; then
  # no known base: the migrations still to apply are the ones to guard (the applied ones went through the earlier pipeline)
  applied=$(psql "$SUPABASE_DB_URL" -X -q -At -c "select name from max.migrations")
  for f in hub/mail/migrations/*.sql; do grep -qxF "$(basename "$f")" <<<"$applied" || echo "${f#hub/}" >> changed_files.txt; done
  echo "no known base: functions and $(wc -l < changed_files.txt) unapplied migration(s)"
  echo "deploy=true" >> "${GITHUB_OUTPUT:-/dev/null}"; exit 0
fi
git -C hub diff --name-only "$seen" "$head" -- mail/functions mail/migrations mail/routines/max-inbox.md > changed_files.txt
if [ -s changed_files.txt ]; then
  echo "changed since $seen:"; cat changed_files.txt; echo "deploy=true" >> "${GITHUB_OUTPUT:-/dev/null}"
else
  echo "no mail changes since $seen"; echo "deploy=false" >> "${GITHUB_OUTPUT:-/dev/null}"
fi
