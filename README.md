# Rhythm Shooter // neon tiles

Ритм-игра в стиле Piano Tiles + shooter. Неон-минимализм, Canvas2D, автогенерация карт из твоей музыки.

**Играть в браузере:** https://fakemorty.github.io/Weksim-Tiles/

## Возможности

- 4 дорожки, стреляешь по летящим нотам
- Загрузка своей музыки: MP3 / WAV / OGG / FLAC
- Автоматический анализ трека в браузере, ничего никуда не отправляется
- 3 режима: **DRUMS** / **CLASSIC** / **VOCAL** (разные веса частотных полос)
- Автоматическая синхронизация скорости под BPM
- Калибровка задержки (для Bluetooth-наушников, беспроводных мониторов)
- HOLD-ноты, аккорды, умная раскладка

## Управление

- `D F J K` — огонь по 4 линиям
- Также: `A S L ;` / `1 2 3 4` / тап на экран
- `ESC` — выход в меню

## Тайминги (по умолчанию, режим Normal)

- MARVELOUS ±25 ms · 350 pts
- PERFECT ±48 ms · 300 pts
- GREAT ±85 ms · 220 pts
- GOOD ±135 ms · 140 pts
- OK ±190 ms · 70 pts
- MISS — комбо ломается

Строгость окон настраивается в разделе «Калибровка задержки».

## Технологии

- Vanilla JS, ES-модули, Canvas2D, Web Audio API
- Анализ в Web Worker: STFT (2048/512) + 6-полосный spectral flux + autocorrelation BPM
- Адаптивные пороги + peak-picking
- Ноль зависимостей на клиенте, деплой статикой

## Запуск локально (для разработки)

Игра — чистая статика, но использует ES-модули и Web Worker, поэтому нужен HTTP-сервер (открытие как `file://` не сработает из-за CORS для module workers).

```bash
# Вариант 1 — Python (обычно уже стоит)
python -m http.server 8000
# открыть http://localhost:8000

# Вариант 2 — Node
npx serve .

# Вариант 3 — VS Code Live Server extension
```

## Как это опубликовано

Автоматический деплой через GitHub Actions на GitHub Pages. Любой push в `main` → через ~40 секунд обновление на сайте. Смотри `.github/workflows/pages.yml`.

## Обновление игры

После получения нового патча/архива:

```bash
git add .
git commit -m "update"
git push
```

Через ~40 сек новая версия на https://fakemorty.github.io/Weksim-Tiles/

## Разработка

- `ROADMAP.md` — план развития
- `src/` — исходники, разбиты по подсистемам (audio/game/render/fx/ui)
- `scripts/smoketest.mjs` — прогон всех модулей через Node с моками браузера
- `scripts/analyzer-test.mjs` — функциональный тест анализатора на синтетическом PCM

Версия: **1.5.0**
