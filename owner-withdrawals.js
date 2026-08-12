(() => {
  'use strict';

  const MODAL_ID = 'gazi-owner-withdrawal-modal';
  const OWNER_TYPE = 'ownerWithdrawal';
  const PARTNER_PROFIT_TYPE = 'partnerProfitDistribution';
  const state = {
    products: [],
    purchases: [],
    sales: [],
    expenses: [],
    settings: { currency: '₪', ownerName: '' },
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
      throw new Error('أغلق التطبيق وافتحه مجددًا حتى يكتمل تحديث ميزة سحب المالك.');
    }
    return api;
  }

  async function readData() {
    const api = bridge();
    const [products, purchases, sales, expenses, settings] = await Promise.all([
      api.db.products.toArray(),
      api.db.purchases.toArray(),
      api.db.sales.toArray(),
      api.db.expenses.toArray(),
      api.db.settings.get('main'),
    ]);
    state.products = products || [];
    state.purchases = purchases || [];
    state.sales = sales || [];
    state.expenses = expenses || [];
    state.settings = settings || { currency: '₪', ownerName: '' };
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

  function ownerRecords() {
    return state.purchases.filter((entry) => entry.purchaseType === OWNER_TYPE);
  }

  function cashRecords() {
    return state.expenses
      .filter((entry) => entry.expenseType === 'ownerCashWithdrawal')
      .sort((left, right) => {
        const leftTime = new Date(left.createdAt || `${left.date}T00:00:00`).getTime();
        const rightTime = new Date(right.createdAt || `${right.date}T00:00:00`).getTime();
        return rightTime - leftTime;
      });
  }

  function profitDistributionRecords() {
    return state.expenses
      .filter(
        (entry) =>
          entry.expenseType === PARTNER_PROFIT_TYPE ||
          entry.type === 'توزيع أرباح الشركاء',
      )
      .sort((left, right) => {
        const leftTime = new Date(left.createdAt || `${left.date}T00:00:00`).getTime();
        const rightTime = new Date(right.createdAt || `${right.date}T00:00:00`).getTime();
        return rightTime - leftTime;
      });
  }

  function groupedWithdrawals() {
    const groups = new Map();
    ownerRecords().forEach((record) => {
      const key = record.ownerWithdrawalId || `legacy-${record.id}`;
      if (!groups.has(key)) {
        groups.set(key, {
          id: key,
          date: record.date,
          createdAt: record.createdAt,
          notes: record.withdrawalNotes || record.notes || '',
          ownerName: record.ownerName || state.settings.ownerName || 'المالك',
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
    return Number(record.withdrawalQty || Math.abs(Number(record.totalUnits || 0)));
  }

  function recordCost(record) {
    if (record.withdrawalCost !== undefined) return Number(record.withdrawalCost || 0);
    return recordQty(record) * Number(record.unitCost || 0);
  }

  function setStatus(message, kind = 'success') {
    const modal = document.getElementById(MODAL_ID);
    const status = modal?.querySelector('[data-owner-status]');
    if (!status) return;
    status.textContent = message;
    status.className = `gazi-owner-status ${kind}`;
    status.hidden = false;
    window.setTimeout(() => {
      if (status.textContent === message) status.hidden = true;
    }, 4500);
  }

  function renderProducts() {
    const modal = document.getElementById(MODAL_ID);
    const container = modal?.querySelector('[data-owner-products]');
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
      container.innerHTML = '<div class="gazi-owner-empty">لا توجد أصناف مطابقة.</div>';
      return;
    }

    container.innerHTML = products
      .map((product) => {
        const stock = stockFor(product.id);
        const inCart = Number(state.cart.get(product.id) || 0);
        return `
          <button
            class="gazi-owner-product ${stock <= 0 ? 'disabled' : ''}"
            type="button"
            data-owner-product="${product.id}"
            ${stock <= 0 ? 'disabled' : ''}
          >
            <span>
              <b>${escapeHtml(product.name)}</b>
              <small>${escapeHtml(product.code || '')} • متاح ${stock.toLocaleString('ar-EG')}</small>
            </span>
            <span class="gazi-owner-product-cost">
              <small>التكلفة</small>
              <b>${money(product.unitCost)}</b>
            </span>
            ${inCart > 0 ? `<em>${inCart.toLocaleString('ar-EG')}</em>` : ''}
          </button>
        `;
      })
      .join('');

    container.querySelectorAll('[data-owner-product]').forEach((button) => {
      button.addEventListener('click', () => {
        const productId = Number(button.getAttribute('data-owner-product'));
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
    const container = modal?.querySelector('[data-owner-cart]');
    const total = modal?.querySelector('[data-owner-total]');
    const saveButton = modal?.querySelector('[data-save-owner-withdrawal]');
    if (!container || !total || !saveButton) return;
    const items = selectedItems();
    total.textContent = money(cartTotal());
    saveButton.disabled = !items.length;

    if (!items.length) {
      container.innerHTML = `
        <div class="gazi-owner-empty">
          اضغط على الصنف لإضافته إلى سحب المالك.
        </div>
      `;
      return;
    }

    container.innerHTML = items
      .map(({ product, qty }) => `
        <div class="gazi-owner-cart-line">
          <span>
            <b>${escapeHtml(product.name)}</b>
            <small>${money(product.unitCost)} للوحدة</small>
          </span>
          <div class="gazi-owner-qty">
            <button type="button" data-owner-minus="${product.id}">−</button>
            <input
              type="number"
              min="1"
              max="${stockFor(product.id)}"
              step="1"
              value="${qty}"
              data-owner-qty="${product.id}"
              aria-label="كمية ${escapeHtml(product.name)}"
            >
            <button type="button" data-owner-plus="${product.id}">+</button>
          </div>
          <b>${money(qty * Number(product.unitCost || 0))}</b>
          <button class="gazi-owner-remove" type="button" data-owner-remove="${product.id}" aria-label="حذف">×</button>
        </div>
      `)
      .join('');

    container.querySelectorAll('[data-owner-minus]').forEach((button) => {
      button.addEventListener('click', () => changeQuantity(
        Number(button.getAttribute('data-owner-minus')),
        -1,
      ));
    });
    container.querySelectorAll('[data-owner-plus]').forEach((button) => {
      button.addEventListener('click', () => changeQuantity(
        Number(button.getAttribute('data-owner-plus')),
        1,
      ));
    });
    container.querySelectorAll('[data-owner-qty]').forEach((input) => {
      input.addEventListener('change', () => {
        const productId = Number(input.getAttribute('data-owner-qty'));
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
    container.querySelectorAll('[data-owner-remove]').forEach((button) => {
      button.addEventListener('click', () => {
        state.cart.delete(Number(button.getAttribute('data-owner-remove')));
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
    const container = modal?.querySelector('[data-owner-history]');
    const total = modal?.querySelector('[data-owner-history-total]');
    if (!container || !total) return;
    const groups = groupedWithdrawals();
    const grandTotal = groups.reduce(
      (sum, group) => sum + group.records.reduce((subtotal, record) => subtotal + recordCost(record), 0),
      0,
    );
    total.textContent = money(grandTotal);

    if (!groups.length) {
      container.innerHTML = '<div class="gazi-owner-empty">لا توجد سحوبات سابقة للمالك.</div>';
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
          <article class="gazi-owner-history-card">
            <header>
              <span>
                <b>${formatDate(group.date)}</b>
                <small>${formatTime(group.createdAt)} • ${escapeHtml(group.ownerName)}</small>
              </span>
              <strong>${money(cost)}</strong>
            </header>
            <ul>${items}</ul>
            ${group.notes ? `<p>${escapeHtml(group.notes)}</p>` : ''}
            <button type="button" class="gazi-owner-delete" data-delete-owner="${escapeHtml(group.id)}">
              حذف السحب وإرجاع الكمية
            </button>
          </article>
        `;
      })
      .join('');

    container.querySelectorAll('[data-delete-owner]').forEach((button) => {
      button.addEventListener('click', () => deleteWithdrawal(button.getAttribute('data-delete-owner')));
    });
  }

  function renderCashHistory() {
    const modal = document.getElementById(MODAL_ID);
    const container = modal?.querySelector('[data-owner-cash-history]');
    const total = modal?.querySelector('[data-owner-cash-total]');
    if (!container || !total) return;
    const records = cashRecords();
    total.textContent = money(
      records.reduce((sum, record) => sum + Number(record.amount || 0), 0),
    );

    if (!records.length) {
      container.innerHTML = '<div class="gazi-owner-empty">لا توجد سحوبات نقدية سابقة.</div>';
      return;
    }

    container.innerHTML = records
      .map((record) => `
        <article class="gazi-owner-cash-card">
          <span>
            <b>${formatDate(record.date)}</b>
            <small>${formatTime(record.createdAt)} • ${escapeHtml(record.ownerName || state.settings.ownerName || 'المالك')}</small>
            ${record.notes ? `<em>${escapeHtml(record.notes)}</em>` : ''}
          </span>
          <strong>${money(record.amount)}</strong>
          <button type="button" data-delete-owner-cash="${record.id}">حذف</button>
        </article>
      `)
      .join('');

    container.querySelectorAll('[data-delete-owner-cash]').forEach((button) => {
      button.addEventListener('click', () => {
        deleteCashWithdrawal(Number(button.getAttribute('data-delete-owner-cash')));
      });
    });
  }

  function renderProfitDistributionHistory() {
    const modal = document.getElementById(MODAL_ID);
    const container = modal?.querySelector('[data-profit-distribution-history]');
    const total = modal?.querySelector('[data-profit-distribution-total]');
    if (!container || !total) return;
    const records = profitDistributionRecords();
    total.textContent = money(
      records.reduce((sum, record) => sum + Number(record.amount || 0), 0),
    );

    if (!records.length) {
      container.innerHTML = '<div class="gazi-owner-empty">لم يتم توزيع أرباح على الشركاء بعد.</div>';
      return;
    }

    container.innerHTML = records
      .map((record) => `
        <article class="gazi-owner-cash-card gazi-profit-distribution-card">
          <span>
            <b>${formatDate(record.date)}</b>
            <small>${formatTime(record.createdAt)} • أرباح موزعة لأصحاب المحل</small>
            ${record.notes ? `<em>${escapeHtml(record.notes)}</em>` : ''}
          </span>
          <strong>${money(record.amount)}</strong>
          <button type="button" data-delete-profit-distribution="${record.id}">حذف</button>
        </article>
      `)
      .join('');

    container.querySelectorAll('[data-delete-profit-distribution]').forEach((button) => {
      button.addEventListener('click', () => {
        deleteProfitDistribution(Number(button.getAttribute('data-delete-profit-distribution')));
      });
    });
  }

  async function saveWithdrawal() {
    const modal = document.getElementById(MODAL_ID);
    const date = modal?.querySelector('[data-owner-date]')?.value || localDateKey();
    const notes = modal?.querySelector('[data-owner-notes]')?.value.trim() || '';
    const saveButton = modal?.querySelector('[data-save-owner-withdrawal]');
    const items = selectedItems();
    if (!items.length || !saveButton) return;

    for (const item of items) {
      if (item.qty > stockFor(item.product.id)) {
        setStatus(`مخزون ${item.product.name} لم يعد كافيًا.`, 'error');
        return;
      }
    }

    const confirmed = window.confirm(
      `تأكيد سحب بضاعة للمالك بتكلفة ${money(cartTotal())}؟\nلن تُحسب كمبيعات أو أرباح أو ديون.`,
    );
    if (!confirmed) return;

    saveButton.disabled = true;
    saveButton.textContent = 'جارٍ الحفظ…';
    const api = bridge();
    const withdrawalId = `OW-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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
          purchaseType: OWNER_TYPE,
          ownerWithdrawalId: withdrawalId,
          withdrawalQty: qty,
          withdrawalCost: qty * unitCost,
          withdrawalNotes: notes,
          ownerName: state.settings.ownerName || 'المالك',
          productNameSnapshot: product.name || '',
          productCodeSnapshot: product.code || '',
        });
      }
      state.cart.clear();
      await readData();
      const notesInput = modal.querySelector('[data-owner-notes]');
      if (notesInput) notesInput.value = '';
      renderProducts();
      renderCart();
      renderHistory();
      setStatus('تم سحب البضاعة: نُقص المخزون ورأس المال بالتكلفة فقط.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'تعذر حفظ سحب المالك.', 'error');
    } finally {
      saveButton.textContent = 'حفظ سحب المالك';
      saveButton.disabled = !selectedItems().length;
    }
  }

  async function deleteWithdrawal(withdrawalId) {
    const group = groupedWithdrawals().find((entry) => entry.id === withdrawalId);
    if (!group) return;
    if (!window.confirm('حذف هذا السحب؟ ستعود الكميات إلى المخزون تلقائيًا.')) return;
    try {
      const api = bridge();
      for (const record of group.records) await api.remove('purchases', record.id);
      await readData();
      renderProducts();
      renderCart();
      renderHistory();
      setStatus('تم حذف السحب وإرجاع الكميات إلى المخزون.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'تعذر حذف السحب.', 'error');
    }
  }

  async function saveCashWithdrawal() {
    const modal = document.getElementById(MODAL_ID);
    const dateInput = modal?.querySelector('[data-owner-cash-date]');
    const amountInput = modal?.querySelector('[data-owner-cash-amount]');
    const notesInput = modal?.querySelector('[data-owner-cash-notes]');
    const saveButton = modal?.querySelector('[data-save-owner-cash]');
    const date = dateInput?.value || localDateKey();
    const amount = Number(amountInput?.value || 0);
    const notes = notesInput?.value.trim() || '';
    if (!saveButton || amount <= 0) {
      setStatus('أدخل مبلغ السحب النقدي.', 'error');
      return;
    }

    if (!window.confirm(`تأكيد سحب ${money(amount)} نقدًا للمالك؟\nسيُخصم المبلغ من صافي الربح.`)) {
      return;
    }

    saveButton.disabled = true;
    saveButton.textContent = 'جارٍ الحفظ…';
    try {
      await bridge().add('expenses', {
        date,
        department: 'المالك',
        type: 'سحب نقدي للمالك',
        amount,
        notes,
        createdAt: new Date().toISOString(),
        expenseType: 'ownerCashWithdrawal',
        ownerName: state.settings.ownerName || 'المالك',
      });
      await readData();
      amountInput.value = '';
      notesInput.value = '';
      renderCashHistory();
      setStatus('تم تسجيل السحب النقدي وخصمه من صافي الربح.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'تعذر حفظ السحب النقدي.', 'error');
    } finally {
      saveButton.textContent = 'حفظ السحب النقدي';
      saveButton.disabled = false;
    }
  }

  async function deleteCashWithdrawal(recordId) {
    const record = cashRecords().find((entry) => entry.id === recordId);
    if (!record) return;
    if (!window.confirm('حذف هذا السحب النقدي؟ سيعود المبلغ إلى صافي الربح.')) return;
    try {
      await bridge().remove('expenses', record.id);
      await readData();
      renderCashHistory();
      setStatus('تم حذف السحب النقدي وإعادة احتساب صافي الربح.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'تعذر حذف السحب النقدي.', 'error');
    }
  }

  async function saveProfitDistribution() {
    const modal = document.getElementById(MODAL_ID);
    const dateInput = modal?.querySelector('[data-profit-distribution-date]');
    const amountInput = modal?.querySelector('[data-profit-distribution-amount]');
    const notesInput = modal?.querySelector('[data-profit-distribution-notes]');
    const saveButton = modal?.querySelector('[data-save-profit-distribution]');
    const date = dateInput?.value || localDateKey();
    const amount = Number(amountInput?.value || 0);
    const notes = notesInput?.value.trim() || '';
    if (!saveButton || amount <= 0) {
      setStatus('أدخل مبلغ الأرباح التي تقاسمها أصحاب المحل.', 'error');
      return;
    }

    if (
      !window.confirm(
        `تأكيد توزيع أرباح بقيمة ${money(amount)} على أصحاب المحل؟\n` +
          'سيُخصم المبلغ من المبلغ المحصّل وصافي الربح، ولن تتغير المبيعات أو الديون أو المخزون.',
      )
    ) {
      return;
    }

    saveButton.disabled = true;
    saveButton.textContent = 'جارٍ الحفظ…';
    try {
      await bridge().add('expenses', {
        date,
        department: 'أصحاب المحل',
        type: 'توزيع أرباح الشركاء',
        amount,
        notes,
        createdAt: new Date().toISOString(),
        expenseType: PARTNER_PROFIT_TYPE,
        ownerName: state.settings.ownerName || '',
      });
      await readData();
      amountInput.value = '';
      notesInput.value = '';
      renderProfitDistributionHistory();
      setStatus('تم تسجيل توزيع الأرباح وخصمه من المبلغ المحصّل وصافي الربح.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'تعذر حفظ توزيع الأرباح.', 'error');
    } finally {
      saveButton.textContent = 'حفظ توزيع الأرباح';
      saveButton.disabled = false;
    }
  }

  async function deleteProfitDistribution(recordId) {
    const record = profitDistributionRecords().find((entry) => entry.id === recordId);
    if (!record) return;
    if (
      !window.confirm(
        `حذف توزيع الأرباح بقيمة ${money(record.amount)}؟\nسيعود المبلغ إلى المحصّل وصافي الربح.`,
      )
    ) {
      return;
    }
    try {
      await bridge().remove('expenses', record.id);
      await readData();
      renderProfitDistributionHistory();
      setStatus('تم حذف توزيع الأرباح وإعادة المبلغ إلى المحصّل وصافي الربح.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'تعذر حذف توزيع الأرباح.', 'error');
    }
  }

  function closeModal() {
    document.getElementById(MODAL_ID)?.remove();
    document.body.classList.remove('gazi-owner-modal-open');
    state.cart.clear();
    state.search = '';
  }

  async function openModal() {
    if (document.getElementById(MODAL_ID)) return;
    try {
      await readData();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'تعذر فتح سحب المالك.');
      return;
    }

    const overlay = document.createElement('div');
    overlay.id = MODAL_ID;
    overlay.className = 'gazi-owner-overlay';
    overlay.dir = 'rtl';
    overlay.innerHTML = `
      <section class="gazi-owner-modal" role="dialog" aria-modal="true" aria-labelledby="gazi-owner-title">
        <header class="gazi-owner-head">
          <div>
            <h2 id="gazi-owner-title">سحب للمالك</h2>
            <p>سحب البضاعة ينقص رأس المال، والسحب النقدي وتوزيع الأرباح يظهران كلٌ على حدة.</p>
          </div>
          <button type="button" data-close-owner aria-label="إغلاق">×</button>
        </header>

        <div class="gazi-owner-body">
          <div class="gazi-owner-status" data-owner-status hidden></div>
          <section class="gazi-owner-entry">
            <div class="gazi-owner-fields">
              <label>
                <span>تاريخ السحب</span>
                <input type="date" value="${localDateKey()}" data-owner-date>
              </label>
              <label>
                <span>بحث عن صنف</span>
                <input type="search" placeholder="اسم الصنف أو الكود" data-owner-search>
              </label>
            </div>

            <div class="gazi-owner-workspace">
              <div>
                <h3>الأصناف</h3>
                <div class="gazi-owner-products" data-owner-products></div>
              </div>
              <div class="gazi-owner-cart-panel">
                <h3>بضاعة المالك</h3>
                <div class="gazi-owner-cart" data-owner-cart></div>
                <label class="gazi-owner-notes">
                  <span>ملاحظات</span>
                  <textarea data-owner-notes placeholder="اختياري"></textarea>
                </label>
                <div class="gazi-owner-total">
                  <span>الخصم من رأس المال بالتكلفة</span>
                  <strong data-owner-total>${money(0)}</strong>
                </div>
                <button class="gazi-owner-save" type="button" data-save-owner-withdrawal disabled>
                  حفظ سحب المالك
                </button>
              </div>
            </div>
          </section>

          <section class="gazi-owner-cash-section">
            <div class="gazi-owner-history-title">
              <span>
                <h3>سحب نقدي للمالك</h3>
                <p>يُسجل كمصروف ويُخصم مباشرة من صافي الربح</p>
              </span>
              <span>
                <small>إجمالي السحوبات النقدية</small>
                <strong data-owner-cash-total>${money(0)}</strong>
              </span>
            </div>
            <div class="gazi-owner-cash-form">
              <label>
                <span>التاريخ</span>
                <input type="date" value="${localDateKey()}" data-owner-cash-date>
              </label>
              <label>
                <span>المبلغ</span>
                <input type="number" min="0.01" step="0.01" placeholder="0.00" data-owner-cash-amount>
              </label>
              <label class="gazi-owner-cash-notes">
                <span>ملاحظة</span>
                <input type="text" placeholder="اختياري" data-owner-cash-notes>
              </label>
              <button type="button" data-save-owner-cash>حفظ السحب النقدي</button>
            </div>
            <div class="gazi-owner-cash-history" data-owner-cash-history></div>
          </section>

          <section class="gazi-profit-distribution-section">
            <div class="gazi-owner-history-title">
              <span>
                <h3>تقاسم أرباح أصحاب المحل</h3>
                <p>المبلغ الذي أخذه الشركاء من الربح؛ يُخصم من المحصّل وصافي الربح</p>
              </span>
              <span>
                <small>إجمالي الأرباح الموزعة</small>
                <strong data-profit-distribution-total>${money(0)}</strong>
              </span>
            </div>
            <div class="gazi-owner-cash-form gazi-profit-distribution-form">
              <label>
                <span>تاريخ التقاسم</span>
                <input type="date" value="${localDateKey()}" data-profit-distribution-date>
              </label>
              <label>
                <span>المبلغ الموزع</span>
                <input type="number" min="0.01" step="0.01" placeholder="0.00" data-profit-distribution-amount>
              </label>
              <label class="gazi-owner-cash-notes">
                <span>كيف تم التقاسم؟</span>
                <input type="text" placeholder="مثال: كل شريك 500 شيكل" data-profit-distribution-notes>
              </label>
              <button type="button" data-save-profit-distribution>حفظ توزيع الأرباح</button>
            </div>
            <div class="gazi-owner-cash-history" data-profit-distribution-history></div>
          </section>

          <section class="gazi-owner-history">
            <div class="gazi-owner-history-title">
              <span>
                <h3>سجل سحوبات المالك</h3>
                <p>تفاصيل الأصناف والكميات المسحوبة سابقًا</p>
              </span>
              <span>
                <small>إجمالي التكلفة</small>
                <strong data-owner-history-total>${money(0)}</strong>
              </span>
            </div>
            <div class="gazi-owner-history-list" data-owner-history></div>
          </section>
        </div>
      </section>
    `;
    document.body.appendChild(overlay);
    document.body.classList.add('gazi-owner-modal-open');
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) closeModal();
    });
    overlay.querySelector('[data-close-owner]').addEventListener('click', closeModal);
    overlay.querySelector('[data-owner-search]').addEventListener('input', (event) => {
      state.search = event.target.value;
      renderProducts();
    });
    overlay.querySelector('[data-save-owner-withdrawal]').addEventListener('click', saveWithdrawal);
    overlay.querySelector('[data-save-owner-cash]').addEventListener('click', saveCashWithdrawal);
    overlay.querySelector('[data-save-profit-distribution]').addEventListener('click', saveProfitDistribution);
    renderProducts();
    renderCart();
    renderHistory();
    renderCashHistory();
    renderProfitDistributionHistory();
  }

  function createButton(className, text) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.setAttribute('data-open-owner-withdrawal', 'true');
    button.innerHTML = `<span aria-hidden="true">↙</span> ${text}`;
    button.addEventListener('click', openModal);
    return button;
  }

  function installPageButtons() {
    const heading = Array.from(document.querySelectorAll('.page-header h1')).find((element) =>
      ['نقطة البيع', 'المخزون'].includes(element.textContent.trim()),
    );
    if (heading) {
      const header = heading.closest('.page-header');
      if (header && !header.querySelector('[data-open-owner-withdrawal]')) {
        header.appendChild(createButton('secondary-button gazi-owner-open', 'سحب للمالك'));
      }
    }

    const quickGrid = document.querySelector('.quick-grid');
    if (quickGrid && !quickGrid.querySelector('[data-open-owner-withdrawal]')) {
      const button = createButton('gazi-owner-quick', 'سحب للمالك');
      quickGrid.prepend(button);
    }
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.getElementById(MODAL_ID)) closeModal();
  });

  const observer = new MutationObserver(installPageButtons);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installPageButtons, { once: true });
  } else {
    installPageButtons();
  }
})();
