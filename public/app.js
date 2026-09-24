const METHODS = [
  { id: 'efectivo', label: 'Efectivo' },
  { id: 'debito', label: 'Débito' },
  { id: 'credito', label: 'Crédito' },
  { id: 'transferencia', label: 'Transferencia' },
];

const NAV = [
  { page: 'venta', label: 'Venta', icon: 'sale' },
  { page: 'productos', label: 'Productos', icon: 'box' },
  { page: 'informes', label: 'Informes', icon: 'chart' },
];

const MORE = [
  { page: 'categorias', label: 'Categorías', icon: 'tag' },
  { page: 'proveedores', label: 'Proveedores', icon: 'truck' },
  { page: 'celular', label: 'Celular', icon: 'phone' },
];

const TITLES = {
  venta: 'Venta',
  productos: 'Productos',
  informes: 'Informes',
  categorias: 'Categorías',
  proveedores: 'Proveedores',
  celular: 'Celular',
  mas: 'Más',
};

const state = {
  page: 'venta',
  products: [],
  categories: [],
  suppliers: [],
  summary: { total_cents: 0, tickets: 0, out: 0, low: 0 },
  cart: [],
  last: null,
  justScanned: false,
  query: '',
  checkout: false,
  payMethod: 'efectivo',
  paidRaw: '',
  receipt: null,
  saving: false,
  editor: null,
  productQuery: '',
  productCategory: '',
  reportTab: 'day',
  reportDate: todayStr(),
  report: null,
  reportLoading: false,
  stockQuery: '',
  stockCategory: '',
  lowOnly: false,
  openSale: null,
  saleCache: {},
  network: null,
  networkLoading: false,
  camera: false,
  scanner: null,
  auth: false,
};

const moneyFmt = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });

function ymd(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function todayStr() {
  return ymd(new Date());
}

function parseYmd(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!match) return new Date();
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function safeColor(color) {
  return /^#[0-9a-fA-F]{6}$/.test(color || '') ? color : '#c2410c';
}

function money(cents) {
  return moneyFmt.format((Number(cents) || 0) / 100);
}

function moneyShort(cents) {
  const pesos = cents / 100;
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: pesos % 1 ? 2 : 0,
  }).format(pesos);
}

function centsToInput(cents) {
  return (Number(cents) / 100).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function parseMoneyInput(raw) {
  let text = String(raw ?? '').trim().replace(/\$/g, '').replace(/\s/g, '');
  if (!text) return null;
  if (text.includes(',') && text.includes('.')) text = text.replace(/\./g, '').replace(',', '.');
  else if (text.includes(',')) text = text.replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(text)) text = text.replace(/\./g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return NaN;
  return Math.round(Number(text) * 100);
}

function methodLabel(id) {
  return METHODS.find((item) => item.id === id)?.label || id;
}

function shortWhen(value) {
  const [date, time = '00:00:00'] = String(value).split(' ');
  const [, month, day] = date.split('-');
  return `${day}/${month} ${time.slice(0, 5)}`;
}

function icon(name) {
  const paths = {
    sale: '<path d="M4 7h16l-1.4 9H6.2z"/><path d="M8 20h.01M16 20h.01"/>',
    box: '<path d="M3 7.5 12 3l9 4.5-9 4.5L3 7.5z"/><path d="M3 7.5V17l9 4 9-4V7.5"/><path d="M12 12v9"/>',
    chart: '<path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 16v-4"/><path d="M12 16V8"/><path d="M16 16v-6"/>',
    tag: '<path d="M12 3H5v7l8 8 7-7-8-8z"/><path d="M8 8h.01"/>',
    truck: '<path d="M3 7h11v8H3z"/><path d="M14 10h4l3 3v2h-7"/><circle cx="7" cy="18" r="1.4"/><circle cx="17" cy="18" r="1.4"/>',
    phone: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>',
    more: '<path d="M6 12h.01M12 12h.01M18 12h.01"/>',
    camera: '<path d="M4 8h4l2-2h4l2 2h4v11H4z"/><circle cx="12" cy="13" r="3"/>',
  };
  return `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || ''}</svg>`;
}

function thumb(product, size) {
  const cls = size ? `thumb ${size}` : 'thumb';
  if (product.photo) return `<img class="${cls}" src="${esc(product.photo)}" alt="">`;
  const letter = esc((product.name || '?').slice(0, 1).toUpperCase());
  return `<span class="${cls} ph" style="--c:${safeColor(product.category_color)}">${letter}</span>`;
}

function cartTotal() {
  return state.cart.reduce((sum, line) => sum + line.product.price_cents * line.qty, 0);
}

function cartUnits() {
  return state.cart.reduce((sum, line) => sum + line.qty, 0);
}

function overStock() {
  return state.cart.some((line) => line.qty > line.product.stock);
}

function canConfirm() {
  if (state.saving || !state.cart.length || overStock()) return false;
  if (state.payMethod !== 'efectivo') return true;
  const paid = parseMoneyInput(state.paidRaw);
  return paid != null && !Number.isNaN(paid) && paid >= cartTotal();
}

function billOptions(totalCents) {
  const options = [{ label: 'Justo', cents: totalCents }];
  for (const pesos of [1000, 2000, 5000, 10000, 20000, 50000, 100000]) {
    const cents = pesos * 100;
    if (cents > totalCents) options.push({ label: moneyShort(cents), cents });
    if (options.length >= 5) break;
  }
  return options;
}

function desktopScanFocus() {
  if (state.camera || window.innerWidth < 900) return undefined;
  return 'scan';
}

let toastTimer;
function toast(message, danger = false) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.toggle('danger', Boolean(danger));
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2800);
}

let audioCtx;
function beep(ok) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx || new Ctx();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = ok ? 880 : 196;
    osc.type = 'sine';
    gain.gain.value = 0.05;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + (ok ? 0.06 : 0.16));
  } catch {
    /* el navegador puede bloquear el audio hasta el primer toque */
  }
}

function setCamStatus(text) {
  const el = document.getElementById('cam-status');
  if (el) el.textContent = text;
}

async function api(url, opts = {}) {
  if (window.menchyCloudApi) {
    try {
      return await window.menchyCloudApi(url, opts);
    } catch (error) {
      if (error.status === 401 && !String(url).includes('/api/login')) renderLogin();
      throw error;
    }
  }
  const options = { method: opts.method || 'GET' };
  if (opts.body instanceof FormData) {
    options.body = opts.body;
    if (opts.method) options.method = opts.method;
  } else if (opts.body != null) {
    options.method = opts.method || 'POST';
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(opts.body);
  }
  let response;
  try {
    response = await fetch(url, options);
  } catch {
    const error = new Error('No hay conexión con Menchy.');
    error.status = 0;
    throw error;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !String(url).includes('/api/login')) renderLogin();
    const error = new Error(data.error || 'No se pudo completar');
    error.status = response.status;
    throw error;
  }
  return data;
}

function syncCart() {
  state.cart = state.cart.flatMap((line) => {
    const product = state.products.find((item) => item.id === line.product.id);
    return product ? [{ product, qty: line.qty }] : [];
  });
  if (!state.last) return;
  const product = state.products.find((item) => item.id === state.last.product.id);
  if (!product) {
    state.last = null;
    return;
  }
  const qty = state.cart.find((line) => line.product.id === product.id)?.qty || 0;
  state.last = { product, qty };
}

function upsertProduct(product) {
  const index = state.products.findIndex((item) => item.id === product.id);
  if (index >= 0) state.products[index] = product;
  else state.products.push(product);
  state.products.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  syncCart();
}

async function pull() {
  const [products, categories, suppliers, summary] = await Promise.all([
    api('/api/products'),
    api('/api/categories'),
    api('/api/suppliers'),
    api('/api/summary'),
  ]);
  state.products = products;
  state.categories = categories;
  state.suppliers = suppliers;
  state.summary = summary;
  syncCart();
}

function suggestionItems() {
  const query = state.query.trim().toLowerCase();
  if (!query) return [];
  return state.products.filter((product) => (
    product.name.toLowerCase().includes(query)
    || (product.barcode || '').toLowerCase().includes(query)
    || (product.category_name || '').toLowerCase().includes(query)
    || (product.supplier_name || '').toLowerCase().includes(query)
  )).slice(0, 6);
}

function paintSuggest() {
  const box = document.getElementById('suggest');
  if (!box) return;
  box.innerHTML = suggestionItems().map((product) => `
    <button type="button" data-act="pick" data-id="${product.id}">
      ${thumb(product)}
      <span><strong>${esc(product.name)}</strong><small>${money(product.price_cents)} · stock ${product.stock}</small></span>
    </button>
  `).join('');
}

function vueltoInner(total = cartTotal()) {
  const paid = parseMoneyInput(state.paidRaw);
  if (paid == null) {
    return '<div class="vuelto wait"><span>Vuelto a entregar</span><strong>Ingresá con cuánto paga</strong></div>';
  }
  if (Number.isNaN(paid)) {
    return '<div class="vuelto bad"><span>Vuelto</span><strong>Ese monto no se entiende</strong></div>';
  }
  if (paid < total) {
    return `<div class="vuelto bad"><span>Falta</span><strong>${money(total - paid)}</strong></div>`;
  }
  const label = paid === total ? 'No tenés que dar vuelto' : 'Vuelto a entregar';
  return `<div class="vuelto ok"><span>${label}</span><strong>${money(paid - total)}</strong></div>`;
}

function paintVuelto() {
  const box = document.getElementById('vuelto-box');
  if (box) box.innerHTML = vueltoInner();
  const button = document.getElementById('confirm-sale');
  if (button) button.disabled = !canConfirm();
}

function updateMarginHint() {
  const hint = document.getElementById('margin-hint');
  if (!hint) return;
  const cost = parseMoneyInput(document.getElementById('cost')?.value);
  const price = parseMoneyInput(document.getElementById('price')?.value);
  if (price == null || Number.isNaN(price) || price <= 0) {
    hint.textContent = '';
    return;
  }
  const gain = price - (Number.isNaN(cost) || cost == null ? 0 : cost);
  const margin = Math.round((gain / price) * 100);
  hint.textContent = `Margen ${margin}% · ganancia ${money(gain)} por unidad`;
}

function render(opts = {}) {
  const active = document.activeElement;
  const keepIds = ['scan', 'product-search', 'paid', 'stock-search'];
  const keep = active && keepIds.includes(active.id)
    ? { id: active.id, start: active.selectionStart, end: active.selectionEnd }
    : null;
  document.getElementById('app').innerHTML = layout();
  paintSuggest();
  if (document.getElementById('price')) updateMarginHint();
  document.title = `Menchy · ${TITLES[state.page] || 'Menchy'}`;
  if (state.camera) return;
  if (opts.focus) {
    document.getElementById(opts.focus)?.focus();
    return;
  }
  if (keep) {
    const el = document.getElementById(keep.id);
    if (el) {
      el.focus();
      try { el.setSelectionRange(keep.start, keep.end); } catch { /* algunos inputs no lo permiten */ }
    }
    return;
  }
  if (window.innerWidth >= 900 && state.page === 'venta' && !state.checkout && !state.receipt && !state.editor) {
    document.getElementById('scan')?.focus();
  }
}

function layout() {
  return `
    <div class="app">
      ${sidebar()}
      <main class="main page-${state.page}">
        ${mobileTop()}
        <div class="main-inner">${pageBody()}</div>
      </main>
      ${bottomNav()}
    </div>
    ${state.receipt ? receiptHtml() : ''}
    ${!state.receipt && state.checkout ? checkoutHtml() : ''}
  `;
}

function stockBadge() {
  return state.summary.out ? `<i class="badge">${state.summary.out}</i>` : '';
}

function sidebar() {
  const buttons = (items) => items.map((item) => `
    <button type="button" class="nav-btn ${state.page === item.page ? 'active' : ''}" data-act="nav" data-page="${item.page}">
      ${icon(item.icon)} ${item.label} ${item.page === 'productos' ? stockBadge() : ''}
    </button>
  `).join('');
  return `
    <aside class="sidebar">
      <div class="brand"><span class="mark">M</span><div><strong>Menchy</strong><small>Almacén</small></div></div>
      ${buttons(NAV)}
      <div class="nav-label">Gestión</div>
      ${buttons(MORE)}
      <div class="side-spacer"></div>
      ${state.auth ? '<button type="button" class="side-logout" data-act="logout">Salir</button>' : ''}
      <div class="side-today">
        <span>Hoy</span>
        <strong>${money(state.summary.total_cents)}</strong>
        <small>${state.summary.tickets} ${state.summary.tickets === 1 ? 'venta' : 'ventas'}</small>
      </div>
    </aside>
  `;
}

function mobileTop() {
  return `
    <div class="mobile-top">
      <div class="brand"><span class="mark">M</span><strong>${esc(TITLES[state.page] || 'Menchy')}</strong></div>
      <span class="mobile-tools">
        ${state.auth ? '<button type="button" class="text-btn" data-act="logout">Salir</button>' : ''}
        <span class="today-pill">Hoy ${money(state.summary.total_cents)}</span>
      </span>
    </div>
  `;
}

function bottomNav() {
  const items = [...NAV, { page: 'mas', label: 'Más', icon: 'more' }];
  return `
    <nav class="bottom-nav">
      ${items.map((item) => {
        const active = item.page === 'mas'
          ? ['mas', 'categorias', 'proveedores', 'celular'].includes(state.page)
          : state.page === item.page;
        return `<button type="button" class="${active ? 'active' : ''}" data-act="nav" data-page="${item.page}">${icon(item.icon)}<span>${item.label}</span>${item.page === 'productos' ? stockBadge() : ''}</button>`;
      }).join('')}
    </nav>
  `;
}

function pageBody() {
  if (state.page === 'venta') return pageVenta();
  if (state.page === 'productos') return state.editor ? pageEditor() : pageProductos();
  if (state.page === 'informes') return pageInformes();
  if (state.page === 'categorias') return pageCategorias();
  if (state.page === 'proveedores') return pageProveedores();
  if (state.page === 'celular') return pageCelular();
  return pageMas();
}

function pageVenta() {
  const units = cartUnits();
  return `
    ${state.products.length ? '' : '<div class="banner">Todavía no hay productos. <button type="button" data-act="nav" data-page="productos">Cargá el primero</button></div>'}
    <section class="pos">
      <form id="scan-form" class="scanbar" autocomplete="off">
        ${icon('sale')}
        <input id="scan" name="menchy-scan" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="search" placeholder="Escaneá el código o buscá el producto" aria-label="Escanear código de barras" value="${esc(state.query)}">
        <button type="button" class="btn secondary icon-btn" data-act="camera-open">${icon('camera')}<span>Cámara</span></button>
        <p class="scan-hint">El lector USB escribe el código solo. Dejá esta pantalla abierta y escaneá.</p>
        <div id="suggest" class="suggest"></div>
      </form>
      ${stageHtml()}
      <section class="cart">
        <header class="cart-head">
          <h2>Venta${units ? ` · ${units}` : ''}</h2>
          <span>Hoy ${money(state.summary.total_cents)} · ${state.summary.tickets} ${state.summary.tickets === 1 ? 'venta' : 'ventas'}</span>
        </header>
        <div class="cart-lines">
          ${state.cart.length ? state.cart.map(lineHtml).join('') : '<p class="empty-copy">Cuando escanees, el producto aparece al costado y se suma acá.</p>'}
        </div>
        <div class="paybar">
          <div>
            <span class="muted">Total</span>
            <strong class="total num">${money(cartTotal())}</strong>
          </div>
          <button type="button" class="btn big" data-act="checkout-open" ${state.cart.length ? '' : 'disabled'}>Cerrar venta</button>
        </div>
      </section>
    </section>
  `;
}

function stageHtml() {
  const last = state.last;
  if (!last) {
    return `
      <aside class="stage" aria-live="polite">
        <div class="stage-empty">
          <span class="mark">M</span>
          <div>
            <h2>El producto va a aparecer acá</h2>
            <p class="muted">Cada escaneo muestra la foto y suma una unidad.</p>
          </div>
        </div>
      </aside>`;
  }
  const product = last.product;
  return `
    <aside class="stage has-product ${state.justScanned ? 'flash' : ''}" aria-live="polite">
      ${thumb(product, 'xl')}
      <div class="stage-copy">
        <p class="eyebrow">${esc(product.category_name || 'Producto')}</p>
        <h2>${esc(product.name)}</h2>
        <p class="stage-price">${money(product.price_cents)}</p>
        <p class="stage-qty">${last.qty > 0 ? `En esta venta: <strong>${last.qty}</strong>` : 'No está en esta venta'}</p>
        <p class="muted">${product.supplier_name ? `${esc(product.supplier_name)} · ` : ''}Stock ${product.stock}</p>
      </div>
    </aside>`;
}

function lineHtml(line) {
  const product = line.product;
  const warn = line.qty > product.stock ? `<small class="bad-text">Hay ${product.stock} en stock</small>` : '';
  const just = state.justScanned && state.last?.product.id === product.id ? 'just' : '';
  return `
    <article class="line ${just}">
      ${thumb(product)}
      <div class="line-copy">
        <strong>${esc(product.name)}</strong>
        <small>${money(product.price_cents)} c/u</small>
        ${warn}
        <button type="button" class="linkish" data-act="remove" data-id="${product.id}">Quitar</button>
      </div>
      <div class="qty">
        <button type="button" data-act="dec" data-id="${product.id}" aria-label="Quitar uno">−</button>
        <b>${line.qty}</b>
        <button type="button" data-act="inc" data-id="${product.id}" aria-label="Sumar uno">+</button>
      </div>
      <strong class="num">${money(product.price_cents * line.qty)}</strong>
    </article>
  `;
}

function checkoutHtml() {
  const total = cartTotal();
  return `
    <div class="sheet">
      <div class="sheet-card pay-sheet" role="dialog" aria-modal="true" aria-labelledby="pay-title">
        <header class="sheet-head">
          <div>
            <p class="eyebrow">Cobrar</p>
            <h2 id="pay-title">${money(total)}</h2>
          </div>
          <button type="button" class="btn secondary small" data-act="checkout-close">Volver</button>
        </header>
        <div class="pay-scroll">
          <div class="methods">
            ${METHODS.map((item) => `<button type="button" class="${state.payMethod === item.id ? 'active' : ''}" data-act="pay" data-method="${item.id}">${item.label}</button>`).join('')}
          </div>
          ${state.payMethod === 'efectivo' ? `
            <label class="field">
              <span>¿Con cuánto paga?</span>
              <input id="paid" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${esc(state.paidRaw)}">
            </label>
            <div class="bills">
              ${billOptions(total).map((bill) => `<button type="button" data-act="bill" data-cents="${bill.cents}">${esc(bill.label)}</button>`).join('')}
            </div>
          ` : `<p class="pay-note">Se cobra el total con ${methodLabel(state.payMethod)}.</p>`}
        </div>
        <div class="pay-foot">
          ${state.payMethod === 'efectivo' ? `<div id="vuelto-box">${vueltoInner(total)}</div>` : ''}
          <button type="button" class="btn big" id="confirm-sale" data-act="confirm-sale" ${canConfirm() ? '' : 'disabled'}>
            ${state.saving ? 'Guardando…' : 'Confirmar venta'}
          </button>
        </div>
      </div>
    </div>
  `;
}

function receiptHtml() {
  const sale = state.receipt;
  const cash = sale.payment_method === 'efectivo';
  const headline = cash
    ? (sale.change_cents === 0 ? 'No tenés que dar vuelto' : 'Entregá este vuelto')
    : `Cobrado con ${methodLabel(sale.payment_method)}`;
  const big = cash ? sale.change_cents : sale.total_cents;
  return `
    <div class="sheet receipt-sheet">
      <div class="sheet-card" role="dialog" aria-modal="true">
        <p class="eyebrow">Venta #${sale.id}</p>
        <h2>${headline}</h2>
        <p class="vuelto-hero ${cash && sale.change_cents > 0 ? 'good' : ''}">${money(big)}</p>
        ${cash ? `<p class="muted">Total ${money(sale.total_cents)} · Pagó ${money(sale.paid_cents)}</p>` : `<p class="muted">Total ${money(sale.total_cents)}</p>`}
        <ul class="receipt-lines">
          ${sale.items.map((item) => `<li><span>${item.qty} × ${esc(item.name)}</span><span class="num">${money(item.price_cents * item.qty)}</span></li>`).join('')}
        </ul>
        <button type="button" class="btn big" data-act="new-sale">Nueva venta</button>
      </div>
    </div>
  `;
}

function visibleProducts() {
  const query = state.productQuery.trim().toLowerCase();
  return state.products.filter((product) => {
    if (state.productCategory && String(product.category_id) !== String(state.productCategory)) return false;
    if (!query) return true;
    return product.name.toLowerCase().includes(query)
      || (product.barcode || '').toLowerCase().includes(query)
      || (product.supplier_name || '').toLowerCase().includes(query);
  });
}

function stockTag(product) {
  if (product.stock === 0) return '<em class="tag bad">Sin stock</em>';
  if (product.min_stock > 0 && product.stock <= product.min_stock) return `<em class="tag warn">Bajo · ${product.stock}</em>`;
  return `<em class="tag" style="--c:${safeColor(product.category_color)}">${product.stock} u.</em>`;
}

function pageProductos() {
  const products = visibleProducts();
  return `
    <header class="page-head">
      <div>
        <h1>Productos</h1>
        <p>Foto, categoría, proveedor, costo y precio de venta.</p>
      </div>
      <button type="button" class="btn" data-act="product-new">Nuevo producto</button>
    </header>
    <div class="report-tools">
      <input id="product-search" placeholder="Buscar" value="${esc(state.productQuery)}" aria-label="Buscar productos">
      <select id="product-category" aria-label="Filtrar por categoría">
        <option value="">Todas las categorías</option>
        ${state.categories.map((cat) => `<option value="${cat.id}" ${String(state.productCategory) === String(cat.id) ? 'selected' : ''}>${esc(cat.name)}</option>`).join('')}
      </select>
    </div>
    ${products.length ? `<div class="grid">${products.map((product) => `
      <button type="button" class="pcard" data-act="product-edit" data-id="${product.id}">
        ${thumb(product)}
        <strong>${esc(product.name)}</strong>
        <span class="chip" style="--c:${safeColor(product.category_color)}">${esc(product.category_name || 'Sin categoría')}</span>
        <span class="price">${money(product.price_cents)}</span>
        <span class="muted">Costo ${money(product.cost_cents)}</span>
        ${stockTag(product)}
      </button>
    `).join('')}</div>` : `<p class="empty-copy">${state.products.length ? 'Nada con esa búsqueda.' : 'Todavía no hay productos.'}</p>`}
  `;
}

function pageEditor() {
  const product = state.editor?.id ? state.products.find((item) => item.id === state.editor.id) : null;
  if (state.editor?.id && !product) return '<p class="empty-copy">No encontré ese producto.</p>';
  return `
    <header class="page-head">
      <div>
        <h1>${product ? 'Editar producto' : 'Nuevo producto'}</h1>
        <p>El código de barras es el que lee el escáner.</p>
      </div>
    </header>
    <form id="product-form" class="panel">
      <div class="editor">
        <div class="photo-pick">
          <img id="photo-preview" alt="" src="${product?.photo || ''}" class="${product?.photo ? '' : 'empty'}">
          <label class="btn secondary">Elegir foto
            <input id="photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp" hidden>
          </label>
        </div>
        <div>
          <div class="form-grid two">
            <label class="field span-2"><span>Nombre</span><input name="name" maxlength="80" required value="${esc(product?.name || '')}"></label>
            <div class="field">
              <span>Código de barras</span>
              <div class="inline">
                <input id="barcode" name="barcode" maxlength="64" value="${esc(product?.barcode || '')}" autocomplete="off">
                <button type="button" class="btn secondary small" data-act="barcode-gen">Generar</button>
              </div>
            </div>
            <label class="field"><span>Categoría</span>
              <select id="category_id" name="category_id" required>
                <option value="">Elegí una categoría</option>
                ${state.categories.map((cat) => `<option value="${cat.id}" ${product && product.category_id === cat.id ? 'selected' : ''}>${esc(cat.name)}</option>`).join('')}
              </select>
            </label>
            <div class="field"><span> </span><button type="button" class="btn secondary" data-act="quick-category">Nueva categoría</button></div>
            <label class="field"><span>Proveedor</span>
              <select id="supplier_id" name="supplier_id">
                <option value="">Sin proveedor</option>
                ${state.suppliers.map((supplier) => `<option value="${supplier.id}" ${product && product.supplier_id === supplier.id ? 'selected' : ''}>${esc(supplier.name)}</option>`).join('')}
              </select>
            </label>
            <div class="field"><span> </span><button type="button" class="btn secondary" data-act="quick-supplier">Nuevo proveedor</button></div>
            <label class="field"><span>Precio de costo</span><input id="cost" name="cost" inputmode="decimal" placeholder="0,00" value="${product ? esc(centsToInput(product.cost_cents)) : ''}"></label>
            <label class="field"><span>Precio de venta</span><input id="price" name="price" inputmode="decimal" placeholder="0,00" required value="${product ? esc(centsToInput(product.price_cents)) : ''}"></label>
            <label class="field"><span>Stock actual</span><input name="stock" inputmode="numeric" placeholder="0" value="${product ? product.stock : ''}"></label>
            <label class="field"><span>Avisar cuando quede esta cantidad o menos</span><input name="min_stock" inputmode="numeric" placeholder="0" value="${product ? product.min_stock : ''}"></label>
          </div>
          <p id="margin-hint" class="hint"></p>
          <div class="form-actions">
            <button type="submit" class="btn">Guardar</button>
            <button type="button" class="btn secondary" data-act="product-cancel">Cancelar</button>
            ${product ? `<button type="button" class="btn danger" data-act="product-delete" data-id="${product.id}">Dar de baja</button>` : ''}
          </div>
        </div>
      </div>
    </form>
  `;
}

function reportTabs() {
  const tabs = [['day', 'Diario'], ['week', 'Semanal'], ['month', 'Mensual'], ['stock', 'Stock']];
  return `<div class="tabs no-print">${tabs.map(([id, label]) => `
    <button type="button" class="${state.reportTab === id ? 'active' : ''}" data-act="report-tab" data-tab="${id}">${label}</button>
  `).join('')}</div>`;
}

function reportTools() {
  if (state.reportTab === 'stock') {
    return `
      <div class="report-tools no-print">
        <input id="stock-search" placeholder="Buscar producto" value="${esc(state.stockQuery)}" aria-label="Buscar en el stock">
        <select id="stock-category" aria-label="Categoría del informe">
          <option value="">Todas las categorías</option>
          ${state.categories.map((cat) => `<option value="${cat.id}" ${String(state.stockCategory) === String(cat.id) ? 'selected' : ''}>${esc(cat.name)}</option>`).join('')}
        </select>
        <label class="check"><input id="low-only" type="checkbox" ${state.lowOnly ? 'checked' : ''}> Solo problemas de stock</label>
        <button type="button" class="btn secondary small" data-act="print">Imprimir</button>
        <button type="button" class="btn secondary small" data-act="csv">Exportar</button>
      </div>`;
  }
  return `
    <div class="report-tools no-print">
      <button type="button" class="btn secondary small" data-act="report-prev">Anterior</button>
      <input id="report-date" type="${state.reportTab === 'month' ? 'month' : 'date'}" value="${state.reportTab === 'month' ? state.reportDate.slice(0, 7) : state.reportDate}" aria-label="Fecha del informe">
      <button type="button" class="btn secondary small" data-act="report-next">Siguiente</button>
      <button type="button" class="btn secondary small" data-act="print">Imprimir</button>
      <button type="button" class="btn secondary small" data-act="csv">Exportar</button>
    </div>`;
}

function pageInformes() {
  return `
    <header class="page-head">
      <div>
        <h1>Informes</h1>
        <p>Stock del depósito y ventas del día, la semana o el mes.</p>
      </div>
    </header>
    ${reportTabs()}
    ${reportTools()}
    ${state.reportLoading && !state.report ? '<p class="empty-copy">Cargando informe…</p>' : ''}
    ${state.report?.kind === 'stock' ? stockReportHtml() : ''}
    ${state.report?.kind === 'sales' ? salesReportHtml() : ''}
  `;
}

function filteredStock() {
  if (state.report?.kind !== 'stock') return [];
  const query = state.stockQuery.trim().toLowerCase();
  return state.report.items.filter((item) => {
    if (state.stockCategory && String(item.category_id) !== String(state.stockCategory)) return false;
    if (state.lowOnly && item.status === 'ok') return false;
    if (!query) return true;
    return item.name.toLowerCase().includes(query)
      || (item.barcode || '').toLowerCase().includes(query)
      || (item.supplier_name || '').toLowerCase().includes(query)
      || (item.category_name || '').toLowerCase().includes(query);
  });
}

function statusLabel(status) {
  if (status === 'sin-stock') return 'Sin stock';
  if (status === 'bajo') return 'Bajo';
  return 'Ok';
}

function stockReportHtml() {
  const items = filteredStock();
  const totals = items.reduce((acc, item) => {
    acc.units += item.stock;
    acc.cost += item.cost_value_cents;
    acc.sale += item.sale_value_cents;
    return acc;
  }, { units: 0, cost: 0, sale: 0 });
  const alerts = state.report.alerts || { out: 0, low: 0 };
  return `
    <div class="kpis">
      <article class="kpi"><span>Productos</span><strong>${items.length}</strong></article>
      <article class="kpi"><span>Unidades</span><strong>${totals.units}</strong></article>
      <article class="kpi"><span>Valor a costo</span><strong>${money(totals.cost)}</strong></article>
      <article class="kpi"><span>Valor a venta</span><strong>${money(totals.sale)}</strong></article>
      <article class="kpi"><span>Sin stock</span><strong>${alerts.out}</strong></article>
      <article class="kpi"><span>Bajo mínimo</span><strong>${alerts.low}</strong></article>
    </div>
    <p class="muted" style="margin-bottom:10px">Actualizado ${esc(shortWhen(state.report.generated_at))}. Ganancia potencial del stock: ${money(totals.sale - totals.cost)}.</p>
    ${items.length ? '' : '<p class="empty-copy">No hay productos para mostrar.</p>'}
    <div class="stock-cards">
      ${items.map((item) => `
        <article class="stock-card">
          <strong>${esc(item.name)}</strong>
          <p class="muted">${esc(item.category_name)}${item.supplier_name ? ` · ${esc(item.supplier_name)}` : ''}</p>
          <p><em class="tag ${item.status === 'ok' ? '' : item.status === 'bajo' ? 'warn' : 'bad'}">${statusLabel(item.status)} · ${item.stock}</em></p>
          <p>Costo ${money(item.cost_cents)} · Venta ${money(item.price_cents)}</p>
          <p>En depósito: ${money(item.sale_value_cents)}</p>
        </article>
      `).join('')}
    </div>
    <div class="stock-table table-wrap">
      <table>
        <thead>
          <tr>
            <th>Producto</th><th>Categoría</th><th>Proveedor</th><th>Código</th>
            <th class="num">Stock</th><th class="num">Costo</th><th class="num">Venta</th>
            <th class="num">Valor costo</th><th class="num">Valor venta</th><th>Estado</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((item) => `
            <tr>
              <td>${esc(item.name)}</td>
              <td>${esc(item.category_name)}</td>
              <td>${esc(item.supplier_name)}</td>
              <td>${esc(item.barcode)}</td>
              <td class="num">${item.stock}</td>
              <td class="num">${money(item.cost_cents)}</td>
              <td class="num">${money(item.price_cents)}</td>
              <td class="num">${money(item.cost_value_cents)}</td>
              <td class="num">${money(item.sale_value_cents)}</td>
              <td>${statusLabel(item.status)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function barsHtml(series) {
  const max = Math.max(...series.map((item) => item.total_cents), 1);
  return `<div class="bars">${series.map((item) => {
    const height = item.total_cents ? Math.max(4, Math.round((item.total_cents / max) * 100)) : 0;
    return `<div class="bar-col" title="${esc(item.label)} · ${money(item.total_cents)}">
      <div class="bar-track"><div class="bar" style="height:${height}%"></div></div>
      <span>${esc(item.label)}</span>
    </div>`;
  }).join('')}</div>`;
}

function salesReportHtml() {
  const report = state.report;
  const summary = report.summary;
  const maxPay = Math.max(...report.payments.map((item) => item.total_cents), 1);
  return `
    <div class="kpis">
      <article class="kpi"><span>Vendido</span><strong>${money(summary.total_cents)}</strong></article>
      <article class="kpi"><span>Ganancia</span><strong>${money(summary.profit_cents)}</strong><em>Costo ${money(summary.cost_cents)}</em></article>
      <article class="kpi"><span>Tickets</span><strong>${summary.tickets}</strong></article>
      <article class="kpi"><span>Ticket promedio</span><strong>${money(summary.avg_cents)}</strong></article>
      <article class="kpi"><span>Unidades</span><strong>${summary.units}</strong></article>
    </div>
    <section class="panel">
      <h2>${esc(report.label)}</h2>
      ${summary.tickets ? barsHtml(report.series) : '<p class="empty-copy">Sin ventas en este período.</p>'}
    </section>
    ${report.payments.length ? `<section class="panel"><h2>Cómo pagaron</h2>${report.payments.map((item) => `
      <div class="pay-line">
        <div style="flex:1">
          <strong>${methodLabel(item.payment_method)}</strong>
          <div class="meter"><span style="width:${Math.round((item.total_cents / maxPay) * 100)}%"></span></div>
        </div>
        <span class="muted">${item.tickets}</span>
        <strong class="num">${money(item.total_cents)}</strong>
      </div>
    `).join('')}</section>` : ''}
    ${report.top.length ? `<section class="panel"><h2>Más vendidos</h2>${report.top.map((item) => `
      <div class="top-row">
        ${item.photo ? `<img class="thumb" src="${esc(item.photo)}" alt="">` : `<span class="thumb ph" style="--c:#c2410c">${esc(item.name.slice(0, 1).toUpperCase())}</span>`}
        <div style="flex:1"><strong>${esc(item.name)}</strong><small class="muted">${item.qty} u.</small></div>
        <strong class="num">${money(item.total_cents)}</strong>
      </div>
    `).join('')}</section>` : ''}
    <section class="panel">
      <h2>Ventas</h2>
      ${report.truncated ? '<p class="muted">Se listan las últimas 300. Los totales de arriba incluyen todas.</p>' : ''}
      ${report.sales.length ? report.sales.map((sale) => `
        <button type="button" class="sale-row" data-act="sale" data-id="${sale.id}">
          <span>${shortWhen(sale.created_at)}</span>
          <span>${methodLabel(sale.payment_method)}${sale.payment_method === 'efectivo' ? ` · vuelto ${money(sale.change_cents)}` : ''}</span>
          <strong class="num">${money(sale.total_cents)}</strong>
        </button>
        ${state.openSale === sale.id ? saleDetailHtml(sale.id) : ''}
      `).join('') : '<p class="empty-copy">No hubo ventas.</p>'}
    </section>
  `;
}

function saleDetailHtml(id) {
  const sale = state.saleCache[id];
  if (!sale) return '<div class="sale-detail">Cargando…</div>';
  return `
    <div class="sale-detail">
      ${sale.items.map((item) => `<div class="pay-line"><span>${item.qty} × ${esc(item.name)}</span><span class="num">${money(item.price_cents * item.qty)}</span></div>`).join('')}
      <p class="muted">Ganancia ${money(sale.total_cents - sale.cost_cents)}</p>
    </div>
  `;
}

function pageCategorias() {
  return `
    <header class="page-head"><div><h1>Categorías</h1><p>Agrupá lo que entra al almacén.</p></div></header>
    <form id="category-form" class="inline-create">
      <input name="name" maxlength="40" placeholder="Nueva categoría" aria-label="Nueva categoría" required>
      <button class="btn" type="submit">Agregar</button>
    </form>
    <div class="stack">
      ${state.categories.length ? state.categories.map((cat) => `
        <form class="row-form" data-kind="category-rename" data-id="${cat.id}">
          <span class="dot" style="--c:${safeColor(cat.color)}"></span>
          <input name="name" maxlength="40" value="${esc(cat.name)}" aria-label="Nombre de la categoría">
          <span class="muted">${cat.products}</span>
          <button class="btn secondary small" type="submit">Guardar</button>
          <button class="btn danger small" type="button" data-act="del-category" data-id="${cat.id}">Eliminar</button>
        </form>
      `).join('') : '<p class="empty-copy">Todavía no hay categorías.</p>'}
    </div>
  `;
}

function pageProveedores() {
  return `
    <header class="page-head"><div><h1>Proveedores</h1><p>De quién comprás cada producto.</p></div></header>
    <form id="supplier-form" class="panel form-grid two">
      <label class="field"><span>Nombre</span><input name="name" maxlength="60" required></label>
      <label class="field"><span>Teléfono</span><input name="phone" maxlength="40"></label>
      <label class="field span-2"><span>Notas</span><input name="notes" maxlength="200"></label>
      <button class="btn" type="submit">Agregar proveedor</button>
    </form>
    <div class="stack">
      ${state.suppliers.map((supplier) => `
        <form class="row-form" data-kind="supplier-rename" data-id="${supplier.id}">
          <input name="name" maxlength="60" value="${esc(supplier.name)}" aria-label="Nombre" required>
          <input name="phone" maxlength="40" value="${esc(supplier.phone)}" aria-label="Teléfono" placeholder="Teléfono">
          <input name="notes" maxlength="200" value="${esc(supplier.notes)}" aria-label="Notas" placeholder="Notas">
          <span class="muted">${supplier.products}</span>
          <button class="btn secondary small" type="submit">Guardar</button>
          <button class="btn danger small" type="button" data-act="del-supplier" data-id="${supplier.id}">Eliminar</button>
        </form>
      `).join('') || '<p class="empty-copy">Todavía no hay proveedores.</p>'}
    </div>
  `;
}

function pageCelular() {
  if (state.networkLoading && !state.network) {
    return '<p class="empty-copy">Buscando la dirección…</p>';
  }
  const entries = state.network?.entries || [];
  const cloudMode = state.network?.mode === 'cloud';
  return `
    <header class="page-head">
      <div>
        <h1>${cloudMode ? 'Abrirlo en otro lado' : 'Usarlo desde el celular'}</h1>
        <p>${cloudMode
          ? 'La otra computadora y el celular entran al mismo stock con esta dirección y la misma clave.'
          : 'Los datos quedan en esta PC. El teléfono entra a lo mismo y la pantalla se acomoda.'}</p>
      </div>
      <button type="button" class="btn secondary" data-act="reload-net">Actualizar</button>
    </header>
    <ol class="steps">
      ${cloudMode ? `
        <li>Abrí el enlace en la otra computadora o en el celular.</li>
        <li>Entrá con la misma clave.</li>
        <li>El stock, las fotos y las ventas son los mismos en todos lados.</li>
        <li>La cámara del celular funciona porque el enlace es seguro. El lector USB se usa en la computadora.</li>
      ` : `
        <li>Dejá abierta la ventana de Menchy en la computadora.</li>
        <li>Conectá el celular al mismo Wi-Fi.</li>
        <li>Escaneá el QR o abrí la dirección.</li>
        <li>La primera vez puede avisar que el sitio no es público. Es esta PC, no internet. Entrá igual si querés usar la cámara. Con un lector Bluetooth alcanza la dirección http.</li>
      `}
    </ol>
    ${entries.length ? entries.map((entry) => `
      <article class="net-card">
        ${entry.qr && entry.qr.startsWith('data:image/') ? `<img class="qr" alt="QR para abrir Menchy" src="${entry.qr}">` : ''}
        <div>
          <h2>${esc(entry.address)}</h2>
          <p><a href="${esc(entry.open)}">${esc(entry.open)}</a></p>
          ${entry.https && entry.http && entry.https !== entry.http ? `<p class="muted">Sin cámara: ${esc(entry.http)}</p>` : ''}
        </div>
      </article>
    `).join('') : '<div class="banner">No encontré una red. Conectá esta PC al Wi-Fi y tocá Actualizar.</div>'}
    <p class="muted">${cloudMode
      ? 'Guardá el enlace. Sirve en el local, en otra computadora y desde tu casa.'
      : `Si el celular no entra, hacé clic derecho en <strong>permitir-celular.bat</strong> y elegí ejecutar como administrador. Equipo: ${esc(state.network?.hostname || '')}.`}</p>
  `;
}

function pageMas() {
  return `
    <header class="page-head"><div><h1>Más</h1><p>Categorías, proveedores y el celular.</p></div></header>
    <div class="more-grid">
      ${MORE.map((item) => `<button type="button" class="more-card" data-act="nav" data-page="${item.page}">${icon(item.icon)}<span>${item.label}</span></button>`).join('')}
    </div>
  `;
}

function go(page) {
  state.page = page;
  state.editor = null;
  state.checkout = false;
  if (page !== 'venta') closeCamera();
  window.scrollTo(0, 0);
  if (page === 'celular') {
    loadNetwork();
    return;
  }
  if (page === 'informes') {
    state.report = null;
    loadReport();
    return;
  }
  render();
}

async function loadNetwork() {
  state.networkLoading = true;
  render();
  try {
    state.network = await api('/api/network');
  } catch (error) {
    toast(error.message, true);
  } finally {
    state.networkLoading = false;
    if (state.page === 'celular') render();
  }
}

let reportToken = 0;
async function loadReport() {
  const token = ++reportToken;
  const tab = state.reportTab;
  state.reportLoading = true;
  if (!state.report && state.page === 'informes') render();
  try {
    const data = tab === 'stock'
      ? await api('/api/reports/stock')
      : await api(`/api/reports/sales?period=${encodeURIComponent(tab)}&date=${encodeURIComponent(state.reportDate)}`);
    if (token !== reportToken) return;
    state.report = data;
    state.openSale = null;
  } catch (error) {
    if (token !== reportToken) return;
    toast(error.message, true);
  } finally {
    if (token === reportToken) {
      state.reportLoading = false;
      if (state.page === 'informes') render();
    }
  }
}

function remember(product) {
  const fresh = state.products.find((item) => item.id === product.id) || product;
  const qty = state.cart.find((line) => line.product.id === fresh.id)?.qty || 0;
  state.last = { product: fresh, qty };
}

function addProduct(product) {
  const fresh = state.products.find((item) => item.id === product.id) || product;
  const line = state.cart.find((item) => item.product.id === fresh.id);
  const next = (line ? line.qty : 0) + 1;
  if (next > fresh.stock) {
    beep(false);
    const message = fresh.stock <= 0
      ? `${fresh.name} no tiene stock`
      : `Stock insuficiente de ${fresh.name}. Hay ${fresh.stock}.`;
    toast(message, true);
    setCamStatus(message);
    state.query = '';
    render({ focus: desktopScanFocus() });
    return;
  }
  if (line) line.qty = next;
  else state.cart.push({ product: fresh, qty: 1 });
  state.last = { product: fresh, qty: next };
  state.justScanned = true;
  state.query = '';
  beep(true);
  setCamStatus(`${fresh.name} × ${next}`);
  render({ focus: desktopScanFocus() });
  state.justScanned = false;
}

function changeQty(id, delta) {
  const line = state.cart.find((item) => item.product.id === id);
  if (!line) return;
  const next = line.qty + delta;
  if (next <= 0) {
    state.cart = state.cart.filter((item) => item.product.id !== id);
    remember(line.product);
    render({ focus: desktopScanFocus() });
    return;
  }
  if (next > line.product.stock) {
    beep(false);
    toast(`Hay ${line.product.stock} de ${line.product.name}`, true);
    return;
  }
  line.qty = next;
  state.justScanned = delta > 0;
  remember(line.product);
  render({ focus: desktopScanFocus() });
  state.justScanned = false;
}

async function onScanSubmit(raw) {
  const code = String(raw || '').trim();
  if (state.checkout || state.receipt || state.editor) {
    state.query = '';
    const scan = document.getElementById('scan');
    if (scan) scan.value = '';
    return;
  }
  if (!code) return;
  let product = state.products.find((item) => item.barcode && item.barcode === code);
  if (!product) {
    try {
      product = await api(`/api/products/lookup?code=${encodeURIComponent(code)}`);
      upsertProduct(product);
    } catch (error) {
      if (error.status !== 404) {
        toast(error.message, true);
        return;
      }
    }
  }
  if (product) {
    addProduct(product);
    return;
  }
  if (/^\d{4,}$/.test(code)) {
    beep(false);
    toast(`No encontré el código ${code}`, true);
    setCamStatus('No encontré ese código');
    state.query = '';
    render({ focus: desktopScanFocus() });
    return;
  }
  state.query = code;
  const found = suggestionItems();
  if (found.length === 1) {
    addProduct(found[0]);
    return;
  }
  beep(false);
  toast(found.length ? 'Hay varios. Elegí uno.' : 'No encontré ese producto', true);
  setCamStatus(found.length ? 'Elegí el producto' : 'No encontré ese producto');
  render({ focus: state.camera ? undefined : desktopScanFocus() });
}

async function confirmSale() {
  if (!canConfirm() || state.saving) return;
  state.saving = true;
  render();
  try {
    const paid = state.payMethod === 'efectivo' ? parseMoneyInput(state.paidRaw) : cartTotal();
    const sale = await api('/api/sales', {
      method: 'POST',
      body: {
        items: state.cart.map((line) => ({ product_id: line.product.id, qty: line.qty })),
        payment_method: state.payMethod,
        paid_cents: paid,
        expected_total_cents: cartTotal(),
      },
    });
    state.cart = [];
    state.last = null;
    state.checkout = false;
    state.receipt = sale;
    state.paidRaw = '';
    try { await pull(); } catch { /* la venta ya quedó registrada */ }
  } catch (error) {
    if (error.status === 409 || error.status === 400) {
      try { await pull(); } catch { /* se muestra el error de la venta */ }
    }
    toast(error.message, true);
  } finally {
    state.saving = false;
    render();
  }
}

async function fileToJpeg(file) {
  const bitmap = await createImageBitmap(file);
  const max = 900;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  if (!blob) throw new Error('foto');
  return new File([blob], 'foto.jpg', { type: 'image/jpeg' });
}

async function saveProduct(form) {
  const name = form.name.value.trim();
  if (!name) return toast('Poné el nombre', true);
  if (!form.category_id.value) return toast('Elegí una categoría', true);
  if (!form.price.value.trim()) return toast('Poné el precio de venta', true);
  let photo = null;
  if (form.photo.files[0]) {
    try {
      photo = await fileToJpeg(form.photo.files[0]);
    } catch {
      return toast('No pude leer esa foto. Usá JPG o PNG.', true);
    }
  }
  const data = new FormData();
  data.set('name', name);
  data.set('barcode', form.barcode.value.trim());
  data.set('category_id', form.category_id.value);
  data.set('supplier_id', form.supplier_id.value);
  data.set('cost', form.cost.value.trim() || '0');
  data.set('price', form.price.value.trim());
  data.set('stock', form.stock.value.trim() || '0');
  data.set('min_stock', form.min_stock.value.trim() || '0');
  if (photo) data.set('photo', photo);
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  button.textContent = 'Guardando…';
  try {
    const id = state.editor?.id;
    const saved = await api(id ? `/api/products/${id}` : '/api/products', {
      method: id ? 'PUT' : 'POST',
      body: data,
    });
    upsertProduct(saved);
    state.editor = null;
    try { await pull(); } catch { /* el producto ya quedó guardado */ }
    render();
    toast('Producto guardado');
  } catch (error) {
    button.disabled = false;
    button.textContent = 'Guardar';
    toast(error.message, true);
  }
}

async function deleteProduct(id) {
  const product = state.products.find((item) => item.id === id);
  if (!product) return;
  if (!confirm(`¿Dar de baja "${product.name}"?`)) return;
  await api(`/api/products/${id}`, { method: 'DELETE' });
  state.products = state.products.filter((item) => item.id !== id);
  state.cart = state.cart.filter((line) => line.product.id !== id);
  if (state.last?.product.id === id) state.last = null;
  state.editor = null;
  try { await pull(); } catch { /* la baja ya se aplicó */ }
  render();
  toast('Producto dado de baja');
}

async function saveCategory(form) {
  const name = form.name.value.trim();
  if (!name) return toast('Poné el nombre', true);
  const saved = await api('/api/categories', { method: 'POST', body: { name } });
  state.categories.push(saved);
  state.categories.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  render();
  toast('Categoría agregada');
}

async function renameCategory(form) {
  const id = Number(form.dataset.id);
  const saved = await api(`/api/categories/${id}`, { method: 'PUT', body: { name: form.name.value.trim() } });
  const index = state.categories.findIndex((item) => item.id === id);
  if (index >= 0) state.categories[index] = saved;
  state.categories.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  render();
  toast('Categoría actualizada');
}

async function saveSupplier(form) {
  const saved = await api('/api/suppliers', {
    method: 'POST',
    body: { name: form.name.value.trim(), phone: form.phone.value, notes: form.notes.value },
  });
  state.suppliers.push(saved);
  state.suppliers.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  render();
  toast('Proveedor agregado');
}

async function renameSupplier(form) {
  const id = Number(form.dataset.id);
  const saved = await api(`/api/suppliers/${id}`, {
    method: 'PUT',
    body: { name: form.name.value.trim(), phone: form.phone.value, notes: form.notes.value },
  });
  const index = state.suppliers.findIndex((item) => item.id === id);
  if (index >= 0) state.suppliers[index] = saved;
  state.suppliers.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  render();
  toast('Proveedor actualizado');
}

async function quickCategory() {
  const name = prompt('Nombre de la categoría');
  if (!name || !name.trim()) return;
  const saved = await api('/api/categories', { method: 'POST', body: { name: name.trim() } });
  state.categories.push(saved);
  state.categories.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  document.getElementById('category_id')?.add(new Option(saved.name, String(saved.id), true, true));
  toast('Categoría creada');
}

async function quickSupplier() {
  const name = prompt('Nombre del proveedor');
  if (!name || !name.trim()) return;
  const saved = await api('/api/suppliers', { method: 'POST', body: { name: name.trim(), phone: '', notes: '' } });
  state.suppliers.push(saved);
  state.suppliers.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  document.getElementById('supplier_id')?.add(new Option(saved.name, String(saved.id), true, true));
  toast('Proveedor creado');
}

function shiftReport(dir) {
  if (state.reportTab === 'month') {
    const [year, month] = state.reportDate.split('-').map(Number);
    state.reportDate = ymd(new Date(year, month - 1 + dir, 1));
  } else if (state.reportTab === 'week') {
    state.reportDate = ymd(addDays(parseYmd(state.reportDate), 7 * dir));
  } else {
    state.reportDate = ymd(addDays(parseYmd(state.reportDate), dir));
  }
  state.report = null;
  loadReport();
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvMoney(cents) {
  return (Number(cents) / 100).toFixed(2).replace('.', ',');
}

function download(filename, text) {
  const blob = new Blob([`\uFEFF${text}`], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1500);
}

function exportCsv() {
  if (state.report?.kind === 'stock') {
    const lines = [[
      'Producto', 'Código', 'Categoría', 'Proveedor', 'Stock', 'Mínimo', 'Costo', 'Venta', 'Valor costo', 'Valor venta', 'Estado',
    ]];
    for (const item of filteredStock()) {
      lines.push([
        item.name, item.barcode, item.category_name, item.supplier_name, item.stock, item.min_stock,
        csvMoney(item.cost_cents), csvMoney(item.price_cents), csvMoney(item.cost_value_cents),
        csvMoney(item.sale_value_cents), statusLabel(item.status),
      ]);
    }
    download('menchy-stock.csv', lines.map((line) => line.map(csvCell).join(';')).join('\n'));
    return;
  }
  if (state.report?.kind === 'sales') {
    const lines = [['Fecha', 'Medio', 'Total', 'Pagó', 'Vuelto', 'Costo', 'Ganancia']];
    for (const sale of state.report.sales) {
      lines.push([
        sale.created_at, methodLabel(sale.payment_method), csvMoney(sale.total_cents),
        csvMoney(sale.paid_cents), csvMoney(sale.change_cents), csvMoney(sale.cost_cents),
        csvMoney(sale.total_cents - sale.cost_cents),
      ]);
    }
    download(`menchy-${state.reportTab}.csv`, lines.map((line) => line.map(csvCell).join(';')).join('\n'));
  }
}

let lastCam = { code: '', at: 0 };
function onCameraCode(text) {
  const code = String(text || '').trim();
  if (!code) return;
  const now = Date.now();
  if (code === lastCam.code && now - lastCam.at < 900) return;
  lastCam = { code, at: now };
  onScanSubmit(code);
}

async function openCamera() {
  if (!window.isSecureContext) {
    toast('Para la cámara abrí la dirección https del QR. En la PC, el lector USB funciona directo.', true);
    return;
  }
  if (typeof Html5Qrcode === 'undefined') {
    toast('No se cargó el lector de la cámara', true);
    return;
  }
  state.camera = true;
  const layer = document.getElementById('camera');
  layer.classList.remove('hidden');
  layer.innerHTML = `
    <div id="reader"></div>
    <div class="camera-bar">
      <p id="cam-status">Apuntá al código. Cada lectura suma una unidad.</p>
      <button type="button" class="btn" data-act="camera-close">Cerrar</button>
    </div>`;
  const scanner = new Html5Qrcode('reader', { verbose: false });
  state.scanner = scanner;
  const config = { fps: 10, qrbox: { width: 280, height: 150 } };
  try {
    await scanner.start({ facingMode: 'environment' }, config, onCameraCode, () => {});
  } catch {
    try {
      await scanner.start({ facingMode: 'user' }, config, onCameraCode, () => {});
    } catch {
      toast('No pude abrir la cámara. Revisá el permiso del navegador.', true);
      closeCamera();
    }
  }
}

async function closeCamera() {
  state.camera = false;
  const layer = document.getElementById('camera');
  const scanner = state.scanner;
  state.scanner = null;
  try { if (scanner) await scanner.stop(); } catch { /* puede no haber llegado a encenderse */ }
  try { scanner?.clear(); } catch { /* sin vista */ }
  if (layer) {
    layer.classList.add('hidden');
    layer.innerHTML = '';
  }
}

async function toggleSale(id) {
  if (state.openSale === id) {
    state.openSale = null;
    render();
    return;
  }
  state.openSale = id;
  render();
  if (state.saleCache[id]) return;
  try {
    state.saleCache[id] = await api(`/api/sales/${id}`);
    if (state.openSale === id) render();
  } catch (error) {
    toast(error.message, true);
  }
}

function onClick(event) {
  if (event.target.classList?.contains('sheet') && state.checkout && !state.receipt) {
    state.checkout = false;
    render({ focus: desktopScanFocus() });
    return;
  }
  const button = event.target.closest('[data-act]');
  if (!button) return;
  const act = button.dataset.act;
  const id = Number(button.dataset.id);
  if (act === 'logout') {
    api('/api/logout', { method: 'POST' }).finally(() => {
      state.cart = [];
      state.receipt = null;
      state.checkout = false;
      state.auth = true;
      renderLogin();
    });
  } else if (act === 'nav') go(button.dataset.page);
  else if (act === 'camera-open') openCamera();
  else if (act === 'camera-close') closeCamera();
  else if (act === 'pick') {
    const product = state.products.find((item) => item.id === id);
    if (product) addProduct(product);
  } else if (act === 'inc') changeQty(id, 1);
  else if (act === 'dec') changeQty(id, -1);
  else if (act === 'remove') {
    const line = state.cart.find((item) => item.product.id === id);
    state.cart = state.cart.filter((item) => item.product.id !== id);
    if (line) remember(line.product);
    render({ focus: desktopScanFocus() });
  } else if (act === 'checkout-open') {
    if (!state.cart.length) return;
    if (overStock()) return toast('Hay productos con más unidades que el stock', true);
    state.checkout = true;
    state.payMethod = 'efectivo';
    state.paidRaw = '';
    render({ focus: 'paid' });
  } else if (act === 'checkout-close') {
    state.checkout = false;
    render({ focus: desktopScanFocus() });
  } else if (act === 'pay') {
    state.payMethod = button.dataset.method;
    render(state.payMethod === 'efectivo' ? { focus: 'paid' } : {});
  } else if (act === 'bill') {
    state.paidRaw = centsToInput(Number(button.dataset.cents));
    render({ focus: 'paid' });
  } else if (act === 'confirm-sale') confirmSale();
  else if (act === 'new-sale') {
    state.receipt = null;
    state.query = '';
    render({ focus: desktopScanFocus() });
  } else if (act === 'product-new') {
    state.page = 'productos';
    state.editor = { id: null };
    render();
  } else if (act === 'product-edit') {
    state.page = 'productos';
    state.editor = { id };
    render();
  } else if (act === 'product-cancel') {
    state.editor = null;
    render();
  } else if (act === 'product-delete') deleteProduct(id).catch((error) => toast(error.message, true));
  else if (act === 'barcode-gen') {
    const input = document.getElementById('barcode');
    if (!input) return;
    input.value = `M${Date.now().toString().slice(-11)}`;
    input.focus();
  } else if (act === 'quick-category') quickCategory().catch((error) => toast(error.message, true));
  else if (act === 'quick-supplier') quickSupplier().catch((error) => toast(error.message, true));
  else if (act === 'del-category') {
    if (!confirm('¿Eliminar esta categoría?')) return;
    api(`/api/categories/${id}`, { method: 'DELETE' })
      .then(() => {
        state.categories = state.categories.filter((item) => item.id !== id);
        render();
        toast('Categoría eliminada');
      })
      .catch((error) => toast(error.message, true));
  } else if (act === 'del-supplier') {
    if (!confirm('¿Eliminar este proveedor?')) return;
    api(`/api/suppliers/${id}`, { method: 'DELETE' })
      .then(() => {
        state.suppliers = state.suppliers.filter((item) => item.id !== id);
        render();
        toast('Proveedor eliminado');
      })
      .catch((error) => toast(error.message, true));
  } else if (act === 'report-tab') {
    if (button.dataset.tab === state.reportTab) return;
    state.reportTab = button.dataset.tab;
    state.report = null;
    state.openSale = null;
    loadReport();
  } else if (act === 'report-prev') shiftReport(-1);
  else if (act === 'report-next') shiftReport(1);
  else if (act === 'print') window.print();
  else if (act === 'csv') exportCsv();
  else if (act === 'sale') toggleSale(id);
  else if (act === 'reload-net') loadNetwork();
}

async function onSubmit(event) {
  event.preventDefault();
  const form = event.target;
  try {
    if (form.id === 'login-form') return submitLogin(form);
    if (form.id === 'scan-form') return onScanSubmit(document.getElementById('scan')?.value ?? state.query);
    if (form.id === 'product-form') return saveProduct(form);
    if (form.id === 'category-form') return saveCategory(form);
    if (form.id === 'supplier-form') return saveSupplier(form);
    if (form.dataset.kind === 'category-rename') return renameCategory(form);
    if (form.dataset.kind === 'supplier-rename') return renameSupplier(form);
  } catch (error) {
    toast(error.message, true);
  }
}

function onInput(event) {
  if (event.target.id === 'scan') {
    state.query = event.target.value;
    paintSuggest();
    return;
  }
  if (event.target.id === 'paid') {
    state.paidRaw = event.target.value;
    paintVuelto();
    return;
  }
  if (event.target.id === 'product-search') {
    state.productQuery = event.target.value;
    render();
    return;
  }
  if (event.target.id === 'stock-search') {
    state.stockQuery = event.target.value;
    render();
    return;
  }
  if (event.target.id === 'cost' || event.target.id === 'price') updateMarginHint();
}

function onChange(event) {
  if (event.target.id === 'photo') {
    const file = event.target.files?.[0];
    const img = document.getElementById('photo-preview');
    if (file && img) {
      img.src = URL.createObjectURL(file);
      img.classList.remove('empty');
    }
    return;
  }
  if (event.target.id === 'report-date') {
    if (!event.target.value) return;
    state.reportDate = state.reportTab === 'month' ? `${event.target.value}-01` : event.target.value;
    state.report = null;
    loadReport();
    return;
  }
  if (event.target.id === 'low-only') {
    state.lowOnly = event.target.checked;
    render();
    return;
  }
  if (event.target.id === 'stock-category') {
    state.stockCategory = event.target.value;
    render();
    return;
  }
  if (event.target.id === 'product-category') {
    state.productCategory = event.target.value;
    render();
  }
}

let keyBuffer = '';
let lastKeyAt = 0;
function onKey(event) {
  if (event.key === 'Escape') {
    if (state.camera) {
      closeCamera();
      return;
    }
    if (state.checkout && !state.receipt) {
      state.checkout = false;
      render({ focus: desktopScanFocus() });
    }
    return;
  }
  if (event.key === 'Enter' && event.target?.id === 'scan') {
    event.preventDefault();
    onScanSubmit(event.target.value);
    return;
  }
  if (event.key === 'Enter' && event.target?.id === 'paid') {
    event.preventDefault();
    if (canConfirm()) confirmSale();
    return;
  }
  const tag = document.activeElement?.tagName;
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  if (typing || state.camera || state.checkout || state.receipt || state.editor || state.page !== 'venta') {
    keyBuffer = '';
    return;
  }
  const now = Date.now();
  if (now - lastKeyAt > 100) keyBuffer = '';
  lastKeyAt = now;
  if (event.key === 'Enter') {
    if (keyBuffer.length >= 3) {
      event.preventDefault();
      const code = keyBuffer;
      keyBuffer = '';
      onScanSubmit(code);
    }
    return;
  }
  if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
    keyBuffer = (keyBuffer + event.key).slice(-64);
  }
}

function renderLogin() {
  state.camera = false;
  document.getElementById('camera')?.classList.add('hidden');
  document.getElementById('app').innerHTML = `
    <div class="login-wrap">
      <form id="login-form" class="login-card" autocomplete="on">
        <span class="mark">M</span>
        <h1>Menchy</h1>
        <p>Entrá con la clave para ver el stock y cargar mercadería.</p>
        <label class="field"><span>Clave</span><input name="password" type="password" required autofocus autocomplete="current-password"></label>
        <p id="login-error" class="login-error"></p>
        <button class="btn big" type="submit">Entrar</button>
      </form>
    </div>`;
}

async function submitLogin(form) {
  const button = form.querySelector('button');
  const errorEl = document.getElementById('login-error');
  if (button) button.disabled = true;
  if (errorEl) errorEl.textContent = '';
  try {
    await api('/api/login', { method: 'POST', body: { password: form.password.value } });
    state.auth = true;
    await pull();
    render();
  } catch (error) {
    if (errorEl) errorEl.textContent = error.message;
    if (button) button.disabled = false;
  }
}

async function boot() {
  document.getElementById('app').innerHTML = '<div class="boot"><span class="mark">M</span><p>Abriendo Menchy…</p></div>';
  try {
    if (window.menchyReady) {
      state.auth = true;
      if (!await window.menchyReady()) return renderLogin();
      await pull();
      render();
      return;
    }
    const health = await fetch('/api/health').then((response) => response.json());
    state.auth = Boolean(health.auth);
    await pull();
    render();
  } catch (error) {
    if (error.status === 401) return;
    document.getElementById('app').innerHTML = `
      <div class="boot-error">
        <span class="mark">M</span>
        <h1>Menchy</h1>
        <p>${esc(error.message)}</p>
        <button class="btn" type="button" onclick="location.reload()">Reintentar</button>
      </div>`;
  }
}

document.body.addEventListener('click', onClick);
document.body.addEventListener('submit', onSubmit);
document.body.addEventListener('input', onInput);
document.body.addEventListener('change', onChange);
document.body.addEventListener('keydown', onKey);
document.body.addEventListener('focusin', (event) => {
  if (event.target.id === 'scan') document.getElementById('scan-form')?.classList.add('ready');
});
document.body.addEventListener('focusout', (event) => {
  if (event.target.id === 'scan') document.getElementById('scan-form')?.classList.remove('ready');
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden || state.editor || state.checkout || state.receipt) return;
  pull().then(() => {
    if (!state.editor && !state.checkout && !state.receipt) render();
  }).catch(() => {});
});
setInterval(() => {
  if (document.hidden || state.editor || state.checkout || state.receipt || state.camera) return;
  if (state.page !== 'venta' && state.page !== 'productos') return;
  pull().then(() => {
    if (state.editor || state.checkout || state.receipt || state.camera) return;
    if (state.page === 'venta' || state.page === 'productos') render();
  }).catch(() => {});
}, 20000);

boot();
