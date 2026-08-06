# Использованные исследования

SisiPlus написан как новое расширение и не содержит целиком исходный код Sisi, Cherry или других плагинов.

При проектировании были изучены:

- `bwa.ad/re` и клиент Sisi — формат серверного меню и карточек Lampa;
- `lampac-nextgen/lampac`, `Modules/Adult` — актуальные URL и алгоритмы получения BongaCams, Runetki, Chaturbate и Xhamster;
- `Denis-Tikhonov/plug` — независимая регистрация парсеров;
- `aawersom/cherry-plugin` — стратегии сетевого fallback, проверка HLS и публичный proxy endpoint;
- публичные ответы самих сайтов и официальные affiliate/API endpoints.

Публичный proxy endpoint Cherry является внешней зависимостью и может быть отключён в настройках. Для долгосрочной установки рекомендуется собственный HTTPS-прокси.
