(() => {
  const cfg = window.MENCHY_CONFIG || {};
  if (!cfg.supabaseUrl || !cfg.supabaseKey) return;

  const COLORS = ['#c2410c', '#0f6e56', '#1d4e89', '#a16207', '#7c3aed', '#be185d', '#0f766e', '#b45309'];
  let sb = null;

  function client() {
    if (!sb) {
      if (!window.supabase?.createClient) {
        const error = new Error('No hay conexión con Menchy.');
        error.status = 0;
        throw error;
      }
      sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
        auth: { persistSession: true, autoRefreshToken: true },
      });
      window.menchySb = sb;
    }
    return sb;
  }

  function fail(status, message) {
    const error = new Error(message);
    error.status = status;
    throw error;
  }

  function raise(error) {
    if (!error) return;
    const raw = String(error.message || 'No se pudo completar');
    if (error.code === '23505' || /duplicate key/i.test(raw)) {
      if (/barcode/i.test(raw)) fail(400, 'Ese código de barras ya está cargado');
      if (/categor/i.test(raw)) fail(400, 'Ya existe esa categoría');
      if (/supplier/i.test(raw)) fail(400, 'Ya existe ese proveedor');
      fail(400, 'Ese dato ya existe');
    }
    const message = raw.replace(/^.*ERROR:\s*/i, '').replace(/^P0001:\s*/, '');
    const status = /precios cambiaron/i.test(message) ? 409 : /no encontr/i.test(message) ? 404 : 400;
    fail(status, message);
  }

  async function requireUser() {
    const { data } = await client().auth.getSession();
    if (!data.session) fail(401, 'Tenés que entrar con la clave');
  }

  function nowLocal(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Argentina/Buenos_Aires',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const get = (type) => parts.find((part) => part.type === type)?.value || '00';
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function ymd(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function parseYmd(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return ymd(date) === value ? date : null;
  }

  function addDays(date, days) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  }

  function startOfWeek(date) {
    const day = date.getDay();
    return addDays(date, day === 0 ? -6 : 1 - day);
  }

  function capital(text) {
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
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
    const label = capital(new Intl.DateTimeFormat('es-AR', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    }).format(start));
    return { start, end: addDays(start, 1), label };
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
    if (!/^[0-9A-Za-z][0-9A-Za-z.\-_ ]{0,63}$/.test(code)) {
      fail(400, 'El código solo puede tener letras, números, puntos y guiones');
    }
    return code;
  }

  function mapProduct(row) {
    if (!row) return null;
    const category = row.categories || {};
    const supplier = row.suppliers || {};
    return {
      id: Number(row.id),
      name: row.name,
      barcode: row.barcode || '',
      category_id: row.category_id == null ? null : Number(row.category_id),
      category_name: category.name || '',
      category_color: category.color || '#c2410c',
      supplier_id: row.supplier_id == null ? null : Number(row.supplier_id),
      supplier_name: supplier.name || '',
      cost_cents: Number(row.cost_cents),
      price_cents: Number(row.price_cents),
      stock: Number(row.stock),
      min_stock: Number(row.min_stock),
      photo: row.photo || '',
      active: Number(row.active),
    };
  }

  const productSelect = '*, categories(name, color), suppliers(name)';

  async function getProduct(id) {
    const { data, error } = await client().from('products').select(productSelect).eq('id', id).maybeSingle();
    raise(error);
    return mapProduct(data);
  }

  async function categories() {
    await requireUser();
    const db = client();
    const [{ data, error }, counted] = await Promise.all([
      db.from('categories').select('*').order('name'),
      db.from('products').select('category_id').eq('active', 1),
    ]);
    raise(error);
    raise(counted.error);
    const counts = new Map();
    for (const row of counted.data || []) counts.set(row.category_id, (counts.get(row.category_id) || 0) + 1);
    return (data || []).map((row) => ({
      id: Number(row.id),
      name: row.name,
      color: row.color,
      products: counts.get(row.id) || 0,
    }));
  }

  async function suppliers() {
    await requireUser();
    const db = client();
    const [{ data, error }, counted] = await Promise.all([
      db.from('suppliers').select('*').order('name'),
      db.from('products').select('supplier_id').eq('active', 1),
    ]);
    raise(error);
    raise(counted.error);
    const counts = new Map();
    for (const row of counted.data || []) {
      if (row.supplier_id != null) counts.set(row.supplier_id, (counts.get(row.supplier_id) || 0) + 1);
    }
    return (data || []).map((row) => ({
      id: Number(row.id),
      name: row.name,
      phone: row.phone || '',
      notes: row.notes || '',
      products: counts.get(row.id) || 0,
    }));
  }

  async function oneCategory(id) {
    const rows = await categories();
    return rows.find((row) => row.id === id) || null;
  }

  async function oneSupplier(id) {
    const rows = await suppliers();
    return rows.find((row) => row.id === id) || null;
  }

  async function saveProduct(id, body) {
    await requireUser();
    const db = client();
    const name = cleanName(body.get ? body.get('name') : body.name, 'el producto', 80);
    const categoryId = Number(body.get ? body.get('category_id') : body.category_id);
    if (!Number.isInteger(categoryId) || categoryId <= 0) fail(400, 'Elegí una categoría');
    const category = await db.from('categories').select('id').eq('id', categoryId).maybeSingle();
    raise(category.error);
    if (!category.data) fail(400, 'Esa categoría no existe');
    let supplierId = null;
    const supplierRaw = String((body.get ? body.get('supplier_id') : body.supplier_id) || '').trim();
    if (supplierRaw) {
      supplierId = Number(supplierRaw);
      const supplier = await db.from('suppliers').select('id').eq('id', supplierId).maybeSingle();
      raise(supplier.error);
      if (!supplier.data) fail(400, 'Ese proveedor no existe');
    }
    const priceRaw = body.get ? body.get('price') : body.price;
    if (String(priceRaw ?? '').trim() === '') fail(400, 'Poné el precio de venta');
    const barcode = cleanBarcode(body.get ? body.get('barcode') : body.barcode);
    if (barcode) {
      const taken = await db.from('products').select('id').eq('barcode', barcode).maybeSingle();
      raise(taken.error);
      if (taken.data && Number(taken.data.id) !== Number(id || 0)) fail(400, 'Ese código de barras ya está cargado');
    }
    let photo = null;
    if (id) {
      const current = await db.from('products').select('photo').eq('id', id).eq('active', 1).maybeSingle();
      raise(current.error);
      if (!current.data) fail(404, 'No encontré ese producto');
      photo = current.data.photo;
    }
    const file = body.get ? body.get('photo') : null;
    if (file && typeof file === 'object' && file.size) {
      const path = `${crypto.randomUUID()}.jpg`;
      const uploaded = await db.storage.from('photos').upload(path, file, { contentType: 'image/jpeg', upsert: false });
      raise(uploaded.error);
      photo = `${cfg.supabaseUrl}/storage/v1/object/public/photos/${path}`;
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
    };
    if (id) {
      const updated = await db.from('products').update(row).eq('id', id).eq('active', 1).select('id');
      raise(updated.error);
      if (!updated.data?.length) fail(404, 'No encontré ese producto');
      return getProduct(id);
    }
    const inserted = await db.from('products').insert({ ...row, active: 1, created_at: nowLocal() }).select('id').single();
    raise(inserted.error);
    return getProduct(inserted.data.id);
  }

  async function summary() {
    await requireUser();
    const db = client();
    const start = `${nowLocal().slice(0, 10)} 00:00:00`;
    const endDate = parseYmd(start.slice(0, 10));
    const end = `${ymd(addDays(endDate, 1))} 00:00:00`;
    const [sales, products] = await Promise.all([
      db.from('sales').select('total_cents').gte('created_at', start).lt('created_at', end),
      db.from('products').select('stock, min_stock').eq('active', 1),
    ]);
    raise(sales.error);
    raise(products.error);
    const rows = sales.data || [];
    const items = products.data || [];
    return {
      tickets: rows.length,
      total_cents: rows.reduce((sum, row) => sum + Number(row.total_cents), 0),
      out: items.filter((row) => Number(row.stock) === 0).length,
      low: items.filter((row) => Number(row.min_stock) > 0 && Number(row.stock) <= Number(row.min_stock) && Number(row.stock) > 0).length,
    };
  }

  async function stockReport() {
    await requireUser();
    const { data, error } = await client().from('products').select(productSelect).eq('active', 1).order('name');
    raise(error);
    const items = (data || []).map((row) => {
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
    }).sort((a, b) => a.category_name.localeCompare(b.category_name, 'es') || a.name.localeCompare(b.name, 'es'));
    return {
      kind: 'stock',
      generated_at: nowLocal(),
      alerts: {
        out: items.filter((item) => item.stock === 0).length,
        low: items.filter((item) => item.status === 'bajo').length,
      },
      items,
    };
  }

  async function salesReport(period, dateStr) {
    await requireUser();
    const chosen = ['day', 'week', 'month'].includes(period) ? period : 'day';
    const range = periodRange(chosen, dateStr);
    const from = `${ymd(range.start)} 00:00:00`;
    const to = `${ymd(range.end)} 00:00:00`;
    const { data, error } = await client()
      .from('sales')
      .select('id, created_at, payment_method, total_cents, paid_cents, change_cents, cost_cents, sale_items(product_id, name, qty, price_cents, cost_cents)')
      .gte('created_at', from)
      .lt('created_at', to)
      .order('created_at', { ascending: false })
      .limit(5000);
    raise(error);
    const rows = data || [];
    const tickets = rows.length;
    const total = rows.reduce((sum, row) => sum + Number(row.total_cents), 0);
    const cost = rows.reduce((sum, row) => sum + Number(row.cost_cents), 0);
    const units = rows.reduce((sum, row) => sum + (row.sale_items || []).reduce((inner, item) => inner + Number(item.qty), 0), 0);
    const payMap = new Map();
    for (const row of rows) {
      const current = payMap.get(row.payment_method) || { payment_method: row.payment_method, tickets: 0, total_cents: 0 };
      current.tickets += 1;
      current.total_cents += Number(row.total_cents);
      payMap.set(row.payment_method, current);
    }
    const topMap = new Map();
    for (const row of rows) {
      for (const item of row.sale_items || []) {
        const key = `${item.product_id || ''}:${item.name}`;
        const current = topMap.get(key) || { product_id: item.product_id, name: item.name, qty: 0, total_cents: 0 };
        current.qty += Number(item.qty);
        current.total_cents += Number(item.qty) * Number(item.price_cents);
        topMap.set(key, current);
      }
    }
    const products = await client().from('products').select('id, photo').in('id', [...topMap.values()].map((item) => item.product_id).filter(Boolean));
    const photos = new Map((products.data || []).map((row) => [row.id, row.photo || '']));
    const top = [...topMap.values()]
      .sort((a, b) => b.total_cents - a.total_cents)
      .slice(0, 8)
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
        const key = ymd(cursor);
        const row = byDay.get(key);
        series.push({
          label: chosen === 'month' ? String(cursor.getDate()) : `${weekdays[cursor.getDay()]} ${cursor.getDate()}`,
          tickets: row?.tickets || 0,
          total_cents: row?.total_cents || 0,
        });
      }
    }
    const sales = rows.slice(0, 300).map((row) => ({
      id: Number(row.id),
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
      summary: {
        tickets,
        units,
        total_cents: total,
        cost_cents: cost,
        profit_cents: total - cost,
        avg_cents: tickets ? Math.round(total / tickets) : 0,
      },
      payments: [...payMap.values()].sort((a, b) => b.total_cents - a.total_cents),
      top,
      series,
      sales,
      truncated: tickets > sales.length,
    };
  }

  async function getSale(id) {
    await requireUser();
    const { data, error } = await client()
      .from('sales')
      .select('*, sale_items(id, product_id, name, barcode, qty, price_cents, cost_cents)')
      .eq('id', id)
      .maybeSingle();
    raise(error);
    if (!data) fail(404, 'No encontré esa venta');
    return {
      id: Number(data.id),
      created_at: data.created_at,
      payment_method: data.payment_method,
      total_cents: Number(data.total_cents),
      paid_cents: Number(data.paid_cents),
      change_cents: Number(data.change_cents),
      cost_cents: Number(data.cost_cents),
      items: (data.sale_items || []).sort((a, b) => a.id - b.id).map((item) => ({
        id: Number(item.id),
        product_id: item.product_id == null ? null : Number(item.product_id),
        name: item.name,
        barcode: item.barcode || '',
        qty: Number(item.qty),
        price_cents: Number(item.price_cents),
        cost_cents: Number(item.cost_cents),
      })),
    };
  }

  window.menchyReady = async function menchyReady() {
    const { data } = await client().auth.getSession();
    return Boolean(data.session);
  };

  window.menchyCloudApi = async function menchyCloudApi(url, opts = {}) {
    const path = String(url).split('?')[0];
    const query = new URLSearchParams(String(url).split('?')[1] || '');
    const method = opts.method || (opts.body != null ? 'POST' : 'GET');
    const body = opts.body;

    if (path === '/api/login' && method === 'POST') {
      const { error } = await client().auth.signInWithPassword({
        email: cfg.email,
        password: String(body?.password || ''),
      });
      if (error) fail(401, 'La clave no coincide');
      return { ok: true };
    }
    if (path === '/api/logout') {
      await client().auth.signOut();
      return { ok: true };
    }
    if (path === '/api/health') return { ok: true, name: 'Menchy', auth: true };
    if (path === '/api/network') {
      const open = location.href.split('#')[0].replace(/index\.html$/, '');
      return {
        mode: 'cloud',
        hostname: 'Menchy',
        https: true,
        entries: [{ name: 'web', address: location.host, http: open, https: open, open, qr: '' }],
      };
    }
    if (path === '/api/summary') return summary();
    if (path === '/api/categories' && method === 'GET') return categories();
    if (path === '/api/categories' && method === 'POST') {
      await requireUser();
      const name = cleanName(body?.name, 'la categoría', 40);
      const existing = await categories();
      const inserted = await client().from('categories').insert({
        name,
        color: COLORS[existing.length % COLORS.length],
        created_at: nowLocal(),
      }).select('id').single();
      raise(inserted.error);
      return oneCategory(Number(inserted.data.id));
    }
    const categoryId = path.match(/^\/api\/categories\/(\d+)$/);
    if (categoryId && method === 'PUT') {
      await requireUser();
      const id = Number(categoryId[1]);
      const name = cleanName(body?.name, 'la categoría', 40);
      const updated = await client().from('categories').update({ name }).eq('id', id).select('id');
      raise(updated.error);
      if (!updated.data?.length) fail(404, 'No encontré esa categoría');
      return oneCategory(id);
    }
    if (categoryId && method === 'DELETE') {
      await requireUser();
      const id = Number(categoryId[1]);
      const used = await client().from('products').select('id', { count: 'exact', head: true }).eq('category_id', id);
      raise(used.error);
      if (used.count) fail(400, 'Hay productos en esta categoría');
      const deleted = await client().from('categories').delete().eq('id', id).select('id');
      raise(deleted.error);
      if (!deleted.data?.length) fail(404, 'No encontré esa categoría');
      return { ok: true };
    }
    if (path === '/api/suppliers' && method === 'GET') return suppliers();
    if (path === '/api/suppliers' && method === 'POST') {
      await requireUser();
      const name = cleanName(body?.name, 'el proveedor', 60);
      const inserted = await client().from('suppliers').insert({
        name,
        phone: String(body?.phone || '').trim().slice(0, 40),
        notes: String(body?.notes || '').trim().slice(0, 200),
        created_at: nowLocal(),
      }).select('id').single();
      raise(inserted.error);
      return oneSupplier(Number(inserted.data.id));
    }
    const supplierId = path.match(/^\/api\/suppliers\/(\d+)$/);
    if (supplierId && method === 'PUT') {
      await requireUser();
      const id = Number(supplierId[1]);
      const name = cleanName(body?.name, 'el proveedor', 60);
      const updated = await client().from('suppliers').update({
        name,
        phone: String(body?.phone || '').trim().slice(0, 40),
        notes: String(body?.notes || '').trim().slice(0, 200),
      }).eq('id', id).select('id');
      raise(updated.error);
      if (!updated.data?.length) fail(404, 'No encontré ese proveedor');
      return oneSupplier(id);
    }
    if (supplierId && method === 'DELETE') {
      await requireUser();
      const id = Number(supplierId[1]);
      const used = await client().from('products').select('id', { count: 'exact', head: true }).eq('supplier_id', id).eq('active', 1);
      raise(used.error);
      if (used.count) fail(400, 'Hay productos de este proveedor');
      await client().from('products').update({ supplier_id: null }).eq('supplier_id', id);
      const deleted = await client().from('suppliers').delete().eq('id', id).select('id');
      raise(deleted.error);
      if (!deleted.data?.length) fail(404, 'No encontré ese proveedor');
      return { ok: true };
    }
    if (path === '/api/products' && method === 'GET') {
      await requireUser();
      const { data, error } = await client().from('products').select(productSelect).eq('active', 1).order('name');
      raise(error);
      return (data || []).map(mapProduct);
    }
    if (path === '/api/products/lookup') {
      await requireUser();
      const code = query.get('code') || '';
      if (!code) fail(400, 'Falta el código');
      const { data, error } = await client().from('products').select(productSelect).eq('active', 1).eq('barcode', code).maybeSingle();
      raise(error);
      if (!data) fail(404, 'No encontré ese código');
      return mapProduct(data);
    }
    if (path === '/api/products' && method === 'POST') return saveProduct(null, body);
    const productId = path.match(/^\/api\/products\/(\d+)$/);
    if (productId && method === 'PUT') return saveProduct(Number(productId[1]), body);
    if (productId && method === 'DELETE') {
      await requireUser();
      const id = Number(productId[1]);
      const updated = await client().from('products').update({ active: 0, barcode: null }).eq('id', id).eq('active', 1).select('id');
      raise(updated.error);
      if (!updated.data?.length) fail(404, 'No encontré ese producto');
      return { ok: true };
    }
    if (path === '/api/sales' && method === 'POST') {
      await requireUser();
      const { data, error } = await client().rpc('place_sale', { payload: body });
      raise(error);
      return data;
    }
    const saleId = path.match(/^\/api\/sales\/(\d+)$/);
    if (saleId) return getSale(Number(saleId[1]));
    if (path === '/api/reports/stock') return stockReport();
    if (path === '/api/reports/sales') return salesReport(query.get('period'), query.get('date'));
    fail(404, 'No se pudo completar');
  };
})();
