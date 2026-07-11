# Rhythm Shooter Mobile

Touch-first версия ритм-игры [Weksim-Tiles](https://github.com/FakeMorty/Weksim-Tiles), адаптированная под смартфоны и планшеты.

**Играть:** https://fakemorty.github.io/Weksim-Tiles-Mobile/

## Отличия от десктоп-версии

- Оптимизировано под touch: большие тап-зоны, отключён hover, viewport под iOS/Android
- По умолчанию Low FX + HPSS off — быстрее на слабых мобильных GPU
- Vibration API — тактильная отдача на попаданиях, разные паттерны по тирам
- Screen Wake Lock — экран не гаснет во время игры
- PWA manifest — можно добавить на главный экран как приложение
- Rotate hint — подсказка повернуть в ландшафт
- Адаптивный CSS: колонки перестраиваются на портрете, HUD ужимается

## Управление

- Тап по нижней части дорожки — попадание
- Удержание — HOLD-нота
- Кнопка меню в углу — пауза

## Технологии

Ядро аналайзера то же, что в десктоп-версии: STFT + HPSS + multiband spectral flux + Ellis DP beat tracking. Всё в Web Worker.

## Ограничения

- Web Worker с ES-модулями — iOS Safari 16.4+ / Chrome 80+
- Wake Lock API — Chrome/Edge на Android, iOS 16.4+
- Vibration API — Android (в iOS не работает)
- Screen Orientation API — не работает без fullscreen

## Разработка

```bash
python -m http.server 8000
# открыть http://localhost:8000 с DevTools в mobile emulation
```

Или запуск как обычной веб-страницы через любой HTTP-сервер.
