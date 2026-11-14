# tidyfetch

[![CI](https://github.com/axtew/tidyfetch/actions/workflows/ci.yml/badge.svg)](https://github.com/axtew/tidyfetch/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/tidyfetch)](https://www.npmjs.com/package/tidyfetch)
[![license](https://img.shields.io/npm/l/tidyfetch)](./LICENSE)

Небольшой HTTP-клиент поверх `fetch`. Запросы, которые одновременно получили 401, ждут одно общее обновление токена и уходят ещё раз. Ошибки - классы, их можно различить через `instanceof`, у каждого запроса есть таймаут, а ответ можно проверить схемой.

[Демо](https://tidyfetch.stevvy1122.workers.dev) · [English version](./README.md)

```ts
import { createClient, HttpError } from "tidyfetch";

const api = createClient({
  baseUrl: "/api",
  headers: () => ({ Authorization: `Bearer ${tokens.access}` }),
  refresh: async () => {
    const { data } = await api.post<Tokens>("/auth/refresh", {
      body: { refresh: tokens.refresh },
      skipRefresh: true,
    });
    tokens.save(data);
    return true;
  },
});

try {
  const { data: user } = await api.get<User>("/me");
  showProfile(user);
} catch (error) {
  if (error instanceof HttpError && error.status === 404) showNotFound();
  else throw error;
}
```

- **Один refresh на параллельные 401.** Запросы, которые получили 401, пока идёт обновление токена, ждут это же обновление, потом каждый уходит ещё раз. Второй 401 - окончательный.
- **Свой класс ошибки на каждый случай.** `HttpError`, `TimeoutError`, `NetworkError`, `ParseError`, `SchemaError`. Отменённый запрос завершается стандартным `AbortError`.
- **Таймаут у каждого запроса.** По умолчанию 30 секунд на попытку, через `AbortSignal`.
- **Типизированная `data`.** Из параметра типа, из `responseType` или из схемы (Zod, Valibot, ArkType через Standard Schema).
- **Обычная рутина вокруг fetch уже сделана.** Относительный `baseUrl`, массивы в query, слияние заголовков, тела JSON и `FormData`, пустые ответы.
- **Маленький, без зависимостей.** 3.1 kB min + gzip, см. [Размер](#размер).

## Содержание

- [Зачем](#зачем)
- [Установка](#установка)
- [Быстрый старт](#быстрый-старт)
- [Авторизация](#авторизация)
- [Запросы](#запросы)
- [Ответы](#ответы)
- [Ошибки](#ошибки)
- [Таймауты и отмена](#таймауты-и-отмена)
- [Обновление токена подробно](#обновление-токена-подробно)
- [Проверка схемой](#проверка-схемой)
- [Хуки](#хуки)
- [Повторы](#повторы)
- [API](#api)
- [Размер](#размер)
- [Тесты](#тесты)
- [Лицензия](#лицензия)

## Зачем

tidyfetch вырос из HTTP-слоя рабочего приложения. Главное в нём - обновление токена: когда access-токен истекает, сразу несколько запросов получают 401, и им нужно дождаться одного обновления, а не запускать каждому своё.

В первой версии здесь была ошибка. Счётчик повторов жил внутри общего promise обновления, и каждый новый запрос обнулял его для остальных. Если сервер продолжал отвечать 401, запросы повторялись бесконечно. В tidyfetch лимит принадлежит самому запросу: он повторяется не больше одного раза, а второй 401 уходит вызывающему коду.

Остальное - то, что любой проект рано или поздно пишет вокруг `fetch`: базовый адрес, query, заголовки, JSON, таймаут, ошибки, по которым понятно, что случилось. Тесты покрывают параллельные 401 и гонки вокруг них, а в [демо](https://tidyfetch.stevvy1122.workers.dev) видно пять запросов, пять 401 и один refresh.

## Установка

```sh
pnpm add tidyfetch
# или: npm install tidyfetch
```

- Только ESM, ES2022.
- Браузеры с `AbortSignal.any`: Chrome 116, Firefox 124, Safari 17.4. Node 20.3 или новее.
- Для типов нужен TypeScript 5.0 или новее.
- Без зависимостей.

## Быстрый старт

Один клиент на приложение, в отдельном модуле:

```ts
// api.ts
import { createClient } from "tidyfetch";

export const api = createClient({ baseUrl: "/api" });
```

Дальше методы:

```ts
import { HttpError } from "tidyfetch";

import { api } from "./api";

interface User {
  id: number;
  name: string;
}

const { data: user } = await api.get<User>("/users/1");
const { data: created } = await api.post<User>("/users", { body: { name: "Anna" } });
await api.patch(`/users/${created.id}`, { body: { name: "Anna K." } });
await api.delete(`/users/${created.id}`);

try {
  await api.get("/users/999");
} catch (error) {
  if (error instanceof HttpError && error.status === 404) console.log("Нет такого пользователя");
  else throw error;
}
```

При статусе 2xx запрос возвращает `{ ok, status, statusText, headers, url, data }`, при любом другом бросает ошибку. `get`, `post`, `put`, `patch` и `delete` - короткие формы `api.request(method, path, options)`; через него же отправляются `HEAD` и `OPTIONS`.

## Авторизация

### Bearer-токен

```ts
import { createClient } from "tidyfetch";

import { tokens } from "./tokens"; // там, где приложение их хранит

export const api = createClient({
  baseUrl: "/api",
  // Вызывается перед каждым запросом, поэтому уходит текущий токен.
  headers: () => (tokens.access ? { Authorization: `Bearer ${tokens.access}` } : {}),
  refresh: async () => {
    if (!tokens.refresh) return false;
    const { data } = await api.post<Tokens>("/auth/refresh", {
      body: { refresh: tokens.refresh },
      skipRefresh: true,
    });
    tokens.save(data);
    return true;
  },
  // Неверный пароль должен дойти до формы входа как 401.
  skipRefresh: (request) => request.url.endsWith("/auth/login"),
});
```

- `headers` в виде функции вызывается перед каждым запросом и может быть async. Токен читается в момент отправки, поэтому повтор после refresh уходит уже с новым.
- `refresh` возвращает `true`, когда новые токены на месте. Тогда каждый запрос, получивший 401, уходит ещё раз. `false` или исключение значат, что сессию не продлить, и эти запросы завершаются своим 401.
- У запроса внутри `refresh` стоит `skipRefresh: true`. Без него 401 от эндпоинта обновления ждал бы того самого refresh, частью которого он является, и ни один из них никогда бы не завершился.
- Опция `skipRefresh` исключает вход. 401 там означает неверный пароль, и он должен дойти до формы, а не запустить refresh.

### Cookie

С HttpOnly cookie браузер сам отправляет сессию, и клиенту не нужен код для токенов:

```ts
import { createClient } from "tidyfetch";

function readCookie(name: string): string | undefined {
  return document.cookie
    .split("; ")
    .find((pair) => pair.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

export const api = createClient({
  baseUrl: "https://api.example.com",
  // Отправлять cookie на другой origin. Если API на том же origin, не нужно.
  credentials: "include",
  // Django проверяет CSRF-токен в заголовке у небезопасных методов.
  headers: () => {
    const csrf = readCookie("csrftoken");
    return csrf === undefined ? {} : { "X-CSRFToken": csrf };
  },
  // Сервер ставит новые cookie, повтор уходит уже с ними.
  refresh: async () => {
    await api.post("/auth/refresh", { skipRefresh: true });
    return true;
  },
  skipRefresh: (request) => request.url.endsWith("/auth/login"),
});
```

Если эндпоинт обновления отвечает ошибкой, `api.post` бросает её, и каждый ждущий запрос завершается своим 401, а эта ошибка лежит в `cause`. Значит, сессия закончилась. Чтобы отправить пользователя на страницу входа, поймайте эту ошибку внутри `refresh`, сделайте там переход и верните `false`.

## Запросы

### URL и baseUrl

```ts
const api = createClient({ baseUrl: "/api" });

await api.get("/users"); // /api/users
await api.get("users"); // /api/users, слэши склеиваются
await api.get("https://cdn.example.com/config.json"); // полный адрес идёт мимо baseUrl
```

`baseUrl` может быть относительным (`/api`) или абсолютным (`https://api.example.com/v1`). Путь со схемой (`https://...`) используется как есть. Адрес передаётся в `fetch` строкой, поэтому относительный работает в браузере; на сервере `fetch` нужен абсолютный `baseUrl`.

### Query

```ts
await api.get("/items", {
  query: { tag: ["red", "blue"], page: 2, archived: false, search: undefined },
});
// /api/items?tag=red&tag=blue&page=2&archived=false
```

- Значения - строки, числа, boolean или массивы из них. Массив повторяет ключ.
- `null` и `undefined` пропускаются, поэтому необязательные фильтры можно передавать как есть.
- Готовый `URLSearchParams` тоже подходит.
- Другие значения (`Date`, вложенный объект) - ошибка типов и `TypeError` во время работы. Сначала преобразуйте их, например `date.toISOString()`.

Объекты query с типом-`interface` принимаются, так что фильтры можно передавать прямо из параметра функции:

```ts
interface ItemFilters {
  page?: number;
  tag?: string[];
}

function getItems(filters: ItemFilters) {
  return api.get<Item[]>("/items", { query: filters });
}

await api.get("/items", { query: { from: new Date() } }); // ошибка типов: сначала преобразуйте дату
```

### Заголовки

```ts
const api = createClient({
  baseUrl: "/api",
  headers: () => ({ Authorization: `Bearer ${tokens.access}`, "Accept-Language": "en" }),
});

// Добавляет заголовок, общие остаются.
await api.get("/reports", { headers: { "X-Request-Id": crypto.randomUUID() } });

// Заменяет общий заголовок с тем же именем (регистр имени не важен).
await api.get("/reports", { headers: { "accept-language": "de" } });

// Убирает общий заголовок: на presigned-ссылку S3 наш токен уходить не должен.
await api.put(uploadUrl, { body: file, headers: { Authorization: undefined } });
```

Общие заголовки клиента и заголовки запроса сливаются для каждого запроса: заголовок запроса побеждает по имени. Подходит любой `HeadersInit`: объект, `Headers`, массив пар. В форме объекта `undefined` убирает общий заголовок для этого запроса. Для совсем другого API со своими заголовками лучше завести второй `createClient`.

### Тело

```ts
// Объект уходит как JSON с Content-Type: application/json.
await api.post("/notes", { body: { text: "Hello" } });

// FormData уходит как multipart, boundary добавляет fetch.
const form = new FormData();
form.append("file", file);
await api.post("/upload", { body: form });

// Эти уходят как есть, их Content-Type выбирает fetch.
await api.post("/search", { body: new URLSearchParams({ q: "fetch" }) });
await api.put("/files/readme.txt", { body: "plain text" });
```

- Как есть уходят: `string`, `Blob` и `File`, `ArrayBuffer`, типизированные массивы, `FormData`, `URLSearchParams`, `ReadableStream`.
- Всё остальное проходит через `JSON.stringify` и получает `Content-Type: application/json`, если `Content-Type` ещё не задан (например, `application/merge-patch+json`).
- `FormData` всегда уходит без заданного `Content-Type`. Тип multipart верен только с boundary, который генерирует `fetch`, поэтому заголовок из клиента или запроса сломал бы загрузку.
- `Content-Type: application/json` в общих заголовках клиента не нужен: объекты получают его и так. А заданный там, он пометил бы как JSON ещё и строки, файлы и `URLSearchParams`.

Тело `ReadableStream` уходит с `duplex: "half"`, этого требует `fetch`. Потоковая отправка в браузерах поддерживается слабо: только Chromium, только по HTTP/2 и новее. Поток читается один раз, поэтому такой запрос не повторяется после обновления токена: он завершается своим 401, и вызывающий код может отправить новый поток, токен к этому моменту уже свежий.

## Ответы

### Форма

```ts
const response = await api.get<User>("/me");

response.ok; // true: статус вне 200-299 бросает HttpError
response.status; // 200
response.statusText; // "OK", по HTTP/2 может быть пустым
response.headers; // Headers
response.url; // итоговый адрес после редиректов
response.data; // User
```

### Тип тела

Без `responseType` тело читается по `Content-Type`:

| Content-Type                          | `data`           |
| ------------------------------------- | ---------------- |
| `application/json`, `*+json`          | разобранный JSON |
| `text/*`, XML, без `Content-Type`     | `string`         |
| всё остальное (картинки, PDF, архивы) | `Blob`           |

`responseType` задаёт его явно: `"json"`, `"text"`, `"blob"`, `"arrayBuffer"` или `"stream"` (непрочитанный `ReadableStream` из `response.body`).

Пустые тела:

- Без `responseType` или с `"json"` отсутствующее или пустое тело даёт `data: undefined`. Сюда относятся 204, 205, `HEAD` и 200 без содержимого. Битый JSON в ответе 2xx бросает `ParseError`.
- С `"text"`, `"blob"`, `"arrayBuffer"` или `"stream"` в `data` всегда значение этого типа, пустое, если тела нет.
- Тело ошибки читается по своему `Content-Type`, что бы ни стояло в `responseType`: неудачное скачивание файла обычно отвечает JSON.

### Тип data

```ts
const { data: user } = await api.get<User>("/me"); // User, на ваше слово, без проверки
const { data: csv } = await api.get("/export", { responseType: "text" }); // string
const { data: pdf } = await api.get("/report", { responseType: "blob" }); // Blob
const { data: me } = await api.get("/me", { schema: UserSchema }); // результат схемы, проверено
const { data: raw } = await api.get("/me"); // unknown

await api.get<User>("/export", { responseType: "text" }); // ошибка типов: уберите <User>, data - string
```

Параметр типа `T` описывает JSON. С не-JSON `responseType` или со `schema` тип `data` следует за ними, а явный `T` рядом с ними - ошибка типов: уберите `T`.

## Ошибки

Любая неудача отправленного запроса - один из пяти классов. Все наследуют `Error` и несут `request`: `{ method, url, headers }` в том виде, в каком запрос ушёл.

| Класс          | Когда                                                              | Поля                                                                |
| -------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `HttpError`    | сервер ответил статусом вне 200-299                                | `status`, `statusText`, `data` (тело ошибки), `response`, `request` |
| `TimeoutError` | ответа нет за `timeout`                                            | `timeout` (мс), `request`, `cause`                                  |
| `NetworkError` | `fetch` упал без ответа: нет сети, DNS, CORS, соединение отклонено | `request`, `cause` (ошибка от `fetch`)                              |
| `ParseError`   | тело ответа 2xx не разбирается, например битый JSON                | `response`, `request`, `cause` (`SyntaxError`)                      |
| `SchemaError`  | тело ответа 2xx не прошло `schema` запроса                         | `issues`, `data` (тело до схемы), `response`, `request`             |

`HttpError.data` - тело ошибки, разобранное по его `Content-Type`, или его текст, если оно не разбирается. Тип `RequestError` - объединение всех пяти.

```ts
import { HttpError, NetworkError, TimeoutError } from "tidyfetch";

try {
  await api.post("/orders", { body: order });
} catch (error) {
  if (error instanceof HttpError && error.status === 422) {
    showFieldErrors(error.data);
  } else if (error instanceof NetworkError || error instanceof TimeoutError) {
    showToast("Нет связи, попробуйте ещё раз");
  } else {
    throw error;
  }
}
```

Запрос, отменённый через свой `signal`, - не ошибка библиотеки: он завершается причиной отмены сигнала, по умолчанию `DOMException` с именем `AbortError`, как и обычный `fetch`. TanStack Query и другой код, который отменяет запросы, уже умеет с этим работать.

```ts
async function search(q: string, signal: AbortSignal) {
  try {
    const { data } = await api.get<SearchResult>("/search", { query: { q }, signal });
    return data;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return undefined;
    throw error;
  }
}
```

## Таймауты и отмена

```ts
const api = createClient({ baseUrl: "/api", timeout: 10_000 });

await api.get("/reports/yearly", { timeout: 60_000 }); // дольше для одного запроса
await api.get("/events", { responseType: "stream", timeout: 5_000 }); // 5 с на получение заголовков
await api.get("/export", { timeout: 0 }); // без таймаута
```

- По умолчанию 30 секунд. `timeout` клиента задаёт его для всех запросов, `timeout` запроса - для одного. `0` выключает.
- Таймаут покрывает и отправку запроса, и чтение тела.
- Он считается на попытку: у повтора после обновления токена свой таймаут, а ожидание самого обновления не считается.
- С `responseType: "stream"` он останавливается, как только пришли заголовки, поэтому долгое скачивание, server-sent events или потоковый ответ не обрываются. `signal` вызывающего кода продолжает работать.
- `signal` вызывающего кода отменяет запрос в любой момент, в том числе во время ожидания refresh. Сам refresh при этом продолжается для остальных запросов.
- Асинхронная проверка в схеме (редкий случай, например async refinement) не покрывается ни таймаутом, ни сигналом.

## Обновление токена подробно

Когда запрос получает 401, у клиента есть `refresh`, и запрос не исключён через `skipRefresh`:

- **Одно обновление на всех.** Первый 401 запускает `refresh`. Каждый запрос, получивший 401, пока он идёт, ждёт этот же вызов.
- **Один повтор.** При `true` каждый ждущий запрос уходит ещё раз, общие заголовки клиента считаются заново. 401 у повтора - окончательный: он уходит вызывающему коду как `HttpError`, нового refresh для него нет. Именно это не даёт бесконечно опрашивать сервер, который на всё отвечает 401.
- **Запоздавший 401.** Запрос, ушедший со старым токеном, чей 401 пришёл, когда обновление уже закончилось, повторяется без второго refresh.
- **Неудача.** `false` или исключение: каждый ждущий запрос завершается своим 401 `HttpError`. То, что бросил `refresh`, лежит в `cause` этой ошибки.
- **Тело-поток** второй раз не отправляется: такой запрос после refresh завершается своим 401.
- **Только 401.** 403 значит "нельзя", а не "не вошли", и refresh не запускает.
- **Отмена.** Сигнал вызывающего кода прерывает ожидание этого запроса, а не сам refresh.
- **Запросам внутри `refresh`** нужен `skipRefresh: true` (или совпадение с опцией `skipRefresh`). Иначе их 401 ждёт тот refresh, частью которого они являются, и ничего не завершается.

В [демо](https://tidyfetch.stevvy1122.workers.dev) это видно по шагам: пять запросов, пять 401, один refresh, пять повторов, плюс переключатели для неудачного refresh и запоздавшего 401.

## Проверка схемой

Подходит любая [Standard Schema](https://standardschema.dev): Zod, Valibot, ArkType и другие. tidyfetch от них не зависит, он знает только интерфейс.

```ts
import { z } from "zod";

const UserSchema = z.object({ id: z.number(), name: z.string(), email: z.email() });

const { data } = await api.get("/me", { schema: UserSchema });
// data: { id: number; name: string; email: string }
```

Тело, которое не прошло проверку, бросает `SchemaError` с проблемами, а в сообщении названа первая:

```
GET /api/me: response does not match the schema: email: Invalid email address
```

Если проблем больше, сообщение заканчивается на `(and 2 more issues)`; все они лежат в `error.issues`. В `data` попадает результат схемы, так что преобразования и значения по умолчанию применяются. Проверяются только успешные тела, после `responseType`. С Valibot так же:

```ts
import * as v from "valibot";

const UserSchema = v.object({ id: v.number(), name: v.string() });
const { data } = await api.get("/me", { schema: UserSchema });
```

## Хуки

```ts
const api = createClient({
  baseUrl: "/api",
  onRequest: (request) => {
    console.debug(request.method, request.url);
  },
  onResponse: (response, request) => {
    console.debug(response.status, request.method, request.url);
  },
  onError: (error, request) => {
    errorTracker.capture(error, { method: request.method, url: request.url });
  },
});
```

Хуки только наблюдают: их не ждут, то, что они возвращают, игнорируется, и изменить запрос или его результат они не могут.

- `onRequest` вызывается перед каждой попыткой, включая повтор после refresh.
- `onResponse` вызывается один раз, при итоговом успехе, `data` уже прошла схему.
- `onError` вызывается один раз, с той ошибкой, которой запрос в итоге завершился. 401, который вылечил refresh, сюда не попадает.
- `onError` не вызывается, когда запрос отменил вызывающий код, и для ошибок до отправки: функция `headers` бросила исключение, неверное значение в query, тело не сериализуется. Такие ошибки получает только вызывающий код.
- Исключение в хуке не ломает запрос. Оно уходит в `reportError` в браузере (видно в консоли и доходит до трекеров ошибок) и в `console.error` в Node, так что сломанная строчка логирования не уронит сервер.

`request.headers` и `error.request.headers` содержат заголовок `Authorization` в том виде, в каком он ушёл. Объект `Headers` превращается в `{}` при `JSON.stringify`, так что случайно он не утечёт, но если копируете заголовки в лог, уберите `Authorization` и `Cookie`.

## Повторы

tidyfetch сам не повторяет неудачные запросы, и это сделано намеренно:

- **Повторы перемножаются.** TanStack Query и так повторяет упавший запрос 3 раза. Если клиент добавит ещё 3 своих, один сломанный эндпоинт получит 4 x 4 = 16 запросов.
- **POST нельзя безопасно повторить.** Запрос может дойти до сервера и потерять ответ на обратном пути. Отправленный ещё раз, он создаст заказ дважды.
- **Приложение знает лучше.** Какие ошибки стоит повторять, сколько ждать, показывать ли спиннер или сообщение: это зависит от экрана, а не от HTTP-клиента.

С классами ошибок правило получается коротким. С TanStack Query:

```ts
import { QueryClient } from "@tanstack/query-core"; // или @tanstack/react-query
import { HttpError, NetworkError, TimeoutError } from "tidyfetch";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (failureCount >= 2) return false; // не больше 2 повторов
        // 4xx от повтора не изменится: нет страницы, ошибка валидации, нет доступа.
        if (error instanceof HttpError) return error.status >= 500;
        return error instanceof NetworkError || error instanceof TimeoutError;
      },
    },
  },
});
```

Мутации TanStack Query по умолчанию не повторяет, и для POST это правильно.

Без TanStack Query то же самое для идемпотентных методов делает маленькая обёртка:

```ts
import { HttpError, NetworkError, TimeoutError } from "tidyfetch";

const IDEMPOTENT = new Set(["GET", "HEAD", "OPTIONS", "PUT", "DELETE"]);

function isRetryable(error: unknown): boolean {
  const temporary =
    (error instanceof HttpError && error.status >= 500) ||
    error instanceof NetworkError ||
    error instanceof TimeoutError;
  return temporary && IDEMPOTENT.has(error.request.method);
}

export async function withRetry<T>(send: () => Promise<T>, retries = 2): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await send();
    } catch (error) {
      if (attempt >= retries || !isRetryable(error)) throw error;
      // 0.5 с, 1 с, 2 с...
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
}

const { data: report } = await withRetry(() => api.get<Report>("/reports/42"));
```

## API

### Опции createClient

| Опция         | Тип                                                         | По умолчанию       | Что делает                                                                                                         |
| ------------- | ----------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `baseUrl`     | `string`                                                    | обязательна        | Префикс для каждого относительного пути. Может быть относительным (`/api`). Полный адрес в запросе идёт мимо него. |
| `headers`     | `HeadersInit` или `() => HeadersInit \| Promise<...>`       | нет                | Уходят с каждым запросом. Функция вызывается перед каждым запросом, токен читается в момент отправки.              |
| `credentials` | `RequestCredentials`                                        | как у `fetch`      | Передаётся в `fetch`. `"include"` отправляет cookie на другой origin.                                              |
| `timeout`     | `number`                                                    | `30000`            | Миллисекунды на попытку, вместе с телом. `0` выключает.                                                            |
| `refresh`     | `() => Promise<boolean>`                                    | нет                | Обновляет доступ после 401. `true`: один повтор. См. [Обновление токена подробно](#обновление-токена-подробно).    |
| `skipRefresh` | `(request: HttpRequest) => boolean`                         | нет                | Запросы, чей 401 никогда не запускает refresh, например вход.                                                      |
| `onRequest`   | `(request: HttpRequest) => unknown`                         | нет                | Перед каждой попыткой. См. [Хуки](#хуки).                                                                          |
| `onResponse`  | `(response: HttpResponse, request: HttpRequest) => unknown` | нет                | Один раз, при успехе.                                                                                              |
| `onError`     | `(error: RequestError, request: HttpRequest) => unknown`    | нет                | Один раз, при итоговой ошибке.                                                                                     |
| `fetch`       | `(url: string, init: RequestInit) => Promise<Response>`     | глобальный `fetch` | Свой `fetch`: тесты, SSR, фейковый сервер. Глобальный читается в момент вызова.                                    |

### Опции запроса

| Опция          | Тип                                                       | По умолчанию      | Что делает                                                                         |
| -------------- | --------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------- |
| `query`        | объект или `URLSearchParams`                              | нет               | Добавляется к адресу. Массивы повторяют ключ, `null` и `undefined` пропускаются.   |
| `headers`      | `HeadersInit` или объект со значениями `undefined`        | нет               | Сливаются поверх общих заголовков. `undefined` убирает общий заголовок.            |
| `body`         | `unknown`                                                 | нет               | Нет у `get`. Объекты уходят как JSON, `FormData`, строки, файлы и потоки как есть. |
| `timeout`      | `number`                                                  | `timeout` клиента | Для этого запроса. `0` выключает.                                                  |
| `signal`       | `AbortSignal`                                             | нет               | Отменяет запрос, в том числе ожидание refresh.                                     |
| `responseType` | `"json" \| "text" \| "blob" \| "arrayBuffer" \| "stream"` | по `Content-Type` | Как читать успешное тело. Задаёт тип `data`.                                       |
| `schema`       | Standard Schema                                           | нет               | Проверяет успешную `data`; `data` получает тип результата схемы.                   |
| `skipRefresh`  | `boolean`                                                 | `false`           | 401 этого запроса никогда не запускает refresh. Для запросов внутри `refresh`.     |

Любая необязательная опция принимает и `undefined`, так что значение типа `T | undefined` можно передать дальше при включённом `exactOptionalPropertyTypes`.

Пакет также экспортирует типы `HttpClient`, `ClientOptions`, `RequestOptions`, `HttpRequest`, `HttpResponse`, `RequestError`, `FetchFunction`, `ResponseBodyType` и `StandardSchemaV1`.

## Размер

Одно и то же маленькое приложение в каждой библиотеке: клиент с базовым адресом, таймаутом и заголовком `Authorization`, который читается при отправке, GET с JSON, POST с JSON, проверка на 404. Минификация esbuild, gzip, зависимости библиотек считаются. Метод и код: [`bench/size`](./bench/size), запуск: `pnpm bench:size`.

| Библиотека    | min + gzip | Оговорки                                                                                            |
| ------------- | ---------: | --------------------------------------------------------------------------------------------------- |
| wretch        |     2.1 kB | таймаут - отдельный addon; один тип ошибки                                                          |
| **tidyfetch** | **3.1 kB** | общий refresh токена, класс ошибки на каждый случай, Standard Schema, хуки; без повторов и progress |
| ofetch        |     4.1 kB | автоматические повторы, `destr` и `ufo` для JSON и адресов; один тип ошибки                         |
| ky            |    10.9 kB | повторы с паузами, много хуков, progress загрузки и скачивания, Standard Schema                     |
| axios         |    21.9 kB | interceptors, адаптеры XHR и `fetch`, progress, гораздо больше опций                                |

Со всеми остальными библиотеками здесь общий refresh на параллельные 401 пишется руками, обычно в interceptor или хуке. Замер в ноябре 2026, версии в [`bench/size/package.json`](./bench/size/package.json).

## Тесты

Опция `fetch` принимает любую функцию с сигнатурой `fetch`, поэтому тестам не нужны ни сеть, ни библиотека моков:

```ts
import { createClient, type FetchFunction } from "tidyfetch";

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const fakeFetch: FetchFunction = async (url, init) => {
  if (url === "/api/me" && init.method === "GET") return json({ id: 1, name: "Anna" });
  return json({ detail: "Not found" }, 404);
};

const api = createClient({ baseUrl: "/api", fetch: fakeFetch });
const { data } = await api.get<{ id: number; name: string }>("/me");
```

Через эту же опцию при серверном рендеринге передаётся `fetch` фреймворка. Без неё глобальный `fetch` читается при каждом вызове, поэтому шпион или мок-сервер (например, MSW), подключённые после `createClient`, всё равно работают. Демо так и работает на фейковом сервере: [`example/src/fakeServer.ts`](./example/src/fakeServer.ts).

## Лицензия

[MIT](./LICENSE)
