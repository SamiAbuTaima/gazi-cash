(() => {
  'use strict';

  const MODAL_ID = 'gazi-stock-waste-modal';
  const WASTE_TYPE = 'stockWaste';
  const state = {
    products: [],
    purchases: [],
    sales: [],
    settings: { currency: '₪' },
    cart: new Map(),
    search: '',
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function localDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function formatDate(value) {
    if (!value) return '—';
    const parsed = new Date(`${value}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return escapeHtml(value);
    return parsed.toLocaleDateString('ar-EG', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  }

  function formatTime(value) {
    if (!value) return '—';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '—';
    return parsed.toLocaleTimeString('ar-EG', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function money(value) {
    return `${Number(value || 0).toLocaleString('ar-EG', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} ${escapeHtml(state.settings.currency || '₪')}`;
  }

  function bridge() {
    const api = window.GaziCashBridge;
    if (!api?.db || typeof api.add !== 'function' || typeof api.remove !== 'function') {
      throw new Error('أغلق التطبيق وافتحه مجددًا حتى يكتمل تحديث تالف المخزون.');
    }
    return api;
  }

  async function readData() {
    const api = bridge();
    const [products, purchases, sales, settings] = await Promise.all([
      api.db.products.toArray(),
      api.db.purchases.toArray(),
      api.db.sales.toArray(),
      api.db.settings.get('main'),
    ]);
    state.products = products || [];
    state.purchases = purchases || [];
    state.sales = sales || [];
    state.settings = settings || { currency: '₪' };
  }

  function stockFor(productId) {
    const product = state.products.find((entry) => entry.id === productId);
    if (!product) return 0;
    const purchased = state.purchases
      .filter((entry) => entry.productId === productId)
      .reduce((total, entry) => total + Number(entry.totalUnits || 0), 0);
    const sold = state.sales.reduce(
      (total, sale) =>
        total +
        (sale.items || [])
          .filter((item) => item.productId === productId)
          .reduce((itemTotal, item) => itemTotal + Number(item.qty || 0), 0),
      0,
    );
    return Number(product.initialStock || 0) + purchased - sold;
  }

  function selectedItems() {
    return Array.from(state.cart.entries())
      .map(([productId, qty]) => {
        const product = state.products.find((entry) => entry.id === productId);
        return product ? { product, qty: Number(qty || 0) } : null;
      })
      .filter(Boolean)
      .filter((entry) => entry.qty > 0);
  }

  function cartTotal() {
    return selectedItems().reduce(
      (total, entry) => total + entry.qty * Number(entry.product.unitCost || 0),
      0,
    );
  }

  function wasteRecords() {
    return state.purchases.filter((entry) => entry.purchaseType === WASTE_TYPE);
  }

  function groupedWaste() {
    const groups = new Map();
    wasteRecords().forEach((record) => {
      const key = record.wasteBatchId || `legacy-waste-${record.id}`;
      if (!groups.has(key)) {
        groups.set(key, {
          id: key,
          date: record.date,
          createdAt: record.createdAt,
          reason: record.wasteReason || record.notes || '',
          records: [],
        });
      }
      groups.get(key).records.push(record);
    });
    return Array.from(groups.values()).sort((left, right) => {
      const leftTime = new Date(left.createdAt || `${left.date}T00:00:00`).getTime();
      const rightTime = new Date(right.createdAt || `${right.date}T00:00:00`).getTime();
      return rightTime - leftTime;
    });
  }

  function productForRecord(record) {
    return state.products.find((product) => product.id === record.productId);
  }

  function recordQty(record) {
    return Number(record.wasteQty || Math.abs(Number(record.totalUnits || 0)));
  }

  function recordCost(record) {
    if (record.wasteCost !== undefined) return Number(record.wasteCost || 0);
    return recordQty(record) * Number(record.unitCost || 0);
  }

  function setStatus(message, kind = 'success') {
    const status = document.querySelector(`#${MODAL_ID} [data-waste-status]`);
    if (!status) return;
    status.textContent = message;
    status.className = `gazi-waste-status ${kind}`;
    status.hidden = false;
    window.setTimeout(() => {
      if (status.textContent === message) status.hidden = true;
    }, 4500);
  }

  function renderProducts() {
    const container = document.querySelector(`#${MODAL_ID} [data-waste-products]`);
    if (!container) return;
    const query = state.search.trim().toLowerCase();
    const products = state.products
      .filter((product) => product.active !== false)
      .filter((product) =>
        `${product.name || ''} ${product.code || ''} ${product.category || ''}`
          .toLowerCase()
          .includes(query),
      );

    if (!products.length) {
      container.innerHTML = '<div class="gazi-waste-empty">لا توجد أصناف مطابقة.</div>';
      return;
    }

    container.innerHTML = products
      .map((product) => {
        const stock = stockFor(product.id);
        const inCart = Number(state.cart.get(product.id) || 0);
        return `
          <button
            class="gazi-waste-product ${stock <= 0 ? 'disabled' : ''}"
            type="button"
            data-waste-product="${product.id}"
            ${stock <= 0 ? 'disabled' : ''}
          >
            <span>
              <b>${escapeHtml(product.name)}</b>
              <small>${escapeHtml(product.code || '')} • متاح ${stock.toLocaleString('ar-EG')}</small>
            </span>
            <span class="gazi-waste-product-cost">
              <small>تكلفة الوحدة</small>
              <b>${money(product.unitCost)}</b>
            </span>
            ${inCart > 0 ? `<em>${inCart.toLocaleString('ar-EG')}</em>` : ''}
          </button>
        `;
      })
      .join('');

    container.querySelectorAll('[data-waste-product]').forEach((button) => {
      button.addEventListener('click', () => {
        const productId = Number(button.getAttribute('data-waste-product'));
        const current = Number(state.cart.get(productId) || 0);
        if (current + 1 > stockFor(productId)) {
          setStatus('الكمية المطلوبة أكبر من المخزون المتاح.', 'error');
          return;
        }
        state.cart.set(productId, current + 1);
        renderProducts();
        renderCart();
      });
    });
  }

  function renderCart() {
    const modal = document.getElementById(MODAL_ID);
    const container = modal?.querySelector('[data-waste-cart]');
    const total = modal?.querySelector('[data-waste-total]');
    const saveButton = modal?.querySelector('[data-save-stock-waste]');
    if (!container || !total || !saveButton) return;
    const items = selectedItems();
    total.textContent = money(cartTotal());
    saveButton.disabled = !items.length;

    if (!items.length) {
      container.innerHTML =
        '<div class="gazi-waste-empty">اضغط على الصنف وحدد عدد العبوات التالفة.</div>';
      return;
    }

    container.innerHTML = items
      .map(({ product, qty }) => `
        <div class="gazi-waste-cart-line">
          <span>
            <b>${escapeHtml(product.name)}</b>
            <small>${money(product.unitCost)} للوحدة</small>
          </span>
          <div class="gazi-waste-qty">
            <button type="button" data-waste-minus="${product.id}">−</button>
            <input
              type="number"
              min="1"
              max="${stockFor(product.id)}"
              step="1"
              value="${qty}"
              data-waste-qty="${product.id}"
              aria-label="الكمية التالفة من ${escapeHtml(product.name)}"
            >
            <button type="button" data-waste-plus="${product.id}">+</button>
          </div>
          <b>${money(qty * Number(product.unitCost || 0))}</b>
          <button class="gazi-waste-remove" type="button" data-waste-remove="${product.id}" aria-label="حذف">×</button>
        </div>
      `)
      .join('');

    container.querySelectorAll('[data-waste-minus]').forEach((button) => {
      button.addEventListener('click', () =>
        changeQuantity(Number(button.getAttribute('data-waste-minus')), -1),
      );
    });
    container.querySelectorAll('[data-waste-plus]').forEach((button) => {
      button.addEventListener('click', () =>
        changeQuantity(Number(button.getAttribute('data-waste-plus')), 1),
      );
    });
    container.querySelectorAll('[data-waste-qty]').forEach((input) => {
      input.addEventListener('change', () => {
        const productId = Number(input.getAttribute('data-waste-qty'));
        const value = Math.floor(Number(input.value || 0));
        const available = stockFor(productId);
        if (value <= 0) state.cart.delete(productId);
        else if (value > available) {
          state.cart.set(productId, available);
          setStatus('تم ضبط الكمية على المخزون المتاح.', 'error');
        } else state.cart.set(productId, value);
        renderProducts();
        renderCart();
      });
    });
    container.querySelectorAll('[data-waste-remove]').forEach((button) => {
      button.addEventListener('click', () => {
        state.cart.delete(Number(button.getAttribute('data-waste-remove')));
        renderProducts();
        renderCart();
      });
    });
  }

  function changeQuantity(productId, delta) {
    const current = Number(state.cart.get(productId) || 0);
    const next = current + delta;
    if (next <= 0) state.cart.delete(productId);
    else if (next > stockFor(productId)) {
      setStatus('لا توجد هذه الكمية في المخزون.', 'error');
      return;
    } else state.cart.set(productId, next);
    renderProducts();
    renderCart();
  }

  function renderHistory() {
    const modal = document.getElementById(MODAL_ID);
    const container = modal?.querySelector('[data-waste-history]');
    const total = modal?.querySelector('[data-waste-history-total]');
    if (!container || !total) return;
    const groups = groupedWaste();
    total.textContent = money(
      groups.reduce(
        (sum, group) =>
          sum + group.records.reduce((subtotal, record) => subtotal + recordCost(record), 0),
        0,
      ),
    );

    if (!groups.length) {
      container.innerHTML = '<div class="gazi-waste-empty">لا توجد عبوات تالفة مسجلة.</div>';
      return;
    }

    container.innerHTML = groups
      .map((group) => {
        const cost = group.records.reduce((sum, record) => sum + recordCost(record), 0);
        const items = group.records
          .map((record) => {
            const product = productForRecord(record);
            return `
              <li>
                <span>${escapeHtml(record.productNameSnapshot || product?.name || 'صنف محذوف')}</span>
                <b>${recordQty(record).toLocaleString('ar-EG')} × ${money(record.unitCost)}</b>
              </li>
            `;
          })
          .join('');
        return `
          <article class="gazi-waste-history-card">
            <header>
              <span>
                <b>${formatDate(group.date)}</b>
                <small>${formatTime(group.createdAt)}</small>
              </span>
              <strong>${money(cost)}</strong>
            </header>
            <ul>${items}</ul>
            ${group.reason ? `<p>${escapeHtml(group.reason)}</p>` : ''}
            <button type="button" data-delete-stock-waste="${escapeHtml(group.id)}">
              حذف وإرجاع الكمية إلى المخزون
            </button>
          </article>
        `;
      })
      .join('');

    container.querySelectorAll('[data-delete-stock-waste]').forEach((button) => {
      button.addEventListener('click', () =>
        deleteWaste(button.getAttribute('data-delete-stock-waste')),
      );
    });
  }

  async function saveWaste() {
    const modal = document.getElementById(MODAL_ID);
    const date = modal?.querySelector('[data-waste-date]')?.value || localDateKey();
    const reason = modal?.querySelector('[data-waste-reason]')?.value.trim() || '';
    const saveButton = modal?.querySelector('[data-save-stock-waste]');
    const items = selectedItems();
    if (!items.length || !saveButton) return;

    for (const item of items) {
      if (item.qty > stockFor(item.product.id)) {
        setStatus(`مخزون ${item.product.name} لم يعد كافيًا.`, 'error');
        return;
      }
    }

    if (
      !window.confirm(
        `تأكيد إتلاف العبوات المحددة بتكلفة ${money(cartTotal())}؟\nستنقص الكمية ورأس المال بالتكلفة، ولن تُحسب كمبيعات أو أرباح.`,
      )
    ) {
      return;
    }

    saveButton.disabled = true;
    saveButton.textContent = 'جارٍ الحفظ…';
    const api = bridge();
    const wasteBatchId = `SW-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const createdAt = new Date().toISOString();
    try {
      for (const { product, qty } of items) {
        const unitCost = Number(product.unitCost || 0);
        await api.add('purchases', {
          date,
          productId: product.id,
          packs: 0,
          unitsPerPack: 1,
          totalUnits: -qty,
          packPrice: 0,
          unitCost,
          totalCost: 0,
          notes: '',
          createdAt,
          purchaseType: WASTE_TYPE,
          wasteBatchId,
          wasteQty: qty,
          wasteCost: qty * unitCost,
          wasteReason: reason,
          productNameSnapshot: product.name || '',
          productCodeSnapshot: product.code || '',
        });
      }
      state.cart.clear();
      await readData();
      const reasonInput = modal.querySelector('[data-waste-reason]');
      if (reasonInput) reasonInput.value = '';
      renderProducts();
      renderCart();
      renderHistory();
      setStatus('تم خصم العبوات التالفة وتكلفتها من المخزون ورأس المال.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'تعذر حفظ تالف المخزون.', 'error');
    } finally {
      saveButton.textContent = 'حفظ التالف';
      saveButton.disabled = !selectedItems().length;
    }
  }

  async function deleteWaste(wasteBatchId) {
    const group = groupedWaste().find((entry) => entry.id === wasteBatchId);
    if (!group) return;
    if (!window.confirm('حذف سجل التالف؟ ستعود الكميات إلى المخزون تلقائيًا.')) return;
    try {
      const api = bridge();
      for (const record of group.records) await api.remove('purchases', record.id);
      await readData();
      renderProducts();
      renderCart();
      renderHistory();
      setStatus('تم حذف سجل التالف وإرجاع الكميات إلى المخزون.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'تعذر حذف سجل التالف.', 'error');
    }
  }

  function closeModal() {
    document.getElementById(MODAL_ID)?.remove();
    document.body.classList.remove('gazi-waste-modal-open');
    state.cart.clear();
    state.search = '';
  }

  async function openModal() {
    if (document.getElementById(MODAL_ID)) return;
    try {
      await readData();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'تعذر فتح تالف المخزون.');
      return;
    }

    const overlay = document.createElement('div');
    overlay.id = MODAL_ID;
    overlay.className = 'gazi-waste-overlay';
    overlay.dir = 'rtl';
    overlay.innerHTML = `
      <section class="gazi-waste-modal" role="dialog" aria-modal="true" aria-labelledby="gazi-waste-title">
        <header class="gazi-waste-head">
          <div>
            <h2 id="gazi-waste-title">تالف المخزون</h2>
            <p>للعبوات المنفجرة أو التالفة: تنقص الكمية ورأس المال بالتكلفة فقط.</p>
          </div>
          <button type="button" data-close-stock-waste aria-label="إغلاق">×</button>
        </header>
        <div class="gazi-waste-body">
          <div class="gazi-waste-status" data-waste-status hidden></div>
          <section class="gazi-waste-entry">
            <div class="gazi-waste-fields">
              <label>
                <span>تاريخ التلف</span>
                <input type="date" value="${localDateKey()}" data-waste-date>
              </label>
              <label>
                <span>بحث عن صنف</span>
                <input type="search" placeholder="اسم الصنف أو الكود" data-waste-search>
              </label>
            </div>
            <div class="gazi-waste-workspace">
              <div>
                <h3>الأصناف المتاحة</h3>
                <div class="gazi-waste-products" data-waste-products></div>
              </div>
              <div class="gazi-waste-cart-panel">
                <h3>العبوات التالفة</h3>
                <div class="gazi-waste-cart" data-waste-cart></div>
                <label class="gazi-waste-reason">
                  <span>سبب التلف</span>
                  <textarea data-waste-reason placeholder="مثال: انفجرت العبوة — اختياري"></textarea>
                </label>
                <div class="gazi-waste-total">
                  <span>الخصم من رأس المال بالتكلفة</span>
                  <strong data-waste-total>${money(0)}</strong>
                </div>
                <button type="button" data-save-stock-waste disabled>حفظ التالف</button>
              </div>
            </div>
          </section>
          <section class="gazi-waste-history">
            <div class="gazi-waste-history-title">
              <span>
                <h3>سجل التالف</h3>
                <p>الأصناف والكميات التي خُصمت سابقًا</p>
              </span>
              <span>
                <small>إجمالي التكلفة المخصومة</small>
                <strong data-waste-history-total>${money(0)}</strong>
              </span>
            </div>
            <div class="gazi-waste-history-list" data-waste-history></div>
          </section>
        </div>
      </section>
    `;
    document.body.appendChild(overlay);
    document.body.classList.add('gazi-waste-modal-open');
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) closeModal();
    });
    overlay.querySelector('[data-close-stock-waste]').addEventListener('click', closeModal);
    overlay.querySelector('[data-waste-search]').addEventListener('input', (event) => {
      state.search = event.target.value;
      renderProducts();
    });
    overlay.querySelector('[data-save-stock-waste]').addEventListener('click', saveWaste);
    renderProducts();
    renderCart();
    renderHistory();
  }

  function installButton() {
    const heading = Array.from(document.querySelectorAll('.page-header h1')).find(
      (element) => element.textContent.trim() === 'المخزون',
    );
    const header = heading?.closest('.page-header');
    if (!header || header.querySelector('[data-open-stock-waste]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary-button gazi-waste-open';
    button.setAttribute('data-open-stock-waste', 'true');
    button.innerHTML = '<span aria-hidden="true">⚠</span> تسجيل تالف';
    button.addEventListener('click', openModal);
    header.appendChild(button);
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.getElementById(MODAL_ID)) closeModal();
  });

  const observer = new MutationObserver(installButton);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installButton, { once: true });
  } else {
    installButton();
  }

  window.GaziStockWaste = {
    stockFor,
    refresh: async () => {
      await readData();
      return {
        products: state.products,
        records: wasteRecords(),
      };
    },
  };
})();
