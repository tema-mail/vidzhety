# Как подключить виджеты к сайту на Astro (на примере gaz-mag)

Это контракт: что сайт даёт модулю и что модуль даёт сайту. Пилот в gaz-mag – только после «внедрять» владельца;
из репо vidzhety живой сайт не трогаем (автовыкладка в бой из main).

## 1. Поставить модуль

```sh
npm i github:tema-mail/vidzhety      # после того как репо появится на GitHub
```

Preact у сайта уже есть (gaz-mag – 10.29), отдельной копии модуль не тянет – та же ветка ^10.
Если `tsconfig` сайта ругается на импорт `.ts`/`.tsx` с расширением – добавить `"allowImportingTsExtensions": true`
(правка tsconfig требует подтверждения владельца, хук).

## 2. Остров – в общий шаблон

`src/layouts/Base.astro`, рядом с окном cookie:

```astro
---
import Widgets from 'vidzhety/src/Widgets.tsx';
import 'vidzhety/src/vidzhety.css';
interface Props { /* … */ quiet?: boolean }
const { /* … */ quiet = false } = Astro.props;
---
<body data-w-quiet={quiet ? '' : undefined}>
  …
  <Sheets client:idle />
  <CookieConsent client:load />
  <Widgets client:idle src={u('/widgets.json')} />
</body>
```

- Один остров на сайт. `client:idle` – не мешает первой отрисовке.
- `u()` – чтобы на Pages с подпапкой (`/gaz-mag/`) адрес был верный.
- Окно, квиз и форма (src/Dialog.tsx) Vite отдаст отдельным куском при первом открытии.
- Цвета – переменными на `:root` сайта: `--w-accent: #1e294e; --w-accent-2: …; --w-radius: 12px`.

## 3. Где лежит widgets.json

| Где сайт | Файл | Как менять |
|---|---|---|
| Pages (показ) | `public/widgets.json` | правка в репо → пересборка |
| Бой на Beget | `/api/widgets` на сервере (кэш 5 минут) | без пересборки; сейчас – тоже `public/widgets.json`, приёмник `/api/widgets` – следующий шаг |

Формат – как `demo/vidzhety.json`. Обязательное:

```json
{
  "endpoint": "/api/lead",
  "tz": 7,
  "agreement": "/soglasie-na-obrabotku-dannyh",
  "metrika": 0,
  "consent": { "key": "gm_consent", "event": "gm-consent" },
  "widgets": [ { "id": "callback", "enabled": true, "type": "callback", "trigger": { "on": "click" }, "…": "…" } ]
}
```

- `enabled: true` – только явно; новый виджет выключен. Это же стоп-кран: `enabled:false` убирает виджет.
- На копии без сервера (Pages) – `"endpoint": "demo:"`: заявка никуда не уходит, как формы gaz-mag без `PUBLIC_LEADS`.
- `metrika` – номер счётчика, только если сайт сам грузит Метрику после согласия. В gaz-mag сейчас
  Метрики на публичных страницах нет (смежная находка из предложения) – оставить `0`, события не копятся.
- Пути в `target.include/exclude` – как в адресной строке, на Pages с подпапкой: `/gaz-mag/katalog/*`.

## 4. Что дописать в LeadForm – событие «заявка принята»

После ответа сервера «принято» форма страницы шлёт `lead-sent` – виджеты заявок замолкают на 90 дней.
`src/islands/LeadForm.tsx`, в `submit`, между проверкой `ok` и переходом на «Спасибо»:

```ts
const ok = await sendForm(form, { Name: name, Phone: phone, ...extra }, items);
setBusy(false);
if (!ok) return setErr(`Не получилось отправить. Позвоните нам: ${SITE.phones[0].text}`);
window.dispatchEvent(new CustomEvent('lead-sent', { detail: { source: 'form:' + form } }));
location.href = thanksUrl();
```

Только после `ok`, не по клику: модуль считает заявкой ответ сервера. То же – в корзине после оформления заказа.

## 5. Кнопки, которые открывают виджет

`data-w-open="<id виджета>"` на любой кнопке или ссылке. Рядом с `data-lead`, но не на одном элементе:
`Sheets.tsx` gaz-mag ловит клики по `[data-lead]` и откроет свой попап поверх виджета.

```astro
<button class="btn" data-w-open="callback">Перезвоните мне</button>   <!-- виджет -->
<button class="btn" data-lead="Заявка на монтаж">Оставить заявку</button> <!-- прежний попап -->
```

## 6. Тихие страницы – в шаблонах

`<body data-w-quiet>` – ни один виджет сам не появляется (по клику открыть можно). В gaz-mag передать `quiet`
в `Base`:

| Страница | Файл gaz-mag |
|---|---|
| «Спасибо» | `src/pages/spasibo.astro` |
| Юридические | `politika-konfidencialnosti.astro`, `soglasie-na-obrabotku-dannyh.astro`, `politika-cookie.astro`, `oferta.astro`, `rekvizity.astro` |
| 404 | `src/pages/404.astro` |
| Админка | `src/pages/admin/*` (свой шаблон – остров туда не ставить вовсе) |
| Корзина и оформление | в gaz-mag это шторки (`Sheets.tsx`), не страницы; если появится страница оформления – `quiet` |

## 7. Что модуль шлёт в заявке

`POST endpoint` с JSON:

```json
{ "form": "Виджет: Обратный звонок", "consent": true, "marketing": false, "source": "w:callback",
  "page": "/katalog/kotly", "landing": "/", "utm": { "utm_campaign": "kotly" }, "referrer": "https://yandex.ru/",
  "fields": { "Name": "…", "Phone": "+7 (913) 123-45-67", "Page": "/katalog/kotly" } }
```

- `server/lead.mjs` gaz-mag это примет: `fields.Phone`, `consent: true`, `fields.Page` – на месте.
- Расхождение: у gaz-mag `source` – источник трафика («Поиск Яндекса»), у модуля – виджет (`w:callback`).
  В пилоте в `lead.mjs` сохранять оба: `widget = body.source` если начинается с `w:`, источник трафика – из `referrer`/`utm`.
- `marketing: true` – только если человек сам отметил вторую галочку (`form.marketing`). Сервер проверяет `consent` –
  без него заявка не принимается (стандарт «проверка согласия на сервере»).

## 8. Cookie, слои, Метрика

- Согласие читается из `localStorage.gm_consent` и события `gm-consent` (`lib/consent.ts` gaz-mag) – совпадает
  с настройками по умолчанию. Пока выбора нет, самопоявляющиеся виджеты ждут.
- `"consent": false` – только для страниц без окна cookie (прототипы): модуль не ждёт выбора, Метрику не включает
  (номер `metrika` игнорируется). На боевом сайте с окном cookie так не ставить.
- Слои: окно cookie gaz-mag `z-index: 130` > окно виджета 110 > шторки gaz-mag 100 > липкая панель 90 > ярлычок и плашка 80.
- Метрика: показы/открытия/закрытия – `params`, заявка – `reachGoal('lead',{w:id})` после ответа сервера,
  мессенджер – `contact_click`. До согласия события копятся, к mc.yandex.ru модуль сам не ходит.

## 9. Проверка пилота (site-forms, раздел «Виджеты»)

Инвентарь виджетов, триггеры с `page.clock`, стоп-условия, тихие страницы, 390 (при входе с поиска ничего не перекрывает,
шторка ≤30%, Esc и «назад»), закон (пустые галочки, нет колеса и «кто-то купил»), Метрика до согласия, стоп-кран.
Образец прогона – проверка демо этого репо.

## Известное до пилота

- Модуль не знает о шторках gaz-mag (`sheet` в `lib/store`): окно на уходе может открыться поверх открытой корзины.
  В пилоте – считать открытую шторку «окном» (проверка `.dr.is-open`) или ставить `quiet` на время шторки.
- Свой счётчик показов (`beacon` в админку) и раздел админки «Виджеты» – следующие шаги.


## Важно: `"demo": true` – только для демо
В боевом widgets.json поля `demo` быть не должно: в режиме демо выключается случайная контрольная группа и устройство/вход можно подменить параметрами адреса. Поле `endpoint: "demo:"` – заглушка «заявка принята», на бою – адрес приёмника сайта.

## Страница без Astro (прототип, статичный HTML)

```html
<link rel="stylesheet" href="https://tema-mail.github.io/vidzhety/vidzhety.css">
…
<div data-vidzhety data-src="vidzhety-glavnaya.json"></div>
<script src="https://tema-mail.github.io/vidzhety/vidzhety.js"></script>   <!-- перед </body> -->
```

Конфиг – файлом рядом со страницей. Для прототипа: `"demo": true` (без случайной контрольной группы, память до закрытия
вкладки, `?w-device=phone`, `?w-ref=search` в адресе), `"consent": false` (окна cookie нет), `"endpoint": "demo:"` (заявки никуда не уходят).
Классы модуля – с префиксом `vz-`, с классами комплекта прототипа (`w-*`) не пересекаются.
