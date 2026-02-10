    function setCollapsibleState(row, shouldOpen) {
      if (!row) return;
      prepareCollapsibleRow(row);
      const panel = row.querySelector('.collapsible');
      if (!panel) return;

      const handleTransitionEnd = (evt) => {
        if (evt.target !== panel || evt.propertyName !== 'max-height') return;
        if (shouldOpen) {
          panel.style.maxHeight = 'none';
        } else {
          panel.style.maxHeight = '';
        }
        panel.removeEventListener('transitionend', handleTransitionEnd);
      };
      panel.addEventListener('transitionend', handleTransitionEnd);

      if (shouldOpen) {
        panel.style.maxHeight = 'none';
        const targetHeight = panel.scrollHeight;
        panel.style.maxHeight = '0px';
        nextFrame(() => {
          row.classList.add('open');
          panel.classList.add('open');
          panel.style.maxHeight = `${targetHeight}px`;
        });
      } else {
        panel.style.maxHeight = 'none';
        const currentHeight = panel.scrollHeight;
        panel.style.maxHeight = `${currentHeight}px`;
        void panel.offsetHeight;
        nextFrame(() => {
          row.classList.remove('open');
          panel.classList.remove('open');
          panel.style.maxHeight = '0px';
        });
      }
    }

    // Toggle Quote Details
    window.toggleQuoteDetails = function(key) {
      const detailRow = document.getElementById(`details-${key}`);
      if (!detailRow) return;

      const willOpen = !detailRow.classList.contains('open');
      if (willOpen) {
        try { __qcagEnsureQuoteDetailsLoaded(detailRow, key); } catch (e) { /* ignore */ }
      }

      // Prepare once: unwrap hidden/content into .collapsible and keep it in flow (no display none)
      prepareCollapsibleRow(detailRow);

      const panel = detailRow.querySelector('.collapsible');
      if (!panel) return;

      const headerRow = document.querySelector(`tr[data-row-key="${key}"]`) || detailRow.previousElementSibling;
      // willOpen computed above

      // Keep level-1 row visually locked while level-2 animates height
      const stopPin = pinRowDuringAnimation(headerRow || detailRow, panel);

      // Close other detail rows in the same group without letting header rows jump
      document.querySelectorAll('tr[data-collapse-group="quote-details"].open').forEach(row => {
        if (row !== detailRow) {
          setCollapsibleState(row, false);
        }
      });

      setCollapsibleState(detailRow, willOpen);
    };

    // Delete Quote with confirmation modal
    window.deleteQuote = function(backendId) {
      const keyStr = backendId != null ? String(backendId) : '';
      if (!keyStr) {
        showToast('Không tìm thấy báo giá để xóa');
        return;
      }

      const quoteMatchesKey = (q) => {
        if (!q) return false;
        const candidates = [q.__backendId, q.id, q.quote_code, q.spo_number, getQuoteKey(q)];
        return candidates.some(v => v != null && String(v) === keyStr);
      };

      const quote = currentQuotes.find(quoteMatchesKey);
      if (!quote) {
        showToast('Không tìm thấy báo giá để xóa');
        return;
      }

      // Prevent deleting a quote that has been produced — require Báo huỷ instead
      const isProduced = String(quote.qcag_status || '').includes('Đã ra đơn');
      if (isProduced) {
        showToast('Báo giá đã ra đơn sản xuất — sử dụng "Báo huỷ" để đánh dấu huỷ');
        return;
      }

      // Remove any stale overlay before adding a new one
      const stale = document.getElementById('delete-quote-overlay');
      if (stale) stale.remove();

      const outletLabel = quote.outlet_name || quote.outlet_code || 'này';
      const overlay = document.createElement('div');
      overlay.id = 'delete-quote-overlay';
      overlay.className = 'fixed inset-0 z-[120] modal-backdrop flex items-center justify-center p-4';
      overlay.innerHTML = `
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 relative">
          <div class="flex items-start justify-between mb-4">
            <div>
              <h3 class="text-xl font-bold text-gray-800">Xác nhận xóa</h3>
              <p class="text-sm text-gray-500 mt-1">Thao tác này sẽ xóa báo giá khỏi danh sách.</p>
            </div>
            <button type="button" class="text-gray-400 hover:text-gray-600 text-2xl leading-none" data-action="cancel-delete" aria-label="Đóng">×</button>
          </div>
          <p class="text-gray-800 mb-6">Bạn có chắc chắn xóa báo giá (${outletLabel}) không?</p>
          <div class="flex justify-end gap-3">
            <button type="button" class="bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium px-4 py-2 rounded" data-action="cancel-delete">Hủy (Esc)</button>
            <button type="button" class="bg-red-600 hover:bg-red-700 text-white font-semibold px-4 py-2 rounded" data-action="confirm-delete">Xác nhận (Enter)</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      ensureScrollLock();

      const confirmBtn = overlay.querySelector('[data-action="confirm-delete"]');
      const cancelBtns = overlay.querySelectorAll('[data-action="cancel-delete"]');
      let isProcessing = false;

      const cleanup = () => {
        document.removeEventListener('keydown', handleKeydown, true);
        overlay.remove();
        ensureScrollLock();
      };

      const handleCancel = () => {
        if (isProcessing) return;
        cleanup();
      };

      const handleKeydown = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          handleCancel();
        } else if (event.key === 'Enter') {
          event.preventDefault();
          confirmBtn.click();
        }
      };

      document.addEventListener('keydown', handleKeydown, true);
      cancelBtns.forEach(btn => btn.addEventListener('click', handleCancel));

      confirmBtn.addEventListener('click', async () => {
        if (isProcessing) return;
        isProcessing = true;
        confirmBtn.disabled = true;
        cancelBtns.forEach(btn => btn.disabled = true);
        confirmBtn.innerHTML = '<div class="loading-spinner"></div>';

        try {
          const hasBackendDelete = window.dataSdk && typeof window.dataSdk.delete === 'function';
          const result = hasBackendDelete ? await window.dataSdk.delete(quote) : { isOk: true, localOnly: true };

          const success = result && (result.isOk === true || result.isOk === undefined || result === true);

          if (!success && hasBackendDelete) {
            showToast('Lỗi khi xóa báo giá');
            return;
          }

          // Remove locally regardless (demo mode or backend success)
          currentQuotes = currentQuotes.filter(q => !quoteMatchesKey(q));
          selectedQuotes.delete(getQuoteKey(quote));
          productionModalFilteredQuotes = productionModalFilteredQuotes.filter(q => !quoteMatchesKey(q));
          pendingJumpToFirstPage = true;
          updateMainList();

          const productionModal = document.getElementById('production-order-modal');
          const isProductionOpen = productionModal && !productionModal.classList.contains('hidden');
          if (isProductionOpen && typeof renderProductionQuotes === 'function') {
            renderProductionQuotes(productionModalFilteredQuotes);
            if (typeof updateSelectedCount === 'function') updateSelectedCount();
            if (typeof updateSelectedSummary === 'function') updateSelectedSummary();
          }

          showToast(hasBackendDelete ? 'Đã xóa báo giá' : 'Đã xóa báo giá (local)');
        } catch (err) {
          console.error('Delete quote failed', err);
          // Fallback: still remove locally so demo không kẹt UI
          currentQuotes = currentQuotes.filter(q => !quoteMatchesKey(q));
          productionModalFilteredQuotes = productionModalFilteredQuotes.filter(q => !quoteMatchesKey(q));
          pendingJumpToFirstPage = true;
          updateMainList();
          showToast('Đã xóa báo giá (local)');
        } finally {
          cleanup();
        }
      });

      setTimeout(() => { confirmBtn.focus(); }, 0);
    };

    // Open Cancel Report Modal for a produced quote (Báo huỷ)
    window.openReportCancelModal = function(backendId) {
      const keyStr = backendId != null ? String(backendId) : '';
      if (!keyStr) { showToast('Không tìm thấy báo giá'); return; }
      const quoteMatchesKey = (q) => {
        if (!q) return false;
        const candidates = [q.__backendId, q.id, q.quote_code, q.spo_number, getQuoteKey(q)];
        return candidates.some(v => v != null && String(v) === keyStr);
      };
      const quote = currentQuotes.find(quoteMatchesKey);
      if (!quote) { showToast('Không tìm thấy báo giá'); return; }

      // Remove stale overlay
      const stale = document.getElementById('report-cancel-overlay');
      if (stale) stale.remove();

      const overlay = document.createElement('div');
      overlay.id = 'report-cancel-overlay';
      overlay.className = 'fixed inset-0 z-[120] modal-backdrop flex items-center justify-center p-4';
      overlay.innerHTML = `
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 relative">
          <div class="flex items-start justify-between mb-4">
            <div>
              <h3 class="text-xl font-bold text-gray-800">Báo huỷ báo giá</h3>
              <p class="text-sm text-gray-500 mt-1">Nhập lý do (tuỳ chọn) và chọn trạng thái liên quan.</p>
            </div>
            <button type="button" class="text-gray-400 hover:text-gray-600 text-2xl leading-none" data-action="cancel-report" aria-label="Đóng">×</button>
          </div>
          <div class="mb-4">
            <input id="cancel-reason-input" placeholder="Lý do báo huỷ (tuỳ chọn)" class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500">
          </div>
          <div class="flex justify-end gap-3">
            <button id="confirm-cancel-produced" class="bg-red-600 hover:bg-red-700 text-white font-semibold px-4 py-2 rounded">Đã sản xuất</button>
            <button id="confirm-cancel-not-produced" class="bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium px-4 py-2 rounded">Chưa sản xuất</button>
            <button type="button" class="bg-gray-100 hover:bg-gray-200 text-gray-800 px-4 py-2 rounded" data-action="cancel-report">Hủy</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      ensureScrollLock();

      const cleanup = () => { document.removeEventListener('keydown', handleKeydown, true); overlay.remove(); ensureScrollLock(); };
      const handleCancel = () => cleanup();
      const handleKeydown = (e) => { if (e.key === 'Escape') { e.preventDefault(); handleCancel(); } };
      document.addEventListener('keydown', handleKeydown, true);
      overlay.querySelectorAll('[data-action="cancel-report"]').forEach(b => b.addEventListener('click', handleCancel));

      const finish = async (produced) => {
        const btn = document.getElementById(produced ? 'confirm-cancel-produced' : 'confirm-cancel-not-produced');
        if (!btn) return;
        btn.disabled = true;
        const reason = String(document.getElementById('cancel-reason-input').value || '').trim();
        try {
          const reasonText = reason ? `, huỷ vì ${reason}` : '';
          const noteText = `Báo giá này ${produced ? 'đã sản xuất' : 'chưa sản xuất'}${reasonText}`;
          const existingNotes = getQuoteNotes(quote);
          const newNote = ensureNoteHasAuthor({ text: noteText, at: new Date().toISOString() });
          const updatedNotes = [...existingNotes, newNote];
          const updated = { ...quote, qcag_status: 'Hủy', notes: JSON.stringify(updatedNotes) };

          const replaceIn = (arr) => {
            const idx = (arr || []).findIndex(quoteMatchesKey);
            if (idx >= 0) arr.splice(idx, 1, updated);
          };

          let ok = false;
          if (window.dataSdk && typeof window.dataSdk.update === 'function') {
            const result = await window.dataSdk.update(updated);
            ok = !!result?.isOk;
            if (ok) {
              replaceIn(currentQuotes);
              replaceIn(productionModalFilteredQuotes);
            }
          } else {
            replaceIn(currentQuotes);
            replaceIn(productionModalFilteredQuotes);
            ok = true;
          }

          if (ok) {
            // reflect changes in UI
            showToast('Đã báo huỷ');
            pendingJumpToFirstPage = true;
            updateMainList();
            try {
              // Update any copies inside productionOrders so acceptance thumbnails reflect new status immediately
              const qKey = (typeof getQuoteKey === 'function') ? getQuoteKey(quote) : (quote.__backendId || quote.id || quote.quote_code || quote.spo_number || '');
              if (qKey && Array.isArray(productionOrders)) {
                for (let oi = 0; oi < productionOrders.length; oi++) {
                  const order = productionOrders[oi];
                  let quotes = [];
                  try { quotes = JSON.parse(order.items || '[]'); } catch (e) { quotes = []; }
                  if (!Array.isArray(quotes)) continue;
                  let changed = false;
                  for (let qi = 0; qi < quotes.length; qi++) {
                    const k = (typeof getQuoteKey === 'function') ? getQuoteKey(quotes[qi]) : (quotes[qi] && (quotes[qi].__backendId || quotes[qi].id || quotes[qi].quote_code || quotes[qi].spo_number || ''));
                    if (String(k) === String(qKey)) {
                      quotes[qi] = updated;
                      changed = true;
                    }
                  }
                  if (changed) {
                    productionOrders[oi] = { ...order, items: JSON.stringify(quotes) };
                  }
                }
              }
            } catch (e) { /* ignore */ }
            const productionModal = document.getElementById('production-order-modal');
            const isProductionOpen = productionModal && !productionModal.classList.contains('hidden');
            if (isProductionOpen && typeof renderProductionQuotes === 'function') {
              renderProductionQuotes(productionModalFilteredQuotes);
              if (typeof updateSelectedCount === 'function') updateSelectedCount();
              if (typeof updateSelectedSummary === 'function') updateSelectedSummary();
            }
            try { renderAcceptanceImages(); } catch (e) { /* ignore */ }
          } else {
            showToast('Lỗi khi báo huỷ');
          }
        } catch (err) {
          console.error('Report cancel failed', err);
          showToast('Lỗi khi báo huỷ');
        } finally {
          cleanup();
        }
      };

      document.getElementById('confirm-cancel-produced').addEventListener('click', () => finish(true));
      document.getElementById('confirm-cancel-not-produced').addEventListener('click', () => finish(false));
      setTimeout(() => { document.getElementById('cancel-reason-input').focus(); }, 0);
    };

    window.openRedoModal = function(backendId) {
      const keyStr = backendId != null ? String(backendId) : '';
      if (!keyStr) { showToast('Không tìm thấy báo giá'); return; }
      const quoteMatchesKey = (q) => {
        if (!q) return false;
        const candidates = [q.__backendId, q.id, q.quote_code, q.spo_number, getQuoteKey(q)];
        return candidates.some(v => v != null && String(v) === keyStr);
      };
      const quote = currentQuotes.find(quoteMatchesKey);
      if (!quote) { showToast('Không tìm thấy báo giá'); return; }

      // Remove stale overlay
      const stale = document.getElementById('redo-overlay');
      if (stale) stale.remove();

      const overlay = document.createElement('div');
      overlay.id = 'redo-overlay';
      overlay.className = 'fixed inset-0 z-[120] modal-backdrop flex items-center justify-center p-4';
      overlay.innerHTML = `
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 relative">
          <div class="flex items-start justify-between mb-4">
            <div>
              <h3 class="text-xl font-bold text-gray-800">Làm lại báo giá</h3>
              <p class="text-sm text-gray-500 mt-1">Bạn có chắc chắn sản xuất lại báo giá này không?<br>Nếu có bạn hãy lựa chọn phương án dưới đây.</p>
            </div>
            <button type="button" class="text-gray-400 hover:text-gray-600 text-2xl leading-none" data-action="cancel-redo" aria-label="Đóng">×</button>
          </div>
          <div class="flex justify-end gap-3">
            <button id="confirm-redo-new-order" class="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2 rounded">Tạo số đơn mới</button>
            <button id="confirm-redo-current-order" class="bg-green-600 hover:bg-green-700 text-white font-semibold px-4 py-2 rounded">Số đơn hiện tại</button>
            <button type="button" class="bg-gray-100 hover:bg-gray-200 text-gray-800 px-4 py-2 rounded" data-action="cancel-redo">Hủy</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      ensureScrollLock();

      const cleanup = () => { document.removeEventListener('keydown', handleKeydown, true); overlay.remove(); ensureScrollLock(); };
      const handleCancel = () => cleanup();
      const handleKeydown = (e) => { if (e.key === 'Escape') { e.preventDefault(); handleCancel(); } };
      document.addEventListener('keydown', handleKeydown, true);
      overlay.querySelectorAll('[data-action="cancel-redo"]').forEach(b => b.addEventListener('click', handleCancel));

      const finish = async (newOrder) => {
        const btn = document.getElementById(newOrder ? 'confirm-redo-new-order' : 'confirm-redo-current-order');
        if (!btn) return;
        btn.disabled = true;
        try {
          const oldOrderNumber = getQcagOrderNumber(quote) || '';
          const existingNotes = getQuoteNotes(quote);
          let noteText;
          let updated;
          if (newOrder) {
            // User requests creating a new order: mark as transient 'Chờ tạo đơn'
            noteText = `Yêu cầu tạo số đơn mới; số đơn cũ: ${oldOrderNumber}`;
            updated = { ...quote, qcag_status: 'Chờ tạo đơn', notes: JSON.stringify([...existingNotes, ensureNoteHasAuthor({ text: noteText, at: new Date().toISOString() })]), qcag_order_number: '', order_number: '' };
            // mark transient recreate request so computeQCAGStatus can surface it
            updated.__recreateRequested = true;
          } else {
            noteText = 'Tiếp tục đơn hàng hiện tại, huỷ bỏ lệnh báo huỷ báo giá';
            updated = { ...quote, qcag_status: 'Đã ra đơn', notes: JSON.stringify([...existingNotes, ensureNoteHasAuthor({ text: noteText, at: new Date().toISOString() })]) };
            if (updated.__recreateRequested) delete updated.__recreateRequested;
          }

          const replaceIn = (arr) => {
            const idx = (arr || []).findIndex(quoteMatchesKey);
            if (idx >= 0) arr.splice(idx, 1, updated);
          };

          let ok = false;
          if (window.dataSdk && typeof window.dataSdk.update === 'function') {
            const result = await window.dataSdk.update(updated);
            ok = !!result?.isOk;
            if (ok) {
              replaceIn(currentQuotes);
              replaceIn(productionModalFilteredQuotes);
            }
          } else {
            replaceIn(currentQuotes);
            replaceIn(productionModalFilteredQuotes);
            ok = true;
          }

          if (ok) {
            showToast('Đã làm lại báo giá');
            pendingJumpToFirstPage = true;
            updateMainList();
            try {
              // For "Làm lại" -> "Tạo số đơn mới": do NOT overwrite snapshots inside existing production orders
              // so that cancelled thumbnails and historical data are preserved.
              if (!newOrder) {
                const qKey = (typeof getQuoteKey === 'function') ? getQuoteKey(quote) : (quote.__backendId || quote.id || quote.quote_code || quote.spo_number || '');
                if (qKey && Array.isArray(productionOrders)) {
                  for (let oi = 0; oi < productionOrders.length; oi++) {
                    const order = productionOrders[oi];
                    let quotes = [];
                    try { quotes = JSON.parse(order.items || '[]'); } catch (e) { quotes = []; }
                    if (!Array.isArray(quotes)) continue;
                    let changed = false;
                    for (let qi = 0; qi < quotes.length; qi++) {
                      const k = (typeof getQuoteKey === 'function') ? getQuoteKey(quotes[qi]) : (quotes[qi] && (quotes[qi].__backendId || quotes[qi].id || quotes[qi].quote_code || quotes[qi].spo_number || ''));
                      if (String(k) === String(qKey)) {
                        quotes[qi] = updated;
                        changed = true;
                      }
                    }
                    if (changed) {
                      productionOrders[oi] = { ...order, items: JSON.stringify(quotes) };
                    }
                  }
                }
              }
            } catch (e) { /* ignore */ }
            const productionModal = document.getElementById('production-order-modal');
            const isProductionOpen = productionModal && !productionModal.classList.contains('hidden');
            if (isProductionOpen && typeof renderProductionQuotes === 'function') {
              renderProductionQuotes(productionModalFilteredQuotes);
              if (typeof updateSelectedCount === 'function') updateSelectedCount();
              if (typeof updateSelectedSummary === 'function') updateSelectedSummary();
            }
            try { renderAcceptanceImages(); } catch (e) { /* ignore */ }
          } else {
            showToast('Lỗi khi làm lại báo giá');
          }
        } finally {
          cleanup();
        }
      };

      document.getElementById('confirm-redo-new-order').addEventListener('click', () => finish(true));
      document.getElementById('confirm-redo-current-order').addEventListener('click', () => finish(false));
    };

    function showToast(message) {
      const toast = document.createElement('div');
      toast.className = 'fixed bottom-4 right-4 bg-gray-800 text-white px-6 py-3 rounded-lg shadow-lg z-50';
      toast.textContent = message;
      document.body.appendChild(toast);
      
      setTimeout(() => {
        toast.remove();
      }, 3000);
    }

    // Hàm renderAcceptanceImages cho modal Hình nghiệm thu
    function renderAcceptanceImages() {
      const grid = document.getElementById('acceptance-images-grid');
      if (!grid) return;
      grid.innerHTML = '';
      // Build items from productionOrders (one thumbnail per quote that appears in orders)
      const items = [];
      const seen = new Set(); // now stores composite keys (quoteKey::orderKey)
      var selectedOrderId = window.__acceptanceSelectedOrderId || null;
      var ordersToUse = window.__filteredAcceptanceOrders || productionOrders;
      // Always use latest productionOrders if filter is reset/null
      var useOrders = window.__filteredAcceptanceOrders === null ? productionOrders : ordersToUse;
      if (Array.isArray(useOrders) && useOrders.length) {
        for (const order of ordersToUse) {
          if (selectedOrderId && String(order.__backendId) !== String(selectedOrderId)) continue;
          const orderKey = order.__backendId || order.id || '';
          let quotes = [];
          try { quotes = JSON.parse(order.items || '[]'); } catch (e) { quotes = []; }
          if (!Array.isArray(quotes) || !quotes.length) continue;
          for (const quote of quotes) {
            const quoteKey = resolveQuoteKey(quote);
            const itemKey = `${quoteKey}::${orderKey}`;
            if (!quoteKey || seen.has(itemKey)) continue;
            seen.add(itemKey);
            // Đọc ảnh từ acceptance_images (mới) hoặc quote.images (cũ)
            let images = [];
            let src = '';
            let imagesCount = 0;
            let imagesSource = 'none';
            try {
              // Try new field first
              images = parseImagesField(quote && quote.acceptance_images);
              if (images && images.length > 0) {
                imagesSource = 'acceptance';
              } else {
                // Fallback to legacy
                images = parseImagesField(quote && quote.images) || [];
                if (images && images.length > 0) {
                  imagesSource = 'legacy';
                }
              }
            } catch (e) { images = []; }
            imagesCount = Array.isArray(images) ? images.length : 0;
            src = (images && images.length && images[0].data) ? images[0].data : '';
            // Luôn ưu tiên lấy đúng mã báo giá, không fallback sang outlet_name
            const caption = (typeof formatQuoteCode === 'function' && quote.quote_code) ? formatQuoteCode(quote) : (quote.quote_code || '-');
            // If a search term is active, only include thumbnails that match the search on quote fields
            if (window.__acceptanceSearch) {
              try {
                const s = String(window.__acceptanceSearch || '').toLowerCase();
                let qOutletName = String(quote.outlet_name || '').toLowerCase();
                let qOutletCode = String(quote.outlet_code || '').toLowerCase();
                let qSpo = String(quote.spo_number || '').toLowerCase();
                let qQuoteCode = '';
                try { qQuoteCode = String((typeof formatQuoteCode === 'function' ? formatQuoteCode(quote) : (quote.quote_code || '')) || '').toLowerCase(); } catch (e) { qQuoteCode = String(quote.quote_code || '').toLowerCase(); }
                if (!(qOutletName.includes(s) || qOutletCode.includes(s) || qSpo.includes(s) || qQuoteCode.includes(s) || String(quoteKey || '').toLowerCase().includes(s))) {
                  continue;
                }
              } catch (e) {
                // if any error, fall back to including the item
              }
            }

            items.push({
              src,
              caption,
              // Keep quote's SPO if any; do NOT include outlet code here
              meta: `SPO: ${quote.spo_number || '-'}`,
              // include parent order number for display in the final row
                orderSpo: order && order.spo_number ? order.spo_number : '',
                orderCreated: order && order.created_at ? order.created_at : null,
              quoteRef: quote || null,
              quoteKey: quoteKey,
              orderKey: orderKey,
              // store computed images count from session storage
              imagesCount: imagesCount,
              imagesSource: imagesSource
            });
          }
        }
      }
      // If no items found, show 5 '+' placeholders (to keep grid visual)
      if (!items.length) {
        // Xác định trạng thái filter hiện tại
        let filter = (window.__acceptanceFilter || 'all');
        let msg = 'Hiện không có outlet nào.';
        if (filter === 'overdue') msg = 'Hiện tại không có Outlet nào trễ hạn.';
        else if (filter === 'normal') msg = 'Hiện tại không có Outlet nào đang thi công.';
        else if (filter === 'full') msg = 'Hiện tại không có Outlet nào hoàn thành.';
        // Tạo div căn giữa dọc và ngang
        grid.innerHTML = '';
        grid.style.display = 'flex';
        grid.style.flexDirection = 'column';
        grid.style.justifyContent = 'center';
        grid.style.alignItems = 'center';
        grid.style.height = '100%';
        grid.style.minHeight = '320px';
        const msgDiv = document.createElement('div');
        msgDiv.className = 'italic text-gray-500 text-center';
        msgDiv.textContent = msg;
        grid.appendChild(msgDiv);
        return;
      } else {
        // Reset grid style nếu có items
        grid.style.display = '';
        grid.style.flexDirection = '';
        grid.style.justifyContent = '';
        grid.style.alignItems = '';
        grid.style.height = '';
        grid.style.minHeight = '';
      }
      // If a master quote indicates a recreate/cancel flow (e.g. 'Chờ tạo đơn' or explicit cancel notes),
      // mark older orders (for the same quote key) as cancelled so their thumbnails show the 'Báo huỷ' flag.
      try {
        const byQuote = {};
        items.forEach(it => {
          if (!it.quoteKey) return;
          byQuote[it.quoteKey] = byQuote[it.quoteKey] || [];
          byQuote[it.quoteKey].push(it);
        });
        Object.keys(byQuote).forEach(qk => {
          const group = byQuote[qk];
          if (!group || group.length < 2) return; // only relevant when multiple orders exist
          // Try to find master/live quote info
          let master = null;
          try { master = (typeof findQuoteByKey === 'function') ? findQuoteByKey(qk) : null; } catch (e) { master = null; }
          const notesMatch = (quote) => {
            try {
              const notes = Array.isArray(quote && quote.notes) ? quote.notes : (typeof quote === 'object' && quote && quote.notes ? (typeof quote.notes === 'string' ? JSON.parse(quote.notes||'[]') : []) : []);
              return notes.some(n => (n && n.text && (n.text.includes('Báo giá này chưa sản xuất') || n.text.includes('Yêu cầu tạo số đơn mới'))));
            } catch (e) { return false; }
          };
          const shouldApply = (master && (String(master.qcag_status || '').toLowerCase().includes('chờ tạo đơn') || notesMatch(master)));
          if (shouldApply) {
            // Sort by orderCreated ascending (oldest first) and mark all but the last as force-cancelled
            group.sort((a,b) => new Date(a.orderCreated || 0) - new Date(b.orderCreated || 0));
            for (let i = 0; i < group.length - 1; i++) {
              group[i].__forceCancelled = true;
            }
          }
        });
      } catch (e) { /* ignore */ }

      // --- Pagination support ---
      window.__acceptancePageSize = window.__acceptancePageSize || 10;
      window.__acceptancePage = window.__acceptancePage || 1;
      var pageSize = parseInt(window.__acceptancePageSize, 10) || 10;
      var totalPages = Math.max(1, Math.ceil(items.length / pageSize));
      if (window.__acceptancePage > totalPages) window.__acceptancePage = totalPages;
      if (window.__acceptancePage < 1) window.__acceptancePage = 1;
      var startIdx = (window.__acceptancePage - 1) * pageSize;
      var endIdx = startIdx + pageSize;
      var displayItems = items.slice(startIdx, endIdx);

      // Update paging UI
      try {
        var pageInfoEl = document.getElementById('acceptance-page-info');
        if (pageInfoEl) pageInfoEl.textContent = window.__acceptancePage + ' / ' + totalPages;
        var prevBtn = document.getElementById('acceptance-prev-btn');
        var nextBtn = document.getElementById('acceptance-next-btn');
        if (prevBtn) prevBtn.disabled = window.__acceptancePage <= 1;
        if (nextBtn) nextBtn.disabled = window.__acceptancePage >= totalPages;
        var sizeEl = document.getElementById('acceptance-page-size');
        if (sizeEl && parseInt(sizeEl.value,10) !== pageSize) sizeEl.value = String(pageSize);
      } catch (e) { /* ignore UI update errors */ }

      const frag = document.createDocumentFragment();
      displayItems.forEach(item => {
        const cell = document.createElement('div');
        cell.className = 'flex flex-col items-start';
        const thumbWrap = document.createElement('div');
        thumbWrap.className = 'w-full h-36 bg-gray-100 rounded-lg overflow-hidden flex items-center justify-center acceptance-thumb-hover';
        thumbWrap.style.position = 'relative';
        thumbWrap.tabIndex = 0;

        // Hiệu ứng hover viền xanh
        thumbWrap.addEventListener('mouseenter', () => {
          thumbWrap.style.boxShadow = 'inset 0 0 0 3px #2563eb';
          thumbWrap.focus();
        });
        thumbWrap.addEventListener('mouseleave', () => {
          thumbWrap.style.boxShadow = '';
        });

        // Paste ảnh trực tiếp
        thumbWrap.addEventListener('paste', (e) => {
          if (!e.clipboardData) return;
          const items = e.clipboardData.items || [];
          for (const it of items) {
            if (it.type && it.type.indexOf('image') === 0) {
              const blob = it.getAsFile();
              if (!blob) continue;
              // Gọi hàm xử lý thêm ảnh vào quoteRef
              if (item && item.quoteRef) {
                handleImageFile(getQuoteKey(item.quoteRef), blob);
              } else {
                // Trường hợp chưa có quoteRef, có thể xử lý khác nếu muốn
              }
              e.preventDefault();
              return;
            }
          }
        });

        // Drag and drop
        thumbWrap.addEventListener('dragover', (e) => {
          e.preventDefault();
          thumbWrap.style.boxShadow = 'inset 0 0 0 3px #10b981';
        });
        thumbWrap.addEventListener('dragleave', (e) => {
          e.preventDefault();
          thumbWrap.style.boxShadow = 'inset 0 0 0 3px #2563eb';
        });
        thumbWrap.addEventListener('drop', (e) => {
          e.preventDefault();
          thumbWrap.style.boxShadow = '';
          const files = e.dataTransfer.files;
          if (files && files.length > 0) {
            for (let i = 0; i < files.length; i++) {
              const file = files[i];
              if (file.type.startsWith('image/')) {
                if (item && item.quoteRef) {
                  handleImageFile(getQuoteKey(item.quoteRef), file);
                }
              }
            }
          }
        });

        // Click để mở modal chi tiết nghiệm thu
        thumbWrap.addEventListener('click', (e) => {
          e.stopPropagation();
          // Luôn mở modal chi tiết nghiệm thu
          try { openAcceptanceDetailModal(item.quoteRef, item.quoteKey, item.orderKey); } catch (err) { console.warn(err); }
        });

        // Check if cancelled - prefer the snapshot from the order so we preserve per-order history
        const quoteSnapshot = item.quoteRef || {};
        let isCancelled = false;
        try {
          isCancelled = !!(quoteSnapshot && (String(quoteSnapshot.qcag_status) === 'Hủy' || (String(quoteSnapshot.qcag_status) === 'Đã ra đơn' && !(quoteSnapshot.qcag_order_number) && (getQuoteNotes(quoteSnapshot).some(n => n.text.includes('Tạo số đơn hàng mới'))))));
          // Respect forced-cancel flag assigned earlier from master-note heuristic
          if (!isCancelled && item.__forceCancelled) isCancelled = true;
        } catch (e) { isCancelled = false; }
        // Fallback to live currentQuotes if snapshot not available
        if (!isCancelled) {
          try {
            // Find all potential live matches, then prefer the one tied to this order (by qcag_order_number or spo),
            // otherwise prefer a non-cancelled match, otherwise newest.
            const matches = Array.isArray(currentQuotes) ? currentQuotes.filter(q => {
              try { return (typeof getQuoteKey === 'function' ? getQuoteKey(q) === item.quoteKey : false); } catch (e) { return false; }
            }) : [];
            let live = null;
            if (matches.length === 1) live = matches[0];
            else if (matches.length > 1) {
              // Prefer exact order SPO match
              const byOrder = matches.find(m => {
                try {
                  const ord = (item && item.orderSpo) ? String(item.orderSpo).trim() : '';
                  if (!ord) return false;
                  if (m && m.qcag_order_number && String(m.qcag_order_number).trim() === ord) return true;
                  if (m && m.spo_number && String(m.spo_number).trim() === ord) return true;
                } catch (e) {}
                return false;
              });
              if (byOrder) live = byOrder;
              else {
                const nonCancelled = matches.find(m => {
                  try { const st = String((m == null ? void 0 : m.qcag_status) || '').toLowerCase(); return !st.includes('hủy') && !st.includes('huy'); } catch (e) { return true; }
                });
                if (nonCancelled) live = nonCancelled;
                else {
                  matches.sort((a,b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
                  live = matches[0];
                }
              }
            }
            if (live) {
              isCancelled = !!(String(live.qcag_status) === 'Hủy' || (String(live.qcag_status) === 'Đã ra đơn' && !live.qcag_order_number && getQuoteNotes(live).some(n => n.text.includes('Tạo số đơn hàng mới'))));
            }
          } catch (e) {}
        }

        if (item && item.src) {
          const img = document.createElement('img');
          img.src = item.src;
          img.alt = item.caption || '';
          img.className = 'w-full h-full object-cover';
          if (isCancelled) {
            img.style.opacity = '0.5';
          }
          thumbWrap.appendChild(img);
          if (isCancelled) {
            const overlay = document.createElement('div');
            overlay.className = 'absolute inset-0 flex flex-col items-center justify-center z-20 pointer-events-none';
            overlay.innerHTML = '<div class="text-4xl text-red-600 font-bold"><i class="fas fa-times" aria-hidden="true"></i></div><div class="text-xs text-red-600 mt-1 font-semibold">Báo huỷ</div>';
            thumbWrap.appendChild(overlay);
          }
          // Hiển thị số lượng ảnh nghiệm thu ở góc phải thumbnail
          const imgCountBadge = document.createElement('div');
          imgCountBadge.textContent = item.imagesCount > 0 ? `${item.imagesCount}` : '0';
          imgCountBadge.className = 'absolute bottom-1 right-1 bg-blue-600 text-white text-xs font-bold rounded-full px-2 py-0.5 shadow';
          thumbWrap.appendChild(imgCountBadge);
        } else {
          if (isCancelled) {
            const cancelBox = document.createElement('div');
            cancelBox.className = 'flex flex-col items-center justify-center';
            cancelBox.setAttribute('aria-label', 'Đã báo huỷ');
            const icon = document.createElement('div');
            icon.className = 'text-4xl text-red-600 font-bold';
            icon.innerHTML = '<i class="fas fa-times" aria-hidden="true"></i>';
            cancelBox.appendChild(icon);
            const text = document.createElement('div');
            text.className = 'text-xs text-red-600 mt-1 font-semibold';
            text.textContent = 'Báo huỷ';
            cancelBox.appendChild(text);
            thumbWrap.appendChild(cancelBox);
          } else {
            const icon = document.createElement('div');
            icon.className = 'text-3xl text-gray-400';
            icon.textContent = '+';
            thumbWrap.appendChild(icon);
          }
        }
        const info = document.createElement('div');
        info.className = 'mt-2 text-sm text-gray-700 w-full';
        info.style.position = 'relative';

        // Move Báo huỷ button into the info area (bottom-right) - like Project backup 17.0
        try {
          if (item && item.quoteRef) {
            const quoteRef2 = item.quoteRef;
            const isProduced2 = String(quoteRef2.qcag_status || '').includes('Đã ra đơn') || hasEverHadOrder(quoteRef2);
            if (isProduced2 && !isCancelled) {
              const cancelBtn2 = document.createElement('button');
              cancelBtn2.className = 'absolute bottom-0 right-0 px-2 py-0.5 text-xs bg-yellow-400 text-yellow-900 rounded hover:bg-yellow-500 hover:text-yellow-900';
              cancelBtn2.style.zIndex = 5;
              cancelBtn2.style.transform = 'translateY(50%)';
              cancelBtn2.textContent = 'Báo huỷ';
              cancelBtn2.title = 'Báo huỷ';
              cancelBtn2.addEventListener('click', (e) => {
                e.stopPropagation();
                try { openReportCancelModal(resolveQuoteKey(quoteRef2)); } catch (err) { console.warn(err); }
              });
              info.appendChild(cancelBtn2);
            }
          }
        } catch (e) { /* ignore */ }
        if (item && item.quoteRef) {
          const quote = item.quoteRef;
          // Hiển thị Tên Outlet lớn nhất ở trên cùng, sau đó Mã BG và meta (SPO/Outlet)
          const outletText = quote.outlet_name || quote.outlet_code || '-';
          const o = document.createElement('div');
          o.className = 'quote-gallery-outlet font-extrabold truncate';
          o.textContent = outletText;
          info.appendChild(o);

          const codeText = (typeof formatQuoteCode === 'function' && quote.quote_code) ? formatQuoteCode(quote) : (quote.quote_code || quote.quoteCode || quote.spo_number || '-');
          const c = document.createElement('div');
          c.className = 'font-semibold truncate quote-gallery-code';
          c.textContent = codeText;
          info.appendChild(c);

          // Prefer latest master/prod-order data for SPO/Outlet
          let master2 = null;
          try { master2 = (typeof findQuoteByKey === 'function') ? findQuoteByKey(resolveQuoteKey(quote)) : null; } catch (_) { master2 = null; }
          const displaySpoNumber2 = (master2 && master2.spo_number) || quote.spo_number || '-';
          const displayOutletCode2 = (master2 && master2.outlet_code) || quote.outlet_code || '';
          const m = document.createElement('div');
          m.className = 'text-xs text-gray-500 truncate quote-gallery-sub';
          m.textContent = `SPO: ${displaySpoNumber2} • Outlet: ${displayOutletCode2}`;
          info.appendChild(m);

          // Sale name (bottom row)
          const s = document.createElement('div');
          s.className = 'text-xs text-gray-500 truncate quote-gallery-sale';
          s.textContent = `Sale: ${quote.sale_name || quote.saleName || '-'}`;
          info.appendChild(s);
        }
        cell.appendChild(thumbWrap);
        cell.appendChild(info);
        frag.appendChild(cell);
      });
      grid.appendChild(frag);
    }

    // SPO Status Functions
    function getSPOStatusClass(spoStatus) {
      const map = {
        'Area Sales Manager Approved...': 'bg-green-100 text-green-800',
        'Sales Supervisor Checked Variation': 'bg-green-100 text-green-800',
        'Sales Rep Checked Variation': 'bg-green-100 text-green-800',
        // Produced / completed statuses (neutral gray or purple)
        'Sales Rep Accepted': 'bg-purple-100 text-purple-800',
        'Store Keeper Finish': 'bg-purple-100 text-purple-800',
        'Sales Admin Finish': 'bg-purple-100 text-purple-800',
        'Sales Supervisor Finish': 'bg-purple-100 text-purple-800',
        'Sign Maker Installed Signage': 'bg-purple-100 text-purple-800',
        // Negative / rejection / cancellation
        'Sales Rep Rejected': 'bg-red-100 text-red-800',
        'Sign Maker Rejected': 'bg-red-100 text-red-800',
        'Sales Admin Rejected': 'bg-red-100 text-red-800',
        'Sales Admin Cancelled': 'bg-red-100 text-red-800',
        'Sales Supervisor Cancelled': 'bg-red-100 text-red-800',
        'Store Keeper Cancelled': 'bg-red-100 text-red-800',
        // In-process / review
        'Sales Admin Checked Marquette': 'bg-yellow-100 text-yellow-800',
        'Sign Maker Checked Marquette': 'bg-yellow-100 text-yellow-800',
        'Sales Rep SR Revised': 'bg-yellow-100 text-yellow-800',
        'Sales Admin Full Checked': 'bg-yellow-100 text-yellow-800',
        'Sales Supervisor Verified': 'bg-yellow-100 text-yellow-800'
      };
      return map[spoStatus] || 'bg-gray-100 text-gray-600';
    }

    function getSPOStatusText(spoStatus) {
      return spoStatus || 'Chưa có trạng thái';
    }

    // QCAG status helpers
    function getQCAGStatusClass(status) {
      if (!status) return 'bg-gray-100 text-gray-600';
      const s = String(status).toLowerCase();
      if (s.includes('hủy') || s === 'hủy') return 'bg-yellow-400 text-yellow-900';
      if (s.includes('chờ nghiệm thu')) return 'bg-blue-100 text-blue-800';
      if (s.includes('hoàn thành')) return 'bg-green-100 text-green-800';
      if (s.includes('chờ')) return 'bg-yellow-100 text-yellow-800';
      return 'bg-gray-100 text-gray-600';
    }

    function getQCAGStatusIcon(status) {
      if (!status) return '';
      const s = String(status).toLowerCase();
      // For 'Hủy' use an X icon
      if (s.includes('hủy') || s === 'hủy') {
        return `<svg class="w-3 h-3 text-yellow-900 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>`;
      }
      return '';
    }

    function renderQCAGStatusHtml(quote, qcComputed) {
      const qc = qcComputed || computeQCAGStatus(quote) || { status: '', warning: false };
      const status = (quote && quote.qcag_status) ? String(quote.qcag_status) : qc.status;

      // If a clear is in-flight, suppress the override badge to avoid flicker
      if (quote && quote.__overrideClearing) {
        return status ? `<span class="px-1.5 py-0.5 text-xs font-medium rounded ${getQCAGStatusClass(status)} inline-flex items-center">${status}</span>` : '-';
      }

      // Persistent override from SQL (qcag_override_status)
      const overrideStatus = quote && quote.qcag_override_status ? String(quote.qcag_override_status).trim() : '';
      if (overrideStatus === 'Cần chỉnh báo giá') {
        const cls = getQCAGStatusClass('Chờ');
        return `<span class="px-1.5 py-0.5 text-xs font-medium rounded ${cls} inline-flex items-center" title="Cần chỉnh báo giá">Cần chỉnh báo giá<span class="ml-1 text-yellow-800"> ⚠️</span></span>`;
      }
      // If status is 'Hủy', display as plain text without badge or icon
      if (String(status || '').toLowerCase().includes('hủy') || String(status || '').toLowerCase() === 'hủy') {
        return status || '-';
      }

      // If quote has local changes from Acceptance Detail (or other tracked edits), overlay QCAG status
      if (hasQuotePendingUpdate(quote)) {
        const cls = getQCAGStatusClass('Chờ');
        const baseTitle = (status || '-').replace(/"/g, '&quot;');
        return `<span class="px-1.5 py-0.5 text-xs font-medium rounded ${cls} inline-flex items-center" title="${baseTitle}">Cần chỉnh báo giá<span class="ml-1 text-yellow-800"> ⚠️</span></span>`;
      }

      const cls = getQCAGStatusClass(status);
      const icon = getQCAGStatusIcon(status);
      // Show update warning if QC logic indicates or if transient edit flags exist
      const showUpdate = qc.warning;
      const updateHtml = showUpdate ? `<span class="ml-1 text-yellow-800" title="Cập nhật báo giá"> ⚠️</span>` : '';
      return `<span class="px-1.5 py-0.5 text-xs font-medium rounded ${cls} inline-flex items-center">${icon}${status || '-'}${updateHtml}</span>`;
    }

    function normalizeSpoNumber(value) {
      return value ? String(value).trim().toLowerCase() : '';
    }

    function isSPONumberUnique(spoNumber, excludeKey) {
      const normalized = normalizeSpoNumber(spoNumber);
      if (!normalized) return true;
      return !currentQuotes.some(q => {
        if (!q || !q.spo_number) return false;
        if (excludeKey && getQuoteKey(q) === excludeKey) return false;
        return normalizeSpoNumber(q.spo_number) === normalized;
      });
    }

    // Edit SPO Number
    window.editSPONumber = function(backendId) {
      const quote = currentQuotes.find(q => q.__backendId === backendId);
      if (!quote) return;

      const modal = document.createElement('div');
      modal.className = 'fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center';
      modal.innerHTML = `
        <div class="bg-white rounded-lg p-6 w-96">
          <h3 class="text-lg font-semibold mb-4">Nhập Số SPO</h3>
          <input type="text" id="spo-number-input" value="${quote.spo_number || ''}" 
                 class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500" 
                 placeholder="Nhập số SPO...">
          <div class="flex justify-end space-x-3 mt-4">
            <button id="cancel-spo" class="px-4 py-2 bg-gray-300 hover:bg-gray-400 text-gray-800 rounded">Hủy</button>
            <button id="save-spo" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded">Lưu</button>
          </div>
        </div>
      `;
      
      document.body.appendChild(modal);
      document.getElementById('spo-number-input').focus();

      document.getElementById('cancel-spo').addEventListener('click', () => modal.remove());
      
      document.getElementById('save-spo').addEventListener('click', async () => {
        const rawValue = document.getElementById('spo-number-input').value.trim();
        const quoteKey = getQuoteKey(quote);
        if (!rawValue) {
          showToast('Số SPO không được để trống');
          return;
        }
        if (!isSPONumberUnique(rawValue, quoteKey)) {
          showToast('Số SPO này đã được gán cho báo giá khác');
          return;
        }
        const previousValue = quote.spo_number || '';
        if (previousValue === rawValue) {
          showToast('Số SPO không có thay đổi');
          modal.remove();
          return;
        }
        const updatedQuote = { ...quote, spo_number: rawValue };
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
            const newStatus = (!previousValue || !prevStatus || prevStatus === 'Chưa có SPO') ? 'Chưa cập nhật trạng thái' : prevStatus;
            currentQuotes[idx] = { ...currentQuotes[idx], spo_number: rawValue, spo_status: newStatus };
          }
          const message = previousValue
            ? `Cập nhật số SPO từ "${previousValue}" sang "${rawValue}"`
            : `Cập nhật số SPO sang "${rawValue}"`;
          addSystemNoteForQuote(quoteKey, message);
          showToast('Đã cập nhật số SPO');
          modal.remove();
          updateMainList();
        } else {
          showToast('Lỗi khi cập nhật số SPO');
        }
      });
    };

    // Edit SPO Status - DISABLED per requirement
    window.editSPOStatus = function(backendId) {
      // Disabled to prevent spo_status changes outside of allowed cases
      return;
      const quote = currentQuotes.find(q => q.__backendId === backendId);
      if (!quote) return;
      // Allowed statuses per user requirement
      const statuses = [
        'Sales Rep Checked Variation',
        'Sales Rep Rejected',
        'Sign Maker Rejected',
        'Sales Admin Finish',
        'Sales Admin Rejected',
        'Sales Admin Cancelled',
        'Sales Admin Checked Marquette',
        'Sales Supervisor Cancelled',
        'Store Keeper Finish',
        'Store Keeper Cancelled',
        'Sign Maker Checked Marquette',
        'Sales Supervisor Checked Variation',
        'Area Sales Manager Approved...',
        'Sales Rep Accepted',
        'Sales Supervisor Finish',
        'Sign Maker Installed Signage',
        'Sales Rep SR Revised',
        'Sales Admin Full Checked',
        'Sales Supervisor Verified'
      ];
      
      const modal = document.createElement('div');
      modal.className = 'fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center';
      modal.innerHTML = `
        <div class="bg-white rounded-lg p-6 w-96">
          <h3 class="text-lg font-semibold mb-4">Cập Nhật Trạng Thái SPO</h3>
          <select id="spo-status-select" class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500">
            ${statuses.map(status => `
              <option value="${status}" ${quote.spo_status === status ? 'selected' : ''}>${status}</option>
            `).join('')}
          </select>
          <div class="flex justify-end space-x-3 mt-4">
            <button id="cancel-status" class="px-4 py-2 bg-gray-300 hover:bg-gray-400 text-gray-800 rounded">Hủy</button>
            <button id="save-status" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded">Lưu</button>
          </div>
        </div>
      `;
      
      document.body.appendChild(modal);

      document.getElementById('cancel-status').addEventListener('click', () => modal.remove());
      
      document.getElementById('save-status').addEventListener('click', async () => {
        const spoStatus = document.getElementById('spo-status-select').value;
        const previousStatus = quote.spo_status || '';
        if (previousStatus === spoStatus) {
          showToast('Trạng thái SPO không có thay đổi');
          modal.remove();
          return;
        }
        const updatedQuote = { ...quote, spo_status: spoStatus };
        const quoteKey = getQuoteKey(quote);
        let ok = true;
        if (window.dataSdk && typeof window.dataSdk.update === 'function') {
          try {
            const result = await window.dataSdk.update(updatedQuote);
            ok = !!result?.isOk;
          } catch (err) {
            ok = false;
          }
        }

        if (!ok) {
          showToast('Lỗi khi cập nhật trạng thái SPO');
          return;
        }

        const idx = currentQuotes.findIndex(q => getQuoteKey(q) === quoteKey);
        if (idx >= 0) {
          currentQuotes[idx] = { ...currentQuotes[idx], spo_status: spoStatus };
        }
        const message = previousStatus
          ? `Cập nhật trạng thái SPO từ "${previousStatus}" sang "${spoStatus}"`
          : `Cập nhật trạng thái SPO sang "${spoStatus}"`;
        addSystemNoteForQuote(quoteKey, message);
        showToast('Đã cập nhật trạng thái SPO');
        modal.remove();
        if (typeof updateMainList === 'function') updateMainList();
      });
    };

    // Utility: simple debounce to avoid firing heavy work on every keystroke
    function debounce(fn, wait) {
      let t = null;
      return function() {
        const args = arguments;
        const ctx = this;
        if (t) clearTimeout(t);
        t = setTimeout(function() { fn.apply(ctx, args); t = null; }, wait || 200);
      };
    }

    // Search Functionality
    function setupSearch() {
      const searchInput = document.getElementById('search-input');
      if (!searchInput) return;
      // Trigger search only when user presses Enter to avoid scanning on every keystroke.
      // Also auto-clear when input is empty for 1s.
      let emptyTimer = null;
      const clearEmptyTimer = () => { if (emptyTimer) { clearTimeout(emptyTimer); emptyTimer = null; } };

      searchInput.addEventListener('input', function() {
        const v = (this.value || '').trim();
        if (!v) {
          clearEmptyTimer();
          emptyTimer = setTimeout(() => {
            searchTerm = '';
            listPage = 1; outletPage = 1;
            updateMainList();
            emptyTimer = null;
          }, 1000);
        } else {
          clearEmptyTimer();
        }
      });

      searchInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          clearEmptyTimer();
          searchTerm = this.value || '';
          listPage = 1; outletPage = 1;
          updateMainList();
        }
      });
    }

  /* ========== ĐÃ VÔ HIỆU HÓA PHẦN TẠO DỮ LIỆU MẪU ==========
    // Tạo 10 báo giá mẫu để test
  // async function createSampleQuotes() {
      const sampleQuotes = [
        {
          id: "sample_001",
          outlet_code: "HCM001",
          outlet_name: "Quán Bia Sài Gòn",
          area: "S4",
          sale_type: "Sale (SR)",
          sale_code: "SR001",
          sale_name: "Nguyễn Văn A",
          ss_name: "Trần Thị B",
          address: "123 Nguyễn Huệ, Phường Bến Nghé, Quận 1, TP.HCM",
          items: JSON.stringify([
            { code: "1.1", content: "Bảng hiệu mica", brand: "Tiger", width: "2", height: "1", quantity: "2", unit: "m²", price: "500000", total: "1,000,000 ₫" },
            { code: "2.1", content: "Bảng hiệu LED", brand: "Heineken", width: "3", height: "1.5", quantity: "4.5", unit: "m²", price: "800000", total: "3,600,000 ₫" }
          ]),
          total_amount: 4600000,
          created_at: new Date(Date.now() - 86400000 * 5).toISOString(), // 5 ngày trước
          spo_number: "SPO2024001",
          spo_status: "ASM Approved"
        },
        {
          id: "sample_002",
          outlet_code: "HCM002",
          outlet_name: "Nhà Hàng Biển Xanh",
          area: "S5",
          sale_type: "TBA",
          sale_code: "TBA001",
          sale_name: "Lê Văn C",
          ss_name: "",
          address: "456 Lê Lợi, Phường Bến Thành, Quận 1, TP.HCM",
          items: JSON.stringify([
            { code: "1.2", content: "Bảng hiệu alu", brand: "Bivina", width: "2.5", height: "1.2", quantity: "3", unit: "m²", price: "600000", total: "1,800,000 ₫" },
            { code: "9.2", content: "Đèn LED trang trí", brand: "Strongbow", width: "", height: "", quantity: "10", unit: "bộ", price: "150000", total: "1,500,000 ₫" }
          ]),
          total_amount: 3300000,
          created_at: new Date(Date.now() - 86400000 * 4).toISOString(),
          spo_number: "SPO2024011",
          spo_status: "Sale Rep Checkvariation"
        },
        {
          id: "sample_003",
          outlet_code: "DN001",
          outlet_name: "Quán Nhậu Miền Trung",
          area: "S16",
          sale_type: "Sale (SR)",
          sale_code: "SR002",
          sale_name: "Phạm Thị D",
          ss_name: "Võ Văn E",
          address: "789 Trần Phú, Phường Thạch Thang, Quận Hải Châu, Đà Nẵng",
          items: JSON.stringify([
            { code: "1.3", content: "Bảng hiệu shopname", brand: "Shopname", width: "4", height: "1", quantity: "4", unit: "m²", price: "450000", total: "1,800,000 ₫" },
            { code: "9.17", content: "Khung sắt", brand: "", width: "", height: "", quantity: "7", unit: "m", price: "80000", total: "560,000 ₫" }
          ]),
          total_amount: 2360000,
          created_at: new Date(Date.now() - 86400000 * 3).toISOString(),
          spo_number: "SPO2024002",
          spo_status: "ASM Approved"
        },
        {
          id: "sample_004",
          outlet_code: "HN001",
          outlet_name: "Beer Club Hà Nội",
          area: "S17",
          sale_type: "Sale (SR)",
          sale_code: "SR003",
          sale_name: "Hoàng Văn F",
          ss_name: "Ngô Thị G",
          address: "321 Hoàng Diệu, Phường Liễu Giai, Quận Ba Đình, Hà Nội",
          items: JSON.stringify([
            { code: "2.2", content: "Bảng hiệu neon", brand: "Larue", width: "3", height: "2", quantity: "6", unit: "m²", price: "900000", total: "5,400,000 ₫" },
            { code: "9.3", content: "Hệ thống âm thanh", brand: "Tiger", width: "", height: "", quantity: "1", unit: "bộ", price: "2000000", total: "2,000,000 ₫" }
          ]),
          total_amount: 7400000,
          created_at: new Date(Date.now() - 86400000 * 2).toISOString(),
          spo_number: "SPO2024012",
          spo_status: "Sale Rep Checkvariation"
        },
        {
          id: "sample_005",
          outlet_code: "CT001",
          outlet_name: "Quán Bia Miền Tây",
          area: "S19",
          sale_type: "TBA",
          sale_code: "TBA002",
          sale_name: "Trương Văn H",
          ss_name: "",
          address: "654 Mậu Thân, Phường An Phú, Quận Ninh Kiều, Cần Thơ",
          items: JSON.stringify([
            { code: "1.4", content: "Bảng hiệu composite", brand: "Shopname", width: "2", height: "1.5", quantity: "3", unit: "m²", price: "550000", total: "1,650,000 ₫" },
            { code: "N6", content: "Vật tư phụ", brand: "", width: "", height: "", quantity: "4", unit: "bộ", price: "100000", total: "400,000 ₫" }
          ]),
          total_amount: 2050000,
          created_at: new Date(Date.now() - 86400000 * 1).toISOString(),
          spo_number: "SPO2024003",
          spo_status: "Từ chối"
        },
        {
          id: "sample_006",
          outlet_code: "HCM003",
          outlet_name: "Nhà Hàng Gia Đình",
          area: "S24",
          sale_type: "Sale (SR)",
          sale_code: "SR004",
          sale_name: "Lý Thị I",
          ss_name: "Đặng Văn J",
          address: "987 Võ Văn Tần, Phường 6, Quận 3, TP.HCM",
          items: JSON.stringify([
            { code: "1.1", content: "Bảng hiệu mica", brand: "Heineken", width: "1.5", height: "1", quantity: "1.5", unit: "m²", price: "500000", total: "750,000 ₫" },
            { code: "1.2", content: "Bảng hiệu alu", brand: "Bia Việt", width: "2", height: "0.8", quantity: "1.6", unit: "m²", price: "600000", total: "960,000 ₫" }
          ]),
          total_amount: 1710000,
          created_at: new Date().toISOString(),
          spo_number: "",
          spo_status: "Chờ duyệt"
        },
        {
          id: "sample_007",
          outlet_code: "BD001",
          outlet_name: "Quán Nhậu Bình Dương",
          area: "S4",
          sale_type: "TBA",
          sale_code: "TBA003",
          sale_name: "Phan Văn K",
          ss_name: "",
          address: "147 Đại lộ Bình Dương, Phường Phú Hòa, TP.Thủ Dầu Một, Bình Dương",
          items: JSON.stringify([
            { code: "2.1", content: "Bảng hiệu LED", brand: "Strongbow", width: "2.5", height: "1.8", quantity: "4.5", unit: "m²", price: "800000", total: "3,600,000 ₫" },
            { code: "9.17", content: "Khung sắt", brand: "", width: "", height: "", quantity: "8", unit: "m", price: "80000", total: "640,000 ₫" },
            { code: "N6", content: "Vật tư phụ", brand: "", width: "", height: "", quantity: "5", unit: "bộ", price: "100000", total: "500,000 ₫" }
          ]),
          total_amount: 4740000,
          created_at: new Date(Date.now() - 86400000 * 6).toISOString(),
          spo_number: "SPO2024004",
          spo_status: "Đã duyệt"
        },
        {
          id: "sample_008",
          outlet_code: "VT001",
          outlet_name: "Beer Garden Vũng Tàu",
          area: "S5",
          sale_type: "Sale (SR)",
          sale_code: "SR005",
          sale_name: "Bùi Thị L",
          ss_name: "Cao Văn M",
          address: "258 Thùy Vân, Phường 2, TP.Vũng Tàu, Bà Rịa - Vũng Tàu",
          items: JSON.stringify([
            { code: "1.3", content: "Bảng hiệu shopname", brand: "Shopname", width: "3.5", height: "1.2", quantity: "4.2", unit: "m²", price: "450000", total: "1,890,000 ₫" },
            { code: "2.2", content: "Bảng hiệu neon", brand: "Tiger", width: "2", height: "1", quantity: "2", unit: "m²", price: "900000", total: "1,800,000 ₫" }
          ]),
          total_amount: 3690000,
          created_at: new Date(Date.now() - 86400000 * 7).toISOString(),
          spo_number: "",
          spo_status: "Đang xử lý"
        },
        {
          id: "sample_009",
          outlet_code: "HP001",
          outlet_name: "Quán Bia Hải Phòng",
          area: "S16",
          sale_type: "Sale (SR)",
          sale_code: "SR006",
          sale_name: "Đinh Văn N",
          ss_name: "Lưu Thị O",
          address: "369 Lạch Tray, Phường Đông Khê, Quận Ngô Quyền, Hải Phòng",
          items: JSON.stringify([
            { code: "1.4", content: "Bảng hiệu composite", brand: "Shopname", width: "2.8", height: "1.5", quantity: "4.2", unit: "m²", price: "550000", total: "2,310,000 ₫" },
            { code: "9.2", content: "Đèn LED trang trí", brand: "Bivina", width: "", height: "", quantity: "15", unit: "bộ", price: "150000", total: "2,250,000 ₫" }
          ]),
          total_amount: 4560000,
          created_at: new Date(Date.now() - 86400000 * 8).toISOString(),
          spo_number: "SPO2024005",
          spo_status: "Đã duyệt"
        },
        {
          id: "sample_010",
          outlet_code: "NB001",
          outlet_name: "Nhà Hàng Ninh Bình",
          area: "S17",
          sale_type: "TBA",
          sale_code: "TBA004",
          sale_name: "Vũ Thị P",
          ss_name: "",
          address: "741 Trần Hưng Đạo, Phường Đông Thành, TP.Ninh Bình, Ninh Bình",
          items: JSON.stringify([
            { code: "1.1", content: "Bảng hiệu mica", brand: "Larue", width: "3", height: "1.8", quantity: "5.4", unit: "m²", price: "500000", total: "2,700,000 ₫" },
            { code: "1.2", content: "Bảng hiệu alu", brand: "Heineken", width: "1.5", height: "1", quantity: "1.5", unit: "m²", price: "600000", total: "900,000 ₫" },
            { code: "9.3", content: "Hệ thống âm thanh", brand: "Bia Việt", width: "", height: "", quantity: "1", unit: "bộ", price: "2000000", total: "2,000,000 ₫" }
          ]),
          total_amount: 5600000,
          created_at: new Date(Date.now() - 86400000 * 9).toISOString(),
          spo_number: "",
          spo_status: "Chờ duyệt"
        }
      ];

      // Tạo từng báo giá mẫu
      for (const quote of sampleQuotes) {
        if (currentQuotes.length >= 999) break; // Kiểm tra giới hạn
        
        const result = await window.dataSdk.create(quote);
        if (!result.isOk) {
          console.error('Lỗi tạo báo giá mẫu:', quote.id);
        }
      }
      
      showToast('Đã tạo 10 báo giá mẫu thành công!');
    }

    // Nút tạo dữ liệu mẫu (ẩn sau khi sử dụng)
  // function addSampleDataButton() {
      const header = document.querySelector('.max-w-7xl > div:first-child .flex');
      const sampleBtn = document.createElement('button');
      sampleBtn.id = 'create-sample-btn';
      sampleBtn.className = 'bg-orange-500 hover:bg-orange-600 text-white font-semibold py-2 px-4 rounded shadow-md transition duration-200';
      sampleBtn.textContent = '🎯 Tạo Dữ Liệu Mẫu';
      sampleBtn.onclick = async function() {
        this.disabled = true;
        this.innerHTML = '<div class="loading-spinner"></div> Đang tạo...';
        await createSampleQuotes();
        this.style.display = 'none'; // Ẩn nút sau khi tạo
      };
      
      header.insertBefore(sampleBtn, header.lastElementChild);
    }
    // Create sample production orders in modal
  // async function createSampleProductionOrdersInModal() {
      const btn = document.getElementById('create-sample-production-orders');
      const originalText = btn.textContent;
      
      btn.disabled = true;
      btn.innerHTML = '<div class="loading-spinner mr-2"></div> Đang tạo...';
      
      try {
        await createSampleProductionOrders();
        btn.style.display = 'none'; // Ẩn nút sau khi tạo thành công
      } catch (error) {
        console.error('Lỗi tạo đơn hàng mẫu:', error);
        showToast('Lỗi khi tạo đơn hàng mẫu');
        btn.disabled = false;
        btn.innerHTML = originalText;
      }
    }

    // ========== PHẦN TẠO DỮ LIỆU MẪU ĐỚN HÀNG SẢN XUẤT ==========
  // async function createSampleProductionOrders() {
      const sampleProductionOrders = [
        {
          id: "production_001",
          outlet_code: "PROD_1703001",
          outlet_name: "Đơn hàng sản xuất 17/03/2024",
          address: "Công ty TNHH Quảng Cáo Sài Gòn",
          phone: "3", // Số lượng điểm thi công
          sale_name: "Đơn hàng sản xuất",
          area: "PRODUCTION",
          items: JSON.stringify([
            {
              outlet_code: "HCM001",
              outlet_name: "Quán Bia Sài Gòn",
              area: "S4",
              sale_type: "Sale (SR)",
              sale_name: "Nguyễn Văn A",
              address: "123 Nguyễn Huệ, Phường Bến Nghé, Quận 1, TP.HCM",
              spo_number: "SPO2024001",
              spo_status: "ASM Approved",
              total_amount: 4600000,
              items: JSON.stringify([
                { code: "1.1", content: "Bảng hiệu mica", brand: "Tiger", width: "2", height: "1", quantity: "2", unit: "m²", price: "500000", total: "1,000,000 ₫" },
                { code: "2.1", content: "Bảng hiệu LED", brand: "Heineken", width: "3", height: "1.5", quantity: "4.5", unit: "m²", price: "800000", total: "3,600,000 ₫" }
              ])
            },
            {
              outlet_code: "HCM002",
              outlet_name: "Nhà Hàng Biển Xanh",
              area: "S5",
              sale_type: "TBA",
              sale_name: "Lê Văn C",
              address: "456 Lê Lợi, Phường Bến Thành, Quận 1, TP.HCM",
              spo_number: "SPO2024011",
              spo_status: "Sale Rep Checkvariation",
              total_amount: 3300000,
              items: JSON.stringify([
                { code: "1.2", content: "Bảng hiệu alu", brand: "Bivina", width: "2.5", height: "1.2", quantity: "3", unit: "m²", price: "600000", total: "1,800,000 ₫" },
                { code: "9.2", content: "Đèn LED trang trí", brand: "Strongbow", width: "", height: "", quantity: "10", unit: "bộ", price: "150000", total: "1,500,000 ₫" }
              ])
            },
            {
              outlet_code: "DN001",
              outlet_name: "Quán Nhậu Miền Trung",
              area: "S16",
              sale_type: "Sale (SR)",
              sale_name: "Phạm Thị D",
              address: "789 Trần Phú, Phường Thạch Thang, Quận Hải Châu, Đà Nẵng",
              spo_number: "SPO2024002",
              spo_status: "ASM Approved",
              total_amount: 2360000,
              items: JSON.stringify([
                { code: "1.3", content: "Bảng hiệu shopname", brand: "Shopname", width: "4", height: "1", quantity: "4", unit: "m²", price: "450000", total: "1,800,000 ₫" },
                { code: "9.17", content: "Khung sắt", brand: "", width: "", height: "", quantity: "7", unit: "m", price: "80000", total: "560,000 ₫" }
              ])
            }
          ]),
          total_amount: 10260000,
          created_at: new Date(Date.now() - 86400000 * 3).toISOString(),
          spo_number: "DH-SX-2024-001",
          spo_status: "Đơn hàng sản xuất"
        },
        {
          id: "production_002",
          outlet_code: "PROD_1503002",
          outlet_name: "Đơn hàng sản xuất 15/03/2024",
          address: "Chưa nhập đơn vị thi công",
          phone: "2", // Số lượng điểm thi công
          sale_name: "Đơn hàng sản xuất",
          area: "PRODUCTION",
          items: JSON.stringify([
            {
              outlet_code: "HN001",
              outlet_name: "Beer Club Hà Nội",
              area: "S17",
              sale_type: "Sale (SR)",
              sale_name: "Hoàng Văn F",
              address: "321 Hoàng Diệu, Phường Liễu Giai, Quận Ba Đình, Hà Nội",
              spo_number: "SPO2024012",
              spo_status: "Sale Rep Checkvariation",
              total_amount: 7400000,
              items: JSON.stringify([
                { code: "2.2", content: "Bảng hiệu neon", brand: "Larue", width: "3", height: "2", quantity: "6", unit: "m²", price: "900000", total: "5,400,000 ₫" },
                { code: "9.3", content: "Hệ thống âm thanh", brand: "Tiger", width: "", height: "", quantity: "1", unit: "bộ", price: "2000000", total: "2,000,000 ₫" }
              ])
            },
            {
              outlet_code: "BD001",
              outlet_name: "Quán Nhậu Bình Dương",
              area: "S4",
              sale_type: "TBA",
              sale_name: "Phan Văn K",
              address: "147 Đại lộ Bình Dương, Phường Phú Hòa, TP.Thủ Dầu Một, Bình Dương",
              spo_number: "SPO2024004",
              spo_status: "Đã duyệt",
              total_amount: 4740000,
              items: JSON.stringify([
                { code: "2.1", content: "Bảng hiệu LED", brand: "Strongbow", width: "2.5", height: "1.8", quantity: "4.5", unit: "m²", price: "800000", total: "3,600,000 ₫" },
                { code: "9.17", content: "Khung sắt", brand: "", width: "", height: "", quantity: "8", unit: "m", price: "80000", total: "640,000 ₫" },
                { code: "N6", content: "Vật tư phụ", brand: "", width: "", height: "", quantity: "5", unit: "bộ", price: "100000", total: "500,000 ₫" }
              ])
            }
          ]),
          total_amount: 12140000,
          created_at: new Date(Date.now() - 86400000 * 5).toISOString(),
          spo_number: "Chưa nhập số đơn hàng",
          spo_status: "Đơn hàng sản xuất"
        },
        {
          id: "production_003",
          outlet_code: "PROD_1203003",
          outlet_name: "Đơn hàng sản xuất 12/03/2024",
          address: "Xưởng Sản Xuất Miền Nam",
          phone: "4", // Số lượng điểm thi công
          sale_name: "Đơn hàng sản xuất",
          area: "PRODUCTION",
          items: JSON.stringify([
            {
              outlet_code: "VT001",
              outlet_name: "Beer Garden Vũng Tàu",
              area: "S5",
              sale_type: "Sale (SR)",
              sale_name: "Bùi Thị L",
              address: "258 Thùy Vân, Phường 2, TP.Vũng Tàu, Bà Rịa - Vũng Tàu",
              spo_number: "SPO2024013",
              spo_status: "Đang xử lý",
              total_amount: 3690000,
              items: JSON.stringify([
                { code: "1.3", content: "Bảng hiệu shopname", brand: "Shopname", width: "3.5", height: "1.2", quantity: "4.2", unit: "m²", price: "450000", total: "1,890,000 ₫" },
                { code: "2.2", content: "Bảng hiệu neon", brand: "Tiger", width: "2", height: "1", quantity: "2", unit: "m²", price: "900000", total: "1,800,000 ₫" }
              ])
            },
            {
              outlet_code: "HP001",
              outlet_name: "Quán Bia Hải Phòng",
              area: "S16",
              sale_type: "Sale (SR)",
              sale_name: "Đinh Văn N",
              address: "369 Lạch Tray, Phường Đông Khê, Quận Ngô Quyền, Hải Phòng",
              spo_number: "SPO2024005",
              spo_status: "Đã duyệt",
              total_amount: 4560000,
              items: JSON.stringify([
                { code: "1.4", content: "Bảng hiệu composite", brand: "Shopname", width: "2.8", height: "1.5", quantity: "4.2", unit: "m²", price: "550000", total: "2,310,000 ₫" },
                { code: "9.2", content: "Đèn LED trang trí", brand: "Bivina", width: "", height: "", quantity: "15", unit: "bộ", price: "150000", total: "2,250,000 ₫" }
              ])
            },
            {
              outlet_code: "CT001",
              outlet_name: "Quán Bia Miền Tây",
              area: "S19",
              sale_type: "TBA",
              sale_name: "Trương Văn H",
              address: "654 Mậu Thân, Phường An Phú, Quận Ninh Kiều, Cần Thơ",
              spo_number: "SPO2024003",
              spo_status: "Từ chối",
              total_amount: 2050000,
              items: JSON.stringify([
                { code: "1.4", content: "Bảng hiệu composite", brand: "Shopname", width: "2", height: "1.5", quantity: "3", unit: "m²", price: "550000", total: "1,650,000 ₫" },
                { code: "N6", content: "Vật tư phụ", brand: "", width: "", height: "", quantity: "4", unit: "bộ", price: "100000", total: "400,000 ₫" }
              ])
            },
            {
              outlet_code: "NB001",
              outlet_name: "Nhà Hàng Ninh Bình",
              area: "S17",
              sale_type: "TBA",
              sale_name: "Vũ Thị P",
              address: "741 Trần Hưng Đạo, Phường Đông Thành, TP.Ninh Bình, Ninh Bình",
              spo_number: "SPO2024014",
              spo_status: "Chờ duyệt",
              total_amount: 5600000,
              items: JSON.stringify([
                { code: "1.1", content: "Bảng hiệu mica", brand: "Larue", width: "3", height: "1.8", quantity: "5.4", unit: "m²", price: "500000", total: "2,700,000 ₫" },
                { code: "1.2", content: "Bảng hiệu alu", brand: "Heineken", width: "1.5", height: "1", quantity: "1.5", unit: "m²", price: "600000", total: "900,000 ₫" },
                { code: "9.3", content: "Hệ thống âm thanh", brand: "Bia Việt", width: "", height: "", quantity: "1", unit: "bộ", price: "2000000", total: "2,000,000 ₫" }
              ])
            }
          ]),
          total_amount: 15900000,
          created_at: new Date(Date.now() - 86400000 * 7).toISOString(),
          spo_number: "DH-SX-2024-003",
          spo_status: "Đơn hàng sản xuất"
        }
      ];

      // Tạo từng đơn hàng sản xuất mẫu
      for (const order of sampleProductionOrders) {
        if (productionOrders.length >= 999) break; // Kiểm tra giới hạn
        
        const result = await window.dataSdk.create(order);
        if (!result.isOk) {
          console.error('Lỗi tạo đơn hàng sản xuất mẫu:', order.id);
        }
      }
      
      showToast('Đã tạo 3 đơn hàng sản xuất mẫu thành công!');
    }

    // Nút tạo đơn hàng sản xuất mẫu
  // function addSampleProductionButton() {
      const header = document.querySelector('.max-w-7xl > div:first-child .flex');
      const sampleProductionBtn = document.createElement('button');
      sampleProductionBtn.id = 'create-sample-production-btn';
      sampleProductionBtn.className = 'bg-purple-500 hover:bg-purple-600 text-white font-semibold py-2 px-4 rounded shadow-md transition duration-200';
      sampleProductionBtn.textContent = '🏭 Tạo Đơn Hàng SX Mẫu';
      sampleProductionBtn.onclick = async function() {
        this.disabled = true;
        this.innerHTML = '<div class="loading-spinner"></div> Đang tạo...';
        await createSampleProductionOrders();
        this.style.display = 'none'; // Ẩn nút sau khi tạo
      };
      
      // Thêm vào sau nút tạo báo giá mẫu
      const sampleBtn = document.getElementById('create-sample-btn');
      if (sampleBtn) {
        header.insertBefore(sampleProductionBtn, sampleBtn.nextSibling);
      } else {
        header.insertBefore(sampleProductionBtn, header.lastElementChild);
      }
    }
    // ========== KẾT THÚC PHẦN TẠO DỮ LIỆU MẪU ĐỚN HÀNG SẢN XUẤT ==========

  // ========== KẾT THÚC PHẦN TẠO DỮ LIỆU MẪU ==========
  */

