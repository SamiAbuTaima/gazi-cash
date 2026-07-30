(() => {
  'use strict';

  const MODAL_ID = 'gazi-debt-transfer-modal';
  const TRANSFER_TYPE = 'customerDebtTransfer';
  const state = {
    customers: [],
    sales: [],
    debtPayments: [],
    settings: { currency: '₪' },
    debts: [],
    refreshPending: false,
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

  function money(value) {
    return `${Number(value || 0).toLocaleString('ar-EG', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} ${escapeHtml(state.settings.currency || '₪')}`;
  }

  function bridge() {
    const api = window.GaziCashBridge;
    if (!api?.db || typeof api.add !== 'function' || typeof api.remove !== 'function') {
      throw new Error('أغلق التطبيق وافتحه مجددًا حتى يكتمل تحديث نقل الديون.');
    }
    return api;
  }

  function sameCustomer(record, customer) {
    if (
      record.customerSyncId &&
      customer.syncId &&
      record.customerSyncId === customer.syncId
    ) {
      return true;
    }
    return String(record.customerId) === String(customer.id);
  }

  function isTransfer(payment) {
    return payment.debtTransferType === TRANSFER_TYPE;
  }

  function calculateDebts() {
    return state.customers
      .map((customer) => {
        const debtSales = state.sales.filter(
          (sale) => sameCustomer(sale, customer) && sale.paymentMethod === 'debt',
        );
        const payments = state.debtPayments.filter((payment) =>
          sameCustomer(payment, customer),
        );
        const saleTotal = debtSales.reduce(
          (total, sale) => total + Number(sale.total || 0),
          0,
        );
        const paidAtSale = debtSales.reduce(
          (total, sale) => total + Number(sale.paidAmount || 0),
          0,
        );
        const laterPayments = payments
          .filter((payment) => !isTransfer(payment))
          .reduce((total, payment) => total + Number(payment.amount || 0), 0);
        const transferredOut = payments
          .filter(
            (payment) =>
              isTransfer(payment) && payment.debtTransferDirection === 'out',
          )
          .reduce((total, payment) => total + Math.abs(Number(payment.amount || 0)), 0);
        const transferredIn = payments
          .filter(
            (payment) =>
              isTransfer(payment) && payment.debtTransferDirection === 'in',
          )
          .reduce((total, payment) => total + Math.abs(Number(payment.amount || 0)), 0);
        const balance = Math.max(
          0,
          saleTotal + transferredIn - paidAtSale - laterPayments - transferredOut,
        );
        return {
          customer,
          debtSales,
          saleTotal,
          paidAtSale,
          laterPayments,
          transferredOut,
          transferredIn,
          balance,
        };
      })
      .filter((debt) => debt.saleTotal > 0)
      .sort((left, right) => right.balance - left.balance);
  }

  async function readData() {
    const api = bridge();
    const [customers, sales, debtPayments, settings] = await Promise.all([
      api.db.customers.toArray(),
      api.db.sales.toArray(),
      api.db.debtPayments.toArray(),
      api.db.settings.get('main'),
    ]);
    state.customers = customers || [];
    state.sales = sales || [];
    state.debtPayments = debtPayments || [];
    state.settings = settings || { currency: '₪' };
    state.debts = calculateDebts();
  }

  function phoneText(customer) {
    return String(customer.phone || '').trim() || 'لا يوجد رقم هاتف';
  }

  function debtForCard(card, usedIds) {
    const name = card.querySelector('.debt-info strong')?.textContent.trim() || '';
    const phone = card.querySelector('.debt-info small')?.textContent.trim() || '';
    const exact = state.debts.find(
      (debt) =>
        !usedIds.has(String(debt.customer.id)) &&
        debt.customer.name.trim() === name &&
        phoneText(debt.customer) === phone,
    );
    if (exact) return exact;
    return state.debts.find(
      (debt) =>
        !usedIds.has(String(debt.customer.id)) &&
        debt.customer.name.trim() === name,
    );
  }

  function renderDebtCard(card, debt) {
    const info = card.querySelector('.debt-info span');
    const balance = card.querySelector('.debt-balance b');
    const actions = card.querySelector('.debt-actions');
    if (!info || !balance || !actions) return;

    const signature = [
      debt.saleTotal,
      debt.paidAtSale,
      debt.laterPayments,
      debt.transferredOut,
      debt.transferredIn,
      debt.balance,
    ].join('|');
    if (card.dataset.gaziDebtSignature !== signature) {
      const parts = [
        `أصل الدين ${money(debt.saleTotal)}`,
        `المسدّد ${money(debt.paidAtSale + debt.laterPayments)}`,
      ];
      if (debt.transferredIn > 0) {
        parts.push(`منقول إليه ${money(debt.transferredIn)}`);
      }
      if (debt.transferredOut > 0) {
        parts.push(`منقول منه ${money(debt.transferredOut)}`);
      }
      info.textContent = parts.join(' • ');
      balance.textContent = money(debt.balance);
      card.classList.toggle('settled', debt.balance <= 0);
      card.dataset.gaziDebtSignature = signature;
    }

    let button = actions.querySelector('[data-transfer-debt]');
    const hasTarget = state.debts.some(
      (candidate) => String(candidate.customer.id) !== String(debt.customer.id),
    );
    if (debt.balance > 0 && hasTarget) {
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'secondary-button gazi-transfer-debt-button';
        button.setAttribute('data-transfer-debt', String(debt.customer.id));
        button.textContent = 'نقل دين';
        actions.appendChild(button);
      }
      button.onclick = () => openTransferModal(debt.customer.id);
    } else {
      button?.remove();
    }
  }

  function enhanceDebtPage() {
    const heading = Array.from(document.querySelectorAll('.page-header h1'))
      .find((element) => element.textContent.trim() === 'الديون');
    if (!heading) return;

    const cards = Array.from(document.querySelectorAll('.debt-card'));
    const usedIds = new Set();
    cards.forEach((card) => {
      const debt = debtForCard(card, usedIds);
      if (!debt) return;
      usedIds.add(String(debt.customer.id));
      renderDebtCard(card, debt);
    });

    const hero = document.querySelector('.debt-hero');
    if (hero) {
      const total = state.debts.reduce((sum, debt) => sum + debt.balance, 0);
      const count = state.debts.filter((debt) => debt.balance > 0).length;
      const signature = `${total}|${count}`;
      if (hero.dataset.gaziDebtSignature !== signature) {
        const strong = hero.querySelector(':scope > strong');
        const small = hero.querySelector(':scope > small');
        if (strong) strong.textContent = money(total);
        if (small) small.textContent = `${count.toLocaleString('ar-EG')} زبائن عليهم رصيد`;
        hero.dataset.gaziDebtSignature = signature;
      }
    }
  }

  function transferPairFromRow(row) {
    const match = row.textContent.match(/DT-[A-Za-z0-9-]+/);
    return match?.[0] || '';
  }

  function enhanceTransferRows() {
    document.querySelectorAll('tbody tr').forEach((row) => {
      const pairId = transferPairFromRow(row);
      if (!pairId || row.dataset.gaziTransferPair === pairId) return;
      const direction = row.textContent.includes('دين منقول من') ? 'in' : 'out';
      const record = state.debtPayments.find(
        (payment) =>
          payment.debtTransferPairId === pairId &&
          payment.debtTransferDirection === direction,
      );
      if (!record) return;
      row.dataset.gaziTransferPair = pairId;
      row.classList.add('gazi-debt-transfer-row');
      const cells = row.querySelectorAll('td');
      const amountCell = cells[1];
      if (amountCell) {
        const amount = Math.abs(Number(record.amount || 0));
        amountCell.innerHTML = record.debtTransferDirection === 'in'
          ? `<span class="gazi-transfer-in">+ ${money(amount)} منقول إليه</span>`
          : `<span class="gazi-transfer-out">${money(amount)} منقول منه</span>`;
      }
    });
  }

  function enhanceDebtDetails() {
    const headings = Array.from(document.querySelectorAll('h2, h3'))
      .filter((element) => element.textContent.trim().startsWith('سجل '));
    headings.forEach((heading) => {
      const customerName = heading.textContent.trim().replace(/^سجل\s+/, '');
      const debt = state.debts.find(
        (entry) => entry.customer.name.trim() === customerName,
      );
      if (!debt) return;
      const container =
        heading.closest('[role="dialog"]') ||
        heading.parentElement?.parentElement?.parentElement;
      const summary = container?.querySelector('.detail-summary');
      if (!summary) return;
      const signature = [
        debt.saleTotal,
        debt.paidAtSale,
        debt.laterPayments,
        debt.transferredOut,
        debt.transferredIn,
        debt.balance,
      ].join('|');
      if (summary.dataset.gaziDebtSignature === signature) return;
      const spans = summary.querySelectorAll(':scope > span');
      if (spans[0]) {
        spans[0].innerHTML = `أصل الدين <b>${money(debt.saleTotal)}</b>`;
      }
      if (spans[1]) {
        spans[1].innerHTML =
          `المسدّد <b>${money(debt.paidAtSale + debt.laterPayments)}</b>`;
      }
      if (spans[2]) {
        spans[2].innerHTML =
          `المتبقي <b class="danger-text">${money(debt.balance)}</b>`;
      }
      let transferSummary = summary.querySelector('[data-transfer-summary]');
      if (debt.transferredIn > 0 || debt.transferredOut > 0) {
        if (!transferSummary) {
          transferSummary = document.createElement('span');
          transferSummary.setAttribute('data-transfer-summary', 'true');
          summary.appendChild(transferSummary);
        }
        const parts = [];
        if (debt.transferredIn > 0) {
          parts.push(`منقول إليه ${money(debt.transferredIn)}`);
        }
        if (debt.transferredOut > 0) {
          parts.push(`منقول منه ${money(debt.transferredOut)}`);
        }
        transferSummary.innerHTML = `تحويلات الدين <b>${parts.join(' • ')}</b>`;
      } else {
        transferSummary?.remove();
      }
      summary.dataset.gaziDebtSignature = signature;
    });
  }

  function closeTransferModal() {
    document.getElementById(MODAL_ID)?.remove();
    document.body.classList.remove('gazi-debt-transfer-open');
  }

  function setModalStatus(message, kind = 'error') {
    const status = document.querySelector(`#${MODAL_ID} [data-transfer-status]`);
    if (!status) return;
    status.textContent = message;
    status.className = `gazi-debt-transfer-status ${kind}`;
    status.hidden = false;
  }

  function notify(message) {
    document.querySelector('[data-gazi-transfer-toast]')?.remove();
    const toast = document.createElement('div');
    toast.className = 'gazi-debt-transfer-toast';
    toast.setAttribute('data-gazi-transfer-toast', 'true');
    toast.textContent = message;
    document.body.appendChild(toast);
    window.setTimeout(() => toast.remove(), 4200);
  }

  async function openTransferModal(customerId) {
    try {
      await readData();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'تعذر فتح نقل الدين.');
      return;
    }
    const source = state.debts.find(
      (debt) => String(debt.customer.id) === String(customerId),
    );
    if (!source || source.balance <= 0) {
      alert('لا يوجد رصيد متبقٍ لنقله.');
      return;
    }
    const targets = state.debts.filter(
      (debt) => String(debt.customer.id) !== String(source.customer.id),
    );
    if (!targets.length) {
      alert('يجب أن يكون الاسم الآخر موجودًا في قائمة الديون أولًا.');
      return;
    }

    closeTransferModal();
    const overlay = document.createElement('div');
    overlay.id = MODAL_ID;
    overlay.className = 'gazi-debt-transfer-overlay';
    overlay.dir = 'rtl';
    overlay.innerHTML = `
      <section class="gazi-debt-transfer-modal" role="dialog" aria-modal="true">
        <header>
          <span>
            <h2>نقل دين — ${escapeHtml(source.customer.name)}</h2>
            <p>ينقص من الاسم الحالي ويُضاف إلى الاسم الجديد، بدون بيع أو ربح جديد.</p>
          </span>
          <button type="button" data-close-transfer aria-label="إغلاق">×</button>
        </header>
        <div class="gazi-debt-transfer-body">
          <div class="gazi-debt-transfer-current">
            <span>الدين المتبقي على ${escapeHtml(source.customer.name)}</span>
            <strong>${money(source.balance)}</strong>
          </div>
          <div class="gazi-debt-transfer-status" data-transfer-status hidden></div>
          <label>
            <span>انقل الدين إلى</span>
            <select data-transfer-target>
              ${targets.map((target) => `
                <option value="${escapeHtml(target.customer.id)}">
                  ${escapeHtml(target.customer.name)} — رصيده ${money(target.balance)}
                </option>
              `).join('')}
            </select>
          </label>
          <label>
            <span>المبلغ المراد نقله</span>
            <input
              type="number"
              min="0.01"
              max="${source.balance}"
              step="0.01"
              value="${source.balance}"
              data-transfer-amount
            >
          </label>
          <label>
            <span>تاريخ النقل</span>
            <input type="date" value="${localDateKey()}" data-transfer-date>
          </label>
          <label>
            <span>ملاحظة</span>
            <input type="text" placeholder="اختياري" data-transfer-notes>
          </label>
          <div class="gazi-debt-transfer-note">
            إجمالي ديون المحل لن يتغير، وسيبقى سجل البيع والربح كما هو.
          </div>
          <button type="button" class="gazi-debt-transfer-save" data-save-transfer>
            تأكيد نقل الدين
          </button>
        </div>
      </section>
    `;
    document.body.appendChild(overlay);
    document.body.classList.add('gazi-debt-transfer-open');
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) closeTransferModal();
    });
    overlay.querySelector('[data-close-transfer]').addEventListener(
      'click',
      closeTransferModal,
    );
    overlay.querySelector('[data-save-transfer]').addEventListener('click', () =>
      saveTransfer(source.customer.id),
    );
  }

  async function saveTransfer(sourceCustomerId) {
    const modal = document.getElementById(MODAL_ID);
    const saveButton = modal?.querySelector('[data-save-transfer]');
    if (!modal || !saveButton) return;

    try {
      await readData();
    } catch (error) {
      setModalStatus(error instanceof Error ? error.message : 'تعذر قراءة الديون.');
      return;
    }

    const source = state.debts.find(
      (debt) => String(debt.customer.id) === String(sourceCustomerId),
    );
    const targetId = modal.querySelector('[data-transfer-target]')?.value;
    const target = state.debts.find(
      (debt) => String(debt.customer.id) === String(targetId),
    );
    const amount = Number(modal.querySelector('[data-transfer-amount]')?.value || 0);
    const date = modal.querySelector('[data-transfer-date]')?.value || localDateKey();
    const notes = modal.querySelector('[data-transfer-notes]')?.value.trim() || '';

    if (!source || source.balance <= 0) {
      setModalStatus('لم يعد على الاسم الحالي دين متبقٍ.');
      return;
    }
    if (!target || String(target.customer.id) === String(source.customer.id)) {
      setModalStatus('اختر اسمًا آخر لنقل الدين إليه.');
      return;
    }
    if (amount <= 0 || amount > source.balance + 0.0001) {
      setModalStatus(`المبلغ يجب ألا يتجاوز ${money(source.balance)}.`);
      return;
    }

    if (
      !window.confirm(
        `نقل ${money(amount)} من دين ${source.customer.name} إلى ${target.customer.name}؟`,
      )
    ) {
      return;
    }

    saveButton.disabled = true;
    saveButton.textContent = 'جارٍ النقل…';
    const api = bridge();
    const pairId = `DT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const createdAt = new Date().toISOString();
    let firstRecordId;
    try {
      firstRecordId = await api.add('debtPayments', {
        customerId: source.customer.id,
        date,
        amount,
        notes: `تحويل دين إلى ${target.customer.name} [${pairId}]${notes ? ` — ${notes}` : ''}`,
        createdAt,
        debtTransferType: TRANSFER_TYPE,
        debtTransferDirection: 'out',
        debtTransferPairId: pairId,
        debtTransferOtherCustomerId: target.customer.id,
        debtTransferOtherCustomerSyncId: target.customer.syncId || '',
        debtTransferOtherCustomerName: target.customer.name,
      });
      await api.add('debtPayments', {
        customerId: target.customer.id,
        date,
        amount: -amount,
        notes: `دين منقول من ${source.customer.name} [${pairId}]${notes ? ` — ${notes}` : ''}`,
        createdAt: new Date(Date.now() + 1).toISOString(),
        debtTransferType: TRANSFER_TYPE,
        debtTransferDirection: 'in',
        debtTransferPairId: pairId,
        debtTransferOtherCustomerId: source.customer.id,
        debtTransferOtherCustomerSyncId: source.customer.syncId || '',
        debtTransferOtherCustomerName: source.customer.name,
      });
      closeTransferModal();
      await readData();
      enhanceAll();
      notify(`تم نقل ${money(amount)} من ${source.customer.name} إلى ${target.customer.name}.`);
    } catch (error) {
      if (firstRecordId !== undefined) {
        try {
          await api.remove('debtPayments', firstRecordId);
        } catch {
          // The original error is more useful to the user.
        }
      }
      setModalStatus(error instanceof Error ? error.message : 'تعذر نقل الدين.');
      saveButton.disabled = false;
      saveButton.textContent = 'تأكيد نقل الدين';
    }
  }

  async function deleteTransferPair(pairId) {
    const records = state.debtPayments.filter(
      (payment) => payment.debtTransferPairId === pairId,
    );
    if (!records.length) return;
    if (!window.confirm('حذف حركة نقل الدين؟ سيعود المبلغ إلى الاسم السابق.')) {
      return;
    }
    try {
      const api = bridge();
      for (const record of records) {
        await api.remove('debtPayments', record.id);
      }
      await readData();
      enhanceAll();
      notify('تم حذف نقل الدين وإعادة الأرصدة كما كانت.');
    } catch (error) {
      alert(error instanceof Error ? error.message : 'تعذر حذف نقل الدين.');
    }
  }

  function handleTransferDelete(event) {
    const button = event.target.closest?.('.icon-button.danger');
    const row = button?.closest('tr');
    const pairId = row?.dataset.gaziTransferPair;
    if (!pairId) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    deleteTransferPair(pairId);
  }

  function enhanceAll() {
    enhanceDebtPage();
    enhanceTransferRows();
    enhanceDebtDetails();
  }

  function scheduleEnhance() {
    if (state.refreshPending) return;
    state.refreshPending = true;
    window.setTimeout(async () => {
      state.refreshPending = false;
      const onDebtPage = Array.from(document.querySelectorAll('.page-header h1'))
        .some((element) => element.textContent.trim() === 'الديون');
      const hasDebtDetails = Array.from(document.querySelectorAll('h2, h3'))
        .some((element) => element.textContent.trim().startsWith('سجل '));
      if (!onDebtPage && !hasDebtDetails) return;
      try {
        await readData();
        enhanceAll();
      } catch {
        // The bridge can be unavailable for a moment while the main bundle starts.
      }
    }, 40);
  }

  document.addEventListener('click', handleTransferDelete, true);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.getElementById(MODAL_ID)) {
      closeTransferModal();
    }
  });

  const observer = new MutationObserver(scheduleEnhance);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleEnhance, { once: true });
  } else {
    scheduleEnhance();
  }

  window.GaziDebtTransfers = {
    calculateDebts,
    refresh: async () => {
      await readData();
      enhanceAll();
      return state.debts;
    },
  };
})();
