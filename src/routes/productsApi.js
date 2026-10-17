const express = require('express');
const mongoose = require('mongoose');

const router = express.Router();

// Нативний драйвер MongoDB, що входить до складу Mongoose, і те саме підключення,
// яке вже відкрито в config/db.js. Колекція в Atlas: products.
const { ObjectId } = mongoose.mongo;
const col = () => mongoose.connection.db.collection('products');

const FIELDS = ['name', 'category', 'price', 'description', 'inStock'];
const SORT_FIELDS = ['name', 'category', 'price', 'createdAt'];

/* ---------- допоміжні функції ---------- */

const isValidId = (id) => typeof id === 'string' && /^[a-f\d]{24}$/i.test(id);
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const getBody = (req) => (isPlainObject(req.body) ? req.body : {});

// Обгортка: будь-яка помилка БД -> JSON 500
const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// Залишаємо тільки поля товару (як у моделі Product)
function pick(src) {
  const out = {};
  for (const k of FIELDS) if (src[k] !== undefined) out[k] = src[k];
  return out;
}

// partial = true — для оновлення (перевіряємо лише передані поля)
function validate(d, partial) {
  const need = (k) => !partial || k in d;
  if (need('name') && (typeof d.name !== 'string' || !d.name.trim()))
    return 'name має бути непорожнім рядком';
  if (need('category') && (typeof d.category !== 'string' || !d.category.trim()))
    return 'category має бути непорожнім рядком';
  if (need('price') && (typeof d.price !== 'number' || !(d.price >= 0)))
    return 'price має бути числом не менше 0';
  if ('description' in d && typeof d.description !== 'string')
    return 'description має бути рядком';
  if ('inStock' in d && typeof d.inStock !== 'boolean')
    return 'inStock має бути true або false';
  return null;
}

// Повний документ товару зі значеннями за замовчуванням (як у схемі Mongoose)
function buildProduct(src) {
  const d = pick(isPlainObject(src) ? src : {});
  const error = validate(d, false);
  if (error) return { error };
  d.name = d.name.trim();
  d.category = d.category.trim();
  return { doc: { description: '', inStock: true, ...d } };
}

// Частина полів для $set
function buildSet(src) {
  const d = pick(isPlainObject(src) ? src : {});
  if (Object.keys(d).length === 0)
    return { error: `set має містити хоча б одне з полів: ${FIELDS.join(', ')}` };
  const error = validate(d, true);
  if (error) return { error };
  if (typeof d.name === 'string') d.name = d.name.trim();
  if (typeof d.category === 'string') d.category = d.category.trim();
  return { set: d };
}

// "name,price" -> { name: 1, price: 1 }
function parseProjection(fields) {
  if (typeof fields !== 'string' || !fields.trim()) return undefined;
  const projection = {};
  fields.split(',').forEach((f) => {
    if (f.trim()) projection[f.trim()] = 1;
  });
  return Object.keys(projection).length ? projection : undefined;
}

const emptyFilter = (f) => !isPlainObject(f) || Object.keys(f).length === 0;

/* ===================== READ ===================== */

// GET /api/products?category=fish&minPrice=10&maxPrice=100&fields=name,price&sort=price&order=desc&limit=10
// find + projection
router.get(
  '/',
  handle(async (req, res) => {
    const { category, minPrice, maxPrice, fields, sort, order, limit } = req.query;

    const filter = {};
    if (category) filter.category = String(category);

    if (minPrice !== undefined || maxPrice !== undefined) {
      filter.price = {};
      if (minPrice !== undefined) {
        if (Number.isNaN(Number(minPrice))) return res.status(400).json({ error: 'minPrice має бути числом' });
        filter.price.$gte = Number(minPrice);
      }
      if (maxPrice !== undefined) {
        if (Number.isNaN(Number(maxPrice))) return res.status(400).json({ error: 'maxPrice має бути числом' });
        filter.price.$lte = Number(maxPrice);
      }
    }

    let cursor = col().find(filter, { projection: parseProjection(fields) });

    if (sort) {
      if (!SORT_FIELDS.includes(sort))
        return res.status(400).json({ error: `sort може бути: ${SORT_FIELDS.join(', ')}` });
      cursor = cursor.sort({ [sort]: order === 'desc' ? -1 : 1 });
    }
    cursor = cursor.limit(Math.min(Number(limit) || 50, 200));

    const items = await cursor.toArray();
    res.json({ count: items.length, items });
  })
);

/* ===================== CREATE ===================== */

// POST /api/products — insertOne
router.post(
  '/',
  handle(async (req, res) => {
    const { doc, error } = buildProduct(req.body);
    if (error) return res.status(400).json({ error });

    const now = new Date();
    const result = await col().insertOne({ ...doc, createdAt: now, updatedAt: now });
    res.status(201).json({ acknowledged: result.acknowledged, insertedId: result.insertedId });
  })
);

// POST /api/products/many — insertMany, body: { "items": [ {...}, {...} ] }
router.post(
  '/many',
  handle(async (req, res) => {
    const { items } = getBody(req);
    if (!Array.isArray(items) || items.length === 0)
      return res.status(400).json({ error: 'items має бути непорожнім масивом' });

    const now = new Date();
    const docs = [];
    for (let i = 0; i < items.length; i++) {
      const { doc, error } = buildProduct(items[i]);
      if (error) return res.status(400).json({ error: `items[${i}]: ${error}` });
      docs.push({ ...doc, createdAt: now, updatedAt: now });
    }

    const result = await col().insertMany(docs);
    res.status(201).json({ insertedCount: result.insertedCount, insertedIds: result.insertedIds });
  })
);

/* ===================== UPDATE ===================== */
// Маршрути /many оголошені ПЕРЕД /:id, щоб Express не сприйняв "many" за id.

// PATCH /api/products/many — updateMany, body: { "filter": {...}, "set": {...} }
router.patch(
  '/many',
  handle(async (req, res) => {
    const { filter, set } = getBody(req);
    if (emptyFilter(filter)) return res.status(400).json({ error: 'filter не може бути порожнім' });

    const built = buildSet(set);
    if (built.error) return res.status(400).json({ error: built.error });

    const result = await col().updateMany(filter, {
      $set: { ...built.set, updatedAt: new Date() },
    });
    res.json({ matchedCount: result.matchedCount, modifiedCount: result.modifiedCount });
  })
);

// PATCH /api/products/:id — updateOne, body: { "set": {...} }
router.patch(
  '/:id',
  handle(async (req, res) => {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Невалідний id' });

    const built = buildSet(getBody(req).set);
    if (built.error) return res.status(400).json({ error: built.error });

    const result = await col().updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { ...built.set, updatedAt: new Date() } }
    );
    if (result.matchedCount === 0) return res.status(404).json({ error: 'Не знайдено' });
    res.json({ matchedCount: result.matchedCount, modifiedCount: result.modifiedCount });
  })
);

// PUT /api/products/:id — replaceOne (документ замінюється повністю)
router.put(
  '/:id',
  handle(async (req, res) => {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Невалідний id' });

    const { doc, error } = buildProduct(req.body);
    if (error) return res.status(400).json({ error });

    const result = await col().replaceOne(
      { _id: new ObjectId(req.params.id) },
      { ...doc, updatedAt: new Date() }
    );
    if (result.matchedCount === 0) return res.status(404).json({ error: 'Не знайдено' });
    res.json({ matchedCount: result.matchedCount, modifiedCount: result.modifiedCount });
  })
);

/* ===================== DELETE ===================== */

// DELETE /api/products/many — deleteMany, body: { "filter": {...} }
router.delete(
  '/many',
  handle(async (req, res) => {
    const { filter } = getBody(req);
    // захист від випадкового видалення всієї колекції
    if (emptyFilter(filter)) return res.status(400).json({ error: 'filter не може бути порожнім' });

    const result = await col().deleteMany(filter);
    res.json({ deletedCount: result.deletedCount });
  })
);

// DELETE /api/products/:id — deleteOne
router.delete(
  '/:id',
  handle(async (req, res) => {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Невалідний id' });

    const result = await col().deleteOne({ _id: new ObjectId(req.params.id) });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Не знайдено' });
    res.json({ deletedCount: result.deletedCount });
  })
);

// GET /api/products/:id?fields=name,price — findOne + projection
router.get(
  '/:id',
  handle(async (req, res) => {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Невалідний id' });

    const item = await col().findOne(
      { _id: new ObjectId(req.params.id) },
      { projection: parseProjection(req.query.fields) }
    );
    if (!item) return res.status(404).json({ error: 'Не знайдено' });
    res.json(item);
  })
);

module.exports = router;
