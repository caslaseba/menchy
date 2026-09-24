import express from 'express';
import multer from 'multer';
import QRCode from 'qrcode';
import selfsigned from 'selfsigned';
import os from 'os';
import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';
import { seedIfEmpty } from './seed.js';

process.env.TZ = process.env.TZ || 'America/Argentina/Buenos_Aires';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3847);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 3848);
const cloud = process.env.MENCHY_CLOUD === '1';
const PASSWORD = process.env.MENCHY_PASSWORD || '';
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data');
const photoDir = path.join(dataDir, 'photos');
const publicDir = path.join(__dirname, 'public');
fs.mkdirSync(photoDir, { recursive: true });

const COLORS = ['#c2410c', '#0f6e56', '#1d4e89', '#a16207', '#7c3aed', '#be185d', '#0f766e', '#b45309'];
const METHODS = ['efectivo', 'debito', 'credito', 'transferencia'];

const db = new DatabaseSync(path.join(dataDir, 'menchy.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    color TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    phone TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    barcode TEXT,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
    cost_cents INTEGER NOT NULL DEFAULT 0,
    price_cents INTEGER NOT NULL DEFAULT 0,
    stock INTEGER NOT NULL DEFAULT 0,
    min_stock INTEGER NOT NULL DEFAULT 0,
    photo TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode
    ON products(barcode) WHERE barcode IS NOT NULL;

  CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY,
    created_at TEXT NOT NULL,
    payment_method TEXT NOT NULL,
    total_cents INTEGER NOT NULL,
    paid_cents INTEGER NOT NULL,
    change_cents INTEGER NOT NULL,
    cost_cents INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sales_created ON sales(created_at);

  CREATE TABLE IF NOT EXISTS sale_items (
    id INTEGER PRIMARY KEY,
    sale_id INTEGER NOT NULL REFERENCES sales(id),
    product_id INTEGER,
    name TEXT NOT NULL,
    barcode TEXT,
    qty INTEGER NOT NULL,
    price_cents INTEGER NOT NULL,
    cost_cents INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  );
`);
seedIfEmpty(db, photoDir);

const PRODUCT_SELECT = `
  SELECT p.*,
    c.name AS category_name,
    c.color AS category_color,
    s.name AS supplier_name
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN suppliers s ON s.id = p.supplier_id
`;

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function sendError(res, error) {
  const message = String(error?.message || error);
  if (error?.status) return res.status(error.status).json({ error: error.message });
  if (message.includes('categories.name')) return res.status(400).json({ error: 'Ya existe esa categoría' });
  if (message.includes('suppliers.name')) return res.status(400).json({ error: 'Ya existe ese proveedor' });
  if (message.includes('barcode')) return res.status(400).json({ error: 'Ese código de barras ya está cargado' });
  if (message.includes('UNIQUE')) return res.status(400).json({ error: 'Ese dato ya existe' });
  console.error(error);
  res.status(500).json({ error: 'Error interno' });
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function ymd(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function nowLocal(date = new Date()) {
  return `${ymd(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function parseYmd(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return ymd(date) === value ? date : null;
}

function startOfWeek(date) {
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(date, diff);
}

function capital(text) {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function idParam(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'Identificador inválido');
  return id;
}

function cleanName(value, label, max = 80) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (!name) throw httpError(400, `Poné el nombre de ${label}`);
  if (name.length > max) throw httpError(400, `El nombre de ${label} es muy largo`);
  return name;
}

function parseQty(value, label) {
  const text = String(value ?? '').trim();
  if (!text) return 0;
  if (!/^\d+$/.test(text)) throw httpError(400, `${label} tiene que ser un número entero`);
  const qty = Number(text);
  if (qty > 1000000) throw httpError(400, `${label} es demasiado alto`);
  return qty;
}

function parseMoney(value, label) {
  let text = String(value ?? '').trim().replace(/\$/g, '').replace(/\s/g, '');
  if (!text) return 0;
  if (text.includes(',') && text.includes('.')) text = text.replace(/\./g, '').replace(',', '.');
  else if (text.includes(',')) text = text.replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(text)) text = text.replace(/\./g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw httpError(400, `${label} no es un precio válido`);
  const cents = Math.round(Number(text) * 100);
  if (cents > 100000000000) throw httpError(400, `${label} es demasiado alto`);
  return cents;
}

function cleanBarcode(value) {
  const code = String(value || '').trim();
  if (!code) return null;
  if (code.length > 64) throw httpError(400, 'El código es demasiado largo');
  if (!/^[0-9A-Za-z][0-9A-Za-z.\-_ ]{0,63}$/.test(code)) {
    throw httpError(400, 'El código solo puede tener letras, números, puntos y guiones');
  }
  return code;
}

function assertBarcodeFree(barcode, exceptId = 0) {
  if (!barcode) return;
  const row = db.prepare('SELECT id FROM products WHERE barcode = ?').get(barcode);
  if (row && row.id !== exceptId) throw httpError(400, 'Ese código de barras ya está cargado');
}

function removePhoto(name) {
  if (!name) return;
  fs.rmSync(path.join(photoDir, path.basename(name)), { force: true });
}

function mapProduct(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    name: row.name,
    barcode: row.barcode || '',
    category_id: row.category_id == null ? null : Number(row.category_id),
    category_name: row.category_name || '',
    category_color: row.category_color || '#c2410c',
    supplier_id: row.supplier_id == null ? null : Number(row.supplier_id),
    supplier_name: row.supplier_name || '',
    cost_cents: Number(row.cost_cents),
    price_cents: Number(row.price_cents),
    stock: Number(row.stock),
    min_stock: Number(row.min_stock),
    photo: row.photo ? `/photos/${path.basename(row.photo)}` : '',
    active: Number(row.active),
  };
}

function getProduct(id) {
  return mapProduct(db.prepare(`${PRODUCT_SELECT} WHERE p.id = ?`).get(id));
}

function mapCategory(row) {
  return {
    id: Number(row.id),
    name: row.name,
    color: row.color,
    products: Number(row.products || 0),
  };
}

function mapSupplier(row) {
  return {
    id: Number(row.id),
    name: row.name,
    phone: row.phone || '',
    notes: row.notes || '',
    products: Number(row.products || 0),
  };
}

const categorySql = `
  SELECT c.id, c.name, c.color,
    (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.active = 1) AS products
  FROM categories c
`;
const supplierSql = `
  SELECT s.id, s.name, s.phone, s.notes,
    (SELECT COUNT(*) FROM products p WHERE p.supplier_id = s.id AND p.active = 1) AS products
  FROM suppliers s
`;

function readProductInput(body) {
  const name = cleanName(body.name, 'el producto', 80);
  const categoryId = Number(body.category_id);
  if (!Number.isInteger(categoryId) || categoryId <= 0) throw httpError(400, 'Elegí una categoría');
  if (!db.prepare('SELECT id FROM categories WHERE id = ?').get(categoryId)) {
    throw httpError(400, 'Esa categoría no existe');
  }
  let supplierId = null;
  if (String(body.supplier_id || '').trim()) {
    supplierId = Number(body.supplier_id);
    if (!Number.isInteger(supplierId) || !db.prepare('SELECT id FROM suppliers WHERE id = ?').get(supplierId)) {
      throw httpError(400, 'Ese proveedor no existe');
    }
  }
  if (String(body.price ?? '').trim() === '') throw httpError(400, 'Poné el precio de venta');
  return {
    name,
    categoryId,
    supplierId,
    cost: parseMoney(body.cost, 'El precio de costo'),
    price: parseMoney(body.price, 'El precio de venta'),
    stock: parseQty(body.stock, 'El stock'),
    minStock: parseQty(body.min_stock, 'El mínimo'),
    barcode: cleanBarcode(body.barcode),
  };
}

const storage = multer.diskStorage({
  destination: photoDir,
  filename(req, file, cb) {
    const ext = file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg';
    cb(null, `${crypto.randomUUID()}.${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (/^image\/(jpeg|png|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('La foto tiene que ser JPG, PNG o WEBP'));
  },
});

function withPhoto(handler) {
  return (req, res) => {
    upload.single('photo')(req, res, (error) => {
      if (error) {
        const tooBig = error.code === 'LIMIT_FILE_SIZE';
        return res.status(400).json({
          error: tooBig ? 'La foto pesa más de 4 MB' : (error.message || 'No pude subir la foto'),
        });
      }
      try {
        handler(req, res);
      } catch (err) {
        if (req.file) removePhoto(req.file.filename);
        sendError(res, err);
      }
    });
  };
}

function getSale(id) {
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
  if (!sale) return null;
  const items = db.prepare(`
    SELECT id, product_id, name, barcode, qty, price_cents, cost_cents
    FROM sale_items WHERE sale_id = ? ORDER BY id
  `).all(id).map((item) => ({
    ...item,
    id: Number(item.id),
    product_id: item.product_id == null ? null : Number(item.product_id),
    qty: Number(item.qty),
    price_cents: Number(item.price_cents),
    cost_cents: Number(item.cost_cents),
  }));
  return {
    id: Number(sale.id),
    created_at: sale.created_at,
    payment_method: sale.payment_method,
    total_cents: Number(sale.total_cents),
    paid_cents: Number(sale.paid_cents),
    change_cents: Number(sale.change_cents),
    cost_cents: Number(sale.cost_cents),
    items,
  };
}

function periodRange(period, dateStr) {
  const today = new Date();
  const anchor = parseYmd(dateStr) || new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (period === 'week') {
    const start = startOfWeek(anchor);
    const end = addDays(start, 7);
    const last = addDays(start, 6);
    const sameMonth = start.getMonth() === last.getMonth() && start.getFullYear() === last.getFullYear();
    const month = new Intl.DateTimeFormat('es-AR', { month: 'long' }).format(start);
    const full = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long' });
    const label = sameMonth
      ? `Semana del ${start.getDate()} al ${last.getDate()} de ${month} de ${last.getFullYear()}`
      : `Semana del ${full.format(start)} al ${full.format(last)} de ${last.getFullYear()}`;
    return { start, end, label };
  }
  if (period === 'month') {
    const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
    const label = capital(new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' }).format(start));
    return { start, end, label };
  }
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  const end = addDays(start, 1);
  const label = capital(new Intl.DateTimeFormat('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(start));
  return { start, end, label };
}

function lanAddresses() {
  const found = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const net of list || []) {
      const v4 = net.family === 'IPv4' || net.family === 4;
      if (!v4 || net.internal) continue;
      found.push({ name, address: net.address });
    }
  }
  return found;
}

let httpsReady = false;

function ensureCertificate(ips) {
  const wanted = ['127.0.0.1', ...ips.map((item) => item.address)].sort();
  const keyPath = path.join(dataDir, 'key.pem');
  const certPath = path.join(dataDir, 'cert.pem');
  const metaPath = path.join(dataDir, 'cert-meta.json');
  if (fs.existsSync(keyPath) && fs.existsSync(certPath) && fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (JSON.stringify((meta.ips || []).slice().sort()) === JSON.stringify(wanted)) {
        return {
          key: fs.readFileSync(keyPath),
          cert: fs.readFileSync(certPath),
        };
      }
    } catch {
      /* se genera de nuevo */
    }
  }
  const generate = selfsigned.generate || selfsigned;
  const pems = generate([{ name: 'commonName', value: 'Menchy' }], {
    days: 825,
    keySize: 2048,
    algorithm: 'sha256',
    notBeforeDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          ...wanted.map((ip) => ({ type: 7, ip })),
        ],
      },
    ],
  });
  fs.writeFileSync(keyPath, pems.private);
  fs.writeFileSync(certPath, pems.cert);
  fs.writeFileSync(metaPath, JSON.stringify({ ips: wanted }));
  return { key: pems.private, cert: pems.cert };
}

const loginAttempts = new Map();

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}

function passwordMatches(input) {
  const given = crypto.createHash('sha256').update(String(input), 'utf8').digest();
  const expected = crypto.createHash('sha256').update(PASSWORD, 'utf8').digest();
  return crypto.timingSafeEqual(given, expected);
}

function sessionValid(token) {
  if (!token || token.length > 128) return false;
  const row = db.prepare('SELECT expires_at FROM sessions WHERE token = ?').get(token);
  if (!row) return false;
  if (Number(row.expires_at) < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return false;
  }
  return true;
}

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'local';
}

function loginBlocked(ip) {
  const row = loginAttempts.get(ip);
  if (!row) return false;
  if (Date.now() > row.reset) {
    loginAttempts.delete(ip);
    return false;
  }
  return row.n >= 8;
}

function loginFailed(ip) {
  const now = Date.now();
  const row = loginAttempts.get(ip);
  if (!row || now > row.reset) loginAttempts.set(ip, { n: 1, reset: now + 10 * 60 * 1000 });
  else row.n += 1;
}

function setSessionCookie(res, token, maxAge) {
  const bits = [
    `menchy=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (cloud) bits.push('Secure');
  res.setHeader('Set-Cookie', bits.join('; '));
}

function publicUrl(req) {
  const configured = process.env.MENCHY_PUBLIC_URL;
  if (configured) return String(configured).replace(/\/$/, '');
  const host = req.get('host');
  if (!host) return '';
  return `${req.protocol}://${host}`;
}

const app = express();
app.disable('x-powered-by');
if (cloud) app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  if (!PASSWORD) return next();
  if (req.path === '/api/login' || req.path === '/api/health') return next();
  const guarded = req.path.startsWith('/api/') || req.path.startsWith('/photos/');
  if (!guarded) return next();
  if (sessionValid(readCookie(req, 'menchy'))) return next();
  res.status(401).json({ error: 'Tenés que entrar con la clave' });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, name: 'Menchy', auth: Boolean(PASSWORD) });
});

app.post('/api/login', (req, res) => {
  if (!PASSWORD) return res.json({ ok: true });
  const ip = clientIp(req);
  if (loginBlocked(ip)) return res.status(429).json({ error: 'Esperá unos minutos e intentá de nuevo' });
  const password = String(req.body?.password || '');
  if (password.length > 200 || !passwordMatches(password)) {
    loginFailed(ip);
    return res.status(401).json({ error: 'La clave no coincide' });
  }
  loginAttempts.delete(ip);
  const token = crypto.randomBytes(32).toString('hex');
  const maxAge = 60 * 60 * 24 * 30;
  db.prepare('INSERT INTO sessions (token, expires_at) VALUES (?, ?)').run(token, Date.now() + maxAge * 1000);
  setSessionCookie(res, token, maxAge);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  const token = readCookie(req, 'menchy');
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  setSessionCookie(res, '', 0);
  res.json({ ok: true });
});

app.get('/api/summary', (req, res) => {
  const start = `${ymd(new Date())} 00:00:00`;
  const end = `${ymd(addDays(new Date(), 1))} 00:00:00`;
  const sales = db.prepare(`
    SELECT COUNT(*) AS tickets, COALESCE(SUM(total_cents), 0) AS total_cents
    FROM sales WHERE created_at >= ? AND created_at < ?
  `).get(start, end);
  const out = db.prepare('SELECT COUNT(*) AS n FROM products WHERE active = 1 AND stock = 0').get().n;
  const low = db.prepare(`
    SELECT COUNT(*) AS n FROM products
    WHERE active = 1 AND min_stock > 0 AND stock <= min_stock AND stock > 0
  `).get().n;
  res.json({
    tickets: Number(sales.tickets),
    total_cents: Number(sales.total_cents),
    out: Number(out),
    low: Number(low),
  });
});

app.get('/api/network', async (req, res) => {
  try {
    if (cloud) {
      const open = publicUrl(req);
      let host = '';
      try { host = new URL(open).host; } catch { host = open; }
      const qr = open
        ? await QRCode.toDataURL(open, { margin: 1, width: 320, errorCorrectionLevel: 'M' })
        : '';
      return res.json({
        mode: 'cloud',
        hostname: os.hostname(),
        httpPort: PORT,
        httpsPort: HTTPS_PORT,
        https: true,
        entries: open ? [{ name: 'web', address: host, http: open, https: open, open, qr }] : [],
      });
    }
    const ips = lanAddresses();
    const entries = [];
    for (const ip of ips) {
      const httpUrl = `http://${ip.address}:${PORT}`;
      const httpsUrl = httpsReady ? `https://${ip.address}:${HTTPS_PORT}` : '';
      const open = httpsUrl || httpUrl;
      const qr = await QRCode.toDataURL(open, { margin: 1, width: 320, errorCorrectionLevel: 'M' });
      entries.push({ name: ip.name, address: ip.address, http: httpUrl, https: httpsUrl, open, qr });
    }
    res.json({
      mode: 'lan',
      hostname: os.hostname(),
      httpPort: PORT,
      httpsPort: HTTPS_PORT,
      https: httpsReady,
      entries,
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/categories', (req, res) => {
  const rows = db.prepare(`${categorySql} ORDER BY c.name COLLATE NOCASE`).all();
  res.json(rows.map(mapCategory));
});

app.post('/api/categories', (req, res) => {
  try {
    const name = cleanName(req.body?.name, 'la categoría', 40);
    const count = db.prepare('SELECT COUNT(*) AS n FROM categories').get().n;
    const color = COLORS[Number(count) % COLORS.length];
    const info = db.prepare('INSERT INTO categories (name, color, created_at) VALUES (?, ?, ?)').run(name, color, nowLocal());
    res.status(201).json(mapCategory(db.prepare(`${categorySql} WHERE c.id = ?`).get(Number(info.lastInsertRowid))));
  } catch (error) {
    sendError(res, error);
  }
});

app.put('/api/categories/:id', (req, res) => {
  try {
    const id = idParam(req.params.id);
    const name = cleanName(req.body?.name, 'la categoría', 40);
    const info = db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(name, id);
    if (!info.changes) throw httpError(404, 'No encontré esa categoría');
    res.json(mapCategory(db.prepare(`${categorySql} WHERE c.id = ?`).get(id)));
  } catch (error) {
    sendError(res, error);
  }
});

app.delete('/api/categories/:id', (req, res) => {
  try {
    const id = idParam(req.params.id);
    const used = db.prepare('SELECT COUNT(*) AS n FROM products WHERE category_id = ?').get(id).n;
    if (Number(used)) throw httpError(400, 'Hay productos en esta categoría');
    const info = db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    if (!info.changes) throw httpError(404, 'No encontré esa categoría');
    res.json({ ok: true });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/suppliers', (req, res) => {
  const rows = db.prepare(`${supplierSql} ORDER BY s.name COLLATE NOCASE`).all();
  res.json(rows.map(mapSupplier));
});

app.post('/api/suppliers', (req, res) => {
  try {
    const name = cleanName(req.body?.name, 'el proveedor', 60);
    const phone = String(req.body?.phone || '').trim().slice(0, 40);
    const notes = String(req.body?.notes || '').trim().slice(0, 200);
    const info = db.prepare(
      'INSERT INTO suppliers (name, phone, notes, created_at) VALUES (?, ?, ?, ?)',
    ).run(name, phone, notes, nowLocal());
    res.status(201).json(mapSupplier(db.prepare(`${supplierSql} WHERE s.id = ?`).get(Number(info.lastInsertRowid))));
  } catch (error) {
    sendError(res, error);
  }
});

app.put('/api/suppliers/:id', (req, res) => {
  try {
    const id = idParam(req.params.id);
    const name = cleanName(req.body?.name, 'el proveedor', 60);
    const phone = String(req.body?.phone || '').trim().slice(0, 40);
    const notes = String(req.body?.notes || '').trim().slice(0, 200);
    const info = db.prepare('UPDATE suppliers SET name = ?, phone = ?, notes = ? WHERE id = ?').run(name, phone, notes, id);
    if (!info.changes) throw httpError(404, 'No encontré ese proveedor');
    res.json(mapSupplier(db.prepare(`${supplierSql} WHERE s.id = ?`).get(id)));
  } catch (error) {
    sendError(res, error);
  }
});

app.delete('/api/suppliers/:id', (req, res) => {
  try {
    const id = idParam(req.params.id);
    const used = db.prepare('SELECT COUNT(*) AS n FROM products WHERE supplier_id = ? AND active = 1').get(id).n;
    if (Number(used)) throw httpError(400, 'Hay productos de este proveedor');
    db.prepare('UPDATE products SET supplier_id = NULL WHERE supplier_id = ?').run(id);
    const info = db.prepare('DELETE FROM suppliers WHERE id = ?').run(id);
    if (!info.changes) throw httpError(404, 'No encontré ese proveedor');
    res.json({ ok: true });
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/products', (req, res) => {
  const rows = db.prepare(`${PRODUCT_SELECT} WHERE p.active = 1 ORDER BY p.name COLLATE NOCASE`).all();
  res.json(rows.map(mapProduct));
});

app.get('/api/products/lookup', (req, res) => {
  const code = String(req.query.code || '').trim();
  if (!code) return res.status(400).json({ error: 'Falta el código' });
  const product = mapProduct(db.prepare(`${PRODUCT_SELECT} WHERE p.active = 1 AND p.barcode = ?`).get(code));
  if (!product) return res.status(404).json({ error: 'No encontré ese código' });
  res.json(product);
});

app.post('/api/products', withPhoto((req, res) => {
  const input = readProductInput(req.body || {});
  assertBarcodeFree(input.barcode);
  try {
    const info = db.prepare(`
      INSERT INTO products (
        name, barcode, category_id, supplier_id, cost_cents, price_cents,
        stock, min_stock, photo, active, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      input.name,
      input.barcode,
      input.categoryId,
      input.supplierId,
      input.cost,
      input.price,
      input.stock,
      input.minStock,
      req.file ? req.file.filename : null,
      nowLocal(),
    );
    res.status(201).json(getProduct(Number(info.lastInsertRowid)));
  } catch (error) {
    if (req.file) removePhoto(req.file.filename);
    throw error;
  }
}));

app.put('/api/products/:id', withPhoto((req, res) => {
  const id = idParam(req.params.id);
  const current = db.prepare('SELECT id, photo FROM products WHERE id = ? AND active = 1').get(id);
  if (!current) throw httpError(404, 'No encontré ese producto');
  const input = readProductInput(req.body || {});
  assertBarcodeFree(input.barcode, id);
  const photo = req.file ? req.file.filename : current.photo;
  db.prepare(`
    UPDATE products SET
      name = ?, barcode = ?, category_id = ?, supplier_id = ?,
      cost_cents = ?, price_cents = ?, stock = ?, min_stock = ?, photo = ?
    WHERE id = ?
  `).run(
    input.name,
    input.barcode,
    input.categoryId,
    input.supplierId,
    input.cost,
    input.price,
    input.stock,
    input.minStock,
    photo,
    id,
  );
  if (req.file && current.photo && current.photo !== req.file.filename) removePhoto(current.photo);
  res.json(getProduct(id));
}));

app.delete('/api/products/:id', (req, res) => {
  try {
    const id = idParam(req.params.id);
    const info = db.prepare('UPDATE products SET active = 0, barcode = NULL WHERE id = ? AND active = 1').run(id);
    if (!info.changes) throw httpError(404, 'No encontré ese producto');
    res.json({ ok: true });
  } catch (error) {
    sendError(res, error);
  }
});

app.post('/api/sales', (req, res) => {
  try {
    const body = req.body || {};
    if (!METHODS.includes(body.payment_method)) throw httpError(400, 'Elegí cómo paga el cliente');
    if (!Array.isArray(body.items) || !body.items.length) throw httpError(400, 'No hay productos en la venta');

    const qtyById = new Map();
    for (const item of body.items) {
      const productId = Number(item.product_id);
      const qty = Number(item.qty);
      if (!Number.isInteger(productId) || productId <= 0) throw httpError(400, 'Producto inválido');
      if (!Number.isInteger(qty) || qty <= 0 || qty > 9999) throw httpError(400, 'Cantidad inválida');
      qtyById.set(productId, (qtyById.get(productId) || 0) + qty);
    }

    const lines = [];
    for (const [productId, qty] of qtyById) {
      const product = getProduct(productId);
      if (!product || !product.active) throw httpError(400, 'Hay un producto que ya no está disponible');
      if (product.stock < qty) {
        throw httpError(400, `Stock insuficiente de ${product.name}. Hay ${product.stock}.`);
      }
      lines.push({ product, qty });
    }

    const total = lines.reduce((sum, line) => sum + line.product.price_cents * line.qty, 0);
    const cost = lines.reduce((sum, line) => sum + line.product.cost_cents * line.qty, 0);
    if (body.expected_total_cents != null && Number(body.expected_total_cents) !== total) {
      throw httpError(409, 'Los precios cambiaron. Revisá la venta.');
    }

    let paid = total;
    let change = 0;
    if (body.payment_method === 'efectivo') {
      paid = Number(body.paid_cents);
      if (!Number.isInteger(paid) || paid < 0) throw httpError(400, 'Ingresá con cuánto paga');
      if (paid < total) throw httpError(400, 'El pago en efectivo no alcanza');
      change = paid - total;
    }

    const insertSale = db.prepare(`
      INSERT INTO sales (created_at, payment_method, total_cents, paid_cents, change_cents, cost_cents)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertItem = db.prepare(`
      INSERT INTO sale_items (sale_id, product_id, name, barcode, qty, price_cents, cost_cents)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const takeStock = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND active = 1 AND stock >= ?');

    db.exec('BEGIN IMMEDIATE');
    try {
      const info = insertSale.run(nowLocal(), body.payment_method, total, paid, change, cost);
      const saleId = Number(info.lastInsertRowid);
      for (const line of lines) {
        const taken = takeStock.run(line.qty, line.product.id, line.qty);
        if (taken.changes !== 1) {
          throw httpError(400, `Stock insuficiente de ${line.product.name}. Hay ${line.product.stock}.`);
        }
        insertItem.run(
          saleId,
          line.product.id,
          line.product.name,
          line.product.barcode || null,
          line.qty,
          line.product.price_cents,
          line.product.cost_cents,
        );
      }
      db.exec('COMMIT');
      res.status(201).json(getSale(saleId));
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/sales/:id', (req, res) => {
  try {
    const sale = getSale(idParam(req.params.id));
    if (!sale) return res.status(404).json({ error: 'No encontré esa venta' });
    res.json(sale);
  } catch (error) {
    sendError(res, error);
  }
});

app.get('/api/reports/stock', (req, res) => {
  const rows = db.prepare(`
    ${PRODUCT_SELECT}
    WHERE p.active = 1
    ORDER BY c.name COLLATE NOCASE, p.name COLLATE NOCASE
  `).all();
  const items = rows.map((row) => {
    const product = mapProduct(row);
    const status = product.stock === 0
      ? 'sin-stock'
      : (product.min_stock > 0 && product.stock <= product.min_stock ? 'bajo' : 'ok');
    return {
      ...product,
      status,
      cost_value_cents: product.cost_cents * product.stock,
      sale_value_cents: product.price_cents * product.stock,
    };
  });
  res.json({
    kind: 'stock',
    generated_at: nowLocal(),
    alerts: {
      out: items.filter((item) => item.stock === 0).length,
      low: items.filter((item) => item.status === 'bajo').length,
    },
    items,
  });
});

app.get('/api/reports/sales', (req, res) => {
  try {
    const period = ['day', 'week', 'month'].includes(req.query.period) ? req.query.period : 'day';
    const range = periodRange(period, String(req.query.date || ''));
    const from = `${ymd(range.start)} 00:00:00`;
    const to = `${ymd(range.end)} 00:00:00`;
    const summaryRow = db.prepare(`
      SELECT COUNT(*) AS tickets,
             COALESCE(SUM(total_cents), 0) AS total_cents,
             COALESCE(SUM(cost_cents), 0) AS cost_cents
      FROM sales WHERE created_at >= ? AND created_at < ?
    `).get(from, to);
    const units = db.prepare(`
      SELECT COALESCE(SUM(si.qty), 0) AS units
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE s.created_at >= ? AND s.created_at < ?
    `).get(from, to).units;
    const tickets = Number(summaryRow.tickets);
    const total = Number(summaryRow.total_cents);
    const cost = Number(summaryRow.cost_cents);
    const payments = db.prepare(`
      SELECT payment_method, COUNT(*) AS tickets, COALESCE(SUM(total_cents), 0) AS total_cents
      FROM sales WHERE created_at >= ? AND created_at < ?
      GROUP BY payment_method
      ORDER BY total_cents DESC
    `).all(from, to).map((row) => ({
      payment_method: row.payment_method,
      tickets: Number(row.tickets),
      total_cents: Number(row.total_cents),
    }));
    const top = db.prepare(`
      SELECT si.product_id AS product_id, si.name AS name,
             SUM(si.qty) AS qty,
             SUM(si.qty * si.price_cents) AS total_cents,
             MAX(p.photo) AS photo
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      LEFT JOIN products p ON p.id = si.product_id
      WHERE s.created_at >= ? AND s.created_at < ?
      GROUP BY si.product_id, si.name
      ORDER BY total_cents DESC
      LIMIT 8
    `).all(from, to).map((row) => ({
      product_id: row.product_id == null ? null : Number(row.product_id),
      name: row.name,
      qty: Number(row.qty),
      total_cents: Number(row.total_cents),
      photo: row.photo ? `/photos/${path.basename(row.photo)}` : '',
    }));

    let series = [];
    if (period === 'day') {
      const rows = db.prepare(`
        SELECT substr(created_at, 12, 2) AS hour, COUNT(*) AS tickets,
               COALESCE(SUM(total_cents), 0) AS total_cents
        FROM sales WHERE created_at >= ? AND created_at < ?
        GROUP BY hour
      `).all(from, to);
      const byHour = new Map(rows.map((row) => [row.hour, row]));
      const hours = new Set();
      for (let hour = 8; hour <= 21; hour += 1) hours.add(pad(hour));
      for (const row of rows) hours.add(row.hour);
      series = [...hours].sort().map((hour) => ({
        label: `${Number(hour)}h`,
        tickets: Number(byHour.get(hour)?.tickets || 0),
        total_cents: Number(byHour.get(hour)?.total_cents || 0),
      }));
    } else {
      const rows = db.prepare(`
        SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS tickets,
               COALESCE(SUM(total_cents), 0) AS total_cents
        FROM sales WHERE created_at >= ? AND created_at < ?
        GROUP BY day
      `).all(from, to);
      const byDay = new Map(rows.map((row) => [row.day, row]));
      const weekdays = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
      for (let cursor = range.start; cursor < range.end; cursor = addDays(cursor, 1)) {
        const key = ymd(cursor);
        const row = byDay.get(key);
        series.push({
          label: period === 'month' ? String(cursor.getDate()) : `${weekdays[cursor.getDay()]} ${cursor.getDate()}`,
          tickets: Number(row?.tickets || 0),
          total_cents: Number(row?.total_cents || 0),
        });
      }
    }

    const sales = db.prepare(`
      SELECT id, created_at, payment_method, total_cents, paid_cents, change_cents, cost_cents
      FROM sales WHERE created_at >= ? AND created_at < ?
      ORDER BY created_at DESC, id DESC
      LIMIT 300
    `).all(from, to).map((row) => ({
      id: Number(row.id),
      created_at: row.created_at,
      payment_method: row.payment_method,
      total_cents: Number(row.total_cents),
      paid_cents: Number(row.paid_cents),
      change_cents: Number(row.change_cents),
      cost_cents: Number(row.cost_cents),
    }));

    res.json({
      kind: 'sales',
      period,
      label: range.label,
      start: ymd(range.start),
      end: ymd(addDays(range.end, -1)),
      summary: {
        tickets,
        units: Number(units),
        total_cents: total,
        cost_cents: cost,
        profit_cents: total - cost,
        avg_cents: tickets ? Math.round(total / tickets) : 0,
      },
      payments,
      top,
      series,
      sales,
      truncated: tickets > sales.length,
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.use('/photos', express.static(photoDir, { maxAge: '7d' }));
app.get('/vendor/html5-qrcode.min.js', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(path.join(__dirname, 'node_modules', 'html5-qrcode', 'html5-qrcode.min.js'));
});
app.use(express.static(publicDir, {
  setHeaders(res, filePath) {
    if (/\.(html|js|css|webmanifest)$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
  },
}));

function openBrowser() {
  exec(`cmd /c start "" "http://localhost:${PORT}"`);
}

const httpServer = http.createServer(app);
httpServer.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error('Ya hay un Menchy abierto en el puerto 3847. Cerrá esa ventana antes de abrir otro.');
  } else {
    console.error(error);
  }
  process.exit(1);
});

if (cloud && !PASSWORD) {
  console.error('Menchy en la nube necesita la variable MENCHY_PASSWORD.');
  process.exit(1);
}

if (cloud) {
  httpServer.listen(PORT, '0.0.0.0', () => {
    const url = process.env.MENCHY_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
    console.log('');
    console.log('  Menchy está listo');
    console.log(`  ${url}`);
    console.log('');
  });
} else {
  httpServer.listen(PORT, '0.0.0.0', () => {
    let cert = null;
    try {
      cert = ensureCertificate(lanAddresses());
    } catch (error) {
      console.error('No pude preparar el acceso seguro para el celular:', error.message);
    }
    if (cert) {
      const httpsServer = https.createServer(cert, app);
      httpsServer.on('error', (error) => {
        console.error(error.code === 'EADDRINUSE'
          ? 'El puerto 3848 está ocupado. El celular puede entrar igual por http, sin cámara.'
          : error.message);
      });
      httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
        httpsReady = true;
        printBanner();
      });
    } else {
      printBanner();
    }
    if (process.env.MENCHY_NO_OPEN !== '1') openBrowser();
  });
}

function printBanner() {
  const ips = lanAddresses();
  console.log('');
  console.log('  Menchy está listo');
  console.log(`  En esta PC:    http://localhost:${PORT}`);
  if (!ips.length) {
    console.log('  Celular: conectá la PC al Wi-Fi y abrí la pantalla Celular.');
  } else {
    for (const ip of ips) {
      const url = httpsReady ? `https://${ip.address}:${HTTPS_PORT}` : `http://${ip.address}:${PORT}`;
      console.log(`  En el celular: ${url}`);
    }
  }
  console.log('  No cierres esta ventana.');
  console.log('');
}
