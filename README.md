# Ore

Лёгкий кроссплатформенный редактор SQLite для **macOS**, **Windows** и **Linux**.
Tauri 2 + Rust (rusqlite, bundled SQLite) + React / TypeScript. Дизайн-система — **Caliper**: flat, волосяные линии, петрольный акцент, тёмная и светлая темы.

> *Ore* — руда: ценное лежит внутри сырых данных. Название свободно в dev-нише (проверено), слово «SQLite» в имени не используется — это чужая торговая марка.

## Возможности

- Открытие `.db / .sqlite / .sqlite3` через диалог или drag&drop, список недавних файлов
- Дерево схемы: таблицы с колонками и PK, views, indexes, triggers, счётчики строк
- Грид данных: пагинация по 50 строк, сортировка кликом по заголовку, правка ячейки двойным кликом, Set NULL, Copy Cell/JSON/CSV, добавление и удаление строк; views и WITHOUT ROWID — read-only
- Фильтры по колонкам: подстрока или префикс-операторы `=`, `>`, `<`
- SQL-консоль: ⌘/Ctrl+Enter, история между сессиями, экспорт результата (первые 1000 строк)
- Импорт CSV: превью, разделитель, новая таблица с выводом типов или существующая с автосопоставлением колонок; импорт одной транзакцией с откатом при ошибке
- Экспорт таблицы (с учётом фильтров) в CSV / JSON

## Разработка

Нужны Node 20+, Rust (rustup), Xcode CLT / MSVC / gcc по платформе.

```bash
cd app
npm install          # если ~/.npm повреждён правами: npm install --cache /tmp/npm-cache-sqlite-editor
npm run tauri dev
```

Тесты бэкенда: `cd app/src-tauri && cargo test`

## Сборка дистрибутивов

```bash
git tag v0.1.0 && git push --tags
```

GitHub Actions (`.github/workflows/release.yml`) соберёт и приложит к черновику Release:
`.dmg` (Apple Silicon + Intel), `.msi`/`.exe` (NSIS), `.AppImage`/`.deb`/`.rpm`.
Сборки без подписи — macOS покажет предупреждение Gatekeeper (ПКМ → Открыть).

## Структура

- `app/src` — React UI (токены и компоненты Caliper: `src/styles/tokens.css`, `shared.css`)
- `app/src-tauri` — Rust-бэкенд: rusqlite, IPC-команды (`open_db`, `get_rows`, `exec_sql`, `import_csv`, …)
- `design/` — HTML-макеты всех экранов и design-brief
- `demo/` — демо-база `shop.db` и CSV для пробы импорта
- `PRD.md` — продуктовая спецификация

## Лицензия

MIT — см. [LICENSE](LICENSE).

