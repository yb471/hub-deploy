#!/usr/bin/env bash
# Выкат шести функций почтового контура (relay, gapps, mailer, hubdb, probe, ebay) из hub/mail/functions через Supabase CLI.
# Нужны supabase CLI и SUPABASE_ACCESS_TOKEN. Тесты (*_test.ts, _test.ts) в выкат не попадают. Секрет PROBE_TOKEN задан
# один раз (значение = max.config probe_token); смена ключа — руками postgres.
set -euo pipefail
cd "$(dirname "$0")/../hub/mail"
: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN is required}"
rm -rf /tmp/deploy && mkdir -p /tmp/deploy/supabase/functions
cp -r functions/. /tmp/deploy/supabase/functions/
find /tmp/deploy -name '*_test.ts' -delete && rm -f /tmp/deploy/supabase/functions/_test.ts
find /tmp/deploy -type d -name fixtures -prune -exec rm -rf {} +
cd /tmp/deploy
for f in relay gapps mailer hubdb probe ebay; do supabase functions deploy "$f" --project-ref pjuwipjyxzxlmhebzdct --no-verify-jwt; done
