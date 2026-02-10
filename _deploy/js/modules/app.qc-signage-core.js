    // ===== QC BẢNG HIỆU =====
    const QC_SIGNAGE_ITEM_CODES = new Set(['2.1', '1.1', '1.2', '9.3', '9.2']);
    const QC_SIGNAGE_LOGO_REGEX = /logo/i;

    const qcSignageUiState = {
      activeTab: 'todo',
      searchTerm: '',
      selection: new Set(),
      itemsByKey: new Map(),
      pageSize: 15,
      pageByTab: { todo: 1, list: 1, waiting: 1, pass: 1 },
      searchOrderOnly: false, // Toggle: chỉ tìm theo số đơn hàng
      reasonModal: {
        pendingAction: null,
        pendingKey: null
      },
      returnConfirm: {
        pendingKey: null,
        pendingOutlet: ''
      }
    };
    if (typeof window !== 'undefined') window.qcSignageUiState = qcSignageUiState;
    let qcSignageHandlersBound = false;

    function getProductionOrderKey(order) {
      if (!order) return '';
      // Prefer stable backend identifiers when available
      if (order.__backendId) return String(order.__backendId);
      if (order.id) return String(order.id);
      // Prefer SPO / production order number if present and not a transient placeholder
      try {
        const spo = order.spo_number && String(order.spo_number).trim();
        if (spo && !/^production_\d+/i.test(spo) && spo !== 'Chưa nhập số đơn hàng') return String(spo);
      } catch (e) { /* ignore */ }
      if (order.outlet_code) return String(order.outlet_code);
      return '';
    }

    function escapeQcHtml(value) {
      if (value === undefined || value === null) return '';
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function ensureQcSignageModalElement() {
      let modal = document.getElementById('qc-signage-modal');
      if (modal) return modal;
      modal = document.createElement('div');
      modal.id = 'qc-signage-modal';
      modal.className = 'hidden fixed inset-0 z-50 modal-backdrop';
      modal.innerHTML = `
        <div class="flex items-center justify-center min-h-full p-4">
          <div class="bg-white rounded-lg shadow-xl w-full max-w-[120rem] modal-content flex flex-col" style="display:flex;flex-direction:column;max-height:90vh;min-width:1200px;">
            <div class="modal-header">
              <div class="flex items-center justify-between mb-4">
                <h3 class="text-2xl font-bold text-gray-800">QC Bảng Hiệu</h3>
                <button id="close-qc-signage-modal" class="text-gray-400 hover:text-gray-600 text-2xl">×</button>
              </div>
              <div class="flex flex-wrap items-center gap-3">
                <div class="relative flex-1 min-w-[260px]">
                  <input id="qc-search-input" type="text" placeholder="Tìm theo Mã đơn hàng, SPO, Outlet..." class="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm">
                  <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <svg class="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                  </div>
                </div>
                <div class="flex items-center bg-gray-100 rounded-lg p-1 text-sm">
                  <button data-qc-tab="todo" class="px-3 py-1 rounded-md bg-white shadow text-gray-800">Chưa QC <span class="qc-tab-count ml-1 text-xs text-gray-500">0</span></button>
                  <button data-qc-tab="waiting" class="px-3 py-1 rounded-md text-gray-600 hover:text-gray-800">Chờ QC <span class="qc-tab-count ml-1 text-xs text-gray-500">0</span></button>
                  <button data-qc-tab="pass" class="px-3 py-1 rounded-md text-gray-600 hover:text-gray-800">Pass QC <span class="qc-tab-count ml-1 text-xs text-gray-500">0</span></button>
                </div>
              </div>
            </div>
            <div class="modal-body flex-1 overflow-y-auto" style="flex:1;overflow-y:auto;">
              <div id="qc-tab-panel-todo" class="space-y-3"></div>
              <div id="qc-tab-panel-waiting" class="space-y-3 hidden"></div>
              <div id="qc-tab-panel-pass" class="space-y-3 hidden"></div>
            </div>
            <div class="qc-modal-footer sticky bottom-0 bg-white border-t border-gray-200 px-6 py-3 z-10 flex items-center justify-between gap-4" style="position:sticky;bottom:0;">
              <span id="qc-selection-count" class="text-sm">Chưa chọn hạng mục nào</span>
              <div id="qc-pagination" class="flex items-center gap-2 min-w-[320px] justify-center">
                <button type="button" id="qc-page-prev" class="w-8 h-8 rounded border border-gray-300 text-gray-700 hover:bg-gray-50" aria-label="Trang trước">‹</button>
                <span id="qc-page-info" class="text-xs text-gray-600 whitespace-nowrap">Trang 1 / 1 (0)</span>
                <button type="button" id="qc-page-next" class="w-8 h-8 rounded border border-gray-300 text-gray-700 hover:bg-gray-50" aria-label="Trang sau">›</button>
                <div class="flex items-center gap-2 ml-2">
                  <span class="text-xs text-gray-500">Hiển thị</span>
                  <select id="qc-page-size" class="border border-gray-300 rounded px-2 py-1 text-xs">
                    <option value="10">10</option>
                    <option value="15" selected>15</option>
                    <option value="20">20</option>
                    <option value="50">50</option>
                    <option value="100">100</option>
                  </select>
                </div>
              </div>
              <div class="flex gap-3">
                <button type="button" id="qc-unselect-btn" class="px-5 py-2 bg-gray-300 hover:bg-gray-400 text-gray-800 rounded font-semibold">Bỏ chọn</button>
                <button type="button" id="qc-register-btn" class="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-semibold">Đăng ký QC</button>
              </div>
            </div>
          </div>
        </div>`;
      document.body.appendChild(modal);
      return modal;
    }

    function ensureQcReasonModalElement() {
      return document.getElementById('qc-reason-modal');
    }

    function parseQcSignageState(order) {
      if (!order) return { items: {} };
      const raw = order.qc_signage_state;
      if (typeof raw === 'string' && raw.trim()) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            const items = parsed.items && typeof parsed.items === 'object' ? parsed.items : {};
            return { items };
          }
        } catch (_) {}
      }
      return { items: {} };
    }

    async function persistQcSignageState(orderKey, state) {
      if (!orderKey) return null;
      const idx = productionOrders.findIndex(o => getProductionOrderKey(o) === orderKey);
      if (idx < 0) return null;
      const order = productionOrders[idx];
      const prepared = {
        items: state && typeof state === 'object' && state.items && typeof state.items === 'object'
          ? state.items
          : {}
      };
      const updated = { ...order, qc_signage_state: JSON.stringify(prepared) };
      productionOrders[idx] = updated;
      if (window.dataSdk && typeof window.dataSdk.update === 'function') {
        try {
          await window.dataSdk.update(updated);
        } catch (err) {
          console.warn('Không thể lưu trạng thái QC bảng hiệu:', err);
        }
      }
      return updated;
    }

    function buildQcSignageItemKey(orderKey, quote, itemIndex, quoteIndex = 0) {
      const safeOrder = orderKey || 'order';
      const safeOutlet = quote && quote.outlet_code ? String(quote.outlet_code) : '';
      const safeSpo = quote && quote.spo_number ? String(quote.spo_number) : '';
      const safeSale = quote && quote.sale_name ? String(quote.sale_name) : '';
      const mid = safeOutlet || safeSpo || safeSale || (`point_${quoteIndex}`);
      return [
        safeOrder,
        mid,
        itemIndex,
        quoteIndex
      ].join('__').replace(/\s+/g, '_');
    }

    function qualifiesQcSignageItem(item = {}) {
      const brand = String(item.brand || '').trim().toLowerCase();
      const contentText = String(item.content || '').toLowerCase();
      if (brand === 'shopname' || contentText.includes('shopname')) {
        return false;
      }
      const code = String(item.code || '').trim();
      if (QC_SIGNAGE_ITEM_CODES.has(code)) return true;
      return QC_SIGNAGE_LOGO_REGEX.test(contentText);
    }

    function formatQcSignageTypeLabel(code, content) {
      const map = {
        '2.1': 'Bảng hiệu hiflex - 1 mặt',
        '1.1': 'Hộp đèn hiflex - 1 mặt',
        '1.2': 'Hộp đèn hiflex - 2 mặt',
        '9.3': 'Thay bạt hộp đèn hiflex',
        '9.2': 'Thay bạt bảng hiệu hiflex'
      };
      const trimmed = String(code || '').trim();
      if (map[trimmed]) return map[trimmed];
      if (QC_SIGNAGE_LOGO_REGEX.test(String(content || ''))) return 'Logo';
      return trimmed || 'Khác';
    }

    function sanitizeQcSelection(rows) {
      const active = qcSignageUiState.activeTab || 'todo';
      const valid = new Set(rows.filter(row => row.status === active && !row.disabled).map(row => row.key));
      Array.from(qcSignageUiState.selection).forEach(key => {
        if (!valid.has(key)) {
          qcSignageUiState.selection.delete(key);
        }
      });
    }

    function collectQcSignageRows() {
      const rows = [];
      const term = qcSignageUiState.searchTerm.toLowerCase();
      for (const order of productionOrders) {
        const orderKey = getProductionOrderKey(order);
        if (!orderKey) continue;
        const isConfirmedOrder = !!(order && (order.is_confirmed || order.last_confirmed_at));
        if (!isConfirmedOrder) continue;
        // Use SPO number if present; treat transient production IDs as unconfirmed so UI shows a dash until SPO is provided
        let orderNumberRaw = (order && order.spo_number && String(order.spo_number).trim() && String(order.spo_number).trim() !== 'Chưa nhập số đơn hàng') ? String(order.spo_number).trim() : '';
        if (/^production_\d+/.test(orderNumberRaw)) orderNumberRaw = '';
        const contractor = (order?.address && order.address !== 'Chưa nhập đơn vị thi công')
          ? order.address
          : 'Chưa nhập đơn vị thi công';
        const qcState = parseQcSignageState(order);
        let quotes = [];
        try {
          quotes = JSON.parse(order.items || '[]');
        } catch (_) {
          quotes = [];
        }
        quotes.forEach((quote, quoteIndex) => {
          let items = [];
          try {
            items = JSON.parse(quote.items || '[]');
          } catch (_) {
            items = [];
          }
          items.forEach((item, itemIndex) => {
            if (!qualifiesQcSignageItem(item)) return;
            const key = buildQcSignageItemKey(orderKey, quote, itemIndex, quoteIndex);
            const stored = qcState.items[key] || {};
            const status = stored.status || 'todo';
            let quoteCodeForSearch = '';
            try {
              quoteCodeForSearch = String(quote?.quote_code || '').trim();
              if (!quoteCodeForSearch && Array.isArray(currentQuotes)) {
                const match = currentQuotes.find(q => (
                  q && (
                    (quote?.outlet_code && String(q.outlet_code) === String(quote?.outlet_code)) ||
                    (!quote?.outlet_code && quote?.spo_number && String(q.spo_number) === String(quote?.spo_number))
                  )
                ));
                if (match && match.quote_code) quoteCodeForSearch = String(match.quote_code);
              }
              if (!quoteCodeForSearch && typeof formatQuoteCode === 'function') {
                const formatted = formatQuoteCode(quote);
                if (formatted) quoteCodeForSearch = String(formatted);
              }
            } catch (e) {
              quoteCodeForSearch = String(quote?.quote_code || '');
            }

            const section = [
              orderNumberRaw,
              quoteCodeForSearch,
              quote?.spo_number || '',
              quote?.outlet_code || '',
              quote?.outlet_name || ''
            ].join(' ').toLowerCase();
            // Apply search filter - if searchOrderOnly is true, only match orderNumber
            if (term) {
              if (qcSignageUiState.searchOrderOnly) {
                // Only match order number
                if (!String(orderNumberRaw || '').toLowerCase().includes(term)) return;
              } else {
                // Match any field
                if (!section.includes(term)) return;
              }
            }
            let matchedQuote = null;
            if (Array.isArray(currentQuotes)) {
              const refCode = (quote?.quote_code || '').toString().trim();
              const refSpo = (quote?.spo_number || '').toString().trim();
              const refOutlet = (quote?.outlet_code || '').toString().trim();
              // Collect all possible matches instead of taking the first — then prefer non-cancelled or newest
              const matches = currentQuotes.filter(q => {
                try {
                  const qCode = ((q == null ? void 0 : q.quote_code) || '').toString().trim();
                  if (refCode && qCode && qCode === refCode) return true;
                  const qSpo = ((q == null ? void 0 : q.spo_number) || '').toString().trim();
                  const qOutlet = ((q == null ? void 0 : q.outlet_code) || '').toString().trim();
                  if (refSpo && qSpo && refOutlet && qOutlet) return qSpo === refSpo && qOutlet === refOutlet;
                } catch (e) { /* ignore */ }
                return false;
              });
              if (matches.length === 1) matchedQuote = matches[0];
              else if (matches.length > 1) {
                // Prefer a match that is not marked as canceled
                const nonCancelled = matches.find(m => {
                  try { const st = String((m == null ? void 0 : m.qcag_status) || '').toLowerCase(); return !st.includes('hủy') && !st.includes('huy'); } catch (e) { return true; }
                });
                if (nonCancelled) matchedQuote = nonCancelled;
                else {
                  // Fallback: take the most recently created
                  matches.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
                  matchedQuote = matches[0];
                }
              }
            }
            const matchedStatus = matchedQuote ? String((matchedQuote == null ? void 0 : matchedQuote.qcag_status) || '').toLowerCase() : '';
            const quoteOrderNumber = matchedQuote ? String((matchedQuote == null ? void 0 : matchedQuote.qcag_order_number) || '').trim() : '';
            const rowOrderNumber = String(orderNumberRaw || '').trim();
            const isCancelled = matchedStatus.includes('hủy');
            const isAwaitingNewOrder = matchedStatus.includes('chờ tạo đơn');
            const isHistoricalOrder = !!(quoteOrderNumber && rowOrderNumber && quoteOrderNumber !== rowOrderNumber);
            const shouldDisable = isCancelled || isAwaitingNewOrder || isHistoricalOrder;
            // Prefer live brand from `currentQuotes` when available (reflect edits made on main list)
            try {
              if (matchedQuote) {
                try {
                  const mqItems = Array.isArray(matchedQuote.items) ? matchedQuote.items : JSON.parse(matchedQuote.items || '[]');
                  if (Array.isArray(mqItems) && mqItems.length) {
                    const codeToMatch = String(item.code || '').trim();
                    const contentToMatch = String(item.content || '').trim().toLowerCase();
                    const found = mqItems.find(mi => {
                      try {
                        if (mi && mi.code && String(mi.code).trim() && codeToMatch && String(mi.code).trim() === codeToMatch) return true;
                        const mic = String(mi.content || '').trim().toLowerCase();
                        if (mic && contentToMatch && mic === contentToMatch) return true;
                        return false;
                      } catch (e) { return false; }
                    });
                    if (found && found.brand) {
                      item.brand = found.brand;
                    }
                  }
                } catch (e) { /* ignore parse errors */ }
              }
            } catch (e) { /* ignore */ }

            rows.push({
              key,
              orderKey,
              orderNumber: orderNumberRaw,
              contractor,
              status,
              lastResult: stored.lastResult || null,
              lastReason: stored.lastReason || '',
              lastReasonAt: stored.lastReasonAt || null,
              updatedAt: stored.updatedAt || null,
              itemIndex,
              quoteRef: {
                spoNumber: quote?.spo_number || '',
                quoteCode: quoteCodeForSearch || '',
                outletCode: quote?.outlet_code || '',
                outletName: quote?.outlet_name || '',
                saleName: quote?.sale_name || '',
                area: quote?.area || '',
                pointOrderNumber: quote?.point_order_number || '',
                province: quote?.province || '',
                district: quote?.district || '',
                ward: quote?.ward || '',
                street: quote?.street || '',
                house_number: quote?.house_number || ''
              },

              item: {
                code: item?.code || '',
                content: item?.content || '',
                brand: item?.brand || '',
                width: item?.width || '',
                height: item?.height || '',
                unit: item?.unit || '',
                quantity: item?.quantity || ''
              },
              typeLabel: formatQcSignageTypeLabel(item?.code, item?.content),
              disabled: shouldDisable
            });
            // Always sync SPO and address from currentQuotes (main list is authoritative source)
            try {
              const last = rows[rows.length - 1];
              if (last && last.quoteRef && Array.isArray(currentQuotes)) {
                const qRef = last.quoteRef;
                // Try multiple ways to find the matching quote in currentQuotes
                let match = null;
                // 1. Try by quote_code (most reliable)
                if (quoteCodeForSearch) {
                  match = currentQuotes.find(q => q && String(q.quote_code || '').trim() === quoteCodeForSearch);
                }
                // 2. Try by outlet_code
                if (!match && quote?.outlet_code) {
                  match = currentQuotes.find(q => q && String(q.outlet_code || '') === String(quote.outlet_code));
                }
                // 3. Try by spo_number (if not empty)
                if (!match && quote?.spo_number && String(quote.spo_number).trim()) {
                  const quoteSpo = String(quote.spo_number).trim();
                  match = currentQuotes.find(q => q && String(q.spo_number || '').trim() === quoteSpo);
                }
                
                if (match) {
                  // ALWAYS sync SPO from currentQuotes (main list)
                  qRef.spoNumber = String(match.spo_number || '').trim();
                  // Sync outlet name
                  if (match.outlet_name) qRef.outletName = match.outlet_name;
                  // Sync address fields
                  if (match.province) qRef.province = match.province;
                  if (match.district) qRef.district = match.district;
                  if (match.ward) qRef.ward = match.ward;
                  if (match.street) qRef.street = match.street;
                  if (match.house_number) qRef.house_number = match.house_number;
                }
              }
            } catch (e) { /* ignore */ }
          });
        });
      }
      qcSignageUiState.itemsByKey = new Map(rows.map(row => [row.key, row]));
      sanitizeQcSelection(rows);
      return rows;
    }

    function buildQcSignageTabHtml(tab, rows) {
      if (!rows.length) {
        return '<div class="text-gray-500 text-center py-8">Không có hạng mục nào trong danh sách này.</div>';
      }
      const isTodoTab = tab === 'todo';
      const isListTab = tab === 'list';
      const showReason = tab === 'todo';
      const showActions = tab === 'waiting';
      const showResult = tab === 'pass';
      const headers = [];
      headers.push('<th class="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">STT</th>');
      headers.push('<th class="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Số đơn hàng</th>');
      headers.push('<th class="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Mã BG</th>');
      headers.push('<th class="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Số SPO</th>');
      headers.push('<th class="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Outlet Code</th>');
      headers.push('<th class="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Tên Outlet</th>');
      headers.push('<th class="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Ngang</th>');
      headers.push('<th class="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Cao</th>');
      headers.push('<th class="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Brand</th>');
      headers.push('<th class="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Loại bảng</th>');
      headers.push('<th class="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Đơn vị thi công</th>');
      if (showReason) headers.push('<th class="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Trạng thái QC</th>');
      if (showActions) headers.push('<th class="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Thao tác</th>');
      if (isListTab) headers.push('<th class="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Loại</th>');
      if (showResult) {
        headers.push('<th class="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Kết quả</th>');
        headers.push('<th class="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Thao tác</th>');
      }

      const rowsHtml = rows.map((row, index) => {
        const isSelected = qcSignageUiState.selection.has(row.key);
        const isDisabled = !!row.disabled;
        const statusHighlight = isTodoTab && !isSelected
          ? (row.lastResult === 'fail' ? 'bg-red-50' : row.lastResult === 'pending' ? 'bg-amber-50' : '')
          : '';
        const rowClasses = [
          isSelected ? 'bg-green-50' : statusHighlight,
          (isTodoTab || isListTab) ? 'qc-selectable-row' : '',
          isDisabled && isTodoTab ? 'opacity-60 cursor-not-allowed' : ''
        ].filter(Boolean).join(' ');
        // Attempt to locate an authoritative quotation record from currentQuotes
        let authoritativeQuote = null;
        try {
          if (row && row.quoteRef) {
            if (row.quoteRef.quoteCode) authoritativeQuote = findQuoteByIdentifier(row.quoteRef.quoteCode) || authoritativeQuote;
            if (!authoritativeQuote && row.quoteRef.spoNumber) authoritativeQuote = findQuoteByIdentifier(row.quoteRef.spoNumber) || authoritativeQuote;
            if (!authoritativeQuote && row.quoteRef.outletCode && Array.isArray(currentQuotes)) {
              authoritativeQuote = currentQuotes.find(q => String(q.outlet_code) === String(row.quoteRef.outletCode)) || authoritativeQuote;
            }
          }
        } catch (e) { /* ignore lookup errors */ }

        // Ưu tiên Mã BG từ chính quoteRef; fallback tìm trong currentQuotes/productionOrders
        let maBG = '';
        if (authoritativeQuote && authoritativeQuote.quote_code) maBG = String(authoritativeQuote.quote_code);
        else maBG = row.quoteRef && row.quoteRef.quoteCode ? String(row.quoteRef.quoteCode) : '';
        if (!maBG && row.quoteRef && row.quoteRef.outletCode) {
          let found = null;
          if (typeof currentQuotes !== 'undefined' && Array.isArray(currentQuotes)) {
            found = currentQuotes.find(q => String(q.outlet_code) === String(row.quoteRef.outletCode));
          }
          if (!found && typeof productionOrders !== 'undefined' && Array.isArray(productionOrders)) {
            for (const order of productionOrders) {
              let quotes = [];
              try { quotes = JSON.parse(order.items || '[]'); } catch (_) { quotes = []; }
              const match = quotes.find(q => String(q.outlet_code) === String(row.quoteRef.outletCode));
              if (match) { found = match; break; }
            }
          }
          if (found && found.quote_code) maBG = String(found.quote_code);
        }
        if (!maBG) maBG = '—';
        const maBgLabel = isDisabled && isTodoTab ? `${maBG} (Báo huỷ)` : maBG;
        const baseCells = `
          <td class="px-3 py-2 text-sm text-gray-700">${index + 1}</td>
          <td class="px-3 py-2 font-semibold text-gray-900">${row.orderNumber ? escapeQcHtml(row.orderNumber) : '—'}</td>
          <td class="px-3 py-2 text-sm text-gray-700">${escapeQcHtml(maBgLabel)}</td>
          <td class="px-3 py-2 text-sm text-gray-700">${row.quoteRef.spoNumber ? escapeQcHtml(row.quoteRef.spoNumber) : '—'}</td>
          <td class="px-3 py-2 text-sm text-gray-700">${(() => {
              const oc = authoritativeQuote ? (authoritativeQuote.outlet_code || authoritativeQuote.outletCode || '') : (row.quoteRef.outletCode || '');
              return oc ? escapeQcHtml(normalizeOutletCode(oc)) : '—';
            })()}</td>
          <td class="px-3 py-2 text-sm text-gray-900">${(() => {
              const on = authoritativeQuote ? (authoritativeQuote.outlet_name || authoritativeQuote.outletName || '') : (row.quoteRef.outletName || '');
              return on ? escapeQcHtml(on) : '—';
            })()}</td>
          <td class="px-3 py-2 text-sm text-gray-700">${row.item.width ? escapeQcHtml(row.item.width) : '—'}</td>
          <td class="px-3 py-2 text-sm text-gray-700">${row.item.height ? escapeQcHtml(row.item.height) : '—'}</td>
          <td class="px-3 py-2 text-sm text-gray-700">${row.item.brand ? escapeQcHtml(row.item.brand) : '—'}</td>
          <td class="px-3 py-2 text-sm text-gray-900">${escapeQcHtml(row.typeLabel)}</td>
          <td class="px-3 py-2 text-sm text-gray-700">${row.contractor ? escapeQcHtml(row.contractor) : '—'}</td>
        `;
        const reasonCell = showReason
          ? (() => {
              let html = '';
              if (isDisabled) {
                html = '<span class="text-xs text-red-600 font-semibold">Đã báo huỷ - không thể đăng ký</span>';
              } else if (!row.lastResult) {
                html = '<span class="text-xs text-gray-400">Chưa đăng ký QC</span>';
              } else if (row.lastResult === 'pending' || row.lastResult === 'fail') {
                const color = row.lastResult === 'fail' ? 'border border-red-400 text-red-700 bg-red-50' : 'border border-amber-400 text-amber-700 bg-amber-50';
                const text = row.lastResult === 'fail' ? 'Fail' : 'Pending';
                html = `<button type="button" class="px-6 py-1 min-w-[100px] rounded ${color} font-semibold focus:outline-none" data-qc-reason="${escapeQcHtml(row.key)}">${text}</button>`;
              } else {
                html = '<span class="text-xs text-green-600">Pass</span>';
              }
              return `<td class="px-3 py-2 text-sm">${html}</td>`;
            })()
          : '';
        const actionsCell = showActions
          ? `<td class="px-3 py-2"><div class="flex flex-wrap gap-2"><button type="button" class="px-3 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded" data-qc-action="pass" data-qc-key="${escapeQcHtml(row.key)}">Pass</button><button type="button" class="px-3 py-1 text-xs bg-amber-500 hover:bg-amber-600 text-white rounded" data-qc-action="pending" data-qc-key="${escapeQcHtml(row.key)}">Pending</button><button type="button" class="px-3 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded" data-qc-action="fail" data-qc-key="${escapeQcHtml(row.key)}">Fail</button></div></td>`
          : '';
        const removeCell = isListTab
          ? `<td class="px-3 py-2"><button type="button" class="px-2 py-1 text-xs bg-red-100 text-red-700 rounded" data-qc-action="remove" data-qc-key="${escapeQcHtml(row.key)}" aria-label="Loại bỏ khỏi danh sách">✕</button></td>`
          : '';
        const resultCell = showResult
          ? `<td class="px-3 py-2 text-sm text-green-600 font-semibold whitespace-nowrap min-w-[220px]">Pass${row.updatedAt ? ` • ${new Date(row.updatedAt).toLocaleString('vi-VN')}` : ''}</td>`
          : '';
        const returnCell = showResult
          ? `<td class="px-3 py-2 text-right"><button type="button" class="px-3 py-1 text-xs rounded text-black border border-gray-300 bg-gray-100" data-qc-action="return" data-qc-key="${escapeQcHtml(row.key)}">Trả về</button></td>`
          : '';
        return `<tr class="${rowClasses}" data-qc-row="true" data-qc-key="${escapeQcHtml(row.key)}" data-qc-disabled="${isDisabled && isTodoTab ? 'true' : 'false'}">${baseCells}${reasonCell}${actionsCell}${removeCell}${resultCell}${returnCell}</tr>`;
      }).join('');

      const table = `
        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-200 text-sm">
            <thead class="bg-gray-50">
              <tr>${headers.join('')}</tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      `;

      const footer = '';

      return table + footer;
    }

    function updateQcTabButtons(counts) {
      const tabs = document.querySelectorAll('[data-qc-tab]');
      tabs.forEach(btn => {
        const tab = btn.dataset.qcTab;
        const count = counts[tab] || 0;
        const countEl = btn.querySelector('.qc-tab-count');
        if (countEl) countEl.textContent = count;
        if (tab === qcSignageUiState.activeTab) {
          btn.classList.add('bg-white', 'shadow', 'text-gray-800');
          btn.classList.remove('text-gray-600');
          btn.setAttribute('aria-selected', 'true');
        } else {
          btn.classList.remove('bg-white', 'shadow', 'text-gray-800');
          btn.classList.add('text-gray-600');
          btn.setAttribute('aria-selected', 'false');
        }
      });
    }

    function updateQcSelectionSummary() {
      const count = qcSignageUiState.selection.size;
      // Update selection count in footer
      const summary = document.getElementById('qc-selection-count');
      if (summary) {
        summary.textContent = count ? `${count} hạng mục được chọn` : 'Chưa chọn hạng mục nào';
      }
      // Update footer buttons disabled state
      const qcUnselectBtn = document.getElementById('qc-unselect-btn');
      if (qcUnselectBtn) qcUnselectBtn.disabled = count === 0;
      const qcRegisterBtn = document.getElementById('qc-register-btn');
      if (qcRegisterBtn && !qcRegisterBtn.classList.contains('hidden')) qcRegisterBtn.disabled = count === 0;
      const qcListRegisterBtn = document.getElementById('qc-list-register-btn');
      if (qcListRegisterBtn && !qcListRegisterBtn.classList.contains('hidden')) {
        // Enable Đăng ký QC in Danh sách if there are any rows in the list, even when none selected
        const listPanel = document.getElementById('qc-tab-panel-list');
        const listRowsCount = listPanel ? listPanel.querySelectorAll('tr[data-qc-row="true"]').length : 0;
        qcListRegisterBtn.disabled = listRowsCount === 0;
      }
      const qcExportBtn = document.getElementById('qc-export-btn');
      if (qcExportBtn && !qcExportBtn.classList.contains('hidden')) {
        if (qcSignageUiState.activeTab === 'list') {
          const listPanel = document.getElementById('qc-tab-panel-list');
          const listRowsCount = listPanel ? listPanel.querySelectorAll('tr[data-qc-row="true"]').length : 0;
          qcExportBtn.disabled = listRowsCount === 0;
        } else {
          qcExportBtn.disabled = count === 0;
        }
      }
    }

    async function moveSelectedQcItemsToWaiting() {
      // legacy: move selected todo items to waiting (keeps old behavior)
      const keys = Array.from(qcSignageUiState.selection).filter(key => {
        const row = qcSignageUiState.itemsByKey.get(key);
        return row && row.status === 'todo';
      });
      if (!keys.length) {
        if (typeof showToast === 'function') showToast('Vui lòng chọn hạng mục cần chuyển.');
        renderQcSignageModal();
        return;
      }
      // FIX: Use batch update instead of sequential await for better performance
      await batchUpdateQcSignageStatus(keys, 'waiting', { lastResult: null, lastReason: '' });
      qcSignageUiState.selection.clear();
      if (typeof showToast === 'function') showToast(`Đã chuyển ${keys.length} hạng mục sang chờ QC.`);
      renderQcSignageModal();
    }

    async function moveSelectedQcItemsToList() {
      try { console.log('DEBUG: moveSelectedQcItemsToList selection ->', Array.from(qcSignageUiState.selection)); } catch(e) {}
      const keys = Array.from(qcSignageUiState.selection).filter(key => {
        const row = qcSignageUiState.itemsByKey.get(key);
        return row && row.status === 'todo';
      });
      if (!keys.length) {
        if (typeof showToast === 'function') showToast('Vui lòng chọn hạng mục cần thêm vào danh sách.');
        renderQcSignageModal();
        return;
      }
      // FIX: Use batch update instead of sequential await for better performance
      await batchUpdateQcSignageStatus(keys, 'list', { lastResult: null, lastReason: '' });
      qcSignageUiState.selection.clear();
      if (typeof showToast === 'function') showToast(`Đã thêm ${keys.length} hạng mục vào Danh sách QC.`);
      renderQcSignageModal();
    }

    // Move list-selected items to waiting. If `keys` provided, operate on those keys. If no keys and selection empty, fallback to ALL list items.
    async function moveListSelectedToWaiting(keys) {
      let targetKeys = Array.isArray(keys) ? keys.slice() : Array.from(qcSignageUiState.selection).filter(key => {
        const row = qcSignageUiState.itemsByKey.get(key);
        return row && row.status === 'list';
      });
      if (!targetKeys.length) {
        // Fallback: take all items in list
        targetKeys = [];
        qcSignageUiState.itemsByKey.forEach((row, key) => {
          if (row && row.status === 'list') targetKeys.push(key);
        });
      }
      if (!targetKeys.length) {
        if (typeof showToast === 'function') showToast('Không có hạng mục nào trong Danh sách QC để đăng ký.');
        renderQcSignageModal();
        return;
      }
      // FIX: Use batch update instead of sequential await for better performance
      await batchUpdateQcSignageStatus(targetKeys, 'waiting', { lastResult: null, lastReason: '' });
      // Clear selection of those keys
      targetKeys.forEach(k => qcSignageUiState.selection.delete(k));
      if (typeof showToast === 'function') showToast(`Đã đăng ký ${targetKeys.length} hạng mục và chuyển sang Chờ QC.`);
      renderQcSignageModal();
    }

    // Pass all items currently in 'waiting' to 'pass'
    async function performPassAllWaiting() {
      const keys = [];
      qcSignageUiState.itemsByKey.forEach((row, key) => {
        if (row && row.status === 'waiting') keys.push(key);
      });
      if (!keys.length) {
        if (typeof showToast === 'function') showToast('Không có hạng mục nào trong Chờ QC để pass.');
        renderQcSignageModal();
        return;
      }
      // FIX: Use batch update instead of sequential await for better performance
      await batchUpdateQcSignageStatus(keys, 'pass', { lastResult: 'pass', lastReason: '' });
      if (typeof showToast === 'function') showToast(`Đã pass ${keys.length} hạng mục.`);
      renderQcSignageModal();
    }

    // ========== BATCH UPDATE QC SIGNAGE STATUS (PERFORMANCE FIX) ==========
    // This function updates multiple QC items in PARALLEL instead of sequential
    // which dramatically improves performance (100 items: 5 seconds vs 5+ minutes)
    async function batchUpdateQcSignageStatus(keys, status, options = {}) {
      if (!Array.isArray(keys) || keys.length === 0) return;
      
      // Group keys by orderKey for batch persistence
      const byOrderKey = new Map();
      const now = new Date().toISOString();
      
      for (const key of keys) {
        const row = qcSignageUiState.itemsByKey.get(key);
        if (!row) continue;
        
        if (!byOrderKey.has(row.orderKey)) {
          byOrderKey.set(row.orderKey, []);
        }
        byOrderKey.get(row.orderKey).push({ key, row });
      }
      
      // Process each order's items and persist once per order (not once per item!)
      const persistPromises = [];
      
      for (const [orderKey, items] of byOrderKey) {
        const idx = productionOrders.findIndex(o => getProductionOrderKey(o) === orderKey);
        if (idx < 0) continue;
        
        const order = productionOrders[idx];
        const state = parseQcSignageState(order);
        
        // Update all items for this order in memory
        for (const { key } of items) {
          const existing = state.items[key] || {};
          const next = {
            status,
            lastResult: options.lastResult !== undefined
              ? options.lastResult
              : (status === 'pass' ? 'pass' : status === 'waiting' ? null : existing.lastResult || null),
            lastReason: options.lastReason !== undefined
              ? options.lastReason
              : (status === 'pass' || status === 'waiting' ? '' : existing.lastReason || ''),
            lastReasonAt: options.lastReason
              ? now
              : (status === 'pass' || status === 'waiting' ? null : existing.lastReasonAt || null),
            updatedAt: now
          };
          state.items[key] = next;
        }
        
        // Single persist call for this order (instead of N persist calls)
        persistPromises.push(persistQcSignageState(orderKey, state));
      }
      
      // Wait for all persist operations in parallel
      await Promise.all(persistPromises);
    }

    async function setQcSignageItemStatus(key, status, options = {}) {
      if (!key) return;
      const row = qcSignageUiState.itemsByKey.get(key);
      if (!row) return;
      const idx = productionOrders.findIndex(o => getProductionOrderKey(o) === row.orderKey);
      if (idx < 0) return;
      const order = productionOrders[idx];
      const state = parseQcSignageState(order);
      const existing = state.items[key] || {};
      const now = new Date().toISOString();
      const next = {
        status,
        lastResult: options.lastResult !== undefined
          ? options.lastResult
          : (status === 'pass' ? 'pass' : status === 'waiting' ? null : existing.lastResult || null),
        lastReason: options.lastReason !== undefined
          ? options.lastReason
          : (status === 'pass' || status === 'waiting' ? '' : existing.lastReason || ''),
        lastReasonAt: options.lastReason
          ? now
          : (status === 'pass' || status === 'waiting' ? null : existing.lastReasonAt || null),
        updatedAt: now
      };
      state.items[key] = next;
      await persistQcSignageState(row.orderKey, state);
    }

    async function appendQcSignageNote(orderKey, text) {
      if (!orderKey || !text) return;
      const idx = productionOrders.findIndex(o => getProductionOrderKey(o) === orderKey);
      if (idx < 0) return;
      const order = productionOrders[idx];
      const notes = Array.isArray(order.notes) ? [...order.notes] : [];
      notes.push(ensureNoteHasAuthor({ text, at: new Date().toISOString() }));
      const updated = { ...order, notes };
      productionOrders[idx] = updated;
      if (window.dataSdk && typeof window.dataSdk.update === 'function') {
        try {
          await window.dataSdk.update(updated);
        } catch (err) {
          console.warn('Không thể lưu ghi chú QC:', err);
        }
      }
    }

    async function handleQcSignageAction(action, key) {
      if (!action || !key) return;
      if (action === 'pass') {
        await setQcSignageItemStatus(key, 'pass', { lastResult: 'pass', lastReason: '' });
        if (typeof showToast === 'function') showToast('Hạng mục đã pass QC.');
        renderQcSignageModal();
        return;
      }
      if (action === 'return') {
        openReturnConfirmModal(key);
        return;
      }
      if (action === 'pending' || action === 'fail') {
        openQcReasonModal(action, key);
      }
    }
