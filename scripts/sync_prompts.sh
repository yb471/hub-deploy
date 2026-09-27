#!/usr/bin/env bash
# Правила почтовой сессии Max живут в базе (max.config max_rules), источник — hub/mail/routines/max-inbox.md.
set -euo pipefail
cd "$(dirname "$0")/../hub/mail"
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is required}"
psql "$SUPABASE_DB_URL" -X -q -v ON_ERROR_STOP=1 -v rules="$(cat routines/max-inbox.md)" <<'SQL'
select max.set_setting('max_rules', :'rules');
SQL
echo "max_rules synced: $(wc -c < routines/max-inbox.md) bytes"
