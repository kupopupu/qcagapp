
        // Migration function: Load all production orders into Xin Phép modal (runs once on data load)
        let __xinphepMigrationDone = false;
        function migrateProductionOrdersToXinphep(orders) {
          // Only run once per session
          if (__xinphepMigrationDone) return;
          if (!orders || !orders.length) return;
          
          try {
            const collected = [];
            const seenKeys = new Set();
            
            for (const ord of orders) {
              try {
                const quotes = JSON.parse(ord.items || '[]');
                if (!Array.isArray(quotes)) continue;
                
                for (const q of quotes) {
                  try {
                    const key = (typeof resolveQuoteKey === 'function' ? resolveQuoteKey(q) : null) || q.quote_code || q.quoteKey || q.quote_code || '';
                    if (!key) continue;
                    if (seenKeys.has(key + '::' + String(ord.__backendId || ord.id || ''))) continue;
                    seenKeys.add(key + '::' + String(ord.__backendId || ord.id || ''));
                    
                    // Build clean quote-like object for xinphep
                    let items = [];
                    try {
                      items = Array.isArray(q.items) ? q.items : JSON.parse(q.items || '[]');
                    } catch (e) { items = []; }
                    
                    const cleanItems = Array.isArray(items) ? items.map(it => ({
                      code: it.code || '',
                      content: it.content || '',
                      brand: it.brand || '',
                      width: it.width || '',
                      height: it.height || '',
                      quantity: it.quantity || '',
                      unit: it.unit || '',
                      price: it.price || '',
                      total: it.total || ''
                    })) : [];
                    
                    const clean = {
                      outlet_code: q.outlet_code || '',
                      outlet_name: q.outlet_name || '',
                      area: q.area || ord.area || '',
                      sale_type: q.sale_type || q.saleType || '',
                      sale_name: q.sale_name || q.saleName || '',
                      sale_phone: q.sale_phone || '',
                      outlet_phone: q.outlet_phone || '',
                      address: q.address || ord.address || '',
                      spo_number: q.spo_number || q.spoNumber || '',
                      items: JSON.stringify(cleanItems),
                      quote_code: q.quote_code || q.quoteCode || '',
                      quote_key: key,
                      quote_id: q.quote_id || q.quoteId || q.id || null,
                      images: q.images || '[]',
                      qcag_status: q.qcag_status || q.qcagStatus || '',
                      qcag_order_number: q.qcag_order_number || q.qcagOrderNumber || '',
                      originating_order_id: ord.__backendId || ord.id || null,
                      originating_order_spo: ord.spo_number || ord.order_number || ''
                    };
                    collected.push(clean);
                  } catch (e) { /* ignore per-quote errors */ }
                }
              } catch (e) { /* ignore per-order errors */ }
            }
            
            // Load into xinphep modal
            if (collected.length > 0 && typeof window.renderXinphepList === 'function') {
              window.renderXinphepList(collected);
              console.log(`[Migration] Loaded ${collected.length} quotes from ${orders.length} production orders into Xin Phép modal`);
            }
            
            __xinphepMigrationDone = true;
          } catch (e) {
            console.error('Migration error:', e);
          }
        }

        // Data Handler (restored)
        const dataHandler = {
          onDataChanged(data) {
            // Hide initial loading overlay when first data arrives
            try {
              if (window.__qcInitialLoadToken && window.QcLoading && typeof window.QcLoading.hide === 'function') {
                window.QcLoading.hide(window.__qcInitialLoadToken);
                window.__qcInitialLoadToken = null;
              }
            } catch (e) {}
            const quotes = data.filter(item => item.area !== 'PRODUCTION' && item.sale_name !== 'Đơn hàng sản xuất');
            const orders = data.filter(item => item.area === 'PRODUCTION' && item.sale_name === 'Đơn hàng sản xuất');
            ensureQuoteCodes(quotes);
            if (quotes.length > lastQuoteCount) {
              pendingJumpToFirstPage = true;
            }
            lastQuoteCount = quotes.length;
            // Ensure default SPO status: if no SPO -> 'Chưa có SPO', if SPO exists and no status -> 'Chưa cập nhật trạng thái'
            currentQuotes = quotes.map(q => {
              const hasSpo = q && q.spo_number && String(q.spo_number).trim();
              const existingStatus = (q && q.spo_status) || '';
              let status = existingStatus;
              if (!hasSpo) status = 'Chưa có SPO';
              else if (!existingStatus) status = 'Chưa cập nhật trạng thái';
              const normalizedOutletCode = normalizeOutletCode(q?.outlet_code);
              return { ...q, spo_status: status, outlet_code: normalizedOutletCode };
            });
            // Build client-side search index once per data change
            try { buildQuoteSearchIndex(); } catch (e) {}
            productionOrders = orders;
            
            // Auto-migrate all production orders to Xin Phép modal on first load
            try { migrateProductionOrdersToXinphep(orders); } catch (e) { console.warn('Migration to xinphep failed', e); }
            
            try { if (typeof __qcagMarkProductionOrdersDirty === 'function') __qcagMarkProductionOrdersDirty(); } catch (e) {}
            
            // Defer heavy UI updates to avoid blocking when receiving WebSocket updates from other clients
            // This allows machine B to continue working smoothly while machine A is saving
            const deferredRender = () => {
              try {
                // Re-render main list based on current view mode
                updateMainList();
                updateRecentQuotesPreview();
                if (!document.getElementById('manage-production-orders-modal').classList.contains('hidden')) {
                  renderProductionOrdersList(orders);
                }
                // If Acceptance modal is open, refresh its order list and image grid
                try {
                  var accModalEl = document.getElementById('acceptance-image-modal');
                  if (accModalEl && !accModalEl.classList.contains('hidden')) {
                    try { if (typeof window.__renderAcceptanceProductionOrders === 'function') window.__renderAcceptanceProductionOrders(); } catch (e) {}
                    try { renderAcceptanceImages(); } catch (e) {}
                  }
                } catch (e) {}
                // If QC Signage modal is open, re-render so outlet_code/outlet_name reflect currentQuotes
                try {
                  const qcModal = document.getElementById('qc-signage-modal');
                  if (qcModal && !qcModal.classList.contains('hidden') && typeof renderQcSignageModal === 'function') {
                    renderQcSignageModal();
                  }
                } catch (e) {}
                // If Manage Order Details modal is open, re-resolve quotes and re-render pages
                try {
                  const mod = document.getElementById('manage-order-details-modal');
                  if (mod && !mod.classList.contains('hidden')) {
                    const openId = mod.dataset.openOrderId;
                    if (openId) {
                      const ord = productionOrders.find(o => String(o.__backendId) === String(openId));
                      if (ord) {
                        let qlist = [];
                        try { qlist = JSON.parse(ord.items || '[]'); } catch (e) { qlist = []; }
                        try { qlist = qlist.map(q => resolveQuoteReference(q)); } catch (e) { /* ignore */ }
                        try { renderManageOrderPages(qlist, (mod._currentPage || 1)); } catch (e) { /* ignore */ }
                      }
                    }
                  }
                } catch (e) {}
              } catch (e) {
                console.error('Deferred render error:', e);
              }
            };
            
            // Debounce + defer rendering to avoid multiple rapid updates blocking UI
            // Clear any pending render and schedule a new one
            if (window.__qcagDeferredRenderTimer) {
              clearTimeout(window.__qcagDeferredRenderTimer);
            }
            window.__qcagDeferredRenderTimer = setTimeout(() => {
              window.__qcagDeferredRenderTimer = null;
              // Use requestAnimationFrame for smoother rendering
              if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(deferredRender);
              } else {
                deferredRender();
              }
            }, 150); // 150ms debounce - accumulate rapid updates (increased from 50ms for better performance on weak devices)
          }
        };

        // ===== VIEW MODE + PAGINATION & RENDERING (GLOBAL) =====
        let viewMode = 'list'; // 'list' | 'outlet'
        let listPage = 1;
        let outletPage = 1;
        const PER_PAGE = 10;
        let searchTerm = '';

        function paginate(arr, page, perPage) {
            const total = arr.length;
            const totalPages = Math.max(1, Math.ceil(total / perPage));
            const safePage = Math.min(Math.max(1, page), totalPages);
            const start = (safePage - 1) * perPage;
            const end = start + perPage;
            return {
                page: safePage,
                totalPages,
                slice: arr.slice(start, end),
                total,
                start: start + 1,
                end: Math.min(end, total)
            };
        }

        function updatePaginationUI(pageInfo, mode = 'list') {
          const wrap = document.getElementById('pagination-container');
          const info = document.getElementById('pagination-info');
          const prev = document.getElementById('prev-page');
          const next = document.getElementById('next-page');
          const input = document.getElementById('pagination-current-input');
          const total = document.getElementById('pagination-total');
          if (!pageInfo) {
            wrap.classList.add('hidden');
            return;
          }
          wrap.classList.remove('hidden');
          info.textContent = `Hiển thị ${pageInfo.start}-${pageInfo.end}/${pageInfo.total}`;
          if (prev) prev.disabled = pageInfo.page <= 1;
          if (next) next.disabled = pageInfo.page >= pageInfo.totalPages;
          if (input) {
            input.value = pageInfo.page;
            input.min = 1;
            input.max = pageInfo.totalPages;
            input.dataset.mode = mode;
          }
          if (total) {
            total.textContent = pageInfo.totalPages;
          }
        }

        function setPaginationHandlers(getPageInfo, setPage, renderFn) {
          const prev = document.getElementById('prev-page');
          const next = document.getElementById('next-page');
          const input = document.getElementById('pagination-current-input');

          if (prev) {
            prev.onclick = () => {
              const pi = getPageInfo();
              if (pi.page > 1) {
                setPage(pi.page - 1);
                renderFn();
              }
            };
          }

          if (next) {
            next.onclick = () => {
              const pi = getPageInfo();
              if (pi.page < pi.totalPages) {
                setPage(pi.page + 1);
                renderFn();
              }
            };
          }

          if (input) {
            const commitInput = () => {
              const pi = getPageInfo();
              const value = parseInt(input.value, 10);
              if (!Number.isFinite(value)) {
                input.value = pi.page;
                return;
              }
              const target = Math.min(Math.max(1, value), pi.totalPages);
              if (target !== pi.page) {
                setPage(target);
                renderFn();
              } else {
                input.value = pi.page;
              }
            };
            input.onkeydown = (event) => {
              if (event.key === 'Enter') {
                commitInput();
              }
            };
            input.onblur = commitInput;
          }
        }

        function updateMainList() {
            if (viewMode === 'list') {
                renderListView();
            } else {
                renderOutletView();
            }
        }

        function filterQuotesBase(quotes) {
            const term = (searchTerm || '').toString().trim();
            if (!term) return quotes;
            const q = normalizeForSearch(term);
            try {
              const matched = new Set();
              for (let i = 0; i < quoteSearchIndex.length; i++) {
                const it = quoteSearchIndex[i];
                if (!it || !it.search) continue;
                if (it.search.indexOf(q) !== -1) matched.add(it.id);
              }
              if (matched.size === 0) return [];
              return quotes.filter(qu => matched.has((typeof getQuoteKey === 'function') ? getQuoteKey(qu) : (qu.__backendId || qu.id || '')));
            } catch (e) {
              const termLow = q;
              return quotes.filter(qu => {
                const outletName = String(qu && qu.outlet_name || '').toLowerCase();
                const outletCode = String(qu && qu.outlet_code || '').toLowerCase();
                const area = String(qu && qu.area || '').toLowerCase();
                const spo = String(qu && qu.spo_number || '').toLowerCase();
                let quoteCode = '';
                try {
                  quoteCode = String((typeof formatQuoteCode === 'function' ? formatQuoteCode(qu) : (qu && qu.quote_code)) || '');
                } catch (e2) {
                  quoteCode = String(qu && qu.quote_code || '');
                }
                quoteCode = quoteCode.toLowerCase();
                let orderNo = '';
                try {
                  orderNo = String((typeof getQcagOrderNumber === 'function' ? getQcagOrderNumber(qu) : '') || (qu && (qu.order_number || qu.qcag_order_number)) || '');
                } catch (e2) {
                  orderNo = String(qu && (qu.order_number || qu.qcag_order_number) || '');
                }
                orderNo = orderNo.toLowerCase();
                return (
                  outletName.includes(termLow) ||
                  outletCode.includes(termLow) ||
                  area.includes(termLow) ||
                  quoteCode.includes(termLow) ||
                  spo.includes(termLow) ||
                  orderNo.includes(termLow)
                );
              });
            }
        }

        function renderListView() {
            const container = document.getElementById('quotes-list');
            let list = [...currentQuotes];
            // newest first
            list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            list = filterQuotesBase(list);
          if (pendingJumpToFirstPage) {
            listPage = 1;
            pendingJumpToFirstPage = false;
          }
            const pi = paginate(list, listPage, PER_PAGE);
            listPage = pi.page;
          updatePaginationUI(pi, 'list');

            if (pi.total === 0) {
                container.innerHTML = '<p class="text-gray-500 text-center py-8">Chưa có báo giá nào</p>';
                return;
            }

            container.innerHTML = `
            <table class="min-w-full divide-y divide-gray-200">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Mã BG</th>
                  <th class="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Khu Vực</th>
                  <th class="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">SPO</th>
                  <th class="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">OutletCode</th>
                  <th class="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Tên Outlet</th>
                  <th class="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Sale</th>
                  <th class="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Tiền</th>
                  <th class="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Status SPO</th>
                  <th class="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Status QCAG</th>
                  <th class="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Số ĐH</th>
                  <th class="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Thao Tác</th>
                </tr>
              </thead>
              <tbody class="bg-white divide-y divide-gray-200">
                ${pi.slice.map((quote, idxOnPage) => {
                  const idxGlobal = (pi.start - 1) + idxOnPage + 1; // natural numbering across all
                  const quoteCode = formatQuoteCode(quote) || idxGlobal;
                  const rowKey = getQuoteKey(quote);
                  // Phân loại QCAG, còn Status SPO hiển thị đúng tên trạng thái gốc
                  // Fast image presence check (avoid JSON.parse of large base64 blobs)
                  let hasAcceptanceImage = false;
                  try {
                    const raw = quote && quote.images;
                    if (Array.isArray(raw)) hasAcceptanceImage = raw.length > 0;
                    else if (typeof raw === 'string') {
                      const s = raw.trim();
                      hasAcceptanceImage = !!(s && s !== '[]' && s !== 'null' && s !== '""');
                    }
                  } catch (e) { hasAcceptanceImage = false; }
                  let spoStatusText = '';
                  if (!quote.spo_number) {
                    spoStatusText = 'Chưa có SPO';
                  } else {
                    spoStatusText = quote.spo_status || '';
                  }
                  const qcObj = computeQCAGStatus(quote);
                  const qcag = qcObj && qcObj.status ? qcObj.status : '';
                  return `
                    <tr class="hover:bg-gray-50 cursor-pointer" data-row-key="${rowKey}" onclick="toggleQuoteDetails('${rowKey}')">
                      <td class="px-4 py-3 whitespace-nowrap text-sm font-semibold text-gray-900">${quote.qcag_status === 'Hủy' ? `<span class="text-red-600">${quoteCode}</span>` : quoteCode}</td>
                      <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-900">${(String(quote.area || '').trim() === 'Modern On Trade 8') ? 'MOT8' : (quote.area || '')}</td>
                      <td class="px-4 py-3 whitespace-nowrap text-sm">
                        <div class="spo-container flex items-center gap-1">
                          <input type="text" 
                                 class="spo-input w-full px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm ${quote.spo_number ? 'spo-confirmed' : ''}" 
                                 placeholder="Nhập số SPO" 
                                 value="${quote.spo_number || ''}" 
                                 data-quote-key="${rowKey}" 
                                 data-original="${quote.spo_number || ''}"
                                 ${quote.spo_number ? 'disabled' : ''}>
                          ${quote.spo_number ? '<button class="spo-edit-btn text-gray-400 hover:text-gray-600" title="Sửa SPO"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg></button>' : ''}
                        </div>
                      </td>
                      <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-900">${quote.qcag_status === 'Hủy' ? `<span class="text-red-600">${quote.outlet_code || ''}</span>` : quote.outlet_code || ''}</td>
                      <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-900">${quote.qcag_status === 'Hủy' ? `<span class="text-red-600">${quote.outlet_name || ''}</span>` : quote.outlet_name || ''}</td>
                      <td class="px-4 py-3 whitespace-nowrap text-sm">
                        <div class="text-sm text-gray-800">${quote.sale_type || 'Sale (SR)'}</div>
                        ${quote.sale_name ? `<div class=\"text-xs text-gray-600 mt-1\">${quote.sale_name}</div>` : ''}
                      </td>
                      <td class="px-4 py-3 whitespace-nowrap text-sm font-semibold text-blue-600">${formatCurrency(parseMoney(quote.total_amount)||0)}</td>
                      <td class="px-4 py-3 whitespace-nowrap text-sm">
                        <div onclick="event.stopPropagation(); editSPOStatus('${quote.__backendId}')" class="cursor-pointer hover:bg-gray-50 p-1 rounded">
                          <span class="px-2 py-1 text-xs font-medium rounded">${spoStatusText}</span>
                        </div>
                      </td>
                      <td class="px-4 py-3 whitespace-nowrap text-sm">${renderQCAGStatusHtml(quote, qcObj)}</td>
                      <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-900">${getQcagOrderNumber(quote) || ''}</td>
                      <td class="px-4 py-3 whitespace-nowrap text-sm">
                        ${(() => {
                          const isProduced = String(quote.qcag_status || '').includes('Đã ra đơn');
                          const disabledDelete = isProduced ? 'opacity-40 cursor-not-allowed' : '';
                          const wrench = `<svg xmlns=\"http://www.w3.org/2000/svg\" class=\"w-5 h-5\" fill=\"none\" viewBox=\"0 0 24 24\" stroke=\"currentColor\"><path stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\" d=\"M21 16l-4-4m0 0l-4-4m4 4L7 21H3v-4l9-10\"/></svg>`;
                          const trash = `<svg xmlns=\"http://www.w3.org/2000/svg\" class=\"w-5 h-5\" fill=\"none\" viewBox=\"0 0 24 24\" stroke=\"currentColor\"><path stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\" d=\"M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7h6m-7 0a2 2 0 012-2h4a2 2 0 012 2m-9 0h10\"/></svg>`;
                          const noteIcon = `<svg xmlns=\"http://www.w3.org/2000/svg\" class=\"w-5 h-5\" fill=\"none\" viewBox=\"0 0 24 24\" stroke=\"currentColor\"><path stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\" d=\"M8 10h8M8 14h5\"/><path stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\" d=\"M21 15a4 4 0 01-4 4H8l-4 3V7a4 4 0 014-4h9a4 4 0 014 4v8z\"/></svg>`;
                          const noteCount = getQuoteNotes(quote).length;
                          const noteCountClass = noteCount > 0 ? 'note-btn-count has-notes' : 'note-btn-count';
                          const editBtn = `<button onclick=\"event.stopPropagation(); startEditQuote('${rowKey}')\" class=\"px-2 py-1 text-xs bg-blue-600 text-white rounded inline-flex items-center gap-1\" title=\"Chỉnh sửa\">${wrench}</button>`;
                          const isCancelled = quote.qcag_status === 'Hủy';
                          // If quote ever had an order or is currently 'Chờ tạo đơn', disallow delete and show 'Báo huỷ'
                          const shouldShowCancel = isProduced || (qcObj && qcObj.status === 'Chờ tạo đơn') || hasEverHadOrder(quote);
                          const delBtn = isCancelled ? `<button onclick=\"event.stopPropagation(); openRedoModal('${rowKey}')\" class=\"px-2 py-1 text-xs bg-green-600 text-white rounded inline-flex items-center gap-1 action-fixed-width h-7 hover:bg-green-700\" title=\"Làm lại\"><i class=\"fas fa-redo\"></i></button>` : shouldShowCancel ? `<button onclick=\"event.stopPropagation(); openReportCancelModal('${rowKey}')\" class=\"px-2 py-1 text-xs bg-yellow-400 text-yellow-900 rounded inline-flex items-center gap-1 action-fixed-width hover:bg-yellow-500 hover:text-yellow-900\" title=\"Báo huỷ\">${trash}</button>` : `<button onclick=\"event.stopPropagation(); deleteQuote('${rowKey}')\" class=\"px-2 py-1 text-xs bg-red-600 text-white rounded inline-flex items-center gap-1 action-fixed-width ${disabledDelete}\" title=\"Xóa\">${trash}</button>`;
                          const pdfBtn = `<button onclick=\"event.stopPropagation(); exportQuoteAsPdf('${getQuoteKey(quote)}')\" class=\"px-2 py-1 text-xs bg-indigo-600 text-white rounded inline-flex items-center gap-1\" title=\"PDF\">PDF</button>`;
                          const noteBtn = `<button onclick=\"event.stopPropagation(); openQuoteNotesModal('${getQuoteKey(quote)}')\" data-note-btn=\"${getQuoteKey(quote)}\" class=\"note-btn note-btn-compact\" title=\"Ghi chú\"><span class=\"note-btn-main\">${noteIcon}</span><span class=\"${noteCountClass}\">${noteCount || 0}</span></button>`;
                          return `<div class=\"flex items-center gap-2\">${editBtn}${delBtn}${pdfBtn}${noteBtn}</div>`;
                        })()}
                      </td>
                    </tr>
                    <tr id="details-${rowKey}" class="hidden" data-details-loaded="0">
                      <td colspan="11" class="px-4 py-4 bg-gray-50">
                        <div class="text-sm text-gray-500">Đang tải chi tiết...</div>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          `;
          
          // Add event listeners for SPO inputs
          container.querySelectorAll('input.spo-input').forEach(input => {
            input.addEventListener('click', (e) => e.stopPropagation());
            input.addEventListener('keydown', async (e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const newValue = input.value.trim();
                if (!newValue) return; // Không cho Enter nếu chưa nhập gì
                
                const quoteKey = input.dataset.quoteKey;
                const originalValue = input.dataset.original || '';
                
                if (newValue === originalValue) {
                  // Nếu không thay đổi, nhưng đã confirm, disable
                  confirmSPO(input);
                  return;
                }
                
                const quote = currentQuotes.find(q => getQuoteKey(q) === quoteKey);
                if (!quote) return;
                
                // Check uniqueness
                if (newValue && !isSPONumberUnique(newValue, quoteKey)) {
                  showToast('Số SPO này đã được gán cho báo giá khác');
                  input.value = originalValue; // Revert
                  return;
                }
                
                // Update data
                const updatedQuote = { ...quote, spo_number: newValue };
                let ok = false;
                if (window.dataSdk && typeof window.dataSdk.update === 'function') {
                  try {
                    const result = await window.dataSdk.update(updatedQuote);
                    ok = !!(result && result.isOk);
                  } catch (err) {
                    ok = false;
                  }
                } else {
                  ok = true;
                }
                
                if (ok) {
                  const idx = currentQuotes.findIndex(q => getQuoteKey(q) === quoteKey);
                  if (idx >= 0) {
                    const prevStatus = currentQuotes[idx].spo_status || '';
                    const newStatus = (!originalValue && newValue) ? 'Chưa cập nhật trạng thái' : prevStatus;
                    currentQuotes[idx] = { ...currentQuotes[idx], spo_number: newValue, spo_status: newStatus };
                  }
                  const message = originalValue
                    ? `Cập nhật số SPO từ "${originalValue}" sang "${newValue}"`
                    : `Cập nhật số SPO sang "${newValue}"`;
                  addSystemNoteForQuote(quoteKey, message);
                  showToast('Đã cập nhật số SPO');
                  input.dataset.original = newValue;
                  confirmSPO(input);
                  updateMainList(); // Refresh to show updated status

                  // Ensure any productionOrders copies containing this quote are updated
                  try {
                    const found = findQuoteInProductionOrders(quoteKey);
                    if (found) {
                      const { order, orderIndex, quoteIndex } = found;
                      let quotes = [];
                      try { quotes = JSON.parse(order.items || '[]'); } catch (e) { quotes = []; }
                      if (Array.isArray(quotes) && quotes[quoteIndex]) {
                        quotes[quoteIndex] = { ...quotes[quoteIndex], spo_number: newValue };
                        const updatedOrder = { ...order, items: JSON.stringify(quotes) };
                        productionOrders[orderIndex] = updatedOrder;
                        if (window.dataSdk && typeof window.dataSdk.update === 'function') {
                          window.dataSdk.update(updatedOrder).catch(() => {});
                        }
                      }
                    }
                  } catch (_) {}

                  // Nếu modal QC bảng hiệu đang mở, cập nhật lại để cột SPO phản ánh dữ liệu mới
                  try {
                    const qcModal = document.getElementById('qc-signage-modal');
                    if (qcModal && !qcModal.classList.contains('hidden') && typeof renderQcSignageModal === 'function') {
                      renderQcSignageModal();
                    }
                  } catch (_) {}
                } else {
                  showToast('Lỗi khi cập nhật số SPO');
                  input.value = originalValue; // Revert
                }
              }
            });
            // Add event listener for edit button
            const containerDiv = input.parentElement;
            const editBtn = containerDiv.querySelector('.spo-edit-btn');
            if (editBtn) {
              editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                editSPO(input);
              });
            }
          });
          
          function confirmSPO(input) {
            __qcagConfirmSPO(input, editSPO);
          }
          
          function editSPO(input) {
            __qcagEditSPO(input);
          }
          
        function buildQuoteNotesHTML(quote) {
          return '';
        }
          setPaginationHandlers(
            () => paginate(filterQuotesBase([...currentQuotes].sort((a,b)=> new Date(b.created_at)-new Date(a.created_at))), listPage, PER_PAGE),
            (p) => { listPage = p; },
            () => renderListView()
          );

        }

        function setQuoteModalMode(mode = 'create') {
          const titleEl = document.querySelector('#quote-modal h3');
          const submitText = document.getElementById('submit-text');
          if (mode === 'edit') {
            if (titleEl) titleEl.textContent = 'Chỉnh sửa Báo Giá';
            if (submitText) submitText.textContent = 'Lưu thay đổi';
          } else {
            if (titleEl) titleEl.textContent = 'Tạo Báo Giá Mới';
            if (submitText) submitText.textContent = 'Xác Nhận';
          }
        }

        function findQuoteByKey(keyStr = '') {
          if (!keyStr) return null;
          return currentQuotes.find(q => {
            if (!q) return false;
            const candidates = [q.__backendId, q.id, q.quote_code, q.spo_number, getQuoteKey(q)];
            return candidates.some(v => v != null && String(v) === keyStr);
          }) || null;
        }

        function populateQuoteForm(quote) {
          if (!quote) return;
          resetQuoteForm();
          currentEditingQuoteKey = getQuoteKey(quote);
          newQuoteCodePreGenerated = null; // Clear pre-generated code when editing
          maquetteUploadQuoteCode = null; // Clear maquette upload code when editing
          setQuoteModalMode('edit');

          const setVal = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.value = value || '';
          };

          window.saleType = quote.sale_type === 'TBA' ? 'TBA' : 'Sale (SR)';
          updateSaleTypeUI();

          setVal('sale-code', quote.sale_code);
          setVal('sale-name', quote.sale_name);
          setVal('sale-phone', quote.sale_phone);
          setVal('ss-name', quote.ss_name);
          setVal('outlet-code', quote.outlet_code);
          setVal('outlet-name', quote.outlet_name);
          setVal('outlet-phone', quote.outlet_phone);
          setVal('spo-name', quote.spo_name);

          // Populate individual address fields (use most recently saved pieces)
          setVal('house-number', quote.house_number || '');
          setVal('street-name', quote.street || '');
          setVal('ward-hamlet', quote.ward || '');
          setVal('commune-ward', quote.district || '');
          setVal('province-city', quote.province || '');

          const areaSelect = document.getElementById('area');
          if (areaSelect) areaSelect.value = quote.area || '';

          const fullAddr = document.getElementById('full-address');
          // Ensure displayed full address reflects the detailed fields
          buildFullAddress();

          // Items
          const itemsContainer = document.getElementById('items-container');
          if (itemsContainer) {
            itemsContainer.innerHTML = '';
          }
          itemCounter = 0;
          let items = [];
          try { items = JSON.parse(quote.items || '[]') || []; } catch (_) { items = []; }
          if (!Array.isArray(items) || !items.length) {
            addItemRow();
          } else {
            items.forEach(item => {
              addItemRow();
              const row = itemsContainer ? itemsContainer.lastElementChild : null;
              if (!row) return;
              const setField = (selector, value) => {
                const el = row.querySelector(selector);
                if (el) el.value = value != null ? value : '';
              };
              setField('.item-code', item.code || '');
              setField('.item-content', item.content || '');
              const brandSelect = row.querySelector('.item-brand');
              if (brandSelect) {
                resetBrandSelectElement(brandSelect, { keepEnabled: true });
                if (item.brand) brandSelect.value = item.brand;
              }
              setField('.item-width', item.width || '');
              setField('.item-height', item.height || '');
              setField('.item-quantity', item.quantity || '');
              setField('.item-unit', item.unit || '');
              setField('.item-price', item.price || '');
              const totalInput = row.querySelector('.item-total');
              if (totalInput) {
                const totalVal = (parseNumber(item.quantity) || 0) * (parseMoney(item.price) || 0);
                totalInput.value = formatCurrency(totalVal);
              }
            });
          }
          updateTotal();
          // Ensure item numbers reflect the populated rows
          updateItemNumbers();
          try { computeAndLockItemsContainerHeight(); } catch (e) {}

          // Images
          let images = [];
          try { images = JSON.parse(quote.images || '[]') || []; } catch (_) { images = []; }
          window.currentQuoteImages = Array.isArray(images) ? images.slice(0, 10) : [];
          if (typeof window.refreshQuoteImagesUI === 'function') {
            window.refreshQuoteImagesUI();
          }

          const totalAmountEl = document.getElementById('total-amount');
          if (totalAmountEl) totalAmountEl.textContent = formatCurrency(parseMoney(quote.total_amount) || 0);
        }

        window.startEditQuote = function(backendId) {
          const key = backendId != null ? String(backendId) : '';
          const quote = findQuoteByKey(key);
          if (!quote) {
            showToast('Không tìm thấy báo giá để chỉnh sửa');
            return;
          }
          setupQuoteModalHandlersOnce();
          populateQuoteForm(quote);
          const modal = document.getElementById('quote-modal');
          if (modal) modal.classList.remove('hidden');
          ensureScrollLock();
          // Ensure the items container locks to header + 4 rows AFTER the modal is visible
          try {
            requestAnimationFrame(() => requestAnimationFrame(() => {
              try { computeAndLockItemsContainerHeight(); } catch (e) {}
            }));
          } catch (e) {}
          // Focus vào Outlet name để bắt đầu sửa nhanh
          const focusEl = document.getElementById('outlet-name');
          if (focusEl) setTimeout(() => focusEl.focus(), 50);
        }

        

        function renderOutletView() {
          const container = document.getElementById('quotes-list');
          // Build a global index map consistent with list view ordering
          let listForIndex = [...currentQuotes];
          listForIndex.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
          listForIndex = filterQuotesBase(listForIndex);
          const quoteIndexMap = {};
          listForIndex.forEach((q, i) => { quoteIndexMap[getQuoteKey(q)] = formatQuoteCode(q) || (i + 1); });
          // group by outlet_code
          const map = new Map();
          for (const q of currentQuotes) {
            const code = q.outlet_code || 'UNKNOWN';
            if (!map.has(code)) map.set(code, []);
            map.get(code).push(q);
          }
          // build groups and sort by latest quote time desc
          let groups = Array.from(map.entries()).map(([code, arr]) => {
            const sorted = [...arr].sort((a,b)=> new Date(b.created_at)-new Date(a.created_at));
            const latest = sorted[0];
            return {
              outlet_code: code,
              outlet_name: latest?.outlet_name || '',
              area: latest?.area || '',
              address: latest?.address || '',
              quotes: sorted
            };
          });
          // filter by search
          const term = (searchTerm||'').toLowerCase().trim();
          if (term) {
            groups = groups.filter(g =>
              (g.outlet_name||'').toLowerCase().includes(term) ||
              (g.outlet_code||'').toLowerCase().includes(term) ||
              (g.area||'').toLowerCase().includes(term)
            );
          }
          // sort by latest created_at
          groups.sort((a,b)=> new Date(a.quotes[0]?.created_at||0) < new Date(b.quotes[0]?.created_at||0) ? 1 : -1);

          if (pendingJumpToFirstPage) {
            outletPage = 1;
            pendingJumpToFirstPage = false;
          }
          const pi = paginate(groups, outletPage, PER_PAGE);
          outletPage = pi.page;
          updatePaginationUI(pi, 'outlet');

          if (pi.total === 0) {
            container.innerHTML = '<p class="text-gray-500 text-center py-8">Không có Outlet nào</p>';
            return;
          }

          container.innerHTML = `
            <table class="min-w-full divide-y divide-gray-200">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">STT</th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Khu Vực</th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Outlet Code</th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tên Outlet</th>
                  <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Số lượng báo giá</th>
                </tr>
              </thead>
              <tbody class="bg-white divide-y divide-gray-200">
                ${pi.slice.map((g, idxOnPage) => {
                  const stt = (pi.start - 1) + idxOnPage + 1;
                  const key = `outlet_${g.outlet_code.replace(/[^a-zA-Z0-9_-]/g,'_')}`;
                  const addr = (g.address && g.address !== 'Địa chỉ sẽ hiển thị tự động khi nhập') ? g.address : '';
                  return `
                    <tr class="hover:bg-gray-50 cursor-pointer" onclick="toggleOutletQuotes('${key}')">
                      <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-900">${stt}</td>
                      <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-900">${g.area}</td>
                      <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-900">${g.outlet_code}</td>
                      <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                        <div class="font-medium">${g.outlet_name}</div>
                        ${addr ? `<div class=\"text-xs text-gray-500\">${addr}</div>` : ''}
                      </td>
                      <td class="px-4 py-3 whitespace-nowrap text-sm text-right">
                        <span class="text-blue-600">${g.quotes.length}</span>
                      </td>
                    </tr>
                    <tr id="${key}" class="hidden">
                      <td colspan="5" class="px-4 py-4 bg-gray-50">
                        ${renderOutletQuotesTable(g.quotes, quoteIndexMap)}
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          `;
          
          // Add event listeners for SPO inputs in outlet view
          container.querySelectorAll('input.spo-input').forEach(input => {
            input.addEventListener('click', (e) => e.stopPropagation());
            input.addEventListener('keydown', async (e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const newValue = input.value.trim();
                if (!newValue) return; // Không cho Enter nếu chưa nhập gì
                
                const quoteKey = input.dataset.quoteKey;
                const originalValue = input.dataset.original || '';
                
                if (newValue === originalValue) {
                  // Nếu không thay đổi, nhưng đã confirm, disable
                  confirmSPO(input);
                  return;
                }
                
                const quote = currentQuotes.find(q => getQuoteKey(q) === quoteKey);
                if (!quote) return;
                
                // Check uniqueness
                if (newValue && !isSPONumberUnique(newValue, quoteKey)) {
                  showToast('Số SPO này đã được gán cho báo giá khác');
                  input.value = originalValue; // Revert
                  return;
                }
                
                // Update data
                const updatedQuote = { ...quote, spo_number: newValue };
                let ok = false;
                if (window.dataSdk && typeof window.dataSdk.update === 'function') {
                  try {
                    const result = await window.dataSdk.update(updatedQuote);
                    ok = !!(result && result.isOk);
                  } catch (err) {
                    ok = false;
                  }
                } else {
                  ok = true;
                }
                
                if (ok) {
                  const idx = currentQuotes.findIndex(q => getQuoteKey(q) === quoteKey);
                  if (idx >= 0) {
                    const prevStatus = currentQuotes[idx].spo_status || '';
                    const newStatus = (!originalValue && newValue) ? 'Chưa cập nhật trạng thái' : prevStatus;
                    currentQuotes[idx] = { ...currentQuotes[idx], spo_number: newValue, spo_status: newStatus };
                  }
                  const message = originalValue
                    ? `Cập nhật số SPO từ "${originalValue}" sang "${newValue}"`
                    : `Cập nhật số SPO sang "${newValue}"`;
                  addSystemNoteForQuote(quoteKey, message);
                  showToast('Đã cập nhật số SPO');
                  input.dataset.original = newValue;
                  confirmSPO(input);
                  updateMainList(); // Refresh to show updated status
                } else {
                  showToast('Lỗi khi cập nhật số SPO');
                  input.value = originalValue; // Revert
                }
              }
            });
            // Add event listener for edit button
            const containerDiv = input.parentElement;
            const editBtn = containerDiv.querySelector('.spo-edit-btn');
            if (editBtn) {
              editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                editSPO(input);
              });
            }
          });

          function confirmSPO(input) {
            __qcagConfirmSPO(input, editSPO);
          }
          
          function editSPO(input) {
            __qcagEditSPO(input);
          }

          setPaginationHandlers(
            () => paginate(groups, outletPage, PER_PAGE),
            (p) => { outletPage = p; },
            () => renderOutletView()
          );
        }

        function renderOutletQuotesTable(quotes, quoteIndexMap) {
          const rows = quotes.map((quote, idx) => {
            const rowKey = getQuoteKey(quote);
            const items = (() => { try { return JSON.parse(quote.items || '[]'); } catch(e) { return []; } })();
            const qcag = quote.qcag_status || '-';
            const isProduced = String(qcag || '').includes('Đã ra đơn');
            const idxGlobal = quoteIndexMap ? quoteIndexMap[rowKey] : (idx + 1);
            const quoteCode = typeof idxGlobal === 'string' ? idxGlobal : (formatQuoteCode(quote) || idxGlobal);
            return `
              <tr class="hover:bg-gray-50 cursor-pointer" data-row-key="${rowKey}" onclick="toggleQuoteDetails('${rowKey}')">
                <td class="px-3 py-2 text-xs font-semibold text-gray-900">${quote.qcag_status === 'Hủy' ? `<span class="text-red-600">${quoteCode}</span>` : quoteCode}</td>
                <td class="px-3 py-2 text-xs text-gray-900">${quote.area || ''}</td>
                <td class="px-3 py-2 text-xs">
                  <div class="spo-container flex items-center gap-1">
                    <input type="text" 
                           class="spo-input w-full px-1 py-0.5 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-transparent ${quote.spo_number ? 'spo-confirmed' : ''}" 
                           placeholder="Nhập số SPO" 
                           value="${quote.spo_number || ''}" 
                           data-quote-key="${rowKey}" 
                           data-original="${quote.spo_number || ''}"
                           ${quote.spo_number ? 'disabled' : ''}>
                    ${quote.spo_number ? '<button class="spo-edit-btn text-gray-400 hover:text-gray-600" title="Sửa SPO"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg></button>' : ''}
                  </div>
                </td>
                <td class="px-3 py-2 text-xs text-gray-900">${quote.qcag_status === 'Hủy' ? `<span class="text-red-600">${quote.outlet_code || ''}</span>` : quote.outlet_code || ''}</td>
                <td class="px-3 py-2 text-xs text-gray-900">${quote.qcag_status === 'Hủy' ? `<span class="text-red-600">${quote.outlet_name || ''}</span>` : quote.outlet_name || ''}</td>
                <td class="px-3 py-2 text-xs">
                  <span class="px-1.5 py-0.5 text-[10px] font-medium rounded ${quote.sale_type === 'TBA' ? 'bg-orange-100 text-orange-800' : 'bg-blue-100 text-blue-800'}">${quote.sale_type || 'Sale (SR)'}</span>
                  ${quote.sale_name ? `<div class=\"text-[10px] text-gray-600 mt-1\">${quote.sale_name}</div>` : ''}
                </td>
                <td class="px-3 py-2 text-xs text-right font-semibold text-blue-600">${formatCurrency(parseMoney(quote.total_amount)||0)}</td>
                <td class="px-3 py-2 text-xs">
                  <div onclick="event.stopPropagation(); editSPOStatus('${quote.__backendId}')" class="cursor-pointer hover:bg-gray-50 p-1 rounded">
                    <span class="px-1.5 py-0.5 text-[10px] font-medium rounded ${getSPOStatusClass(quote.spo_status)}">${getSPOStatusText(quote.spo_status)}</span>
                  </div>
                </td>
                <td class="px-3 py-2 text-xs">${renderQCAGStatusHtml(quote)}</td>
                <td class="px-3 py-2 text-xs text-gray-900">${getQcagOrderNumber(quote) || ''}</td>
                <td class="px-3 py-2 text-xs">
                  <div class="inline-flex items-center gap-2">
                    ${(() => {
                      const isCancelled = quote.qcag_status === 'Hủy';
                      // If quote ever had an order or is currently 'Chờ tạo đơn', disallow delete and show 'Báo huỷ'
                      const shouldShowCancel2 = isProduced || (computeQCAGStatus ? computeQCAGStatus(quote).status === 'Chờ tạo đơn' : false) || hasEverHadOrder(quote);
                      return isCancelled ? `<button onclick="event.stopPropagation(); openRedoModal('${rowKey}')" class="px-2 py-1 text-xs bg-green-600 text-white rounded inline-flex items-center gap-1 hover:bg-green-700 action-fixed-width h-7" title="Làm lại"><i class="fas fa-redo"></i></button>` : shouldShowCancel2 ? `<button onclick="event.stopPropagation(); openReportCancelModal('${rowKey}')" class="px-2 py-1 text-xs bg-yellow-400 text-yellow-900 rounded inline-flex items-center gap-1 hover:bg-yellow-500 hover:text-yellow-900 action-fixed-width" title="Báo huỷ"><svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7h6m-7 0a2 2 0 012-2h4a2 2 0 012 2m-9 0h10"/></svg></button>` : `<button onclick="event.stopPropagation(); deleteQuote('${rowKey}')" class="px-2 py-1 text-xs bg-red-600 text-white rounded inline-flex items-center gap-1" title="Xóa"><svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7h6m-7 0a2 2 0 012-2h4a2 2 0 012 2m-9 0h10"/></svg></button>`;
                    })()}
                    ${(() => { const c = getQuoteNotes(quote).length; const countClass = c > 0 ? 'note-btn-count has-notes' : 'note-btn-count'; const pdfBtn = `<button onclick=\"event.stopPropagation(); exportQuoteAsPdf('${getQuoteKey(quote)}')\" class=\"px-2 py-1 text-xs bg-indigo-600 text-white rounded inline-flex items-center gap-1\" title=\"PDF\">PDF</button>`; return `${pdfBtn}<button onclick=\"event.stopPropagation(); openQuoteNotesModal('${getQuoteKey(quote)}')\" data-note-btn=\"${getQuoteKey(quote)}\" class=\"note-btn note-btn-compact\" title=\"Ghi chú\"><span class=\"note-btn-main\"><svg xmlns=\"http://www.w3.org/2000/svg\" class=\"w-4 h-4\" fill=\"none\" viewBox=\"0 0 24 24\" stroke=\"currentColor\"><path stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\" d=\"M12 20l9-5-9-5-9 5 9 5z\"/><path stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\" d=\"M12 12V4m0 0L7 8m5-4l5 4\"/></svg></span><span class=\"${countClass}\">${c || 0}</span></button>`; })()}
                  </div>
                </td>
              </tr>
              <tr id="details-${rowKey}" class="hidden">
                <td colspan="11" class="px-3 py-3 bg-gray-50">
                  <div class="flex gap-3">
                    <!-- Cột trái 75%: Chi tiết báo giá -->
                    <div class="flex-[3] space-y-3">
                      <div class="flex justify-between items-start gap-4">
                        <div class="text-xs space-y-2">
                          <div class="flex flex-wrap gap-3">
                            <div>
                              <span class="font-medium text-gray-700">Chức vụ:</span>
                              <span class="px-1.5 py-0.5 text-[10px] font-medium rounded ml-1 ${quote.sale_type === 'TBA' ? 'bg-orange-100 text-orange-800' : 'bg-blue-100 text-blue-800'}">${quote.sale_type || 'Sale (SR)'}</span>
                            </div>
                            ${quote.sale_code ? `<div><span class=\"font-medium text-gray-700\">Mã Sale:</span> <span class=\"text-gray-600\">${quote.sale_code}</span></div>` : ''}
                            ${quote.sale_name ? `<div><span class=\"font-medium text-gray-700\">Tên Sale:</span> <span class=\"text-gray-600\">${quote.sale_name}</span></div>` : ''}
                            ${quote.ss_name ? `<div><span class=\"font-medium text-gray-700\">Tên SS:</span> <span class=\"text-gray-600\">${quote.ss_name}</span></div>` : ''}
                          </div>
                          <div class="flex flex-wrap gap-3 mt-1">
                            <div>
                              <span class="font-medium text-gray-700">Ngày tạo:</span>
                              <span class="text-gray-600">${new Date(quote.created_at).toLocaleDateString('vi-VN')}</span>
                            </div>
                            ${quote.spo_number ? `<div><span class=\"font-medium text-gray-700\">Số SPO:</span> <span class=\"text-blue-600 font-medium\">${quote.spo_number}</span></div>` : ''}
                            ${quote.address && quote.address !== 'Địa chỉ sẽ hiển thị tự động khi nhập' ? `<div><span class=\"font-medium text-gray-700\">Địa chỉ:</span> <span class=\"text-gray-600\">${quote.address}</span></div>` : ''}
                          </div>
                        </div>
                        ${(() => { 
                          let imgs = []; 
                          try { imgs = JSON.parse(quote.images || '[]'); } catch (e) { imgs = []; }
                          if (!Array.isArray(imgs) || !imgs.length) return '<div class=\"text-[11px] text-gray-400\">Không có hình</div>';
                          return `<div class=\"w-56 flex-shrink-0\"><h4 class=\"font-semibold text-gray-800 mb-2 text-xs\">Hình ảnh (${imgs.length})</h4><div class=\"grid grid-cols-2 gap-2\">${imgs.map(im => `<div class=\"border rounded bg-white overflow-hidden cursor-pointer\" onclick=\"event.stopPropagation(); openImageViewer('${im.data}','${(im.name||'').replace(/'/g,'&#39;')}')\"><img src='${im.data}' alt='${(im.name||'').replace(/'/g,'&#39;')}' class=\"w-full h-20 object-cover\"></div>`).join('')}</div></div>`; 
                        })()}
                      </div>
                      <div class="space-y-2">
                        <h4 class="font-semibold text-gray-800 text-sm">Chi Tiết Hạng Mục (${items.length} mục)</h4>
                      <div class="overflow-x-auto">
                        <table class="w-full text-xs">
                          <thead class="bg-gray-100">
                            <tr>
                              <th class="px-2 py-1 text-left text-[11px] font-medium text-gray-600">Code</th>
                              <th class="px-2 py-1 text-left text-[11px] font-medium text-gray-600">Nội dung</th>
                              <th class="px-2 py-1 text-left text-[11px] font-medium text-gray-600">Brand</th>
                              <th class="px-2 py-1 text-left text-[11px] font-medium text-gray-600">Ngang x Cao</th>
                              <th class="px-2 py-1 text-left text-[11px] font-medium text-gray-600">SL</th>
                              <th class="px-2 py-1 text-left text-[11px] font-medium text-gray-600">ĐVT</th>
                              <th class="px-2 py-1 text-left text-[11px] font-medium text-gray-600">Đơn giá</th>
                              <th class="px-2 py-1 text-left text-[11px] font-medium text-gray-600">Thành tiền</th>
                            </tr>
                          </thead>
                          <tbody class="divide-y divide-gray-200">
                            ${items.map(item => `
                              <tr class="hover:bg-gray-50">
                                <td class="px-2 py-1 text-gray-900 font-medium">${item.code}</td>
                                <td class="px-2 py-1 text-gray-700">${item.content}</td>
                                <td class="px-2 py-1 text-gray-600">${item.brand || '-'}</td>
                                <td class="px-2 py-1 text-gray-600">${item.width && item.height ? `${item.width}m × ${item.height}m` : '-'}</td>
                                <td class="px-2 py-1 text-gray-900">${item.quantity}</td>
                                <td class="px-2 py-1 text-gray-600">${item.unit}</td>
                                <td class="px-2 py-1 text-gray-900">${formatCurrency(parseMoney(item.price) || 0)}</td>
                                <td class="px-2 py-1 text-blue-600 font-semibold">${item.total}</td>
                              </tr>
                            `).join('')}
                          </tbody>
                        </table>
                      </div>
                        <div class="flex justify-end">
                          <span class="text-sm font-bold text-blue-600">Tổng cộng: ${formatCurrency(parseMoney(quote.total_amount)||0)}</span>
                        </div>
                      </div>
                    </div>
                    <!-- Cột phải 25%: Xem nhanh ghi chú -->
                    <div class="flex-1 notes-preview" data-notes-preview="${rowKey}">
                      ${renderNotesPreviewHTML(quote)}
                    </div>
                  </div>
                </td>
              </tr>
            `;
          }).join('');
          return `
            <div class="overflow-x-auto">
              <table class="min-w-full text-sm">
                <thead class="bg-gray-100">
                  <tr>
                    <th class="px-3 py-2 text-left text-[11px] text-gray-600">Mã BG</th>
                    <th class="px-3 py-2 text-left text-[11px] text-gray-600">Khu Vực</th>
                    <th class="px-3 py-2 text-left text-[11px] text-gray-600">SPO</th>
                    <th class="px-3 py-2 text-left text-[11px] text-gray-600">OutletCode</th>
                    <th class="px-3 py-2 text-left text-[11px] text-gray-600">Tên Outlet</th>
                    <th class="px-3 py-2 text-left text-[11px] text-gray-600">Sale</th>
                    <th class="px-3 py-2 text-right text-[11px] text-gray-600">Tiền</th>
                    <th class="px-3 py-2 text-left text-[11px] text-gray-600">Status SPO</th>
                    <th class="px-3 py-2 text-left text-[11px] text-gray-600">Status QCAG</th>
                    <th class="px-3 py-2 text-left text-[11px] text-gray-600">Số ĐH</th>
                    <th class="px-3 py-2 text-left text-[11px] text-gray-600">Thao Tác</th>
                  </tr>
                </thead>
                <tbody class="divide-y">${rows}</tbody>
              </table>
            </div>
          `;
        }
        window.toggleOutletQuotes = function(id) {
          const row = document.getElementById(id);
          if (!row) return;
          prepareCollapsibleRow(row);
          const shouldOpen = !row.classList.contains('open');
          const headerRow = row.previousElementSibling;
          const panel = row.querySelector('.collapsible');
          const stopPin = pinRowDuringAnimation(headerRow || row, panel);
          setCollapsibleState(row, shouldOpen);
        }
        // ===== END VIEW MODE (GLOBAL) =====

        // ===== PRODUCTION MODAL FILTER STATE (GLOBAL) =====
        // These must be global to persist across modal opens and allow event listeners to reference them correctly
        let productionModalAreaFilters = new Set();
        let productionModalApprovedOnly = false;
        let productionModalUnapprovedOnly = false;
        let productionModalActiveFilter = 'all';
        let productionModalTermForSelection = '';
        let productionModalQuotesToFilter = [];
        let productionModalFilteredQuotes = [];

        function openProductionOrderModal(options = {}) {
            const {
                preserveSelection = false, skipReload = false
            } = options;

            const __qcagProfile = (() => {
              try { return String(localStorage.getItem('QCAG_PROFILE_PRODUCTION_MODAL') || '') === '1'; } catch (e) { return false; }
            })();
            const __qcagT0 = (__qcagProfile && window.performance && typeof performance.now === 'function') ? performance.now() : 0;
            if (__qcagProfile) {
              try { console.groupCollapsed('[perf] openProductionOrderModal'); } catch (e) { /* ignore */ }
            }

            document.getElementById('production-order-modal').classList.remove('hidden');
            ensureScrollLock();
            // Setup tab handlers for production modal (only once)
            setupProductionModalTabHandlers();
            // Update pending count badge
            updatePendingCount();
            // Reset selection state unless preserving (e.g., when returning from list modal)
            if (!preserveSelection) {
              selectedQuotes.clear();
            }
            // ===== VIEW MODE + PAGINATION & RENDERING =====
            let viewMode = 'list'; // 'list' | 'outlet'
            window.currentViewInProductionModal = viewMode; // Track globally
            let listPage = 1;
            let outletPage = 1;
            const PER_PAGE = 100;
            let searchTerm = '';

            function paginate(arr, page, perPage) {
              const total = arr.length;
              const totalPages = Math.max(1, Math.ceil(total / perPage));
              const safePage = Math.min(Math.max(1, page), totalPages);
              const start = (safePage - 1) * perPage;
              const end = start + perPage;
              return { page: safePage, totalPages, slice: arr.slice(start, end), total, start: start + 1, end: Math.min(end, total) };
            }

            function updatePaginationUI(pageInfo) {
              const wrap = document.getElementById('pagination-container');
              const info = document.getElementById('pagination-info');
              const prev = document.getElementById('prev-page');
              const next = document.getElementById('next-page');
              const input = document.getElementById('pagination-current-input');
              const total = document.getElementById('pagination-total');
              if (!pageInfo) { wrap.classList.add('hidden'); return; }
              wrap.classList.remove('hidden');
              info.textContent = `Hiển thị ${pageInfo.start}-${pageInfo.end}/${pageInfo.total}`;
              if (prev) prev.disabled = pageInfo.page <= 1;
              if (next) next.disabled = pageInfo.page >= pageInfo.totalPages;
              if (input) {
                input.value = pageInfo.page;
                input.min = 1;
                input.max = pageInfo.totalPages;
              }
              if (total) {
                total.textContent = pageInfo.totalPages;
              }
            }

            function setPaginationHandlers(getPageInfo, setPage, renderFn) {
              const prev = document.getElementById('prev-page');
              const next = document.getElementById('next-page');
              const input = document.getElementById('pagination-current-input');

              if (prev) {
                prev.onclick = () => {
                  const pi = getPageInfo();
                  if (pi.page > 1) {
                    setPage(pi.page - 1);
                    renderFn();
                  }
                };
              }

              if (next) {
                next.onclick = () => {
                  const pi = getPageInfo();
                  if (pi.page < pi.totalPages) {
                    setPage(pi.page + 1);
                    renderFn();
                  }
                };
              }

              if (input) {
                const commitInput = () => {
                  const pi = getPageInfo();
                  const value = parseInt(input.value, 10);
                  if (!Number.isFinite(value)) {
                    input.value = pi.page;
                    return;
                  }
                  const target = Math.min(Math.max(1, value), pi.totalPages);
                  if (target !== pi.page) {
                    setPage(target);
                    renderFn();
                  } else {
                    input.value = pi.page;
                  }
                };
                input.onkeydown = (event) => {
                  if (event.key === 'Enter') {
                    commitInput();
                  }
                };
                input.onblur = commitInput;
              }
            }

            function updateMainList() {
              if (viewMode === 'list') {
                renderListView();
              } else {
                renderOutletView();
              }
            }

            function filterQuotesBase(quotes) {
              const term = (searchTerm || '').toLowerCase().trim();
              if (!term) return quotes;
              return quotes.filter(q => {
                const outletName = String(q && q.outlet_name || '').toLowerCase();
                const outletCode = String(q && q.outlet_code || '').toLowerCase();
                const area = String(q && q.area || '').toLowerCase();
                const spo = String(q && q.spo_number || '').toLowerCase();
                let quoteCode = '';
                try {
                  quoteCode = String((typeof formatQuoteCode === 'function' ? formatQuoteCode(q) : (q && q.quote_code)) || '');
                } catch (e) {
                  quoteCode = String(q && q.quote_code || '');
                }
                quoteCode = quoteCode.toLowerCase();
                let orderNo = '';
                try {
                  orderNo = String((typeof getQcagOrderNumber === 'function' ? getQcagOrderNumber(q) : '') || (q && (q.order_number || q.qcag_order_number)) || '');
                } catch (e) {
                  orderNo = String(q && (q.order_number || q.qcag_order_number) || '');
                }
                orderNo = orderNo.toLowerCase();
                return (
                  outletName.includes(term) ||
                  outletCode.includes(term) ||
                  area.includes(term) ||
                  quoteCode.includes(term) ||
                  spo.includes(term) ||
                  orderNo.includes(term)
                );
              });
            }

            function renderListView() {
              const container = document.getElementById('quotes-list');
              let list = [...currentQuotes];
              // newest first
              list.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
              list = filterQuotesBase(list);
              const pi = paginate(list, listPage, PER_PAGE);
              listPage = pi.page;
              updatePaginationUI(pi);
              window.currentViewInProductionModal = 'list'; // Update global tracker

              if (pi.total === 0) {
                container.innerHTML = '<p class="text-gray-500 text-center py-8">Chưa có báo giá nào</p>';
                return;
              }

              container.innerHTML = `
                <table class="min-w-full divide-y divide-gray-200">
                  <thead class="bg-gray-50">
                    <tr>
                      <th class="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Mã BG</th>
                      <th class="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Khu Vực</th>
                      <th class="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">SPO</th>
                      <th class="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">OutletCode</th>
                      <th class="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Tên Outlet</th>
                      <th class="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Sale</th>
                      <th class="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Tiền</th>
                      <th class="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Status SPO</th>
                      <th class="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Status QCAG</th>
                      <th class="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Số ĐH</th>
                      <th class="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Thao Tác</th>
                    </tr>
                  </thead>
                  <tbody class="bg-white divide-y divide-gray-200">
                    ${pi.slice.map((quote, idxOnPage) => {
                      const idxGlobal = (pi.start - 1) + idxOnPage + 1; // natural numbering across all
                      const items = JSON.parse(quote.items || '[]');
                      const rowKey = getQuoteKey(quote);
                      const qcag = quote.qcag_status || '-';
                      const isProduced = String(qcag || '').includes('Đã ra đơn');
                      return `
                        <tr class="hover:bg-gray-50 cursor-pointer" data-row-key="${rowKey}" onclick="toggleQuoteDetails('${rowKey}')">
                          <td class="px-4 py-6 whitespace-nowrap text-sm font-semibold text-gray-900">${quote.qcag_status === 'Hủy' ? `<span class="text-red-600">${formatQuoteCode(quote) || idxGlobal}</span>` : formatQuoteCode(quote) || idxGlobal}</td>
                          <td class="px-4 py-6 whitespace-nowrap text-sm text-gray-900">${quote.area || ''}</td>
                          <td class="px-4 py-3 whitespace-nowrap text-sm">
                            ${quote.sale_type === 'TBA' ? 'TBA' : 'SR'}
                            ${quote.sale_name ? `<div class="text-xs text-gray-600 mt-1">${quote.sale_name}</div>` : ''}
                          </td>
                          </td>
                          <td class="px-4 py-6 whitespace-nowrap text-sm text-gray-900">${quote.outlet_code || ''}</td>
                          <td class="px-4 py-6 whitespace-nowrap text-sm text-gray-900">${quote.outlet_name || ''}</td>
                          <td class="px-4 py-3 whitespace-nowrap text-sm">
                            ${quote.sale_type === 'TBA' ? 'TBA' : 'SR'}
                            ${quote.sale_name ? `<div class="text-xs text-gray-600 mt-1">${quote.sale_name}</div>` : ''}
                          </td>
                          <td class="px-4 py-6 whitespace-nowrap text-sm font-semibold text-blue-600">${formatCurrency(parseMoney(quote.total_amount)||0)}</td>
                          <td class="px-4 py-6 whitespace-nowrap text-sm">
                            <div onclick="event.stopPropagation(); editSPOStatus('${quote.__backendId}')" class="cursor-pointer hover:bg-gray-50 p-1 rounded">
                              <span class="px-2 py-1 text-xs font-medium rounded ${getSPOStatusClass(quote.spo_status)}">${getSPOStatusText(quote.spo_status)}</span>
                            </div>
                          </td>
                          <td class="px-4 py-6 whitespace-nowrap text-sm">${renderQCAGStatusHtml(quote)}</td>
                          <td class="px-4 py-6 whitespace-nowrap text-sm text-gray-900">${getQcagOrderNumber(quote) || ''}</td>
                          <td class="px-4 py-6 whitespace-nowrap text-sm">
                            ${(() => {
                              const isCancelled = quote.qcag_status === 'Hủy';
                              return isCancelled ? `<button onclick="event.stopPropagation(); openRedoModal('${rowKey}')" class="bg-green-600 text-white hover:bg-green-700 font-medium action-fixed-width h-7"><i class="fas fa-redo"></i></button>` : isProduced ? `<button onclick="event.stopPropagation(); openReportCancelModal('${rowKey}')" class="text-yellow-900 hover:text-yellow-700 font-medium action-fixed-width" title="Báo huỷ"><svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7h6"/></svg></button>` : `<button onclick="event.stopPropagation(); deleteQuote('${rowKey}')" class="text-red-600 hover:text-red-800 font-medium action-fixed-width" title="Xóa"><svg xmlns=\"http://www.w3.org/2000/svg\" class=\"w-4 h-4\" fill=\"none\" viewBox=\"0 0 24 24\" stroke=\"currentColor\"><path stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\" d=\"M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7h6\"/></svg></button>`;
                            })()}
                          </td>
                        </tr>
                        <tr id="details-${rowKey}" class="hidden">
                          <td colspan="11" class="px-4 py-4 bg-gray-50">
                            <div class="flex gap-3">
                              <!-- Cột trái 75%: Chi tiết báo giá -->
                              <div class="flex-[3] space-y-4">
                                <div class="flex justify-between items-start gap-6">
                                  <div class="text-sm space-y-2">
                                    <div class="flex flex-wrap gap-4">
                                      <div>
                                        <span class="font-medium text-gray-700">Chức vụ:</span>
                                        ${quote.sale_type === 'TBA' ? ' <span class="text-orange-800">TBA</span>' : ' <span class="text-gray-700">SR</span>'}
                                      </div>
                                      ${quote.sale_code ? `<div><span class=\"font-medium text-gray-700\">Mã Sale:</span> <span class=\"text-gray-600\">${quote.sale_code}</span></div>` : ''}
                                      ${quote.sale_name ? `<div><span class=\"font-medium text-gray-700\">Tên Sale:</span> <span class=\"text-gray-600\">${quote.sale_name}</span></div>` : ''}
                                      ${quote.ss_name ? `<div><span class=\"font-medium text-gray-700\">Tên SS:</span> <span class=\"text-gray-600\">${quote.ss_name}</span></div>` : ''}
                                    </div>
                                    <div class="flex flex-wrap gap-4 mt-2">
                                      <div>
                                        <span class="font-medium text-gray-700">Ngày tạo:</span>
                                        <span class="text-gray-600">${new Date(quote.created_at).toLocaleDateString('vi-VN')}</span>
                                      </div>
                                      ${quote.spo_number ? `<div><span class=\"font-medium text-gray-700\">Số SPO:</span> <span class=\"text-blue-600 font-medium\">${quote.spo_number}</span></div>` : ''}
                                      ${quote.address && quote.address !== 'Địa chỉ sẽ hiển thị tự động khi nhập' ? `<div><span class=\"font-medium text-gray-700\">Địa chỉ:</span> <span class=\"text-gray-600\">${quote.address}</span></div>` : ''}
                                    </div>
                                  </div>
                                  ${(() => { 
                                    let imgs = []; 
                                    try { imgs = JSON.parse(quote.images || '[]'); } catch (e) { imgs = []; }
                                    if (!Array.isArray(imgs) || !imgs.length) return '<div class=\"text-xs text-gray-400\">Không có hình</div>';
                                    return `<div class=\"w-64 flex-shrink-0\"><h4 class=\"font-semibold text-gray-800 mb-2 text-sm\">Hình ảnh (${imgs.length})</h4><div class=\"grid grid-cols-2 gap-2\">${imgs.map(im => `<div class=\"border rounded bg-white overflow-hidden cursor-pointer\" onclick=\"event.stopPropagation(); openImageViewer('${im.data}','${(im.name||'').replace(/'/g,'&#39;')}')\"><img src='${im.data}' alt='${(im.name||'').replace(/'/g,'&#39;')}' class=\"w-full h-24 object-cover\"></div>`).join('')}</div></div>`; 
                                  })()}
                                </div>
                                <div class="space-y-3">
                                  <h4 class="font-semibold text-gray-800">Chi Tiết Hạng Mục (${items.length} mục)</h4>
                                <div class="overflow-x-auto">
                                  <table class="min-w-full text-sm">
                                    <thead class="bg-gray-100">
                                      <tr>
                                        <th class="px-3 py-2 text-left text-xs font-medium text-gray-600">Code</th>
                                        <th class="px-3 py-2 text-left text-xs font-medium text-gray-600">Nội dung</th>
                                        <th class="px-3 py-2 text-left text-xs font-medium text-gray-600">Brand</th>
                                        <th class="px-3 py-2 text-left text-xs font-medium text-gray-600">Ngang x Cao</th>
                                        <th class="px-3 py-2 text-left text-xs font-medium text-gray-600">SL</th>
                                        <th class="px-3 py-2 text-left text-xs font-medium text-gray-600">ĐVT</th>
                                        <th class="px-3 py-2 text-left text-xs font-medium text-gray-600">Đơn giá</th>
                                        <th class="px-3 py-2 text-left text-xs font-medium text-gray-600">Thành tiền</th>
                                      </tr>
                                    </thead>
                                    <tbody class="divide-y divide-gray-200">
                                      ${items.map(item => `
                                        <tr class="hover:bg-gray-50">
                                          <td class="px-3 py-2 text-gray-900 font-medium">${item.code}</td>
                                          <td class="px-3 py-2 text-gray-700">${item.content}</td>
                                          <td class="px-3 py-2 text-gray-600">${item.brand || '-'}</td>
                                          <td class="px-3 py-2 text-gray-600">${item.width && item.height ? `${item.width}m × ${item.height}m` : '-'}</td>
                                          <td class="px-3 py-2 text-gray-900">${item.quantity}</td>
                                          <td class="px-3 py-2 text-gray-600">${item.unit}</td>
                                          <td class="px-3 py-2 text-gray-900">${formatCurrency(parseMoney(item.price) || 0)}</td>
                                          <td class="px-3 py-2 text-blue-600 font-semibold">${item.total}</td>
                                        </tr>
                                      `).join('')}
                                    </tbody>
                                  </table>
                                </div>
                                  <div class="flex justify-end">
                                    <span class="text-lg font-bold text-blue-600">Tổng cộng: ${formatCurrency(parseMoney(quote.total_amount)||0)}</span>
                                  </div>
                                </div>
                              </div>
                              <!-- Cột phải 25%: Xem nhanh ghi chú -->
                              <div class="flex-1 notes-preview" data-notes-preview="${rowKey}">
                                ${renderNotesPreviewHTML(quote)}
                              </div>
                            </div>
                          </td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              `;

              setPaginationHandlers(
                () => paginate(filterQuotesBase([...currentQuotes].sort((a,b)=> new Date(b.created_at)-new Date(a.created_at))), listPage, PER_PAGE),
                (p) => { listPage = p; },
                () => renderListView()
              );
            }
            window.renderProductionListView = renderListView; // Export to global

            function renderOutletView() {
              window.currentViewInProductionModal = 'outlet'; // Update global tracker
              const container = document.getElementById('quotes-list');
              // group by outlet_code
              const map = new Map();
              for (const q of currentQuotes) {
                const code = q.outlet_code || 'UNKNOWN';
                if (!map.has(code)) map.set(code, []);
                map.get(code).push(q);
              }
              // build groups and sort by latest quote time desc
              let groups = Array.from(map.entries()).map(([code, arr]) => {
                const sorted = [...arr].sort((a,b)=> new Date(b.created_at)-new Date(a.created_at));
                const latest = sorted[0];
                return {
                  outlet_code: code,
                  outlet_name: latest?.outlet_name || '',
                  area: latest?.area || '',
                  address: latest?.address || '',
                  quotes: sorted
                };
              });
              // filter by search
              const term = (searchTerm||'').toLowerCase().trim();
              if (term) {
                groups = groups.filter(g =>
                  (g.outlet_name||'').toLowerCase().includes(term) ||
                  (g.outlet_code||'').toLowerCase().includes(term) ||
                  (g.area||'').toLowerCase().includes(term)
                );
              }
              // sort by latest created_at
              groups.sort((a,b)=> new Date(a.quotes[0]?.created_at||0) < new Date(b.quotes[0]?.created_at||0) ? 1 : -1);

              const pi = paginate(groups, outletPage, PER_PAGE);
              outletPage = pi.page;
              updatePaginationUI(pi);

              if (pi.total === 0) {
                container.innerHTML = '<p class="text-gray-500 text-center py-8">Không có Outlet nào</p>';
                return;
              }

              container.innerHTML = `
                <table class="min-w-full divide-y divide-gray-200">
                  <thead class="bg-gray-50">
                    <tr>
                      <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">STT</th>
                      <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Khu Vực</th>
                      <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Outlet Code</th>
                      <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tên Outlet</th>
                      <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Số lượng báo giá</th>
                    </tr>
                  </thead>
                  <tbody class="bg-white divide-y divide-gray-200">
                    ${pi.slice.map((g, idxOnPage) => {
                      const stt = (pi.start - 1) + idxOnPage + 1;
                      const key = `outlet_${g.outlet_code.replace(/[^a-zA-Z0-9_-]/g,'_')}`;
                      const addr = (g.address && g.address !== 'Địa chỉ sẽ hiển thị tự động khi nhập') ? g.address : '';
                      return `
                        <tr class="hover:bg-gray-50">
                          <td class="px-4 py-6 whitespace-nowrap text-sm text-gray-900">${stt}</td>
                          <td class="px-4 py-6 whitespace-nowrap text-sm text-gray-900">${g.area}</td>
                          <td class="px-4 py-6 whitespace-nowrap text-sm text-gray-900">${g.outlet_code}</td>
                          <td class="px-4 py-6 whitespace-nowrap text-sm text-gray-900">
                            <div class="font-medium">${g.outlet_name}</div>
                            ${addr ? `<div class=\"text-xs text-gray-500\">${addr}</div>` : ''}
                          </td>
                          <td class="px-4 py-6 whitespace-nowrap text-sm text-right">
                            <button class="text-blue-600 hover:underline" onclick="toggleOutletQuotes('${key}')">${g.quotes.length}</button>
                          </td>
                        </tr>
                        <tr id="${key}" class="hidden">
                          <td colspan="5" class="px-4 py-4 bg-gray-50">
                            ${renderOutletQuotesTable(g.quotes)}
                          </td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              `;

              setPaginationHandlers(
                () => paginate(groups, outletPage, PER_PAGE),
                (p) => { outletPage = p; },
                () => renderOutletView()
              );
            }
            window.renderProductionOutletView = renderOutletView; // Export to global

            function renderOutletQuotesTable(quotes) {
              const rows = quotes.map((quote, idx) => {
                const quoteCode = formatQuoteCode(quote) || (idx + 1);
                const isProduced = String(quote.qcag_status || '').includes('Đã ra đơn');
                return `
                  <tr class="hover:bg-white/60">
                    <td class="px-3 py-2 text-xs font-semibold text-gray-900">${quote.qcag_status === 'Hủy' ? `<span class="text-red-600">${quoteCode}</span>` : quoteCode}</td>
                    <td class="px-3 py-2 text-xs">${quote.area || ''}</td>
                    <td class="px-3 py-2 text-xs">${quote.spo_number || ''}</td>
                    <td class="px-3 py-2 text-xs">${quote.qcag_status === 'Hủy' ? `<span class="text-red-600">${quote.outlet_code || ''}</span>` : quote.outlet_code || ''}</td>
                    <td class="px-3 py-2 text-xs">${quote.qcag_status === 'Hủy' ? `<span class="text-red-600">${quote.outlet_name || ''}</span>` : quote.outlet_name || ''}</td>
                    <td class="px-3 py-2 text-xs">
                      <span class="px-1.5 py-0.5 text-[10px] font-medium rounded ${quote.sale_type === 'TBA' ? 'bg-orange-100 text-orange-800' : 'bg-blue-100 text-blue-800'}">${quote.sale_type || 'Sale (SR)'}</span>
                      ${quote.sale_name ? `<div class=\"text-[10px] text-gray-600 mt-1\">${quote.sale_name}</div>` : ''}
                    </td>
                    <td class="px-3 py-2 text-xs text-right text-blue-600 font-medium">${formatCurrency(parseMoney(quote.total_amount)||0)}</td>
                    <td class="px-3 py-2 text-xs">
                      <span class="px-1.5 py-0.5 rounded ${getSPOStatusClass(quote.spo_status)}">${getSPOStatusText(quote.spo_status)}</span>
                    </td>
                    <td class="px-3 py-2 text-xs">${renderQCAGStatusHtml(quote)}</td>
                    <td class="px-3 py-2 text-xs">${getQcagOrderNumber(quote) || ''}</td>
                    <td class="px-3 py-2 text-xs">
                      <div class="inline-flex items-center gap-2">
                        ${(() => {
                          const isCancelled = quote.qcag_status === 'Hủy';
                          const shouldShowCancel3 = isProduced || (computeQCAGStatus ? computeQCAGStatus(quote).status === 'Chờ tạo đơn' : false) || hasEverHadOrder(quote);
                          return isCancelled ? `<button onclick="event.stopPropagation(); openRedoModal('${getQuoteKey(quote)}')" class="px-2 py-1 text-xs bg-green-600 text-white rounded action-fixed-width h-7 hover:bg-green-700" title="Làm lại"><i class="fas fa-redo"></i></button>` : shouldShowCancel3 ? `<button onclick="event.stopPropagation(); openReportCancelModal('${getQuoteKey(quote)}')" class="px-2 py-1 text-xs bg-yellow-400 text-yellow-900 rounded action-fixed-width hover:bg-yellow-500 hover:text-yellow-900" title="Báo huỷ"><svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7h6"/></svg></button>` : `<button onclick="event.stopPropagation(); deleteQuote('${getQuoteKey(quote)}')" class="px-2 py-1 text-xs bg-red-600 text-white rounded action-fixed-width" title="Xóa"><svg xmlns=\"http://www.w3.org/2000/svg\" class=\"w-4 h-4\" fill=\"none\" viewBox=\"0 0 24 24\" stroke=\"currentColor\"><path stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\" d=\"M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7h6\"/></svg></button>`;
                        })()}
                        ${(() => { const c = getQuoteNotes(quote).length; const countClass = c > 0 ? 'note-btn-count has-notes' : 'note-btn-count'; const pdfBtn = `<button onclick=\"event.stopPropagation(); exportQuoteAsPdf('${getQuoteKey(quote)}')\" class=\"px-2 py-1 text-xs bg-indigo-600 text-white rounded inline-flex items-center gap-1\" title=\"PDF\">PDF</button>`; return `${pdfBtn}<button onclick=\"event.stopPropagation(); openQuoteNotesModal('${getQuoteKey(quote)}')\" data-note-btn=\"${getQuoteKey(quote)}\" class=\"note-btn note-btn-compact\" title=\"Ghi chú\"><span class=\"note-btn-main\"></span><span class=\"${countClass}\">${c || 0}</span></button>`; })()}
                      </div>
                    </td>
                  </tr>
                `;
              }).join('');
              return `
                <div class="overflow-x-auto">
                  <table class="min-w-full text-sm">
                    <thead class="bg-gray-100">
                      <tr>
                        <th class="px-3 py-2 text-left text-[11px] text-gray-600">Mã BG</th>
                        <th class="px-3 py-2 text-left text-[11px] text-gray-600">Khu Vực</th>
                        <th class="px-3 py-2 text-left text-[11px] text-gray-600">SPO</th>
                        <th class="px-3 py-2 text-left text-[11px] text-gray-600">OutletCode</th>
                        <th class="px-3 py-2 text-left text-[11px] text-gray-600">Tên Outlet</th>
                        <th class="px-3 py-2 text-left text-[11px] text-gray-600">Sale</th>
                        <th class="px-3 py-2 text-right text-[11px] text-gray-600">Tiền</th>
                        <th class="px-3 py-2 text-left text-[11px] text-gray-600">Status SPO</th>
                        <th class="px-3 py-2 text-left text-[11px] text-gray-600">Status QCAG</th>
                        <th class="px-3 py-2 text-left text-[11px] text-gray-600">Số ĐH</th>
                        <th class="px-3 py-2 text-left text-[11px] text-gray-600">Thao Tác</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y">${rows}</tbody>
                  </table>
                </div>
              `;
            }

            window.toggleOutletQuotes = function(id) {
              const row = document.getElementById(id);
              if (!row) return;
              prepareCollapsibleRow(row);
              const shouldOpen = !row.classList.contains('open');
              const headerRow = row.previousElementSibling;
              const panel = row.querySelector('.collapsible');
              const stopPin = pinRowDuringAnimation(headerRow || row, panel);
              setCollapsibleState(row, shouldOpen);
            }

            // ===== Selection & Filtering for Production Modal =====
            const APPROVED = getApprovedSet();
            const PRODUCED = getProducedSet();
            // Base: start with all quotes (filters and toggles will narrow down)
            // Using global variables to maintain state across modal opens



            function applySelectionFilters() {
              // QUAN TRỌNG: LUÔN bắt đầu từ currentQuotes (toàn bộ danh sách gốc)
              // Không dùng productionModalQuotesToFilter để tránh lọc trên kết quả cũ
              let arr = [...currentQuotes];

              // Approved / unapproved toggles take precedence
              if (productionModalApprovedOnly) {
                // Require a SPO number as well as an approved status
                arr = arr.filter(q => (q.spo_number && /Approved|Checked Variation/i.test(String(q.spo_status || ''))));
              }
              if (productionModalUnapprovedOnly) {
                // Unapproved includes missing SPO or statuses that are not cancelled/rejected/accepted/finished/approved
                arr = arr.filter(q => (!q.spo_number) || !/cancel|reject|accept|finish|Approved|Checked Variation/i.test(String(q.spo_status || '')));
              }
              // Nếu không chọn trạng thái, hiển thị cả hai nhóm
              if (!productionModalApprovedOnly && !productionModalUnapprovedOnly) {
                arr = arr.filter(q => (q.spo_number && /Approved|Checked Variation/i.test(String(q.spo_status || ''))) || (!q.spo_number) || !/cancel|reject|accept|finish|Approved|Checked Variation/i.test(String(q.spo_status || '')));
              }

              // Specific status filter or selected
              if (productionModalActiveFilter === 'selected') {
                // Selected filter must show ALL selected quotes regardless of other filters.
                // Return the full selected set directly from currentQuotes.
                return currentQuotes.filter(q => selectedQuotes.has(getQuoteKey(q)));
              } else if (productionModalActiveFilter && productionModalActiveFilter !== 'all') {
                // If activeFilter matches one of the exact status strings, filter by it
                arr = arr.filter(q => q.spo_status === productionModalActiveFilter);
              }

              // Area multi-select
              if (productionModalAreaFilters && productionModalAreaFilters.size > 0) {
                arr = arr.filter(q => productionModalAreaFilters.has(q.area));
              }

              // Search term
              if (productionModalTermForSelection) {
                const norm = (typeof normalizeForSearch === 'function') ? normalizeForSearch(productionModalTermForSelection) : String(productionModalTermForSelection || '').toLowerCase();
                try {
                  const c = document.getElementById('production-quotes-list');
                  if (c && c._prodSearchIndex && typeof c._prodSearchIndex.get === 'function') {
                    arr = arr.filter(q => {
                      try {
                        const k = getQuoteKey(q);
                        const s = String(c._prodSearchIndex.get(k) || '');
                        return s.indexOf(norm) !== -1;
                      } catch (e) { return false; }
                    });
                  } else {
                    const t = productionModalTermForSelection.toLowerCase();
                    arr = arr.filter(q => {
                      const outletName = String(q && q.outlet_name || '').toLowerCase();
                      const outletCode = String(q && q.outlet_code || '').toLowerCase();
                      const area = String(q && q.area || '').toLowerCase();
                      const saleName = String(q && q.sale_name || '').toLowerCase();
                      const ssName = String(q && q.ss_name || '').toLowerCase();
                      const spo = String(q && q.spo_number || '').toLowerCase();
                      let quoteCode = '';
                      try {
                        quoteCode = String((typeof formatQuoteCode === 'function' ? formatQuoteCode(q) : (q && q.quote_code)) || '');
                      } catch (e) {
                        quoteCode = String(q && q.quote_code || '');
                      }
                      quoteCode = quoteCode.toLowerCase();
                      let orderNo = '';
                      try {
                        orderNo = String((typeof getQcagOrderNumber === 'function' ? getQcagOrderNumber(q) : '') || (q && (q.order_number || q.qcag_order_number)) || '');
                      } catch (e) {
                        orderNo = String(q && (q.order_number || q.qcag_order_number) || '');
                      }
                      orderNo = orderNo.toLowerCase();
                      return (
                        outletName.includes(t) ||
                        outletCode.includes(t) ||
                        area.includes(t) ||
                        saleName.includes(t) ||
                        ssName.includes(t) ||
                        quoteCode.includes(t) ||
                        spo.includes(t) ||
                        orderNo.includes(t)
                      );
                    });
                  }
                } catch (e) {
                  // fallback to previous behavior
                  const t = productionModalTermForSelection.toLowerCase();
                  arr = arr.filter(q => String(q && (q.outlet_name || '')).toLowerCase().includes(t));
                }
              }
              return arr;
            }

            // Bind search - CHỈ TÌM KHI NHẤN ENTER (không realtime)
            const sInput = document.getElementById('production-search');
            if (sInput && !sInput._bound) {
              sInput._bound = true;
              sInput._emptyResetTimer = null;
              
              // Helper function to perform search
              function performProductionSearch() {
                productionModalTermForSelection = (sInput.value || '').trim();
                // Reset to page 1
                try { const c = document.getElementById('production-quotes-list'); if (c) c._prodPage = 1; } catch (e) {}
                // FORCE REBUILD: Clear cached state to ensure fresh render
                const container = document.getElementById('production-quotes-list');
                if (container) {
                  delete container._prodRowMap;
                  delete container._prodVisible;
                  delete container._prodBuilt;
                }
                // QUAN TRỌNG: Luôn reset về danh sách gốc trước khi filter
                // Điều này đảm bảo mỗi lần search đều lọc từ toàn bộ currentQuotes,
                // không phụ thuộc vào kết quả của lần search trước
                productionModalQuotesToFilter = [...currentQuotes];
                // Apply current filters and render
                const sorted = sortQuotes(applySelectionFilters(), 'newest');
                productionModalFilteredQuotes = sorted;
                renderProductionQuotes(sorted);
                updateSelectedCount();
              }
              
              // Theo dõi thay đổi input để auto-reset khi rỗng
              sInput.addEventListener('input', function(e) {
                // Hủy timer cũ
                if (sInput._emptyResetTimer) {
                  clearTimeout(sInput._emptyResetTimer);
                  sInput._emptyResetTimer = null;
                }
                
                // Nếu ô tìm rỗng, sau 1s tự động reset về tất cả
                const val = (sInput.value || '').trim();
                if (!val) {
                  sInput._emptyResetTimer = setTimeout(() => {
                    sInput._emptyResetTimer = null;
                    performProductionSearch(); // reset về tất cả
                  }, 1000);
                }
              });

              sInput.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  // Hủy pending timer nếu có
                  if (sInput._emptyResetTimer) {
                    clearTimeout(sInput._emptyResetTimer);
                    sInput._emptyResetTimer = null;
                  }
                  // Tìm kiếm ngay lập tức
                  performProductionSearch();
                } else if (e.key === 'Escape') {
                  // Xóa nội dung và reset ngay
                  e.preventDefault();
                  sInput.value = '';
                  if (sInput._emptyResetTimer) {
                    clearTimeout(sInput._emptyResetTimer);
                    sInput._emptyResetTimer = null;
                  }
                  performProductionSearch();
                }
              });
            }

            // Multi toggles and filters - using global variables

            // Reset UI state when opening modal (unless preserving selection)
            if (typeof preserveSelection === 'undefined' || !preserveSelection) {
              // Clear visual active classes
              document.querySelectorAll('#production-order-modal .area-filter, #production-order-modal .toggle-filter').forEach(b => b.classList.remove('active'));
              document.querySelectorAll('#production-order-modal .filter-btn').forEach(b => b.classList.remove('active'));
              const allBtn = document.querySelector('#production-order-modal .filter-btn[data-filter="all"]');
              if (allBtn) allBtn.classList.add('active');

              // Reset search input and internal term
              const ps = document.getElementById('production-search');
              if (ps) { ps.value = ''; }
              productionModalTermForSelection = '';
              try { const c = document.getElementById('production-quotes-list'); if (c) c._prodPage = 1; } catch (e) { /* ignore */ }

              // Reset filter state vars
              productionModalAreaFilters.clear();
              productionModalApprovedOnly = false;
              productionModalUnapprovedOnly = false;
              productionModalActiveFilter = 'all';

              // Reset list to full current quotes
              productionModalQuotesToFilter = [...currentQuotes];
              productionModalFilteredQuotes = productionModalQuotesToFilter;

              // Re-render is done once at the end of openProductionOrderModal
              // to avoid doing the expensive filter/render twice.
              updateSelectedCount();
              updateSelectedSummary();
            }

            // Bind status filter buttons (single-selection, with toggle support for 'selected')
            document.querySelectorAll('#production-order-modal .filter-btn').forEach(btn => {
              if (btn._bound) return;
              btn._bound = true;
              btn.addEventListener('click', () => {
                const filterName = btn.dataset.filter || 'all';
                if (filterName === 'selected') {
                  // Toggle behavior for selected filter
                  const currentlyActive = btn.classList.contains('active');
                  document.querySelectorAll('#production-order-modal .filter-btn').forEach(b => b.classList.remove('active'));
                  if (!currentlyActive) {
                    btn.classList.add('active');
                    productionModalActiveFilter = 'selected';
                  } else {
                    // turning off 'selected'
                    productionModalActiveFilter = 'all';
                    // If no filters remain, reset to full list
                    if (!productionModalApprovedOnly && !productionModalUnapprovedOnly && productionModalAreaFilters.size === 0 && !productionModalTermForSelection) {
                      productionModalQuotesToFilter = [...currentQuotes];
                      productionModalFilteredQuotes = productionModalQuotesToFilter;
                      renderProductionQuotes(productionModalQuotesToFilter);
                      updateSelectedCount();
                      return;
                    }
                  }
                } else {
                  // normal single-selection behavior
                  document.querySelectorAll('#production-order-modal .filter-btn').forEach(b => b.classList.remove('active'));
                  btn.classList.add('active');
                  productionModalActiveFilter = filterName;
                }
                const sorted = sortQuotes(applySelectionFilters(), 'newest');
                productionModalFilteredQuotes = sorted;
                renderProductionQuotes(sorted);
                updateSelectedCount();
              });
            });

            // Area buttons (single-select now)
            document.querySelectorAll('#production-order-modal .area-filter').forEach(btn => {
              if (btn._bound) return;
              btn._bound = true;
              btn.addEventListener('click', () => {
                const area = btn.dataset.area;
                const currentlyActive = btn.classList.contains('active');
                // Clear previous selection (single-select behavior)
                document.querySelectorAll('#production-order-modal .area-filter').forEach(b => b.classList.remove('active'));
                productionModalAreaFilters.clear();
                // If it wasn't active, activate this one; otherwise leave none active (toggle off)
                if (!currentlyActive) {
                  productionModalAreaFilters.add(area);
                  btn.classList.add('active');
                }

                // If no filters remain active, reset to full list for consistency
                if (!productionModalApprovedOnly && !productionModalUnapprovedOnly && productionModalAreaFilters.size === 0 && !productionModalTermForSelection && productionModalActiveFilter === 'all') {
                  productionModalQuotesToFilter = [...currentQuotes];
                  productionModalFilteredQuotes = productionModalQuotesToFilter;
                  renderProductionQuotes(productionModalQuotesToFilter);
                  updateSelectedCount();
                  return;
                }

                const sorted = sortQuotes(applySelectionFilters(), 'newest');
                productionModalFilteredQuotes = sorted;
                renderProductionQuotes(sorted);
                updateSelectedCount();
              });
            });

            // Approved / Unapproved toggles
            const approvedBtn = document.getElementById('filter-approved');
            if (approvedBtn && !approvedBtn._bound) {
              approvedBtn._bound = true;
              approvedBtn.addEventListener('click', () => {
                productionModalApprovedOnly = !productionModalApprovedOnly;
                approvedBtn.classList.toggle('active', productionModalApprovedOnly);
                // Ensure unapproved is off when approved is enabled
                if (productionModalApprovedOnly) {
                  productionModalUnapprovedOnly = false;
                  const ub = document.getElementById('filter-unapproved');
                  if (ub) ub.classList.remove('active');
                }
                // If no filters remain active, reset to full list for consistency
                if (!productionModalApprovedOnly && !productionModalUnapprovedOnly && productionModalAreaFilters.size === 0 && !productionModalTermForSelection && productionModalActiveFilter === 'all') {
                  productionModalQuotesToFilter = [...currentQuotes];
                  productionModalFilteredQuotes = productionModalQuotesToFilter;
                  renderProductionQuotes(productionModalQuotesToFilter);
                  updateSelectedCount();
                  return;
                }
                const sorted = sortQuotes(applySelectionFilters(), 'newest');
                productionModalFilteredQuotes = sorted;
                renderProductionQuotes(sorted);
                updateSelectedCount();
              });
            }

            const unapprovedBtn = document.getElementById('filter-unapproved');
            if (unapprovedBtn && !unapprovedBtn._bound) {
              unapprovedBtn._bound = true;
              unapprovedBtn.addEventListener('click', () => {
                productionModalUnapprovedOnly = !productionModalUnapprovedOnly;
                unapprovedBtn.classList.toggle('active', productionModalUnapprovedOnly);
                // Ensure approved is off when unapproved is enabled
                if (productionModalUnapprovedOnly) {
                  productionModalApprovedOnly = false;
                  const ab = document.getElementById('filter-approved');
                  if (ab) ab.classList.remove('active');
                }
                // If no filters remain active, reset to full list for consistency
                if (!productionModalApprovedOnly && !productionModalUnapprovedOnly && productionModalAreaFilters.size === 0 && !productionModalTermForSelection && productionModalActiveFilter === 'all') {
                  productionModalQuotesToFilter = [...currentQuotes];
                  productionModalFilteredQuotes = productionModalQuotesToFilter;
                  renderProductionQuotes(productionModalQuotesToFilter);
                  updateSelectedCount();
                  return;
                }
                const sorted = sortQuotes(applySelectionFilters(), 'newest');
                productionModalFilteredQuotes = sorted;
                renderProductionQuotes(sorted);
                updateSelectedCount();
              });
            }

            // Clear filters
            const clearFiltersBtn = document.getElementById('clear-filters');
            if (clearFiltersBtn && !clearFiltersBtn._bound) {
              clearFiltersBtn._bound = true;
                clearFiltersBtn.addEventListener('click', () => {
                  productionModalAreaFilters.clear();
                  productionModalApprovedOnly = false;
                  productionModalUnapprovedOnly = false;
                  document.querySelectorAll('#production-order-modal .area-filter, #production-order-modal .toggle-filter').forEach(b => b.classList.remove('active'));
                  document.querySelectorAll('#production-order-modal .filter-btn').forEach(b => b.classList.remove('active'));
                  const allBtn = document.querySelector('#production-order-modal .filter-btn[data-filter="all"]');
                  if (allBtn) allBtn.classList.add('active');
                  productionModalActiveFilter = 'all';
                  // Reset quotesToFilter về danh sách gốc
                  productionModalQuotesToFilter = [...currentQuotes];
                  productionModalFilteredQuotes = productionModalQuotesToFilter;
                  renderProductionQuotes(productionModalQuotesToFilter);
                  updateSelectedCount();
                });
            }

            // Bind action buttons
            const closeBtn = document.getElementById('close-production-modal');
            if (closeBtn && !closeBtn._bound) {
              closeBtn._bound = true;
              closeBtn.addEventListener('click', () => closeProductionModal(false));
            }
            const cancelBtn = document.getElementById('cancel-production');
            if (cancelBtn && !cancelBtn._bound) {
              cancelBtn._bound = true;
              cancelBtn.addEventListener('click', () => closeProductionModal(false));
            }
            const createListBtn = document.getElementById('create-production-list');
            if (createListBtn && !createListBtn._bound) {
              createListBtn._bound = true;
              createListBtn.addEventListener('click', createProductionList);
            }

            // Apply sort
            const sortValue = (document.getElementById('production-sort') || {}).value || 'newest';
            productionModalQuotesToFilter = sortQuotes(productionModalQuotesToFilter, sortValue);

            productionModalFilteredQuotes = productionModalQuotesToFilter;
            renderProductionQuotes(productionModalQuotesToFilter);
            updateStatsBar();

            if (__qcagProfile) {
              try {
                const __qcagT1 = (window.performance && typeof performance.now === 'function') ? performance.now() : __qcagT0;
                console.log('totalMs', Math.round(__qcagT1 - __qcagT0));
              } catch (e) { /* ignore */ }
              try { console.groupEnd(); } catch (e) { /* ignore */ }
            }
        }

        function sortQuotes(quotes, sortValue) {
            const arr = [...quotes];
            switch (sortValue) {
                case 'amount_desc':
                  return arr.sort((a, b) => (parseMoney(b.total_amount) || 0) - (parseMoney(a.total_amount) || 0));
                case 'amount_asc':
                  return arr.sort((a, b) => (parseMoney(a.total_amount) || 0) - (parseMoney(b.total_amount) || 0));
                case 'area':
                    return arr.sort((a, b) => (a.area || '').localeCompare(b.area || ''));
                case 'sale_name':
                    return arr.sort((a, b) => (a.sale_name || '').localeCompare(b.sale_name || ''));
                case 'newest':
                default:
                    return arr.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            }
        }

        function getApprovedSet() {
            return new Set([
                'Area Sales Manager Approved...',
                'Sales Supervisor Checked Variation',
                'Sales Rep Checked Variation'
            ]);
        }

            // Reviewed set: statuses considered "Đã duyệt SPO" (ASM + SS Checked)
            function getReviewedSet() {
              return new Set([
                'Area Sales Manager Approved...',
                'Sales Supervisor Checked Variation'
              ]);
            }

        function getProducedSet() {
            return new Set([
                'Sales Rep Accepted',
                'Store Keeper Finish',
                'Sales Admin Finish',
                'Sales Supervisor Finish',
                'Sign Maker Installed Signage'
            ]);
        }

        function updateFilterCounts() {
            const APPROVED = getApprovedSet();
            const PRODUCED = getProducedSet();
            const eligible = currentQuotes.filter(q => APPROVED.has(q.spo_status) && !PRODUCED.has(q.spo_status));
            const byStatus = {
                'Area Sales Manager Approved...': 0,
                'Sales Supervisor Checked Variation': 0,
                'Sales Rep Checked Variation': 0
            };
            eligible.forEach(q => {
                if (byStatus[q.spo_status] !== undefined) byStatus[q.spo_status]++;
            });

            // Update spans
            document.querySelectorAll('.js-count').forEach(span => {
                const status = span.dataset.status;
                if (status === '__ALL__') {
                    span.textContent = eligible.length;
                } else if (byStatus[status] !== undefined) {
                    span.textContent = byStatus[status];
                }
            });
        }

        // Stable key for quotes across sources (SDK, seeded, local). Avoids 'undefined' selecting all.
        function getQuoteKey(q) {
            if (!q) return '';
            // Prefer permanent quote code, then backend id, explicit id, SPO number
            const primary = q.quote_code || q.__backendId || q.id || q.spo_number;
            if (primary) return String(primary);
            // Fallback compose from stable fields available in both SDK and seeded data
            const outlet = q.outlet_code || 'OC';
            const sale = q.sale_name || 'SN';
            const created = q.created_at || q.date || '';
            const total = q.total_amount != null ? q.total_amount : '';
            return String(`${outlet}__${sale}__${created}__${total}`);
        }
