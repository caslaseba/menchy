(() => {
  const cfg = window.MENCHY_CONFIG || {};
  if (!cfg.firebase?.apiKey) return;

  const COLORS = ['#c2410c', '#0f6e56', '#1d4e89', '#a16207', '#7c3aed', '#be185d', '#0f766e', '#b45309'];
  let app = null;

  function client() {
    if (!app) {
      if (!window.firebase?.initializeApp) {
        const error = new Error('No hay conexión con Menchy.');
        error.status = 0;
        throw error;
      }
      app = window.firebase.initializeApp(cfg.firebase);
    }
    return window.firebase;
  }

  function db() {
    client();
    return window.firebase.firestore();
  }

  function fail(status, message) {
    const error = new Error(message);
    error.status = status;
    throw error;
  }

  function nowLocal(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Argentina/Buenos_Aires',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(date);
    const get = (type) => parts.find((part) => part.type === type)?.value || '00';
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
  }

  function pad(n) { return String(n).padStart(2, '0'); }
  function ymd(date) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
  function parseYmd(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return ymd(date) === value ? date : null;
  }
  function addDays(date, days) { return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days); }
  function startOfWeek(date) {
    const day = date.getDay();
    return addDays(date, day === 0 ? -6 : 1 - day);
  }
  function capital(text) { return text ? text.charAt(0).toUpperCase() + text.slice(1) : text; }

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
      return { start, end, label: capital(new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' }).format(start)) };
    }
    const start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
    return {
      start,
      end: addDays(start, 1),
      label: capital(new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(start)),
    };
  }

  function cleanName(value, label, max) {
    const name = String(value || '').trim().replace(/\s+/g, ' ');
    if (!name) fail(400, `Poné el nombre de ${label}`);
    if (name.length > max) fail(400, `El nombre de ${label} es muy largo`);
    return name;
  }
  function parseQty(value, label) {
    const text = String(value ?? '').trim();
    if (!text) return 0;
    if (!/^\d+$/.test(text)) fail(400, `${label} tiene que ser un número entero`);
    const qty = Number(text);
    if (qty > 1000000) fail(400, `${label} es demasiado alto`);
    return qty;
  }
  function parseMoney(value, label) {
    let text = String(value ?? '').trim().replace(/\$/g, '').replace(/\s/g, '');
    if (!text) return 0;
    if (text.includes(',') && text.includes('.')) text = text.replace(/\./g, '').replace(',', '.');
    else if (text.includes(',')) text = text.replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(text)) text = text.replace(/\./g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(text)) fail(400, `${label} no es un precio válido`);
    return Math.round(Number(text) * 100);
  }
  function cleanBarcode(value) {
    const code = String(value || '').trim();
    if (!code) return null;
    if (code.length > 64) fail(400, 'El código es demasiado largo');
    if (!/^[0-9A-Za-z][0-9A-Za-z.\-_ ]{0,63}$/.test(code)) fail(400, 'El código solo puede tener letras, números, puntos y guiones');
    return code;
  }

  async function requireUser() {
    if (!client().auth().currentUser) fail(401, 'Tenés que entrar con la clave');
  }

  function mapProduct(row, categories, suppliers) {
    const category = categories.get(row.category_id);
    const supplier = row.supplier_id == null ? null : suppliers.get(row.supplier_id);
    return {
      id: Number(row.id),
      name: row.name,
      barcode: row.barcode || '',
      category_id: row.category_id == null ? null : Number(row.category_id),
      category_name: category?.name || '',
      category_color: category?.color || '#c2410c',
      supplier_id: row.supplier_id == null ? null : Number(row.supplier_id),
      supplier_name: supplier?.name || '',
      cost_cents: Number(row.cost_cents),
      price_cents: Number(row.price_cents),
      stock: Number(row.stock),
      min_stock: Number(row.min_stock),
      photo: row.photo || '',
      active: Number(row.active),
    };
  }

  async function loadMaps() {
    const [cats, sups] = await Promise.all([
      db().collection('categories').get(),
      db().collection('suppliers').get(),
    ]);
    return {
      categories: new Map(cats.docs.map((doc) => [Number(doc.id), { id: Number(doc.id), ...doc.data() }])),
      suppliers: new Map(sups.docs.map((doc) => [Number(doc.id), { id: Number(doc.id), ...doc.data() }])),
    };
  }

  async function products() {
    await requireUser();
    const maps = await loadMaps();
    const snap = await db().collection('products').where('active', '==', 1).get();
    return snap.docs.map((doc) => mapProduct({ id: Number(doc.id), ...doc.data() }, maps.categories, maps.suppliers))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }

  async function categories() {
    await requireUser();
    const [cats, prods] = await Promise.all([
      db().collection('categories').get(),
      db().collection('products').where('active', '==', 1).get(),
    ]);
    const counts = new Map();
    prods.docs.forEach((doc) => {
      const id = Number(doc.data().category_id);
      counts.set(id, (counts.get(id) || 0) + 1);
    });
    return cats.docs.map((doc) => ({
      id: Number(doc.id),
      name: doc.data().name,
      color: doc.data().color,
      products: counts.get(Number(doc.id)) || 0,
    })).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }

  async function suppliers() {
    await requireUser();
    const [rows, prods] = await Promise.all([
      db().collection('suppliers').get(),
      db().collection('products').where('active', '==', 1).get(),
    ]);
    const counts = new Map();
    prods.docs.forEach((doc) => {
      const id = doc.data().supplier_id;
      if (id != null) counts.set(Number(id), (counts.get(Number(id)) || 0) + 1);
    });
    return rows.docs.map((doc) => ({
      id: Number(doc.id),
      name: doc.data().name,
      phone: doc.data().phone || '',
      notes: doc.data().notes || '',
      products: counts.get(Number(doc.id)) || 0,
    })).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }

  async function nextId(name) {
    const ref = db().collection('meta').doc('ids');
    return db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.exists ? Number(snap.data()[name] || 0) : 0;
      const id = current + 1;
      tx.set(ref, { [name]: id }, { merge: true });
      return id;
    });
  }

  async function saveProduct(id, body) {
    await requireUser();
    const name = cleanName(body.get ? body.get('name') : body.name, 'el producto', 80);
    const categoryId = Number(body.get ? body.get('category_id') : body.category_id);
    if (!Number.isInteger(categoryId) || categoryId <= 0) fail(400, 'Elegí una categoría');
    const category = await db().collection('categories').doc(String(categoryId)).get();
    if (!category.exists) fail(400, 'Esa categoría no existe');
    let supplierId = null;
    const supplierRaw = String((body.get ? body.get('supplier_id') : body.supplier_id) || '').trim();
    if (supplierRaw) {
      supplierId = Number(supplierRaw);
      const supplier = await db().collection('suppliers').doc(String(supplierId)).get();
      if (!supplier.exists) fail(400, 'Ese proveedor no existe');
    }
    const priceRaw = body.get ? body.get('price') : body.price;
    if (String(priceRaw ?? '').trim() === '') fail(400, 'Poné el precio de venta');
    const barcode = cleanBarcode(body.get ? body.get('barcode') : body.barcode);
    if (barcode) {
      const taken = await db().collection('products').where('barcode', '==', barcode).get();
      if (taken.docs.some((doc) => Number(doc.id) !== Number(id || 0) && doc.data().active === 1)) {
        fail(400, 'Ese código de barras ya está cargado');
      }
    }
    const allCats = await categories();
    const allSups = await suppliers();
    const catMap = new Map(allCats.map((row) => [row.id, row]));
    const supMap = new Map(allSups.map((row) => [row.id, row]));
    let photo = '';
    if (id) {
      const current = await db().collection('products').doc(String(id)).get();
      if (!current.exists || current.data().active !== 1) fail(404, 'No encontré ese producto');
      photo = current.data().photo || '';
    }
    const file = body.get ? body.get('photo') : null;
    if (file && typeof file === 'object' && file.size) {
      const path = `products/${crypto.randomUUID()}.jpg`;
      const ref = client().storage().ref(path);
      await ref.put(file, { contentType: 'image/jpeg' });
      photo = await ref.getDownloadURL();
    }
    const row = {
      name,
      barcode,
      category_id: categoryId,
      supplier_id: supplierId,
      cost_cents: parseMoney(body.get ? body.get('cost') : body.cost, 'El precio de costo'),
      price_cents: parseMoney(priceRaw, 'El precio de venta'),
      stock: parseQty(body.get ? body.get('stock') : body.stock, 'El stock'),
      min_stock: parseQty(body.get ? body.get('min_stock') : body.min_stock, 'El mínimo'),
      photo,
      active: 1,
    };
    const productId = id || await nextId('products');
    if (!id) row.created_at = nowLocal();
    await db().collection('products').doc(String(productId)).set(row, { merge: true });
    return mapProduct({ id: productId, ...row }, catMap, supMap);
  }

  async function summary() {
    await requireUser();
    const start = `${nowLocal().slice(0, 10)} 00:00:00`;
    const end = `${ymd(addDays(parseYmd(start.slice(0, 10)), 1))} 00:00:00`;
    const [sales, prods] = await Promise.all([
      db().collection('sales').where('created_at', '>=', start).where('created_at', '<', end).get(),
      db().collection('products').where('active', '==', 1).get(),
    ]);
    return {
      tickets: sales.size,
      total_cents: sales.docs.reduce((sum, doc) => sum + Number(doc.data().total_cents), 0),
      out: prods.docs.filter((doc) => Number(doc.data().stock) === 0).length,
      low: prods.docs.filter((doc) => {
        const row = doc.data();
        return Number(row.min_stock) > 0 && Number(row.stock) <= Number(row.min_stock) && Number(row.stock) > 0;
      }).length,
    };
  }

  async function stockReport() {
    const items = (await products()).map((product) => {
      const status = product.stock === 0 ? 'sin-stock' : (product.min_stock > 0 && product.stock <= product.min_stock ? 'bajo' : 'ok');
      return { ...product, status, cost_value_cents: product.cost_cents * product.stock, sale_value_cents: product.price_cents * product.stock };
    }).sort((a, b) => a.category_name.localeCompare(b.category_name, 'es') || a.name.localeCompare(b.name, 'es'));
    return {
      kind: 'stock',
      generated_at: nowLocal(),
      alerts: { out: items.filter((item) => item.stock === 0).length, low: items.filter((item) => item.status === 'bajo').length },
      items,
    };
  }

  async function salesReport(period, dateStr) {
    await requireUser();
    const chosen = ['day', 'week', 'month'].includes(period) ? period : 'day';
    const range = periodRange(chosen, dateStr);
    const from = `${ymd(range.start)} 00:00:00`;
    const to = `${ymd(range.end)} 00:00:00`;
    const snap = await db().collection('sales').where('created_at', '>=', from).where('created_at', '<', to).get();
    const rows = snap.docs.map((doc) => ({ id: Number(doc.id), ...doc.data() }));
    const tickets = rows.length;
    const total = rows.reduce((sum, row) => sum + Number(row.total_cents), 0);
    const cost = rows.reduce((sum, row) => sum + Number(row.cost_cents), 0);
    const units = rows.reduce((sum, row) => sum + (row.items || []).reduce((inner, item) => inner + Number(item.qty), 0), 0);
    const payMap = new Map();
    const topMap = new Map();
    for (const row of rows) {
      const pay = payMap.get(row.payment_method) || { payment_method: row.payment_method, tickets: 0, total_cents: 0 };
      pay.tickets += 1;
      pay.total_cents += Number(row.total_cents);
      payMap.set(row.payment_method, pay);
      for (const item of row.items || []) {
        const key = `${item.product_id || ''}:${item.name}`;
        const current = topMap.get(key) || { product_id: item.product_id, name: item.name, qty: 0, total_cents: 0, photo: '' };
        current.qty += Number(item.qty);
        current.total_cents += Number(item.qty) * Number(item.price_cents);
        topMap.set(key, current);
      }
    }
    const catalog = await products();
    const photos = new Map(catalog.map((item) => [item.id, item.photo]));
    const top = [...topMap.values()].sort((a, b) => b.total_cents - a.total_cents).slice(0, 8)
      .map((item) => ({ ...item, photo: photos.get(item.product_id) || '' }));
    let series = [];
    if (chosen === 'day') {
      const byHour = new Map();
      for (const row of rows) {
        const hour = String(row.created_at).slice(11, 13);
        const current = byHour.get(hour) || { tickets: 0, total_cents: 0 };
        current.tickets += 1;
        current.total_cents += Number(row.total_cents);
        byHour.set(hour, current);
      }
      const hours = new Set();
      for (let hour = 8; hour <= 21; hour += 1) hours.add(pad(hour));
      for (const hour of byHour.keys()) hours.add(hour);
      series = [...hours].sort().map((hour) => ({
        label: `${Number(hour)}h`,
        tickets: byHour.get(hour)?.tickets || 0,
        total_cents: byHour.get(hour)?.total_cents || 0,
      }));
    } else {
      const byDay = new Map();
      for (const row of rows) {
        const day = String(row.created_at).slice(0, 10);
        const current = byDay.get(day) || { tickets: 0, total_cents: 0 };
        current.tickets += 1;
        current.total_cents += Number(row.total_cents);
        byDay.set(day, current);
      }
      const weekdays = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
      for (let cursor = range.start; cursor < range.end; cursor = addDays(cursor, 1)) {
        const row = byDay.get(ymd(cursor));
        series.push({
          label: chosen === 'month' ? String(cursor.getDate()) : `${weekdays[cursor.getDay()]} ${cursor.getDate()}`,
          tickets: row?.tickets || 0,
          total_cents: row?.total_cents || 0,
        });
      }
    }
    const sales = rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || b.id - a.id).slice(0, 300).map((row) => ({
      id: row.id,
      created_at: row.created_at,
      payment_method: row.payment_method,
      total_cents: Number(row.total_cents),
      paid_cents: Number(row.paid_cents),
      change_cents: Number(row.change_cents),
      cost_cents: Number(row.cost_cents),
    }));
    return {
      kind: 'sales',
      period: chosen,
      label: range.label,
      start: ymd(range.start),
      end: ymd(addDays(range.end, -1)),
      summary: { tickets, units, total_cents: total, cost_cents: cost, profit_cents: total - cost, avg_cents: tickets ? Math.round(total / tickets) : 0 },
      payments: [...payMap.values()].sort((a, b) => b.total_cents - a.total_cents),
      top, series, sales, truncated: tickets > sales.length,
    };
  }

  async function placeSale(body) {
    await requireUser();
    const method = body?.payment_method;
    if (!['efectivo', 'debito', 'credito', 'transferencia'].includes(method)) fail(400, 'Elegí cómo paga el cliente');
    if (!Array.isArray(body.items) || !body.items.length) fail(400, 'No hay productos en la venta');
    const qtyById = new Map();
    for (const item of body.items) {
      const productId = Number(item.product_id);
      const qty = Number(item.qty);
      if (!Number.isInteger(productId) || productId <= 0) fail(400, 'Producto inválido');
      if (!Number.isInteger(qty) || qty <= 0 || qty > 9999) fail(400, 'Cantidad inválida');
      qtyById.set(productId, (qtyById.get(productId) || 0) + qty);
    }
    const saleId = await nextId('sales');
    const created = nowLocal();
    return db().runTransaction(async (tx) => {
      const lines = [];
      for (const [productId, qty] of [...qtyById.entries()].sort((a, b) => a[0] - b[0])) {
        const snap = await tx.get(db().collection('products').doc(String(productId)));
        if (!snap.exists || snap.data().active !== 1) fail(400, 'Hay un producto que ya no está disponible');
        const product = snap.data();
        if (Number(product.stock) < qty) fail(400, `Stock insuficiente de ${product.name}. Hay ${product.stock}.`);
        lines.push({ ref: snap.ref, product, productId, qty });
      }
      const total = lines.reduce((sum, line) => sum + Number(line.product.price_cents) * line.qty, 0);
      const cost = lines.reduce((sum, line) => sum + Number(line.product.cost_cents) * line.qty, 0);
      if (body.expected_total_cents != null && Number(body.expected_total_cents) !== total) fail(409, 'Los precios cambiaron. Revisá la venta.');
      let paid = total;
      let change = 0;
      if (method === 'efectivo') {
        paid = Number(body.paid_cents);
        if (!Number.isInteger(paid) || paid < 0) fail(400, 'Ingresá con cuánto paga');
        if (paid < total) fail(400, 'El pago en efectivo no alcanza');
        change = paid - total;
      }
      const items = lines.map((line, index) => ({
        id: index + 1,
        product_id: line.productId,
        name: line.product.name,
        barcode: line.product.barcode || '',
        qty: line.qty,
        price_cents: Number(line.product.price_cents),
        cost_cents: Number(line.product.cost_cents),
      }));
      for (const line of lines) tx.update(line.ref, { stock: Number(line.product.stock) - line.qty });
      const sale = { created_at: created, payment_method: method, total_cents: total, paid_cents: paid, change_cents: change, cost_cents: cost, items };
      tx.set(db().collection('sales').doc(String(saleId)), sale);
      return { id: saleId, ...sale };
    });
  }

  async function seedIfEmpty() {
    const existing = await db().collection('categories').limit(1).get();
    if (!existing.empty) return;
    const created = nowLocal().slice(0, 10) + ' 08:00:00';
    const site = new URL('fotos/', location.href).href;
    const cats = [
      [1, 'Bebidas', '#1d4e89'], [2, 'Almacén', '#c2410c'], [3, 'Lácteos', '#a16207'],
      [4, 'Limpieza', '#0f6e56'], [5, 'Golosinas', '#be185d'], [6, 'Fiambres', '#7c3aed'],
    ];
    const sups = [
      [1, 'Distribuidora Sur', '11 4567-8901', 'Entrega martes y viernes. Pedido mínimo $ 80.000.'],
      [2, 'Lácteos del Valle', '11 5123-4400', 'Cadena de frío. Avisar si falta hielo en el pedido.'],
      [3, 'Limpieza Norte', '11 4788-2201', 'Factura A. Pago a 15 días.'],
      [4, 'Golosinas Ramos', '11 6033-1188', 'Reposición semanal los lunes a la mañana.'],
    ];
    const prods = [
      [1, 'Agua mineral 500 ml', '7798001000001', 1, 1, 80000, 150000, 24, 8],
      [2, 'Gaseosa cola 1,5 l', '7798001000002', 1, 1, 180000, 320000, 12, 6],
      [3, 'Jugo de naranja 1 l', '7798001000003', 1, 1, 140000, 260000, 9, 4],
      [4, 'Yerba mate 1 kg', '7798001000004', 2, 1, 320000, 540000, 0, 4],
      [5, 'Arroz largo fino 1 kg', '7798001000005', 2, 1, 150000, 280000, 18, 6],
      [6, 'Fideos spaghetti 500 g', '7798001000006', 2, 1, 90000, 170000, 20, 8],
      [7, 'Aceite de girasol 900 ml', '7798001000007', 2, 1, 280000, 460000, 2, 5],
      [8, 'Leche entera 1 l', '7798001000008', 3, 2, 120000, 210000, 10, 6],
      [9, 'Yogur firme vainilla', '7798001000009', 3, 2, 70000, 140000, 8, 6],
      [10, 'Queso cremoso por kg', '7798001000010', 3, 2, 650000, 980000, 3, 2],
      [11, 'Detergente limón 750 ml', '7798001000011', 4, 3, 160000, 290000, 7, 3],
      [12, 'Lavandina 1 l', '7798001000012', 4, 3, 90000, 180000, 1, 4],
      [13, 'Alfajor de chocolate', '7798001000013', 5, 4, 80000, 160000, 30, 10],
      [14, 'Caramelos de menta 100 g', '7798001000014', 5, 4, 50000, 110000, 15, 5],
      [15, 'Jamón cocido 200 g', '7798001000015', 6, 2, 280000, 470000, 5, 3],
      [16, 'Salchichas 6 unidades', '7798001000016', 6, 2, 220000, 390000, 4, 3],
    ];
    const byCode = new Map(prods.map((row) => [row[2], { id: row[0], name: row[1], barcode: row[2], price_cents: row[6], cost_cents: row[5] }]));
    const day = (daysAgo, hh, mm) => {
      const date = new Date();
      date.setDate(date.getDate() - daysAgo);
      date.setHours(hh, mm, 0, 0);
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(hh)}:${pad(mm)}:00`;
    };
    const sales = [];
    const addSale = (when, method, paid, lines) => {
      const items = lines.map((line, index) => {
        const product = byCode.get(line[0]);
        return { id: index + 1, product_id: product.id, name: product.name, barcode: product.barcode, qty: line[1], price_cents: product.price_cents, cost_cents: product.cost_cents };
      });
      const total = items.reduce((sum, item) => sum + item.price_cents * item.qty, 0);
      const cost = items.reduce((sum, item) => sum + item.cost_cents * item.qty, 0);
      const cash = method === 'efectivo';
      sales.push({ created_at: when, payment_method: method, total_cents: total, paid_cents: cash ? paid : total, change_cents: cash ? paid - total : 0, cost_cents: cost, items });
    };
    addSale(day(0, 9, 15), 'efectivo', 500000, [['7798001000001', 2]]);
    addSale(day(0, 11, 22), 'debito', 0, [['7798001000002', 1], ['7798001000013', 2]]);
    addSale(day(0, 13, 40), 'credito', 0, [['7798001000008', 2], ['7798001000006', 1]]);
    addSale(day(0, 16, 5), 'transferencia', 0, [['7798001000015', 1]]);
    addSale(day(0, 19, 10), 'efectivo', 1000000, [['7798001000013', 3], ['7798001000014', 1]]);
    addSale(day(1, 10, 5), 'efectivo', 1000000, [['7798001000005', 1], ['7798001000007', 1]]);
    addSale(day(1, 15, 30), 'debito', 0, [['7798001000009', 3]]);
    addSale(day(1, 18, 20), 'credito', 0, [['7798001000016', 2]]);
    addSale(day(2, 8, 40), 'efectivo', 500000, [['7798001000001', 3]]);
    addSale(day(2, 12, 15), 'transferencia', 0, [['7798001000010', 1]]);
    addSale(day(2, 17, 45), 'debito', 0, [['7798001000011', 1], ['7798001000012', 1]]);
    addSale(day(6, 11, 10), 'efectivo', 1000000, [['7798001000002', 2], ['7798001000001', 1]]);
    addSale(day(6, 19, 5), 'credito', 0, [['7798001000013', 4]]);
    addSale(day(10, 9, 50), 'debito', 0, [['7798001000008', 4], ['7798001000009', 2]]);
    addSale(day(10, 16, 25), 'transferencia', 0, [['7798001000005', 2], ['7798001000006', 3]]);
    addSale(day(15, 13, 15), 'efectivo', 2000000, [['7798001000015', 2], ['7798001000010', 1]]);
    addSale(day(19, 18, 40), 'debito', 0, [['7798001000003', 2], ['7798001000014', 2]]);

    const batch = db().batch();
    for (const [id, name, color] of cats) batch.set(db().collection('categories').doc(String(id)), { name, color, created_at: created });
    for (const [id, name, phone, notes] of sups) batch.set(db().collection('suppliers').doc(String(id)), { name, phone, notes, created_at: created });
    for (const [id, name, barcode, categoryId, supplierId, cost, price, stock, minStock] of prods) {
      batch.set(db().collection('products').doc(String(id)), {
        name, barcode, category_id: categoryId, supplier_id: supplierId,
        cost_cents: cost, price_cents: price, stock, min_stock: minStock,
        photo: `${site}${barcode}.svg`, active: 1, created_at: created,
      });
    }
    sales.forEach((sale, index) => batch.set(db().collection('sales').doc(String(index + 1)), sale));
    batch.set(db().collection('meta').doc('ids'), { categories: 6, suppliers: 4, products: 16, sales: sales.length });
    await batch.commit();
  }

  window.menchyReady = async function menchyReady() {
    client();
    const user = await new Promise((resolve) => {
      const stop = window.firebase.auth().onAuthStateChanged((next) => {
        stop();
        resolve(next);
      });
    });
    if (!user) return false;
    await seedIfEmpty();
    return true;
  };

  window.menchyCloudApi = async function menchyCloudApi(url, opts = {}) {
    const path = String(url).split('?')[0];
    const query = new URLSearchParams(String(url).split('?')[1] || '');
    const method = opts.method || (opts.body != null ? 'POST' : 'GET');
    const body = opts.body;
    if (path === '/api/login' && method === 'POST') {
      try {
        await client().auth().signInWithEmailAndPassword(cfg.email, String(body?.password || ''));
      } catch {
        fail(401, 'La clave no coincide');
      }
      await seedIfEmpty();
      return { ok: true };
    }
    if (path === '/api/logout') {
      await client().auth().signOut();
      return { ok: true };
    }
    if (path === '/api/health') return { ok: true, name: 'Menchy', auth: true };
    if (path === '/api/network') {
      const open = location.href.split('#')[0].replace(/index\.html$/, '');
      return { mode: 'cloud', hostname: 'Menchy', https: true, entries: [{ name: 'web', address: location.host, http: open, https: open, open, qr: '' }] };
    }
    if (path === '/api/summary') return summary();
    if (path === '/api/categories' && method === 'GET') return categories();
    if (path === '/api/categories' && method === 'POST') {
      await requireUser();
      const name = cleanName(body?.name, 'la categoría', 40);
      const rows = await categories();
      if (rows.some((row) => row.name.toLowerCase() === name.toLowerCase())) fail(400, 'Ya existe esa categoría');
      const id = await nextId('categories');
      await db().collection('categories').doc(String(id)).set({ name, color: COLORS[rows.length % COLORS.length], created_at: nowLocal() });
      return { id, name, color: COLORS[rows.length % COLORS.length], products: 0 };
    }
    const categoryId = path.match(/^\/api\/categories\/(\d+)$/);
    if (categoryId && method === 'PUT') {
      await requireUser();
      const id = Number(categoryId[1]);
      const name = cleanName(body?.name, 'la categoría', 40);
      const ref = db().collection('categories').doc(String(id));
      if (!(await ref.get()).exists) fail(404, 'No encontré esa categoría');
      await ref.update({ name });
      const rows = await categories();
      return rows.find((row) => row.id === id);
    }
    if (categoryId && method === 'DELETE') {
      await requireUser();
      const id = Number(categoryId[1]);
      const used = await db().collection('products').where('category_id', '==', id).limit(1).get();
      if (!used.empty) fail(400, 'Hay productos en esta categoría');
      await db().collection('categories').doc(String(id)).delete();
      return { ok: true };
    }
    if (path === '/api/suppliers' && method === 'GET') return suppliers();
    if (path === '/api/suppliers' && method === 'POST') {
      await requireUser();
      const name = cleanName(body?.name, 'el proveedor', 60);
      const rows = await suppliers();
      if (rows.some((row) => row.name.toLowerCase() === name.toLowerCase())) fail(400, 'Ya existe ese proveedor');
      const id = await nextId('suppliers');
      const row = { name, phone: String(body?.phone || '').trim().slice(0, 40), notes: String(body?.notes || '').trim().slice(0, 200), created_at: nowLocal() };
      await db().collection('suppliers').doc(String(id)).set(row);
      return { id, ...row, products: 0 };
    }
    const supplierId = path.match(/^\/api\/suppliers\/(\d+)$/);
    if (supplierId && method === 'PUT') {
      await requireUser();
      const id = Number(supplierId[1]);
      const name = cleanName(body?.name, 'el proveedor', 60);
      const ref = db().collection('suppliers').doc(String(id));
      if (!(await ref.get()).exists) fail(404, 'No encontré ese proveedor');
      await ref.update({ name, phone: String(body?.phone || '').trim().slice(0, 40), notes: String(body?.notes || '').trim().slice(0, 200) });
      const rows = await suppliers();
      return rows.find((row) => row.id === id);
    }
    if (supplierId && method === 'DELETE') {
      await requireUser();
      const id = Number(supplierId[1]);
      const used = await db().collection('products').where('supplier_id', '==', id).get();
      if (used.docs.some((doc) => doc.data().active === 1)) fail(400, 'Hay productos de este proveedor');
      await db().collection('suppliers').doc(String(id)).delete();
      return { ok: true };
    }
    if (path === '/api/products' && method === 'GET') return products();
    if (path === '/api/products/lookup') {
      const code = query.get('code') || '';
      if (!code) fail(400, 'Falta el código');
      const rows = await products();
      const product = rows.find((item) => item.barcode === code);
      if (!product) fail(404, 'No encontré ese código');
      return product;
    }
    if (path === '/api/products' && method === 'POST') return saveProduct(null, body);
    const productId = path.match(/^\/api\/products\/(\d+)$/);
    if (productId && method === 'PUT') return saveProduct(Number(productId[1]), body);
    if (productId && method === 'DELETE') {
      await requireUser();
      const id = Number(productId[1]);
      const ref = db().collection('products').doc(String(id));
      const snap = await ref.get();
      if (!snap.exists || snap.data().active !== 1) fail(404, 'No encontré ese producto');
      await ref.update({ active: 0, barcode: null });
      return { ok: true };
    }
    if (path === '/api/sales' && method === 'POST') return placeSale(body);
    const saleId = path.match(/^\/api\/sales\/(\d+)$/);
    if (saleId) {
      await requireUser();
      const snap = await db().collection('sales').doc(saleId[1]).get();
      if (!snap.exists) fail(404, 'No encontré esa venta');
      const data = snap.data();
      return { id: Number(snap.id), ...data, items: data.items || [] };
    }
    if (path === '/api/reports/stock') return stockReport();
    if (path === '/api/reports/sales') return salesReport(query.get('period'), query.get('date'));
    fail(404, 'No se pudo completar');
  };
})();
