(() => {
  'use strict';

  const DB_NAME = 'gazi-cash-db';
  const MODAL_ID = 'gazi-invoice-history-modal';
  const DETAILS_ID = 'gazi-invoice-details-modal';
  const PAYMENT_LABELS = {
    cash: 'نقدي',
    debt: 'دين',
    transfer: 'تحويل',
    other: 'أخرى',
  };

  const state = {
    sales: [],
    currency: '₪',
    filters: {
      from: '',
      to: '',
      payment: 'all',
      query: '',
    },
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

  function shiftDays(days) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return localDateKey(date);
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

  function normalizeDigits(value) {
    const arabicIndic = '٠١٢٣٤٥٦٧٨٩';
    const easternArabic = '۰۱۲۳۴۵۶۷۸۹';
    return String(value ?? '')
      .replace(/[٠-٩]/g, (digit) => String(arabicIndic.indexOf(digit)))
      .replace(/[۰-۹]/g, (digit) => String(easternArabic.indexOf(digit)));
  }

  function displayedDateToKey(value) {
    const normalized = normalizeDigits(value);
    const match = normalized.match(/(\d{4})\s*[\/.-]\s*(\d{1,2})\s*[\/.-]\s*(\d{1,2})/);
    if (!match) return '';
    const [, year, month, day] = match;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  function money(value) {
    const number = Number(value || 0);
    return `${number.toLocaleString('ar-EG', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} ${escapeHtml(state.currency)}`;
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('تعذر فتح قاعدة البيانات.'));
      request.onblocked = () => reject(new Error('قاعدة البيانات مشغولة. أغلق التطبيق وافتحه مجددًا.'));
    });
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('تعذر قراءة البيانات.'));
    });
  }

  async function readInvoiceData() {
    const db = await openDatabase();
    try {
      const transaction = db.transaction(['sales', 'settings'], 'readonly');
      const salesRequest = transaction.objectStore('sales').getAll();
      const settingsRequest = transaction.objectStore('settings').get('main');
      const [sales, settings] = await Promise.all([
        requestResult(salesRequest),
        requestResult(settingsRequest),
      ]);
      state.sales = (sales || []).sort((left, right) => {
        const leftTime = new Date(left.createdAt || `${left.date}T00:00:00`).getTime();
        const rightTime = new Date(right.createdAt || `${right.date}T00:00:00`).getTime();
        return rightTime - leftTime;
      });
      state.currency = settings?.currency || '₪';
    } finally {
      db.close();
    }
  }

  function filteredSales() {
    const query = state.filters.query.trim().toLowerCase();
    return state.sales.filter((sale) => {
      if (state.filters.from && sale.date < state.filters.from) return false;
      if (state.filters.to && sale.date > state.filters.to) return false;
      if (state.filters.payment !== 'all' && sale.paymentMethod !== state.filters.payment) {
        return false;
      }
      if (!query) return true;
      const itemText = (sale.items || [])
        .map((item) => `${item.name || ''} ${item.code || ''}`)
        .join(' ');
      return `${sale.invoiceNo || ''} ${sale.customerName || ''} ${itemText}`
        .toLowerCase()
        .includes(query);
    });
  }

  function summaryFor(sales) {
    return sales.reduce(
      (summary, sale) => {
        const total = Number(sale.total || 0);
        const paid = sale.paymentMethod === 'debt'
          ? Number(sale.paidAmount || 0)
          : total;
        summary.total += total;
        summary.paid += paid;
        summary.remaining += Math.max(0, total - paid);
        summary.profit += Number(sale.profit || 0);
        return summary;
      },
      { total: 0, paid: 0, remaining: 0, profit: 0 },
    );
  }

  function paymentBadge(method) {
    const label = PAYMENT_LABELS[method] || 'أخرى';
    return `<span class="gazi-payment-badge ${escapeHtml(method || 'other')}">${label}</span>`;
  }

  function renderHistory() {
    const modal = document.getElementById(MODAL_ID);
    if (!modal) return;

    const sales = filteredSales();
    const summary = summaryFor(sales);
    const resultCount = modal.querySelector('[data-result-count]');
    const summaryContainer = modal.querySelector('[data-history-summary]');
    const resultsContainer = modal.querySelector('[data-history-results]');

    resultCount.textContent = `${sales.length.toLocaleString('ar-EG')} فاتورة`;
    summaryContainer.innerHTML = `
      <div><span>إجمالي المبيعات</span><strong>${money(summary.total)}</strong></div>
      <div><span>المبلغ المحصّل</span><strong>${money(summary.paid)}</strong></div>
      <div><span>الديون المتبقية</span><strong>${money(summary.remaining)}</strong></div>
      <div><span>إجمالي الربح</span><strong>${money(summary.profit)}</strong></div>
    `;

    if (!sales.length) {
      resultsContainer.innerHTML = `
        <div class="gazi-history-empty">
          <span>⌕</span>
          <strong>لا توجد فواتير مطابقة</strong>
          <p>غيّر التاريخ أو البحث أو طريقة الدفع.</p>
        </div>
      `;
      return;
    }

    resultsContainer.innerHTML = `
      <div class="gazi-history-table-wrap">
        <table class="gazi-history-table">
          <thead>
            <tr>
              <th>الفاتورة</th>
              <th>التاريخ والوقت</th>
              <th>العميل</th>
              <th>الدفع</th>
              <th>الإجمالي</th>
              <th>الربح</th>
              <th>التفاصيل</th>
            </tr>
          </thead>
          <tbody>
            ${sales
              .map(
                (sale) => `
                  <tr>
                    <td data-label="الفاتورة"><b>${escapeHtml(sale.invoiceNo)}</b></td>
                    <td data-label="التاريخ والوقت">
                      <span class="gazi-date-time">
                        <b>${formatDate(sale.date)}</b>
                        <small>${formatTime(sale.createdAt)}</small>
                      </span>
                    </td>
                    <td data-label="العميل">${escapeHtml(sale.customerName || 'زبون نقدي')}</td>
                    <td data-label="الدفع">${paymentBadge(sale.paymentMethod)}</td>
                    <td data-label="الإجمالي"><b>${money(sale.total)}</b></td>
                    <td data-label="الربح">${money(sale.profit)}</td>
                    <td data-label="التفاصيل">
                      <button class="gazi-details-button" type="button" data-invoice-id="${escapeHtml(sale.id)}">
                        عرض
                      </button>
                    </td>
                  </tr>
                `,
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `;

    resultsContainer.querySelectorAll('[data-invoice-id]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.getAttribute('data-invoice-id');
        const sale = state.sales.find((entry) => String(entry.id) === String(id));
        if (sale) openDetails(sale);
      });
    });
  }

  function setRange(range) {
    const today = localDateKey();
    if (range === 'today') {
      state.filters.from = today;
      state.filters.to = today;
    } else if (range === 'yesterday') {
      const yesterday = shiftDays(-1);
      state.filters.from = yesterday;
      state.filters.to = yesterday;
    } else if (range === 'beforeYesterday') {
      const beforeYesterday = shiftDays(-2);
      state.filters.from = beforeYesterday;
      state.filters.to = beforeYesterday;
    } else if (range === 'week') {
      state.filters.from = shiftDays(-6);
      state.filters.to = today;
    } else if (range === 'month') {
      const date = new Date();
      date.setDate(1);
      state.filters.from = localDateKey(date);
      state.filters.to = today;
    } else {
      state.filters.from = '';
      state.filters.to = '';
    }

    const modal = document.getElementById(MODAL_ID);
    modal.querySelector('[data-filter-from]').value = state.filters.from;
    modal.querySelector('[data-filter-to]').value = state.filters.to;
    renderHistory();
  }

  function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.remove();
    if (!document.querySelector('.gazi-overlay')) {
      document.body.classList.remove('gazi-modal-open');
    }
  }

  function bindOverlayClose(overlay, id) {
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) closeModal(id);
    });
    overlay.querySelector('[data-close-modal]').addEventListener('click', () => closeModal(id));
  }

  async function openHistory(options = {}) {
    if (document.getElementById(MODAL_ID)) return;
    try {
      await readInvoiceData();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'تعذر قراءة سجل الفواتير.');
      return;
    }

    const requestedFrom = typeof options === 'object' && options ? options.from : '';
    const requestedTo = typeof options === 'object' && options ? options.to : '';
    state.filters = {
      from: requestedFrom || shiftDays(-6),
      to: requestedTo || localDateKey(),
      payment: 'all',
      query: '',
    };
    const singleDay = state.filters.from && state.filters.from === state.filters.to
      ? formatDate(state.filters.from)
      : '';

    const overlay = document.createElement('div');
    overlay.id = MODAL_ID;
    overlay.className = 'gazi-overlay';
    overlay.dir = 'rtl';
    overlay.innerHTML = `
      <section class="gazi-history-modal" role="dialog" aria-modal="true" aria-labelledby="gazi-history-title">
        <header class="gazi-history-header">
          <div>
            <h2 id="gazi-history-title">${singleDay ? `فواتير يوم ${singleDay}` : 'سجل الفواتير'}</h2>
            <p>${singleDay ? 'كل عمليات البيع المحفوظة في هذا اليوم' : 'ابحث في جميع الفواتير القديمة واعرض أصناف كل فاتورة'}</p>
          </div>
          <button class="gazi-close-button" type="button" aria-label="إغلاق" data-close-modal>×</button>
        </header>

        <div class="gazi-history-body">
          <div class="gazi-quick-ranges">
            <button type="button" data-range="today">اليوم</button>
            <button type="button" data-range="yesterday">أمس</button>
            <button type="button" data-range="beforeYesterday">أول أمس</button>
            <button type="button" data-range="week">آخر 7 أيام</button>
            <button type="button" data-range="month">هذا الشهر</button>
            <button type="button" data-range="all">كل الفواتير</button>
          </div>

          <div class="gazi-history-filters">
            <label>
              <span>من تاريخ</span>
              <input type="date" data-filter-from value="${state.filters.from}">
            </label>
            <label>
              <span>إلى تاريخ</span>
              <input type="date" data-filter-to value="${state.filters.to}">
            </label>
            <label>
              <span>طريقة الدفع</span>
              <select data-filter-payment>
                <option value="all">الكل</option>
                <option value="cash">نقدي</option>
                <option value="debt">دين</option>
                <option value="transfer">تحويل</option>
                <option value="other">أخرى</option>
              </select>
            </label>
            <label class="gazi-search-field">
              <span>بحث</span>
              <input type="search" data-filter-query placeholder="رقم الفاتورة، العميل أو الصنف">
            </label>
          </div>

          <div class="gazi-history-toolbar">
            <strong data-result-count></strong>
            <button type="button" class="gazi-refresh-button" data-refresh-history>↻ تحديث البيانات</button>
          </div>

          <div class="gazi-history-summary" data-history-summary></div>
          <div data-history-results></div>
        </div>
      </section>
    `;

    document.body.appendChild(overlay);
    document.body.classList.add('gazi-modal-open');
    bindOverlayClose(overlay, MODAL_ID);

    overlay.querySelectorAll('[data-range]').forEach((button) => {
      button.addEventListener('click', () => setRange(button.getAttribute('data-range')));
    });
    overlay.querySelector('[data-filter-from]').addEventListener('change', (event) => {
      state.filters.from = event.target.value;
      renderHistory();
    });
    overlay.querySelector('[data-filter-to]').addEventListener('change', (event) => {
      state.filters.to = event.target.value;
      renderHistory();
    });
    overlay.querySelector('[data-filter-payment]').addEventListener('change', (event) => {
      state.filters.payment = event.target.value;
      renderHistory();
    });
    overlay.querySelector('[data-filter-query]').addEventListener('input', (event) => {
      state.filters.query = event.target.value;
      renderHistory();
    });
    overlay.querySelector('[data-refresh-history]').addEventListener('click', async () => {
      await readInvoiceData();
      renderHistory();
    });

    renderHistory();
  }

  function invoiceDocument(sale) {
    const items = sale.items || [];
    const paid = sale.paymentMethod === 'debt'
      ? Number(sale.paidAmount || 0)
      : Number(sale.total || 0);
    const remaining = Math.max(0, Number(sale.total || 0) - paid);
    return `
      <div class="gazi-invoice-sheet" dir="rtl">
        <div class="gazi-invoice-brand">
          <div>
            <h2>غازي كاش</h2>
            <p>فاتورة بيع</p>
          </div>
          <strong>${escapeHtml(sale.invoiceNo)}</strong>
        </div>
        <div class="gazi-invoice-meta">
          <span><b>التاريخ:</b> ${formatDate(sale.date)}</span>
          <span><b>الوقت:</b> ${formatTime(sale.createdAt)}</span>
          <span><b>العميل:</b> ${escapeHtml(sale.customerName || 'زبون نقدي')}</span>
          <span><b>الدفع:</b> ${PAYMENT_LABELS[sale.paymentMethod] || 'أخرى'}</span>
        </div>
        <div class="gazi-invoice-items">
          <table>
            <thead>
              <tr>
                <th>الصنف</th>
                <th>الكمية</th>
                <th>سعر الوحدة</th>
                <th>المجموع</th>
              </tr>
            </thead>
            <tbody>
              ${items
                .map(
                  (item) => `
                    <tr>
                      <td>
                        <b>${escapeHtml(item.name || 'صنف')}</b>
                        <small>${escapeHtml(item.code || '')}</small>
                      </td>
                      <td>${Number(item.qty || 0).toLocaleString('ar-EG')}</td>
                      <td>${money(item.unitPrice)}</td>
                      <td>${money(item.total ?? Number(item.qty || 0) * Number(item.unitPrice || 0))}</td>
                    </tr>
                  `,
                )
                .join('')}
            </tbody>
          </table>
        </div>
        <div class="gazi-invoice-totals">
          <span>الإجمالي <strong>${money(sale.total)}</strong></span>
          <span>المدفوع <strong>${money(paid)}</strong></span>
          ${remaining > 0 ? `<span class="remaining">المتبقي <strong>${money(remaining)}</strong></span>` : ''}
        </div>
        ${sale.notes ? `<div class="gazi-invoice-notes"><b>ملاحظات:</b> ${escapeHtml(sale.notes)}</div>` : ''}
      </div>
    `;
  }

  function openDetails(sale) {
    closeModal(DETAILS_ID);
    const overlay = document.createElement('div');
    overlay.id = DETAILS_ID;
    overlay.className = 'gazi-overlay gazi-details-overlay';
    overlay.dir = 'rtl';
    overlay.innerHTML = `
      <section class="gazi-details-modal" role="dialog" aria-modal="true">
        <header class="gazi-history-header">
          <div>
            <h2>تفاصيل الفاتورة</h2>
            <p>${escapeHtml(sale.invoiceNo)}</p>
          </div>
          <button class="gazi-close-button" type="button" aria-label="إغلاق" data-close-modal>×</button>
        </header>
        <div class="gazi-details-body">
          ${invoiceDocument(sale)}
          <div class="gazi-owner-metrics">
            <span>تكلفة البضاعة <strong>${money(sale.cost)}</strong></span>
            <span>ربح الفاتورة <strong>${money(sale.profit)}</strong></span>
          </div>
          <div class="gazi-details-actions">
            <button type="button" class="gazi-print-button" data-print-invoice>طباعة الفاتورة</button>
            <button type="button" class="gazi-share-button" data-share-invoice>مشاركة الملخص</button>
          </div>
        </div>
      </section>
    `;
    document.body.appendChild(overlay);
    document.body.classList.add('gazi-modal-open');
    bindOverlayClose(overlay, DETAILS_ID);

    overlay.querySelector('[data-print-invoice]').addEventListener('click', () => printInvoice(sale));
    overlay.querySelector('[data-share-invoice]').addEventListener('click', () => shareInvoice(sale));
  }

  function printInvoice(sale) {
    const printWindow = window.open('', '_blank', 'width=760,height=900');
    if (!printWindow) {
      alert('اسمح بفتح النافذة حتى تتم طباعة الفاتورة.');
      return;
    }
    printWindow.document.write(`
      <!doctype html>
      <html lang="ar" dir="rtl">
        <head>
          <meta charset="utf-8">
          <title>${escapeHtml(sale.invoiceNo)}</title>
          <style>
            body{font-family:Arial,sans-serif;color:#173d3a;margin:0;padding:28px}
            .gazi-invoice-brand{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #0f766e;padding-bottom:15px}
            h2,p{margin:0}.gazi-invoice-meta{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:20px 0}
            table{width:100%;border-collapse:collapse}th,td{border:1px solid #dce8e6;padding:10px;text-align:right}
            th{background:#edf7f5}td small{display:block;color:#667}.gazi-invoice-totals{margin-top:18px;display:grid;gap:8px}
            .gazi-invoice-totals span{display:flex;justify-content:space-between;padding:10px;background:#f4f9f8}
            .remaining{color:#a94418}.gazi-invoice-notes{margin-top:15px;padding:12px;border:1px solid #dce8e6}
          </style>
        </head>
        <body>${invoiceDocument(sale)}</body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 250);
  }

  async function shareInvoice(sale) {
    const items = (sale.items || [])
      .map((item) => `${item.name} × ${item.qty}: ${money(item.total)}`)
      .join('\n');
    const text = [
      `فاتورة غازي كاش ${sale.invoiceNo}`,
      `التاريخ: ${formatDate(sale.date)} - ${formatTime(sale.createdAt)}`,
      `العميل: ${sale.customerName || 'زبون نقدي'}`,
      items,
      `الإجمالي: ${money(sale.total)}`,
    ]
      .filter(Boolean)
      .join('\n');

    if (navigator.share) {
      try {
        await navigator.share({ title: `فاتورة ${sale.invoiceNo}`, text });
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
      }
    }

    try {
      await navigator.clipboard.writeText(text);
      alert('تم نسخ ملخص الفاتورة، ويمكنك لصقه في واتساب.');
    } catch {
      alert(text);
    }
  }

  function installHistoryButton() {
    const panel = document.querySelector('.history-panel');
    if (!panel || panel.querySelector('[data-open-invoice-history]')) return;
    const title = panel.querySelector('.panel-title');
    if (!title) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary-button gazi-open-history-button';
    button.setAttribute('data-open-invoice-history', 'true');
    button.innerHTML = '<span>☷</span> سجل كل الفواتير';
    button.addEventListener('click', () => openHistory());
    title.appendChild(button);
  }

  function installReportInvoiceLinks() {
    const heading = Array.from(document.querySelectorAll('.panel-title h2'))
      .find((element) => element.textContent.trim() === 'التقرير اليومي');
    if (!heading) return;

    const panel = heading.closest('section.panel') || heading.closest('.panel');
    if (!panel) return;

    const panelTitle = heading.closest('.panel-title');
    if (panelTitle && !panelTitle.querySelector('[data-open-report-invoices]')) {
      const allButton = document.createElement('button');
      allButton.type = 'button';
      allButton.className = 'secondary-button gazi-open-history-button';
      allButton.setAttribute('data-open-report-invoices', 'true');
      allButton.innerHTML = '<span>☷</span> كل الفواتير';
      allButton.addEventListener('click', () => openHistory());
      panelTitle.appendChild(allButton);
    }

    panel.querySelectorAll('tbody tr').forEach((row) => {
      if (row.querySelector('[data-report-invoice-date]')) return;
      const cells = row.querySelectorAll('td');
      const dateCell = cells[0];
      const operationsCell = cells[cells.length - 1];
      const date = displayedDateToKey(dateCell?.textContent);
      if (!date || !operationsCell) return;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'gazi-report-invoices-button';
      button.setAttribute('data-report-invoice-date', date);
      button.setAttribute('aria-label', `عرض فواتير ${date}`);
      button.innerHTML = '<span>عرض الفواتير</span>';
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openHistory({ from: date, to: date });
      });
      operationsCell.appendChild(button);
    });
  }

  function installDebtInvoiceLinks() {
    const heading = Array.from(document.querySelectorAll('h2, h3'))
      .find((element) => element.textContent.trim() === 'فواتير الدين');
    if (!heading) return;

    const container = heading.closest('section') || heading.parentElement?.parentElement;
    if (!container) return;

    container.querySelectorAll('tbody tr').forEach((row) => {
      if (row.querySelector('[data-debt-invoice-no]')) return;
      const invoiceCell = Array.from(row.querySelectorAll('td'))
        .find((cell) => /GC-[A-Z0-9]+/i.test(normalizeDigits(cell.textContent)));
      if (!invoiceCell) return;

      const match = normalizeDigits(invoiceCell.textContent).match(/GC-[A-Z0-9]+/i);
      const invoiceNo = match?.[0];
      if (!invoiceNo) return;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'gazi-debt-invoice-button';
      button.setAttribute('data-debt-invoice-no', invoiceNo);
      button.innerHTML = '<span>عرض المشتريات</span>';
      button.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        try {
          await readInvoiceData();
          const sale = state.sales.find(
            (entry) => String(entry.invoiceNo).toUpperCase() === invoiceNo.toUpperCase(),
          );
          if (!sale) {
            alert('تعذر العثور على بيانات هذه الفاتورة في هذا الجهاز.');
            return;
          }
          openDetails(sale);
        } catch (error) {
          alert(error instanceof Error ? error.message : 'تعذر قراءة تفاصيل الفاتورة.');
        }
      });
      invoiceCell.appendChild(button);
    });
  }

  function installEnhancements() {
    installHistoryButton();
    installReportInvoiceLinks();
    installDebtInvoiceLinks();
  }

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (document.getElementById(DETAILS_ID)) {
      closeModal(DETAILS_ID);
    } else {
      closeModal(MODAL_ID);
    }
  });

  const observer = new MutationObserver(installEnhancements);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installEnhancements, { once: true });
  } else {
    installEnhancements();
  }
})();
