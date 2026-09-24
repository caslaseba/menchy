import fs from 'fs';
import path from 'path';

function pad(n) {
  return String(n).padStart(2, '0');
}

function stamp(daysAgo, hh, mm) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hh, mm, 0, 0);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(hh)}:${pad(mm)}:00`;
}

function xml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function photoSvg(file, title, color, glyph) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
  <rect width="800" height="800" fill="#f6f0e6"/>
  <rect x="150" y="90" width="500" height="500" rx="48" fill="${color}"/>
  ${glyph}
  <text x="400" y="680" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="40" font-weight="700" fill="#1c1916">${xml(title)}</text>
</svg>
`;
}

const GLYPH = {
  bottle: '<rect x="355" y="150" width="90" height="46" rx="12" fill="#fff"/><rect x="330" y="196" width="140" height="300" rx="28" fill="#fff"/><rect x="358" y="240" width="84" height="190" rx="16" fill="#d5eef8"/>',
  can: '<rect x="300" y="170" width="200" height="320" rx="36" fill="#fff"/><rect x="300" y="230" width="200" height="70" fill="#1c1916" opacity=".15"/>',
  box: '<path d="M250 250 400 180 550 250 400 320z" fill="#fff"/><path d="M250 250v190l150 70V320z" fill="#fff" opacity=".85"/><path d="M550 250v190L400 510V320z" fill="#fff" opacity=".7"/>',
  bag: '<path d="M300 220h200l30 280H270z" fill="#fff"/><path d="M340 220c0-50 120-50 120 0" fill="none" stroke="#fff" stroke-width="28"/>',
  carton: '<path d="M300 200h200l40 300H260z" fill="#fff"/><path d="M300 200 400 150 500 200" fill="#fff" opacity=".8"/>',
  jar: '<rect x="345" y="160" width="110" height="36" rx="8" fill="#fff"/><rect x="310" y="196" width="180" height="280" rx="40" fill="#fff"/><rect x="340" y="250" width="120" height="150" rx="16" fill="#f3d2a4"/>',
  bar: '<rect x="250" y="250" width="300" height="160" rx="28" fill="#fff"/><rect x="270" y="270" width="260" height="40" rx="10" fill="#3b2414"/>',
  pack: '<rect x="270" y="200" width="260" height="300" rx="24" fill="#fff"/><circle cx="340" cy="300" r="28" fill="#e11d48"/><circle cx="410" cy="330" r="28" fill="#f59e0b"/><circle cx="470" cy="290" r="28" fill="#16a34a"/>',
};

export function seedIfEmpty(db, photoDir) {
  const count = Number(db.prepare('SELECT COUNT(*) AS n FROM categories').get().n);
  if (count > 0) return;

  const categories = [
    ['Bebidas', '#1d4e89'],
    ['Almacén', '#c2410c'],
    ['Lácteos', '#a16207'],
    ['Limpieza', '#0f6e56'],
    ['Golosinas', '#be185d'],
    ['Fiambres', '#7c3aed'],
  ];
  const suppliers = [
    ['Distribuidora Sur', '11 4567-8901', 'Entrega martes y viernes. Pedido mínimo $ 80.000.'],
    ['Lácteos del Valle', '11 5123-4400', 'Cadena de frío. Avisar si falta hielo en el pedido.'],
    ['Limpieza Norte', '11 4788-2201', 'Factura A. Pago a 15 días.'],
    ['Golosinas Ramos', '11 6033-1188', 'Reposición semanal los lunes a la mañana.'],
  ];
  const products = [
    ['Agua mineral 500 ml', '7798001000001', 'Bebidas', 'Distribuidora Sur', 80000, 150000, 24, 8, 'bottle'],
    ['Gaseosa cola 1,5 l', '7798001000002', 'Bebidas', 'Distribuidora Sur', 180000, 320000, 12, 6, 'can'],
    ['Jugo de naranja 1 l', '7798001000003', 'Bebidas', 'Distribuidora Sur', 140000, 260000, 9, 4, 'bottle'],
    ['Yerba mate 1 kg', '7798001000004', 'Almacén', 'Distribuidora Sur', 320000, 540000, 0, 4, 'bag'],
    ['Arroz largo fino 1 kg', '7798001000005', 'Almacén', 'Distribuidora Sur', 150000, 280000, 18, 6, 'bag'],
    ['Fideos spaghetti 500 g', '7798001000006', 'Almacén', 'Distribuidora Sur', 90000, 170000, 20, 8, 'box'],
    ['Aceite de girasol 900 ml', '7798001000007', 'Almacén', 'Distribuidora Sur', 280000, 460000, 2, 5, 'bottle'],
    ['Leche entera 1 l', '7798001000008', 'Lácteos', 'Lácteos del Valle', 120000, 210000, 10, 6, 'carton'],
    ['Yogur firme vainilla', '7798001000009', 'Lácteos', 'Lácteos del Valle', 70000, 140000, 8, 6, 'jar'],
    ['Queso cremoso por kg', '7798001000010', 'Lácteos', 'Lácteos del Valle', 650000, 980000, 3, 2, 'jar'],
    ['Detergente limón 750 ml', '7798001000011', 'Limpieza', 'Limpieza Norte', 160000, 290000, 7, 3, 'bottle'],
    ['Lavandina 1 l', '7798001000012', 'Limpieza', 'Limpieza Norte', 90000, 180000, 1, 4, 'bottle'],
    ['Alfajor de chocolate', '7798001000013', 'Golosinas', 'Golosinas Ramos', 80000, 160000, 30, 10, 'bar'],
    ['Caramelos de menta 100 g', '7798001000014', 'Golosinas', 'Golosinas Ramos', 50000, 110000, 15, 5, 'pack'],
    ['Jamón cocido 200 g', '7798001000015', 'Fiambres', 'Lácteos del Valle', 280000, 470000, 5, 3, 'pack'],
    ['Salchichas 6 unidades', '7798001000016', 'Fiambres', 'Lácteos del Valle', 220000, 390000, 4, 3, 'pack'],
  ];

  const insertCategory = db.prepare('INSERT INTO categories (name, color, created_at) VALUES (?, ?, ?)');
  const insertSupplier = db.prepare('INSERT INTO suppliers (name, phone, notes, created_at) VALUES (?, ?, ?, ?)');
  const insertProduct = db.prepare(`
    INSERT INTO products (
      name, barcode, category_id, supplier_id, cost_cents, price_cents,
      stock, min_stock, photo, active, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `);
  const insertSale = db.prepare(`
    INSERT INTO sales (created_at, payment_method, total_cents, paid_cents, change_cents, cost_cents)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertItem = db.prepare(`
    INSERT INTO sale_items (sale_id, product_id, name, barcode, qty, price_cents, cost_cents)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const created = stamp(0, 8, 0);
  const categoryId = new Map();
  const supplierId = new Map();
  const catalog = new Map();

  db.exec('BEGIN IMMEDIATE');
  try {
    for (const [name, color] of categories) {
      const info = insertCategory.run(name, color, created);
      categoryId.set(name, Number(info.lastInsertRowid));
    }
    for (const [name, phone, notes] of suppliers) {
      const info = insertSupplier.run(name, phone, notes, created);
      supplierId.set(name, Number(info.lastInsertRowid));
    }
    for (const item of products) {
      const [name, barcode, category, supplier, cost, price, stock, minStock, glyph] = item;
      const file = `${barcode}.svg`;
      fs.writeFileSync(
        path.join(photoDir, file),
        photoSvg(file, name, categories.find((row) => row[0] === category)[1], GLYPH[glyph]),
      );
      const info = insertProduct.run(
        name,
        barcode,
        categoryId.get(category),
        supplierId.get(supplier),
        cost,
        price,
        stock,
        minStock,
        file,
        created,
      );
      catalog.set(name, {
        id: Number(info.lastInsertRowid),
        name,
        barcode,
        price_cents: price,
        cost_cents: cost,
      });
    }

    const line = (name, qty) => ({ ...catalog.get(name), qty });
    const addSale = (daysAgo, hh, mm, method, lines, paidCents) => {
      const total = lines.reduce((sum, item) => sum + item.price_cents * item.qty, 0);
      const cost = lines.reduce((sum, item) => sum + item.cost_cents * item.qty, 0);
      const paid = method === 'efectivo' ? paidCents : total;
      const change = method === 'efectivo' ? paid - total : 0;
      const info = insertSale.run(stamp(daysAgo, hh, mm), method, total, paid, change, cost);
      const saleId = Number(info.lastInsertRowid);
      for (const item of lines) {
        insertItem.run(saleId, item.id, item.name, item.barcode, item.qty, item.price_cents, item.cost_cents);
      }
    };

    addSale(0, 9, 15, 'efectivo', [line('Agua mineral 500 ml', 2)], 500000);
    addSale(0, 11, 22, 'debito', [line('Gaseosa cola 1,5 l', 1), line('Alfajor de chocolate', 2)]);
    addSale(0, 13, 40, 'credito', [line('Leche entera 1 l', 2), line('Fideos spaghetti 500 g', 1)]);
    addSale(0, 16, 5, 'transferencia', [line('Jamón cocido 200 g', 1)]);
    addSale(0, 19, 10, 'efectivo', [line('Alfajor de chocolate', 3), line('Caramelos de menta 100 g', 1)], 1000000);

    addSale(1, 10, 5, 'efectivo', [line('Arroz largo fino 1 kg', 1), line('Aceite de girasol 900 ml', 1)], 1000000);
    addSale(1, 15, 30, 'debito', [line('Yogur firme vainilla', 3)]);
    addSale(1, 18, 20, 'credito', [line('Salchichas 6 unidades', 2)]);

    addSale(2, 8, 40, 'efectivo', [line('Agua mineral 500 ml', 3)], 500000);
    addSale(2, 12, 15, 'transferencia', [line('Queso cremoso por kg', 1)]);
    addSale(2, 17, 45, 'debito', [line('Detergente limón 750 ml', 1), line('Lavandina 1 l', 1)]);

    addSale(6, 11, 10, 'efectivo', [line('Gaseosa cola 1,5 l', 2), line('Agua mineral 500 ml', 1)], 1000000);
    addSale(6, 19, 5, 'credito', [line('Alfajor de chocolate', 4)]);
    addSale(10, 9, 50, 'debito', [line('Leche entera 1 l', 4), line('Yogur firme vainilla', 2)]);
    addSale(10, 16, 25, 'transferencia', [line('Arroz largo fino 1 kg', 2), line('Fideos spaghetti 500 g', 3)]);
    addSale(15, 13, 15, 'efectivo', [line('Jamón cocido 200 g', 2), line('Queso cremoso por kg', 1)], 2000000);
    addSale(19, 18, 40, 'debito', [line('Jugo de naranja 1 l', 2), line('Caramelos de menta 100 g', 2)]);

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
