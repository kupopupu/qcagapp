(function () {
  function byId(id) { return document.getElementById(id); }

  function openBangtinhModal() {
    const modal = byId('bangtinh-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    try { if (typeof ensureScrollLock === 'function') ensureScrollLock(); } catch (_) {}
    try { if (window.QCAG_Shipping && typeof window.QCAG_Shipping.render === 'function') window.QCAG_Shipping.render(); } catch (_) {}
  }

  function closeBangtinhModal() {
    const modal = byId('bangtinh-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    try { if (typeof ensureScrollLock === 'function') ensureScrollLock(); } catch (_) {}
  }

  function bindOnce() {
    const openBtn = byId('bangtinh-btn');
    if (openBtn && !openBtn._bound) {
      openBtn._bound = true;
      openBtn.addEventListener('click', openBangtinhModal);
    }
    const closeBtn = byId('close-bangtinh-modal');
    if (closeBtn && !closeBtn._bound) {
      closeBtn._bound = true;
      closeBtn.addEventListener('click', closeBangtinhModal);
    }
  }

  window.openBangtinhModal = openBangtinhModal;
  window.closeBangtinhModal = closeBangtinhModal;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindOnce, { once: true });
  } else {
    bindOnce();
  }
})();

// Shipping calculation module
(function() {
  function byId(id) { return document.getElementById(id); }
  function parseNumber(v) {
    if (v == null) return 0;
    try {
      // Remove any non-digit characters (commas, dots, currency marks)
      const s = String(v).replace(/[^0-9\-]/g, '');
      return s ? parseInt(s, 10) : 0;
    } catch (e) { return 0; }
  }

  function fmt(v) {
    try { return new Intl.NumberFormat('vi-VN').format(Math.round(v)); } catch (e) { return String(v); }
  }

  // Default cycle of length 10: position 1=100%, 2=50%, 3..10=30%
  const defaultWeights = [1, 0.5, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3];

  function findShippingInItems(items) {
    if (!Array.isArray(items)) return { go: 0, back: 0, has: false };
    let go = 0, back = 0;
    items.forEach(it => {
      try {
        const c = String(it.content || it.content || '').toLowerCase();
        const p = it.price != null ? it.price : it.total || '';
        if (!p) return;
        const n = parseNumber(p);
        if (c.includes('vận chuyển') && c.includes('lượt đi')) go = Math.max(go, n);
        else if (c.includes('vận chuyển') && c.includes('lượt về')) back = Math.max(back, n);
        else if (c.includes('phí vận chuyển') && c.includes('lượt đi')) go = Math.max(go, n);
        else if (c.includes('phí vận chuyển') && c.includes('lượt về')) back = Math.max(back, n);
        else if (c.includes('chi phí vận chuyển') && c.includes('lượt đi')) go = Math.max(go, n);
        else if (c.includes('chi phí vận chuyển') && c.includes('lượt về')) back = Math.max(back, n);
      } catch (e) {}
    });
    return { go, back, has: !!(go || back) };
  }

  function buildShippingUI(groups) {
    const modalBody = byId('bangtinh-modal')?.querySelector('.modal-body');
    if (!modalBody) return;
    if (!groups || !Object.keys(groups).length) {
      modalBody.innerHTML = '<div class="text-center text-gray-500 py-20 text-lg">Chưa có dữ liệu vận chuyển.</div>';
      return;
    }

    // Build tabs for sales on left and details on right
    const saleKeys = Object.keys(groups);
    const left = [];
    const right = [];

    saleKeys.forEach((saleKey, idx) => {
      const active = idx === 0 ? 'bg-white shadow text-gray-900' : 'text-gray-600';
      left.push(`<button data-sale-key="${encodeURIComponent(saleKey)}" class="w-full text-left px-3 py-2 ${active} hover:bg-white border-b">${escapeHtml(saleKey)} <span class="text-xs text-gray-500 ml-2">(${groups[saleKey].length})</span></button>`);
      // build right panel
      const rows = [];
      let totalGo = 0, totalBack = 0;
      groups[saleKey].forEach((q, i) => {
        const baseGo = q.shippingBaseGo || 0;
        const baseBack = q.shippingBaseBack || 0;
        const w = defaultWeights[i % defaultWeights.length] || 0;
        const appliedGo = Math.round(baseGo * w);
        const appliedBack = Math.round(baseBack * w);
        totalGo += appliedGo;
        totalBack += appliedBack;
        rows.push(`
          <tr class="hover:bg-gray-50">
            <td class="px-4 py-3 text-sm">${i+1}</td>
            <td class="px-4 py-3 text-sm font-semibold">${escapeHtml(q.quote_code || q.quoteCode || q.spo_number || '-')}</td>
            <td class="px-4 py-3 text-sm">${escapeHtml(q.outlet_name || q.outletName || q.outlet_code || '')}</td>
            <td class="px-4 py-3 text-sm text-right">${fmt(baseGo)}</td>
            <td class="px-4 py-3 text-sm text-right">${fmt(baseBack)}</td>
            <td class="px-4 py-3 text-sm text-right">${Math.round(w*100)}%</td>
            <td class="px-4 py-3 text-sm text-right">${fmt(appliedGo)}</td>
            <td class="px-4 py-3 text-sm text-right">${fmt(appliedBack)}</td>
          </tr>
        `);
      });

      right.push(`
        <div data-sale-panel="${encodeURIComponent(saleKey)}" class="p-4 ${idx===0? '':'hidden'}">
          <h4 class="text-lg font-semibold mb-4">${escapeHtml(saleKey)} — Tổng: <span class="font-bold text-blue-600">${fmt(totalGo + totalBack)}</span></h4>
          <div class="overflow-x-auto border border-gray-200 rounded-lg">
            <table class="min-w-full text-sm">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-4 py-2 text-left">#</th>
                  <th class="px-4 py-2 text-left">Mã BG / SPO</th>
                  <th class="px-4 py-2 text-left">Outlet</th>
                  <th class="px-4 py-2 text-right">Base đi</th>
                  <th class="px-4 py-2 text-right">Base về</th>
                  <th class="px-4 py-2 text-right">Tỷ lệ</th>
                  <th class="px-4 py-2 text-right">Áp dụng đi</th>
                  <th class="px-4 py-2 text-right">Áp dụng về</th>
                </tr>
              </thead>
              <tbody>
                ${rows.join('')}
              </tbody>
            </table>
          </div>
        </div>
      `);
    });

    modalBody.innerHTML = `
      <div class="grid grid-cols-4 gap-4">
        <div class="col-span-1 border-r border-gray-100 pr-2">
          <div class="space-y-1">${left.join('')}</div>
        </div>
        <div class="col-span-3">${right.join('')}</div>
      </div>
    `;

    // attach sale tab handlers
    modalBody.querySelectorAll('[data-sale-key]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const key = decodeURIComponent(btn.dataset.saleKey || '');
        modalBody.querySelectorAll('[data-sale-panel]').forEach(p => {
          if (decodeURIComponent(p.dataset.salePanel) === key) p.classList.remove('hidden'); else p.classList.add('hidden');
        });
        modalBody.querySelectorAll('[data-sale-key]').forEach(b => b.classList.remove('bg-white','shadow','text-gray-900'));
        btn.classList.add('bg-white','shadow','text-gray-900');
      });
    });
  }

  function escapeHtml(text) {
    const d = document.createElement('div'); d.textContent = text || ''; return d.innerHTML;
  }

  // Main render: group quotes by sale and compute shipping
  function renderShipping() {
    if (typeof currentQuotes === 'undefined' || !Array.isArray(currentQuotes)) {
      const modalBody = byId('bangtinh-modal')?.querySelector('.modal-body');
      if (modalBody) modalBody.innerHTML = '<div class="text-center text-gray-500 py-20 text-lg">Chưa có dữ liệu báo giá.</div>';
      return;
    }

    // collect quotes that contain shipping items
    const groups = {};
    currentQuotes.forEach(q => {
      try {
        const items = Array.isArray(q.items) ? q.items : JSON.parse(q.items || '[]');
        const sh = findShippingInItems(items);
        if (!sh.has) return;
        const saleName = (q.sale_type === 'TBA' ? 'TBA' : 'Sale') + ' - ' + (q.sale_name || 'Không có tên');
        if (!groups[saleName]) groups[saleName] = [];
        groups[saleName].push(Object.assign({}, q, { shippingBaseGo: sh.go, shippingBaseBack: sh.back }));
      } catch (e) { /* ignore parse errors */ }
    });

    // Sort each group's quotes by created_at
    Object.keys(groups).forEach(k => {
      groups[k].sort((a,b) => {
        try { return new Date(a.created_at || 0) - new Date(b.created_at || 0); } catch (e) { return 0; }
      });
    });

    buildShippingUI(groups);
  }

  // expose global
  window.QCAG_Shipping = {
    render: renderShipping
  };

})();
