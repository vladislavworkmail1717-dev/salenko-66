# salenko-66 — ДЗ 66.1. Розширення функціональності сервера Express з MongoDB Atlas

Express-сервер з авторизацією (Passport), шаблонами EJS і MongoDB Atlas. У ДЗ 66.1 до читання даних (65.1) додано створення, оновлення та видалення документів колекції `products` (CRUD-API на `/api/products`), а також розширене читання `find` з проекцією (`projection`).

## Технології
Node.js, Express 5, MongoDB Atlas, Mongoose (модель і сторінка `/products`), нативний драйвер MongoDB (CRUD-API), Passport (`passport-local`), `express-session`, EJS, `bcryptjs`, `dotenv`.

## Налаштування MongoDB Atlas
1. Створити кластер (Cluster0) і базу даних.
2. **Database Access** — створити користувача бази з правами читання й запису.
3. **Network Access** — додати IP-адресу (для деплою — `0.0.0.0/0`).
4. **Connect → Drivers** — скопіювати рядок підключення, підставити логін, пароль і назву бази.

## Запуск
```bash
npm install
cp .env.example .env     # заповнити значення
npm run seed             # (необовʼязково) тестові товари, якщо колекція порожня
npm start                # або npm run dev
```

Змінні `.env`:

| Змінна | Опис |
|---|---|
| `MONGODB_URI` | рядок підключення до Atlas (з назвою бази) |
| `SESSION_SECRET` | секрет для `express-session` |
| `PORT` | порт сервера (за замовчуванням `3000`) |

## Структура
```
src/
  server.js              — підключення до БД, потім запуск сервера
  app.js                 — Express, сесії, Passport, підключення маршрутів
  config/db.js           — підключення до Atlas (Mongoose)
  config/passport.js     — стратегія passport-local
  middleware/auth.js     — ensureAuth / ensureGuest
  models/product.js      — Mongoose-модель Product (колекція products)
  models/users.js        — користувачі (в памʼяті)
  routes/auth.js         — /register, /login, /logout
  routes/products.js     — сторінка /products (читання, ДЗ 65.1)
  routes/productsApi.js  — CRUD-API /api/products (ДЗ 66.1)
  seed.js                — тестові товари
  views/                 — EJS-шаблони
```

## Сторінки (з попередніх ДЗ)
`GET /` — головна, `GET /register`, `GET /login`, `POST /logout`, `GET /protected` (тільки для авторизованих), `GET /products` — таблиця товарів з Atlas.

---

## ДЗ 66.1 — CRUD-API `/api/products`

### Де і як реалізовано
Усі маршрути знаходяться у `src/routes/productsApi.js` і підключені в `src/app.js` за префіксом `/api/products`.

Для операцій використовується **нативний драйвер MongoDB**, який входить до складу Mongoose і працює через те саме підключення, що відкривається в `config/db.js`:

```js
const { ObjectId } = mongoose.mongo;
const col = () => mongoose.connection.db.collection('products');
```

Метод `col()` повертає нативну колекцію, тому у маршрутах викликаються методи драйвера напряму: `insertOne`, `insertMany`, `updateOne`, `updateMany`, `replaceOne`, `deleteOne`, `deleteMany`, `find`, `findOne`.

Оскільки нативний драйвер оминає валідацію Mongoose, у роутері є власна перевірка полів (`validate`, `buildProduct`, `buildSet`): допустимі поля `name`, `category`, `price`, `description`, `inStock`; для нових документів підставляються значення за замовчуванням (`description: ""`, `inStock: true`) і додаються `createdAt` / `updatedAt`.

### Таблиця маршрутів

| Метод | Маршрут | Операція MongoDB | Опис |
|---|---|---|---|
| GET | `/api/products` | `find` + `projection` | Список: фільтри, сортування, ліміт, вибір полів |
| GET | `/api/products/:id` | `findOne` + `projection` | Один документ |
| POST | `/api/products` | `insertOne` | Створити один документ |
| POST | `/api/products/many` | `insertMany` | Створити кілька документів |
| PATCH | `/api/products/:id` | `updateOne` | Оновити поля одного документа (`$set`) |
| PATCH | `/api/products/many` | `updateMany` | Оновити поля всіх документів за фільтром |
| PUT | `/api/products/:id` | `replaceOne` | Повна заміна документа |
| DELETE | `/api/products/:id` | `deleteOne` | Видалити один документ |
| DELETE | `/api/products/many` | `deleteMany` | Видалити документи за фільтром (порожній фільтр заборонений) |

> Маршрути `/many` оголошені перед `/:id`, щоб Express не сприймав слово `many` як id.

### Приклади запитів і відповідей

Значення `_id` у прикладах умовні — підставте реальні зі своєї бази.

#### insertOne — `POST /api/products`
```bash
curl -X POST http://localhost:3000/api/products \
  -H "Content-Type: application/json" \
  -d '{"name":"Неон блакитний","category":"fish","price":25}'
```
`201 Created`:
```json
{ "acknowledged": true, "insertedId": "6710a1b2c3d4e5f600000001" }
```
Некоректні дані — `400`: `{ "error": "price має бути числом не менше 0" }`

#### insertMany — `POST /api/products/many`
```bash
curl -X POST http://localhost:3000/api/products/many \
  -H "Content-Type: application/json" \
  -d '{"items":[{"name":"Анубіас","category":"plants","price":80},{"name":"Фільтр","category":"equipment","price":450}]}'
```
`201 Created`:
```json
{
  "insertedCount": 2,
  "insertedIds": { "0": "6710a1b2c3d4e5f600000002", "1": "6710a1b2c3d4e5f600000003" }
}
```

#### updateOne — `PATCH /api/products/:id`
```bash
curl -X PATCH http://localhost:3000/api/products/6710a1b2c3d4e5f600000001 \
  -H "Content-Type: application/json" \
  -d '{"set":{"price":30}}'
```
`200 OK`:
```json
{ "matchedCount": 1, "modifiedCount": 1 }
```
Документ не знайдено — `404`: `{ "error": "Не знайдено" }`. Невалідний id — `400`: `{ "error": "Невалідний id" }`.

#### updateMany — `PATCH /api/products/many`
```bash
curl -X PATCH http://localhost:3000/api/products/many \
  -H "Content-Type: application/json" \
  -d '{"filter":{"category":"fish"},"set":{"inStock":false}}'
```
`200 OK`:
```json
{ "matchedCount": 2, "modifiedCount": 2 }
```
Порожній `filter` — `400`: `{ "error": "filter не може бути порожнім" }`.

#### replaceOne — `PUT /api/products/:id`
Документ замінюється повністю: поля, яких немає в тілі запиту, отримують значення за замовчуванням, а `createdAt` зникає.
```bash
curl -X PUT http://localhost:3000/api/products/6710a1b2c3d4e5f600000001 \
  -H "Content-Type: application/json" \
  -d '{"name":"Гупі","category":"fish","price":20}'
```
`200 OK`:
```json
{ "matchedCount": 1, "modifiedCount": 1 }
```

#### deleteOne — `DELETE /api/products/:id`
```bash
curl -X DELETE http://localhost:3000/api/products/6710a1b2c3d4e5f600000001
```
`200 OK`:
```json
{ "deletedCount": 1 }
```
Повторне видалення — `404`: `{ "error": "Не знайдено" }`.

#### deleteMany — `DELETE /api/products/many`
```bash
curl -X DELETE http://localhost:3000/api/products/many \
  -H "Content-Type: application/json" \
  -d '{"filter":{"category":"equipment"}}'
```
`200 OK`:
```json
{ "deletedCount": 1 }
```
Порожній фільтр (`{}`) — `400`: `{ "error": "filter не може бути порожнім" }`.

#### find + projection — `GET /api/products`
Параметри запиту:

| Параметр | Опис |
|---|---|
| `category` | фільтр за категорією |
| `minPrice`, `maxPrice` | діапазон ціни (`$gte`, `$lte`) |
| `fields` | projection — поля через кому, наприклад `name,price` |
| `sort`, `order` | поле сортування (`name`, `category`, `price`, `createdAt`) і напрям (`asc` / `desc`) |
| `limit` | максимум документів (до 200, за замовчуванням 50) |

```bash
curl "http://localhost:3000/api/products?minPrice=30&fields=name,price&sort=price&order=desc&limit=5"
```
`200 OK` (повертаються лише `_id`, `name`, `price`):
```json
{
  "count": 2,
  "items": [
    { "_id": "6710a1b2c3d4e5f600000003", "name": "Фільтр", "price": 450 },
    { "_id": "6710a1b2c3d4e5f600000002", "name": "Анубіас", "price": 80 }
  ]
}
```

#### findOne + projection — `GET /api/products/:id`
```bash
curl "http://localhost:3000/api/products/6710a1b2c3d4e5f600000001?fields=name,price"
```
`200 OK`:
```json
{ "_id": "6710a1b2c3d4e5f600000001", "name": "Неон блакитний", "price": 25 }
```

### Коди відповідей
`200` — успіх, `201` — створено, `400` — невалідні дані, id або JSON, `404` — документ чи маршрут не знайдено, `500` — помилка сервера або БД.
