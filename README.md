# hub-deploy — выкат почтового контура hub

Отдельное репо для конвейера выката (27.09): workflow, сторож `scripts/lint.ts`,
скрипты и секреты живут здесь, а не в hub, и сессии Routine сюда не
дотягиваются. Workflow раз в пять минут забирает `main` репо hub и, если
менялись `mail/functions`, `mail/migrations` или `mail/routines/max-inbox.md`,
проверяет типы и тесты, прогоняет сторож, применяет миграции ролью `migrator`,
кладёт правила Max, выкатывает функции и держит карантин 3 минуты с откатом.

Секреты репо: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_URL` (роль `migrator`),
`HUB_READ_TOKEN` (fine-grained PAT, только чтение репо hub).
`canon/_egress.ts` — эталон сторожа выхода в сеть, hub обязан совпадать с ним.
Что помнит база: `ci_seen_sha` (последний просмотренный коммит hub),
`ci_last_good_sha` (последний прошедший карантин), строка `ci` в `max.deps`.
