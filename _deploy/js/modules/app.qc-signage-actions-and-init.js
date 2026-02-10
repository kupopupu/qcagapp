
    function showQcSignageReason(key) {
      if (!key) return;
      const row = qcSignageUiState.itemsByKey.get(key);
      if (!row || !row.lastReason) return;
      const label = row.lastResult === 'fail' ? 'Fail' : 'Pending';
      const modal = ensureQcReasonViewModal();
      const title = document.getElementById('qc-reason-view-title');
      if (title) title.textContent = `Lý do ${label}`;
      const content = document.getElementById('qc-reason-view-content');
      if (content) {
        // Thông tin: Outlet, Đơn Hàng, Loại bảng
        const outlet = row.quoteRef && row.quoteRef.outletName ? row.quoteRef.outletName : '';
        const orderNum = row.orderNumber || '';
        const typeLabel = row.typeLabel || '';
        content.innerHTML = `<div class='mb-4 text-sm text-gray-600'>Outlet: <span class='font-semibold'>${escapeQcHtml(outlet)}</span> - Đơn Hàng: <span class='font-semibold'>${escapeQcHtml(orderNum)}</span> - Loại bảng: <span class='font-semibold'>${escapeQcHtml(typeLabel)}</span></div><div class='border rounded p-3 bg-gray-50'>${escapeQcHtml(row.lastReason)}</div>`;
      }
      modal.classList.remove('hidden');
      ensureScrollLock();
      const closeBtn = document.getElementById('qc-reason-view-close');
      if (closeBtn && !closeBtn._qcBound) {
        closeBtn._qcBound = true;
        closeBtn.addEventListener('click', () => {
          modal.classList.add('hidden');
          ensureScrollLock();
        });
      }
      if (!modal._qcEscBound) {
        modal._qcEscBound = true;
        modal.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            modal.classList.add('hidden');
            ensureScrollLock();
          }
        });
      }
      setTimeout(() => { modal.focus && modal.focus(); }, 0);
    }

    function ensureReturnConfirmModalElement() {
      return document.getElementById('qc-return-confirm-modal');
    }

    function openReturnConfirmModal(key) {
      if (!key) return;
      const row = qcSignageUiState.itemsByKey.get(key);
      const outlet = row && row.quoteRef && row.quoteRef.outletName ? row.quoteRef.outletName : (row && row.quoteRef && row.quoteRef.outletCode ? row.quoteRef.outletCode : '');
      const modal = ensureReturnConfirmModalElement();
      if (!modal) {
        if (typeof showToast === 'function') showToast('Không tìm thấy cửa sổ xác nhận.');
        return;
      }
      qcSignageUiState.returnConfirm.pendingKey = key;
      qcSignageUiState.returnConfirm.pendingOutlet = outlet || '';
      const outletEl = document.getElementById('qc-return-outlet-name');
      if (outletEl) outletEl.textContent = outlet || '-';
      modal.classList.remove('hidden');
      ensureScrollLock();
      // Bind controls once
      if (!modal._qcBound) {
        modal._qcBound = true;
        const closeBtn = document.getElementById('qc-return-confirm-close');
        if (closeBtn) closeBtn.addEventListener('click', () => { modal.classList.add('hidden'); qcSignageUiState.returnConfirm.pendingKey = null; ensureScrollLock(); });
        const cancelBtn = document.getElementById('qc-return-cancel');
        if (cancelBtn) cancelBtn.addEventListener('click', () => { modal.classList.add('hidden'); qcSignageUiState.returnConfirm.pendingKey = null; ensureScrollLock(); });
        const confirmBtn = document.getElementById('qc-return-confirm');
        if (confirmBtn) confirmBtn.addEventListener('click', async () => {
          confirmBtn.disabled = true;
          const k = qcSignageUiState.returnConfirm.pendingKey;
          if (k) {
            await setQcSignageItemStatus(k, 'waiting', { lastResult: null, lastReason: '' });
            if (typeof showToast === 'function') showToast('Đã trả về sang Chờ QC.');
            qcSignageUiState.returnConfirm.pendingKey = null;
            modal.classList.add('hidden');
            renderQcSignageModal();
          }
          confirmBtn.disabled = false;
          ensureScrollLock();
        });
        modal.addEventListener('click', (e) => { if (e.target === modal) { modal.classList.add('hidden'); qcSignageUiState.returnConfirm.pendingKey = null; ensureScrollLock(); } });
        modal.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            modal.classList.add('hidden'); qcSignageUiState.returnConfirm.pendingKey = null; ensureScrollLock();
          } else if (e.key === 'Enter') {
            const btn = document.getElementById('qc-return-confirm'); if (btn) btn.click();
          }
        });
      }
      // Focus for keyboard events
      setTimeout(() => { const b = document.getElementById('qc-return-confirm'); if (b) b.focus(); else modal.focus && modal.focus(); }, 0);
    }

    // Export selected keys (optional). If `keys` provided, use them; otherwise fallback to current selection
    function exportQcSignageToExcel(keys) {
      const selectedKeys = Array.isArray(keys) ? keys : Array.from(qcSignageUiState.selection);
      if (selectedKeys.length === 0) {
        if (typeof showToast === 'function') showToast('Chưa chọn hạng mục nào để xuất.');
        return;
      }
      const rows = collectQcSignageRows();
      const selectedRows = rows.filter(row => selectedKeys.includes(row.key));
      
      // Helper function to calculate quantity based on code and content
      function calculateQcQuantity(code, content) {
        const codeStr = String(code || '').trim();
        const contentLower = String(content || '').toLowerCase();
        
        // Code 9.2 + "2 mặt" => 2
        if (codeStr === '9.2' && contentLower.includes('2 mặt')) return 2;
        // Code 9.3 + "1 mặt" => 1
        if (codeStr === '9.3' && contentLower.includes('1 mặt')) return 1;
        // Code 9.3 + "2 mặt" => 2
        if (codeStr === '9.3' && contentLower.includes('2 mặt')) return 2;
        // Code 2.1 + "giả hộp" => 2
        if (codeStr === '2.1' && contentLower.includes('giả hộp')) return 2;
        // Default => 1
        return 1;
      }
      
      const data = selectedRows.map((row, index) => {
        // Parse width and height as numbers
        const widthNum = parseFloat(row.item.width) || 0;
        const heightNum = parseFloat(row.item.height) || 0;
        const quantity = calculateQcQuantity(row.item.code, row.item.content);
        
        return {
          STT: index + 1,
          Area: row.quoteRef.area || 'South',
          'Mã SPO': row.quoteRef.spoNumber || '',
          'Mã Outlet': row.quoteRef.outletCode || '',
          'Tên Outlet': row.quoteRef.outletName || '',
          'Tỉnh/thành phố': row.quoteRef.province || '',
          'Xã/phường': row.quoteRef.district || '',
          'Ấp/khóm': row.quoteRef.ward || '',
          'Tên đường': row.quoteRef.street || '',
          'Số nhà': row.quoteRef.house_number || '',
          'Ngang': widthNum,
          'Cao': heightNum,
          'Trụ phi 90': '',
          'Nhãn hàng': row.item.brand || '',
          'Loại bảng': row.typeLabel || '',
          'Số lượng': quantity
        };
      });
      const ws = XLSX.utils.json_to_sheet(data);
      
      // Format number columns (Ngang, Cao, Số lượng) - columns K, L, P (index 10, 11, 15)
      const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
      for (let R = range.s.r + 1; R <= range.e.r; ++R) {
        // Ngang (column K = 10)
        const cellNgang = ws[XLSX.utils.encode_cell({r: R, c: 10})];
        if (cellNgang) cellNgang.t = 'n';
        // Cao (column L = 11)
        const cellCao = ws[XLSX.utils.encode_cell({r: R, c: 11})];
        if (cellCao) cellCao.t = 'n';
        // Số lượng (column P = 15)
        const cellSL = ws[XLSX.utils.encode_cell({r: R, c: 15})];
        if (cellSL) cellSL.t = 'n';
      }
      
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'QC Signage');
      const fileName = `QC_Signage_${new Date().toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(wb, fileName);
      if (typeof showToast === 'function') showToast(`Đã xuất ${selectedKeys.length} hạng mục ra file Excel.`);
    }

    function attachQcSignageDelegates(tab) {
      const panel = document.getElementById(`qc-tab-panel-${tab}`);
      if (!panel) return;
      const qcUnselectBtn = document.getElementById('qc-unselect-btn');
      const qcRegisterBtn = document.getElementById('qc-register-btn'); // todo: Thêm vào danh sách
      const qcListRegisterBtn = document.getElementById('qc-list-register-btn'); // list: Đăng ký QC
      const qcExportBtn = document.getElementById('qc-export-btn');
      const qcPassAllBtn = document.getElementById('qc-pass-all-btn');
      // pass filters container (show only on pass tab)
      const passFilters = document.getElementById('qc-pass-filters');
      if (passFilters) passFilters.classList.add('hidden');

      const bindUnselect = () => {
        if (!qcUnselectBtn) return;
        qcUnselectBtn.disabled = qcSignageUiState.selection.size === 0;
        qcUnselectBtn.onclick = () => {
          const modal = ensureQcUnselectConfirmModal();
          modal.classList.remove('hidden');
          ensureScrollLock();
          if (!modal._qcBound) {
            modal._qcBound = true;
            const cancelBtn = document.getElementById('qc-unselect-cancel');
            if (cancelBtn) cancelBtn.onclick = () => { modal.classList.add('hidden'); ensureScrollLock(); };
            const confirmBtn = document.getElementById('qc-unselect-confirm');
            if (confirmBtn) confirmBtn.onclick = () => {
              qcSignageUiState.selection.clear();
              modal.classList.add('hidden');
              renderQcSignageModal();
              ensureScrollLock();
            };
            modal.addEventListener('click', (event) => { if (event.target === modal) { modal.classList.add('hidden'); ensureScrollLock(); } });
          }
        };
      };

      if (tab === 'todo') {
        if (qcPassAllBtn) qcPassAllBtn.classList.add('hidden');
        panel.querySelectorAll('tr[data-qc-row="true"]').forEach(rowEl => {
          rowEl.onclick = (event) => {
            const interactive = event.target.closest('button, a, input, textarea, select, label');
            if (interactive) return;
            if (rowEl.getAttribute('data-qc-disabled') === 'true') return;
            const key = rowEl.getAttribute('data-qc-key');
            if (!key) return;
            if (qcSignageUiState.selection.has(key)) qcSignageUiState.selection.delete(key);
            else qcSignageUiState.selection.add(key);
            renderQcSignageModal();
          };
        });
        panel.querySelectorAll('[data-qc-reason]').forEach(btn => {
          btn.addEventListener('click', () => {
            const key = btn.getAttribute('data-qc-reason');
            showQcSignageReason(key);
          });
        });
        if (qcRegisterBtn) {
          qcRegisterBtn.disabled = qcSignageUiState.selection.size === 0;
          qcRegisterBtn.textContent = 'Thêm vào Danh sách';
          qcRegisterBtn.setAttribute('aria-label', 'Thêm vào Danh sách QC');
          qcRegisterBtn.onclick = async () => {
            qcRegisterBtn.disabled = true;
            await moveSelectedQcItemsToList();
            qcRegisterBtn.disabled = false;
          };
          qcRegisterBtn.classList.remove('hidden');
        }
        if (qcListRegisterBtn) qcListRegisterBtn.classList.add('hidden');
        if (qcExportBtn) qcExportBtn.classList.add('hidden');
        bindUnselect();
        updateQcSelectionSummary();
        // Select-all button for todo
        const qcSelectAllBtn = document.getElementById('qc-select-all-btn');
        if (qcSelectAllBtn) {
          const rows = Array.from(panel.querySelectorAll('tr[data-qc-row="true"]')).filter(r => r.getAttribute('data-qc-disabled') !== 'true');
          qcSelectAllBtn.disabled = rows.length === 0;
          qcSelectAllBtn.classList.remove('hidden');
          const allSelected = rows.length && Array.from(rows).every(r => qcSignageUiState.selection.has(r.getAttribute('data-qc-key')));
          qcSelectAllBtn.textContent = allSelected ? 'Bỏ chọn tất cả' : 'Chọn tất cả';
          qcSelectAllBtn.onclick = () => {
            const keys = Array.from(rows).map(r => r.getAttribute('data-qc-key'));
            const currentlyAll = keys.length && keys.every(k => qcSignageUiState.selection.has(k));
            if (currentlyAll) {
              keys.forEach(k => qcSignageUiState.selection.delete(k));
            } else {
              keys.forEach(k => qcSignageUiState.selection.add(k));
            }
            renderQcSignageModal();
          };
        }
        // Show unselect and count
        const qcUnselectBtn = document.getElementById('qc-unselect-btn');
        if (qcUnselectBtn) qcUnselectBtn.classList.remove('hidden');
        const qcSelectionCount = document.getElementById('qc-selection-count');
        if (qcSelectionCount) qcSelectionCount.classList.remove('hidden');
      } else if (tab === 'waiting') {
        // Ensure select-all hidden in non-todo tabs
        const qcSelectAllBtn = document.getElementById('qc-select-all-btn');
        if (qcSelectAllBtn) qcSelectAllBtn.classList.add('hidden');
        panel.querySelectorAll('[data-qc-action]').forEach(btn => {
          btn.addEventListener('click', async () => {
            const action = btn.getAttribute('data-qc-action');
            const key = btn.getAttribute('data-qc-key');
            if (!action || !key) return;
            btn.disabled = true;
            await handleQcSignageAction(action, key);
            btn.disabled = false;
          });
        });
        if (qcRegisterBtn) qcRegisterBtn.classList.add('hidden');
        if (qcListRegisterBtn) qcListRegisterBtn.classList.add('hidden');
        if (qcExportBtn) qcExportBtn.classList.add('hidden');
        if (qcPassAllBtn) qcPassAllBtn.classList.remove('hidden');
        // Hide unselect and count
        const qcUnselectBtn = document.getElementById('qc-unselect-btn');
        if (qcUnselectBtn) qcUnselectBtn.classList.add('hidden');
        const qcSelectionCount = document.getElementById('qc-selection-count');
        if (qcSelectionCount) qcSelectionCount.classList.add('hidden');
      } else if (tab === 'list') {
        // Ensure select-all hidden in non-todo tabs
        const qcSelectAllBtn2 = document.getElementById('qc-select-all-btn');
        if (qcSelectAllBtn2) qcSelectAllBtn2.classList.add('hidden');
        panel.querySelectorAll('tr[data-qc-row="true"]').forEach(rowEl => {
          rowEl.onclick = (event) => {
            const interactive = event.target.closest('button, a, input, textarea, select, label');
            if (interactive) return;
            const key = rowEl.getAttribute('data-qc-key');
            if (!key) return;
            if (qcSignageUiState.selection.has(key)) qcSignageUiState.selection.delete(key);
            else qcSignageUiState.selection.add(key);
            renderQcSignageModal();
          };
        });
        if (qcListRegisterBtn) {
          qcListRegisterBtn.classList.remove('hidden');
          // enable if there are any rows in list (allow acting on all when none selected)
          const listRows = panel.querySelectorAll('tr[data-qc-row="true"]');
          qcListRegisterBtn.disabled = listRows.length === 0;
          qcListRegisterBtn.onclick = async () => {
            qcListRegisterBtn.disabled = true;
            // use current selection if present, otherwise operate on all list keys
            const keys = Array.from(qcSignageUiState.selection).filter(k => {
              const r = qcSignageUiState.itemsByKey.get(k); return r && r.status === 'list';
            });
            const effectiveKeys = keys.length ? keys : Array.from(qcSignageUiState.itemsByKey).filter(([k,v]) => v && v.status === 'list').map(([k])=>k);
            if (effectiveKeys.length) {
              exportQcSignageToExcel(effectiveKeys);
              await moveListSelectedToWaiting(effectiveKeys);
            } else {
              if (typeof showToast === 'function') showToast('Không có hạng mục nào để đăng ký.');
            }
            qcListRegisterBtn.disabled = false;
          };
        }
        if (qcExportBtn) {
          qcExportBtn.classList.remove('hidden');
          qcExportBtn.onclick = () => {
            const keys = Array.from(qcSignageUiState.selection).filter(k => {
              const r = qcSignageUiState.itemsByKey.get(k);
              return r && r.status === 'list';
            });
            const effectiveKeys = keys.length ? keys : Array.from(qcSignageUiState.itemsByKey).filter(([k,v]) => v && v.status === 'list').map(([k])=>k);
            if (effectiveKeys.length) {
              exportQcSignageToExcel(effectiveKeys);
            } else {
              if (typeof showToast === 'function') showToast('Không có hạng mục nào để xuất.');
            }
          };
        }
        if (qcRegisterBtn) qcRegisterBtn.classList.add('hidden');
        if (qcPassAllBtn) qcPassAllBtn.classList.add('hidden');
        // Attach remove buttons in list
        panel.querySelectorAll('[data-qc-action="remove"]').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const key = btn.getAttribute('data-qc-key');
            if (!key) return;
            btn.disabled = true;
            await setQcSignageItemStatus(key, 'todo', { lastResult: null, lastReason: '' });
            if (typeof showToast === 'function') showToast('Đã loại khỏi Danh sách QC.');
            renderQcSignageModal();
          });
        });
        bindUnselect();
        updateQcSelectionSummary();
        // Show unselect and count
        const qcUnselectBtn = document.getElementById('qc-unselect-btn');
        if (qcUnselectBtn) qcUnselectBtn.classList.remove('hidden');
        const qcSelectionCount = document.getElementById('qc-selection-count');
        if (qcSelectionCount) qcSelectionCount.classList.remove('hidden');
      } else if (tab === 'pass') {
          // Hide select-all in pass tab as well
        const qcSelectAllBtn3 = document.getElementById('qc-select-all-btn');
        if (qcSelectAllBtn3) qcSelectAllBtn3.classList.add('hidden');
        // Show pass date filters
        const passFilters = document.getElementById('qc-pass-filters');
        if (passFilters) {
          passFilters.classList.remove('hidden');
          const pf = document.getElementById('qc-pass-from');
          const pt = document.getElementById('qc-pass-to');
          if (pf) {
            pf.value = qcSignageUiState.passFilterFrom || '';
            pf.style.width = '120px'; // Fixed width to prevent jumping
            if (qcSignageUiState.passFilterTo) {
              pf.max = qcSignageUiState.passFilterTo;
            } else {
              pf.removeAttribute('max');
            }
          }
          if (pt) {
            pt.value = qcSignageUiState.passFilterTo || '';
            pt.style.width = '120px'; // Fixed width to prevent jumping
            if (qcSignageUiState.passFilterFrom) {
              pt.min = qcSignageUiState.passFilterFrom;
            } else {
              pt.removeAttribute('min');
            }
          }
        }
        panel.querySelectorAll('[data-qc-action]').forEach(btn => {
          btn.addEventListener('click', async () => {
            const action = btn.getAttribute('data-qc-action');
            const key = btn.getAttribute('data-qc-key');
            if (!action || !key) return;
            btn.disabled = true;
            await handleQcSignageAction(action, key);
            btn.disabled = false;
          });
        });
        // Highlight whole row when hovering the 'Trả về' button
        panel.querySelectorAll('[data-qc-action="return"]').forEach(btn => {
          const tr = btn.closest('tr');
          if (!tr) return;
          btn.addEventListener('mouseenter', () => {
            if (!tr.classList.contains('bg-green-50')) tr.classList.add('bg-gray-100');
          });
          btn.addEventListener('mouseleave', () => {
            if (tr.classList.contains('bg-gray-100')) tr.classList.remove('bg-gray-100');
          });
        });
        if (qcPassAllBtn) qcPassAllBtn.classList.add('hidden');
        if (qcRegisterBtn) qcRegisterBtn.classList.add('hidden');
        if (qcListRegisterBtn) qcListRegisterBtn.classList.add('hidden');
        if (qcExportBtn) qcExportBtn.classList.add('hidden');
        // Hide unselect and count
        const qcUnselectBtn = document.getElementById('qc-unselect-btn');
        if (qcUnselectBtn) qcUnselectBtn.classList.add('hidden');
        const qcSelectionCount = document.getElementById('qc-selection-count');
        if (qcSelectionCount) qcSelectionCount.classList.add('hidden');
      }
    }

    function renderQcSignageModal() {
      const modal = ensureQcSignageModalElement();
      if (!modal || modal.classList.contains('hidden')) return;
      const rows = collectQcSignageRows();
      const grouped = { todo: [], list: [], waiting: [], pass: [] };
      rows.forEach(row => {
        if (row.status === 'waiting') grouped.waiting.push(row);
        else if (row.status === 'pass') grouped.pass.push(row);
        else if (row.status === 'list') grouped.list.push(row);
        else grouped.todo.push(row);
      });
      updateQcTabButtons({
        todo: grouped.todo.length,
        list: grouped.list.length,
        waiting: grouped.waiting.length,
        pass: grouped.pass.length
      });

      // Apply 'pass' date filters (if set) — filter by row.updatedAt
      if (qcSignageUiState.passFilterFrom || qcSignageUiState.passFilterTo) {
        const from = qcSignageUiState.passFilterFrom ? new Date(qcSignageUiState.passFilterFrom) : null;
        const to = qcSignageUiState.passFilterTo ? new Date(qcSignageUiState.passFilterTo) : null;
        if (to) to.setHours(23, 59, 59, 999);
        grouped.pass = grouped.pass.filter(row => {
          if (!row.updatedAt) return false;
          const d = new Date(row.updatedAt);
          if (from && d < from) return false;
          if (to && d > to) return false;
          return true;
        });
      }
      const searchInput = document.getElementById('qc-search-input');
      if (searchInput && searchInput.value !== qcSignageUiState.searchTerm) {
        searchInput.value = qcSignageUiState.searchTerm;
      }
      const activeTab = qcSignageUiState.activeTab || 'todo';
      const pageSize = Math.max(1, parseInt(qcSignageUiState.pageSize || 15, 10) || 15);
      const totalForActive = grouped[activeTab] ? grouped[activeTab].length : 0;
      const totalPages = Math.max(1, Math.ceil(totalForActive / pageSize));
      const pageByTab = qcSignageUiState.pageByTab || (qcSignageUiState.pageByTab = { todo: 1, list: 1, waiting: 1, pass: 1 });
      let activePage = parseInt(pageByTab[activeTab] || 1, 10) || 1;
      if (activePage > totalPages) activePage = totalPages;
      if (activePage < 1) activePage = 1;
      pageByTab[activeTab] = activePage;
      const startIdx = (activePage - 1) * pageSize;
      const endIdx = startIdx + pageSize;
      const pagedRows = grouped[activeTab].slice(startIdx, endIdx);

      // Update pagination UI
      try {
        const info = document.getElementById('qc-page-info');
        const prevBtn = document.getElementById('qc-page-prev');
        const nextBtn = document.getElementById('qc-page-next');
        const sizeSelect = document.getElementById('qc-page-size');
        if (info) info.textContent = `Trang ${activePage} / ${totalPages} (${totalForActive})`;
        if (prevBtn) prevBtn.disabled = activePage <= 1;
        if (nextBtn) nextBtn.disabled = activePage >= totalPages;
        if (sizeSelect) sizeSelect.value = String(pageSize);
      } catch (e) { /* ignore */ }

      ['todo','list','waiting','pass'].forEach(tab => {
        const panel = document.getElementById(`qc-tab-panel-${tab}`);
        if (!panel) return;
        if (qcSignageUiState.activeTab === tab) {
          panel.classList.remove('hidden');
          panel.innerHTML = buildQcSignageTabHtml(tab, pagedRows);
        } else {
          panel.classList.add('hidden');
          panel.innerHTML = '';
        }
      });
      attachQcSignageDelegates(qcSignageUiState.activeTab);
    }

    function handleQcTabSwitch(tab) {
      if (!tab || tab === qcSignageUiState.activeTab) return;
      if (!['todo', 'list', 'waiting', 'pass'].includes(tab)) return;
      qcSignageUiState.activeTab = tab;
      renderQcSignageModal();
    }

    function openQcSignageModal() {
      const modal = ensureQcSignageModalElement();
      if (!modal) {
        if (typeof showToast === 'function') showToast('Không tìm thấy cửa sổ QC.');
        return;
      }
      setupQcSignageModalHandlers();
      modal.classList.remove('hidden');
      ensureScrollLock();
      renderQcSignageModal();
      const searchInput = document.getElementById('qc-search-input');
      if (searchInput) {
        searchInput.value = qcSignageUiState.searchTerm;
        searchInput.focus();
        const len = searchInput.value.length;
        if (typeof searchInput.setSelectionRange === 'function') {
          searchInput.setSelectionRange(len, len);
        }
      }
    }

    function closeQcSignageModal() {
      const modal = document.getElementById('qc-signage-modal');
      if (!modal) return;
      modal.classList.add('hidden');
      qcSignageUiState.selection.clear();
      ensureScrollLock();
    }

    function resetQcReasonModalState() {
      qcSignageUiState.reasonModal.pendingAction = null;
      qcSignageUiState.reasonModal.pendingKey = null;
    }

    function closeQcReasonModal() {
      const modal = document.getElementById('qc-reason-modal');
      if (!modal) return;
      modal.classList.add('hidden');
      const input = document.getElementById('qc-reason-input');
      if (input) {
        input.value = '';
      }
      resetQcReasonModalState();
      ensureScrollLock();
    }

    async function submitQcReasonModal() {
      const { pendingAction, pendingKey } = qcSignageUiState.reasonModal;
      if (!pendingAction || !pendingKey) {
        closeQcReasonModal();
        return;
      }
      const input = document.getElementById('qc-reason-input');
      const reason = input ? input.value.trim() : '';
      if (!reason) {
        if (typeof showToast === 'function') showToast('Vui lòng nhập lý do.');
        if (input) input.focus();
        return;
      }
      const row = qcSignageUiState.itemsByKey.get(pendingKey);
      await setQcSignageItemStatus(pendingKey, 'todo', { lastResult: pendingAction, lastReason: reason });
      if (row) {
        const label = pendingAction === 'fail' ? 'Fail' : 'Pending';
        // Resolve authoritative outlet info from currentQuotes when possible
        let oc = row.quoteRef.outletCode || '';
        let on = row.quoteRef.outletName || '';
        try {
          let aq = null;
          if (row.quoteRef && row.quoteRef.quoteCode) aq = findQuoteByIdentifier(row.quoteRef.quoteCode) || aq;
          if (!aq && row.quoteRef && row.quoteRef.spoNumber) aq = findQuoteByIdentifier(row.quoteRef.spoNumber) || aq;
          if (!aq && row.quoteRef && row.quoteRef.outletCode && Array.isArray(currentQuotes)) aq = currentQuotes.find(q => String(q.outlet_code) === String(row.quoteRef.outletCode)) || aq;
          if (aq) {
            oc = aq.outlet_code || oc;
            on = aq.outlet_name || on;
          }
        } catch (e) { /* ignore */ }
        const message = `QC Bảng hiệu • ${label} • ĐH ${row.orderNumber} • Outlet ${oc || '-'} - ${on || '-'} • Item ${row.item.code || ''} ${row.typeLabel}: ${reason}`;
        await appendQcSignageNote(row.orderKey, message);
      }
      if (typeof showToast === 'function') {
        const label = pendingAction === 'fail' ? 'Fail' : 'Pending';
        showToast(`Đã đánh dấu ${label}.`);
      }
      closeQcReasonModal();
      renderQcSignageModal();
    }

    function ensureQcReasonModalElement() {
      return document.getElementById('qc-reason-modal');
    }

    function ensureQcReasonViewModal() {
      return document.getElementById('qc-reason-view-modal');
    }

    function openQcReasonModal(action, key) {
      const modal = ensureQcReasonModalElement();
      if (!modal) {
        if (typeof showToast === 'function') showToast('Không tìm thấy cửa sổ nhập lý do.');
        return;
      }
      qcSignageUiState.reasonModal.pendingAction = action;
      qcSignageUiState.reasonModal.pendingKey = key;
      const title = document.getElementById('qc-reason-title');
      if (title) {
        title.textContent = action === 'fail' ? 'Lý do Fail' : 'Lý do Pending';
      }
      const input = document.getElementById('qc-reason-input');
      if (input) {
        input.value = '';
        const schedule = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb) => setTimeout(cb, 0);
        schedule(() => {
          input.focus();
        });
      }
      modal.classList.remove('hidden');
      ensureScrollLock();
    }

    function setupQcSignageModalHandlers() {
      if (qcSignageHandlersBound) return;
      const modal = ensureQcSignageModalElement();
      if (!modal) return;
      qcSignageHandlersBound = true;
      const closeBtn = document.getElementById('close-qc-signage-modal');
      if (closeBtn) {
        closeBtn.addEventListener('click', closeQcSignageModal);
      }
      modal.addEventListener('click', (event) => {
        if (event.target === modal) {
          closeQcSignageModal();
        }
      });
      const searchInput = document.getElementById('qc-search-input');
      if (searchInput) {
        searchInput.addEventListener('input', (event) => {
          qcSignageUiState.searchTerm = event.target.value || '';
          if (qcSignageUiState.pageByTab) {
            const tab = qcSignageUiState.activeTab || 'todo';
            qcSignageUiState.pageByTab[tab] = 1;
          }
          renderQcSignageModal();
        });
      }
      
      // Toggle button for order-only search
      const searchOrderToggle = document.getElementById('qc-search-order-toggle');
      if (searchOrderToggle && !searchOrderToggle._qcBound) {
        searchOrderToggle._qcBound = true;
        console.log('[QC Debug] Toggle button found and binding click handler');
        // Update button style based on initial state
        const updateToggleStyle = () => {
          if (qcSignageUiState.searchOrderOnly) {
            searchOrderToggle.classList.add('bg-blue-500', 'text-white', 'border-blue-500', 'hover:bg-blue-600');
            searchOrderToggle.classList.remove('bg-white', 'text-gray-700', 'hover:bg-gray-50');
            searchInput.placeholder = 'Tìm theo số đơn hàng...';
          } else {
            searchOrderToggle.classList.remove('bg-blue-500', 'text-white', 'border-blue-500', 'hover:bg-blue-600');
            searchOrderToggle.classList.add('bg-white', 'text-gray-700', 'hover:bg-gray-50');
            searchInput.placeholder = 'Tìm theo Mã đơn hàng, SPO, Outlet...';
          }
        };
        updateToggleStyle();
        
        searchOrderToggle.addEventListener('click', (e) => {
          console.log('[QC Debug] Toggle button clicked!', e);
          qcSignageUiState.searchOrderOnly = !qcSignageUiState.searchOrderOnly;
          console.log('[QC Debug] searchOrderOnly is now:', qcSignageUiState.searchOrderOnly);
          updateToggleStyle();
          // Re-render if there's a search term
          if (qcSignageUiState.searchTerm) {
            if (qcSignageUiState.pageByTab) {
              const tab = qcSignageUiState.activeTab || 'todo';
              qcSignageUiState.pageByTab[tab] = 1;
            }
            renderQcSignageModal();
          }
        });
      }

      // Pagination controls
      const qcPrevBtn = document.getElementById('qc-page-prev');
      const qcNextBtn = document.getElementById('qc-page-next');
      const qcPageSize = document.getElementById('qc-page-size');
      if (qcPrevBtn && !qcPrevBtn._qcBound) {
        qcPrevBtn._qcBound = true;
        qcPrevBtn.addEventListener('click', () => {
          const tab = qcSignageUiState.activeTab || 'todo';
          qcSignageUiState.pageByTab = qcSignageUiState.pageByTab || { todo: 1, list: 1, waiting: 1, pass: 1 };
          qcSignageUiState.pageByTab[tab] = Math.max(1, (qcSignageUiState.pageByTab[tab] || 1) - 1);
          renderQcSignageModal();
        });
      }
      if (qcNextBtn && !qcNextBtn._qcBound) {
        qcNextBtn._qcBound = true;
        qcNextBtn.addEventListener('click', () => {
          const tab = qcSignageUiState.activeTab || 'todo';
          qcSignageUiState.pageByTab = qcSignageUiState.pageByTab || { todo: 1, list: 1, waiting: 1, pass: 1 };
          qcSignageUiState.pageByTab[tab] = (qcSignageUiState.pageByTab[tab] || 1) + 1;
          renderQcSignageModal();
        });
      }
      if (qcPageSize && !qcPageSize._qcBound) {
        qcPageSize._qcBound = true;
        qcPageSize.addEventListener('change', (e) => {
          const next = parseInt(e.target.value, 10) || 15;
          qcSignageUiState.pageSize = next;
          if (qcSignageUiState.pageByTab) {
            const tab = qcSignageUiState.activeTab || 'todo';
            qcSignageUiState.pageByTab[tab] = 1;
          }
          renderQcSignageModal();
        });
      }

      // Date filters for 'Đạt QC' tab (auto-apply)
      const passFrom = document.getElementById('qc-pass-from');
      const passTo = document.getElementById('qc-pass-to');
      if (passFrom && !passFrom._qcBound) {
        passFrom._qcBound = true;
        passFrom.addEventListener('change', (e) => {
          const fromValue = e.target.value;
          qcSignageUiState.passFilterFrom = fromValue || '';
          // Set min for 'to' date
          if (passTo && fromValue) {
            passTo.min = fromValue;
            // If current 'to' is before 'from', clear it
            if (passTo.value && passTo.value < fromValue) {
              passTo.value = '';
              qcSignageUiState.passFilterTo = '';
            }
          } else if (passTo) {
            passTo.removeAttribute('min');
          }
          renderQcSignageModal();
        });
      }
      if (passTo && !passTo._qcBound) {
        passTo._qcBound = true;
        passTo.addEventListener('change', (e) => {
          const toValue = e.target.value;
          qcSignageUiState.passFilterTo = toValue || '';
          // Set max for 'from' date
          if (passFrom && toValue) {
            passFrom.max = toValue;
            // If current 'from' is after 'to', clear it
            if (passFrom.value && passFrom.value > toValue) {
              passFrom.value = '';
              qcSignageUiState.passFilterFrom = '';
            }
          } else if (passFrom) {
            passFrom.removeAttribute('max');
          }
          renderQcSignageModal();
        });
      }
      const passClear = document.getElementById('qc-pass-clear');
      if (passClear && !passClear._qcBound) {
        passClear._qcBound = true;
        passClear.addEventListener('click', () => {
          qcSignageUiState.passFilterFrom = qcSignageUiState.passFilterTo = '';
          if (passFrom) {
            passFrom.value = '';
            passFrom.removeAttribute('max');
          }
          if (passTo) {
            passTo.value = '';
            passTo.removeAttribute('min');
          }
          renderQcSignageModal();
        });
      }
      const tabButtons = document.querySelectorAll('[data-qc-tab]');
      tabButtons.forEach(btn => {
        if (btn._qcBound) return;
        btn._qcBound = true;
        btn.addEventListener('click', () => {
          const value = btn.getAttribute('data-qc-tab');
          handleQcTabSwitch(value);
        });
      });
      const reasonModal = ensureQcReasonModalElement();
      if (reasonModal && !reasonModal._qcBound) {
        reasonModal._qcBound = true;
        reasonModal.addEventListener('click', (event) => {
          if (event.target === reasonModal) {
            closeQcReasonModal();
          }
        });
        const closeBtn = document.getElementById('qc-reason-close');
        if (closeBtn) closeBtn.addEventListener('click', closeQcReasonModal);
        const cancelBtn = document.getElementById('qc-reason-cancel');
        if (cancelBtn) cancelBtn.addEventListener('click', closeQcReasonModal);
        const submitBtn = document.getElementById('qc-reason-submit');
        if (submitBtn) submitBtn.addEventListener('click', submitQcReasonModal);
        const input = document.getElementById('qc-reason-input');
        if (input) {
          input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submitQcReasonModal();
              return;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              closeQcReasonModal();
            }
          });
        }
      }
      const reasonViewModal = ensureQcReasonViewModal();
      if (reasonViewModal && !reasonViewModal._qcBound) {
        reasonViewModal._qcBound = true;
        reasonViewModal.addEventListener('click', (event) => {
          if (event.target === reasonViewModal) {
            reasonViewModal.classList.add('hidden');
            ensureScrollLock();
          }
        });
        const closeBtn = document.getElementById('qc-reason-view-close');
        if (closeBtn) closeBtn.addEventListener('click', () => {
          reasonViewModal.classList.add('hidden');
          ensureScrollLock();
        });
        const okBtn = document.getElementById('qc-reason-view-ok');
        if (okBtn) okBtn.addEventListener('click', () => {
          reasonViewModal.classList.add('hidden');
          ensureScrollLock();
        });
      }
      // Bind Pass All button to confirmation modal
      const qcPassAllBtn = document.getElementById('qc-pass-all-btn');
      if (qcPassAllBtn && !qcPassAllBtn._qcBound) {
        qcPassAllBtn._qcBound = true;
        qcPassAllBtn.addEventListener('click', () => {
          const modal = ensureQcPassAllConfirmModal();
          modal.classList.remove('hidden');
          ensureScrollLock();
          if (!modal._qcBound) {
            modal._qcBound = true;
            const cancelBtn = document.getElementById('qc-pass-all-cancel');
            const confirmBtn = document.getElementById('qc-pass-all-confirm');
            if (cancelBtn) cancelBtn.addEventListener('click', () => { modal.classList.add('hidden'); ensureScrollLock(); });
            if (confirmBtn) confirmBtn.addEventListener('click', async () => {
              confirmBtn.disabled = true;
              await performPassAllWaiting();
              confirmBtn.disabled = false;
              modal.classList.add('hidden');
              ensureScrollLock();
            });
            modal.addEventListener('click', (event) => { if (event.target === modal) { modal.classList.add('hidden'); ensureScrollLock(); } });
          }
        });
      }
    }

    // Initialize
    initializeApp();
    setupSearch();
    setupQcSignageModalHandlers();
    setupExcelImportHandlers();
    // Restore sidebar event bindings (was removed in corruption)
    function setupSidebar() {
      const createBtn = document.getElementById('create-quote-btn');
      if (createBtn) {
        createBtn.addEventListener('click', () => {
          currentEditingQuoteKey = null;
          setQuoteModalMode('create');
          resetQuoteForm();
          setupQuoteModalHandlersOnce();
          document.getElementById('quote-modal').classList.remove('hidden');
          updateSaleTypeUI();
          ensureScrollLock();
          // Ensure measurements run after modal is visible to avoid
          // measuring before layout; double rAF helps wait for paint.
          if (typeof computeAndLockItemsContainerHeight === 'function') {
            requestAnimationFrame(() => requestAnimationFrame(() => {
              try { computeAndLockItemsContainerHeight(); } catch (e) { /* ignore */ }
            }));
          }
        });
      }
      const prodBtn = document.getElementById('create-production-order');
      if (prodBtn) {
        prodBtn.addEventListener('click', () => openProductionOrderModal());
      }
      const manageBtn = document.getElementById('manage-production-orders');
      if (manageBtn) {
        manageBtn.addEventListener('click', () => openManageProductionOrdersModal());
      }
      const qcBtn = document.getElementById('qc-signage');
      if (qcBtn) {
        qcBtn.addEventListener('click', () => openQcSignageModal());
      }
      const galleryBtn = document.getElementById('quote-gallery-btn');
      if (galleryBtn) {
        galleryBtn.addEventListener('click', () => openQuoteImagesModal());
      }
      const closeGalleryBtn = document.getElementById('close-quote-images-modal');
      if (closeGalleryBtn && !closeGalleryBtn._bound) {
        closeGalleryBtn._bound = true;
        closeGalleryBtn.addEventListener('click', closeQuoteImagesModal);
      }

      // Bind gallery export button to multi-export behavior (like Project Backup 9.0)
      const exportGalleryBtn = document.getElementById('quote-images-export-btn');
      if (exportGalleryBtn && !exportGalleryBtn._bound) {
        exportGalleryBtn._bound = true;
        exportGalleryBtn.addEventListener('click', exportSelectedQuoteImages);
      }
      const exportGalleryPdfBtn = document.getElementById('quote-images-export-pdf-btn');
      if (exportGalleryPdfBtn && !exportGalleryPdfBtn._bound) {
        exportGalleryPdfBtn._bound = true;
        exportGalleryPdfBtn.addEventListener('click', exportSelectedQuoteImagesAsPdf);
      }

      // Bind date filter inputs
      const fromDateEl = document.getElementById('quote-images-from-date');
      if (fromDateEl && !fromDateEl._bound) {
        fromDateEl._bound = true;
        fromDateEl.addEventListener('change', () => {
          const toDateEl = document.getElementById('quote-images-to-date');
          if (toDateEl) {
            toDateEl.min = fromDateEl.value || '';
            if (fromDateEl.value && toDateEl.value && fromDateEl.value > toDateEl.value) {
              toDateEl.value = fromDateEl.value;
            }
          }
          // Reset to first page when date filter changes
          quoteGalleryPage = 1;
          const searchEl = document.getElementById('quote-images-search');
          const term = searchEl ? searchEl.value : '';
          renderQuoteImagesGallery(term);
        });
      }
      const toDateEl = document.getElementById('quote-images-to-date');
      if (toDateEl && !toDateEl._bound) {
        toDateEl._bound = true;
        toDateEl.addEventListener('change', () => {
          const fromDateEl = document.getElementById('quote-images-from-date');
          if (fromDateEl) {
            fromDateEl.max = toDateEl.value || '';
            if (toDateEl.value && fromDateEl.value && fromDateEl.value > toDateEl.value) {
              fromDateEl.value = toDateEl.value;
            }
          }
          // Reset to first page when date filter changes
          quoteGalleryPage = 1;
          const searchEl = document.getElementById('quote-images-search');
          const term = searchEl ? searchEl.value : '';
          renderQuoteImagesGallery(term);
        });
      }
      // Date mode toggle (two-sided control)
      const dateCreatedBtn = document.getElementById('quote-images-date-mode-created');
      const dateUpdatedBtn = document.getElementById('quote-images-date-mode-updated');
      function updateDateModeUI() {
        if (!dateCreatedBtn || !dateUpdatedBtn) return;
        const createdSelected = quoteGalleryDateMode === 'created';
        // Selected style
        if (createdSelected) {
          dateCreatedBtn.classList.remove('text-gray-500','bg-gray-100');
          dateCreatedBtn.classList.add('text-gray-900','bg-white','border','border-blue-500','shadow-sm');
          dateUpdatedBtn.classList.remove('text-gray-900','bg-white','border','border-blue-500','shadow-sm');
          dateUpdatedBtn.classList.add('text-gray-500','bg-gray-100');
          dateCreatedBtn.setAttribute('aria-pressed','true');
          dateUpdatedBtn.setAttribute('aria-pressed','false');
        } else {
          dateUpdatedBtn.classList.remove('text-gray-500','bg-gray-100');
          dateUpdatedBtn.classList.add('text-gray-900','bg-white','border','border-blue-500','shadow-sm');
          dateCreatedBtn.classList.remove('text-gray-900','bg-white','border','border-blue-500','shadow-sm');
          dateCreatedBtn.classList.add('text-gray-500','bg-gray-100');
          dateUpdatedBtn.setAttribute('aria-pressed','true');
          dateCreatedBtn.setAttribute('aria-pressed','false');
        }
      }
      if (dateCreatedBtn && !dateCreatedBtn._bound) {
        dateCreatedBtn._bound = true;
        dateCreatedBtn.addEventListener('click', () => {
          if (quoteGalleryDateMode === 'created') return;
          quoteGalleryDateMode = 'created';
          updateDateModeUI();
          // Reset to first page on mode change
          quoteGalleryPage = 1;
          const searchEl = document.getElementById('quote-images-search');
          const term = searchEl ? searchEl.value : '';
          renderQuoteImagesGallery(term);
        });
      }
      if (dateUpdatedBtn && !dateUpdatedBtn._bound) {
        dateUpdatedBtn._bound = true;
        dateUpdatedBtn.addEventListener('click', () => {
          if (quoteGalleryDateMode === 'updated') return;
          quoteGalleryDateMode = 'updated';
          updateDateModeUI();
          // Reset to first page on mode change
          quoteGalleryPage = 1;
          const searchEl = document.getElementById('quote-images-search');
          const term = searchEl ? searchEl.value : '';
          renderQuoteImagesGallery(term);
        });
      }

      // Update UI helper to mirror Backup 9.0 behavior
      function updateQuoteGallerySelectionUI() {
        const count = getQuoteGallerySelectionCount();
        const btn = document.getElementById('quote-images-export-btn');
        if (btn) {
          btn.textContent = count > 0 ? `Xuất JPG (${count})` : 'Xuất JPG';
          btn.disabled = count === 0;
        }
      }

      async function exportSelectedQuoteImages() {
        const entries = collectQuoteImagesForGallery();
        const entryMap = new Map(entries.map((e) => [e.id, e]));
        const selectedIds = Array.from(selectedQuoteGalleryIds || []);
        const selectedEntries = selectedIds.map((id) => entryMap.get(id)).filter(Boolean);
        if (!selectedEntries.length) {
          showToast('Chọn ít nhất 1 hình để xuất JPG');
          return;
        }
        if (typeof window.html2canvas !== 'function' && typeof html2canvas === 'undefined') {
          showToast('Thiếu thư viện html2canvas để xuất JPG');
          return;
        }

        // helper to convert dataURL -> Blob (with retries/backoff)
        const dataUrlToBlob = async (dataUrl) => {
          const res = await qcagFetchWithRetries(dataUrl);
          return await res.blob();
        };

        // Ask for save location: prefer directory picker for batch export
        let dirHandle = null;
        let useDirectory = false;
        if (window.showDirectoryPicker) {
          try {
            dirHandle = await window.showDirectoryPicker();
            useDirectory = !!dirHandle;
          } catch (e) {
            // user cancelled or not supported / fallback
            dirHandle = null;
            useDirectory = false;
          }
        }

        // If directory picker not available, ask user whether to choose per-file save dialogs (showSaveFilePicker)
        let usePerFilePicker = false;
        if (!useDirectory && window.showSaveFilePicker) {
          // Ask user once whether they want to choose a save location per file.
          try {
            // simple confirm via native confirm (no UI modal available)
            usePerFilePicker = confirm('Trình duyệt của bạn hỗ trợ chọn nơi lưu. Bạn muốn chọn vị trí lưu cho mỗi ảnh không? (OK = có, Cancel = dùng tải xuống mặc định)');
          } catch (e) {
            usePerFilePicker = false;
          }
        }

        let success = 0;
        try {
          // If directory chosen, write files directly into it
          if (useDirectory && dirHandle) {
            for (const entry of selectedEntries) {
              try {
                const quote = entry.quoteKey ? findQuoteByKey(entry.quoteKey) : null;
                const data = quote ? buildQuotePreviewDataFromQuote(quote) : {
                  quoteCode: entry.quoteCode || '---',
                  outletCode: entry.outletCode || '',
                  outletName: entry.outletName || '',
                  area: entry.area || '',
                  saleName: entry.saleName || '',
                  saleCode: '',
                  salePhone: '',
                  saleType: 'Sale (SR)',
                  ssName: entry.ssName || '',
                  address: '',
                  spoName: '',
                  totalAmount: 0,
                  items: [],
                  primaryImage: null,
                  brandFooter: 'Quảng cáo An Giang báo giá',
                  brandApproval: 'Heineken Việt Nam duyệt',
                  createdAt: null,
                  updatedAt: null
                };
                if (!data.primaryImage && entry.hasImage && entry.src) data.primaryImage = { data: entry.src, name: entry.name || 'Hình báo giá' };
                const filenameBase = sanitizeFilenameForDownload(`${data.quoteCode || 'BG'} - ${data.outletName || 'Outlet'}`);
                const filename = `${filenameBase}.jpg`;
                const dataUrl = await renderPreviewToJpegDataUrl(data, { includeQcagSign: false });
                const blob = await dataUrlToBlob(dataUrl);
                const fh = await dirHandle.getFileHandle(filename, { create: true });
                const writable = await fh.createWritable();
                await writable.write(blob);
                await writable.close();
                success += 1;
              } catch (err) {
                console.error('Error exporting to directory', err);
              }
            }
            if (success) showToast(`Đã lưu ${success} ảnh vào thư mục`);
            return;
          }

          // If per-file picker chosen
          if (usePerFilePicker) {
            for (const entry of selectedEntries) {
              try {
                const quote = entry.quoteKey ? findQuoteByKey(entry.quoteKey) : null;
                const data = quote ? buildQuotePreviewDataFromQuote(quote) : {
                  quoteCode: entry.quoteCode || '---',
                  outletCode: entry.outletCode || '',
                  outletName: entry.outletName || '',
                  area: entry.area || '',
                  saleName: entry.saleName || '',
                  saleCode: '',
                  salePhone: '',
                  saleType: 'Sale (SR)',
                  ssName: entry.ssName || '',
                  address: '',
                  spoName: '',
                  totalAmount: 0,
                  items: [],
                  primaryImage: null,
                  brandFooter: 'Quảng cáo An Giang báo giá',
                  brandApproval: 'Heineken Việt Nam duyệt',
                  createdAt: null,
                  updatedAt: null
                };
                if (!data.primaryImage && entry.hasImage && entry.src) data.primaryImage = { data: entry.src, name: entry.name || 'Hình báo giá' };
                const filenameBase = sanitizeFilenameForDownload(`${data.quoteCode || 'BG'} - ${data.outletName || 'Outlet'}`);
                const filename = `${filenameBase}.jpg`;
                const dataUrl = await renderPreviewToJpegDataUrl(data, { includeQcagSign: false });
                const blob = await dataUrlToBlob(dataUrl);

                try {
                  const handle = await window.showSaveFilePicker({ suggestedName: filename, types: [{ description: 'JPEG image', accept: { 'image/jpeg': ['.jpg', '.jpeg'] } }] });
                  const writable = await handle.createWritable();
                  await writable.write(blob);
                  await writable.close();
                  success += 1;
                } catch (e) {
                  // user cancelled this file; continue with next
                  console.warn('User canceled save for', filename);
                }
              } catch (err) {
                console.error('Per-file save error', err);
              }
            }
            if (success) showToast(`Đã lưu ${success} ảnh`);
            return;
          }

          // Fallback: anchor downloads (browser default location) but confirm first
          try {
            const proceed = confirm('Trình duyệt không hỗ trợ chọn thư mục/chọn nơi lưu hàng loạt. Tiếp tục tải xuống (sử dụng thư mục tải xuống của trình duyệt)?');
            if (!proceed) {
              showToast('Hủy xuất ảnh');
              return;
            }
          } catch (e) {}

          for (const entry of selectedEntries) {
            try {
              const quote = entry.quoteKey ? findQuoteByKey(entry.quoteKey) : null;
              const data = quote ? buildQuotePreviewDataFromQuote(quote) : {
                quoteCode: entry.quoteCode || '---',
                outletCode: entry.outletCode || '',
                outletName: entry.outletName || '',
                area: entry.area || '',
                saleName: entry.saleName || '',
                saleCode: '',
                salePhone: '',
                saleType: 'Sale (SR)',
                ssName: entry.ssName || '',
                address: '',
                spoName: '',
                totalAmount: 0,
                items: [],
                primaryImage: null,
                brandFooter: 'Quảng cáo An Giang báo giá',
                brandApproval: 'Heineken Việt Nam duyệt',
                createdAt: null,
                updatedAt: null
              };
              if (!data.primaryImage && entry.hasImage && entry.src) data.primaryImage = { data: entry.src, name: entry.name || 'Hình báo giá' };
              const filenameBase = sanitizeFilenameForDownload(`${data.quoteCode || 'BG'} - ${data.outletName || 'Outlet'}`);
              const filename = `${filenameBase}.jpg`;
              const dataUrl = await renderPreviewToJpegDataUrl(data, { includeQcagSign: false });
              triggerDataUrlDownload(dataUrl, filename);
              success += 1;
            } catch (err) {
              console.error('Fallback anchor download error', err);
            }
          }
          if (success) showToast(`Đã xuất ${success} JPG`);
        } catch (err) {
          console.error('Export selected images error', err);
          showToast('Lỗi khi xuất ảnh');
        } finally {
          // Reset selected gallery images after an export attempt (per user request)
          try {
            selectedQuoteGalleryIds = new Set();
            updateQuoteGallerySelectionUI();
            const searchEl = document.getElementById('quote-images-search');
            const searchTerm = searchEl ? (searchEl.value || '') : '';
            // Re-render gallery to reflect cleared selection
            try { renderQuoteImagesGallery(searchTerm); } catch (e) { /* ignore render errors */ }
          } catch (e) {
            console.warn('Failed to reset gallery selection after export:', e);
          }
        }
      }

      // New: Export selected images as PDF (one PDF per image). Loads jsPDF from CDN if needed.
      async function exportSelectedQuoteImagesAsPdf() {
        const entries = collectQuoteImagesForGallery();
        const entryMap = new Map(entries.map((e) => [e.id, e]));
        const selectedIds = Array.from(selectedQuoteGalleryIds || []);
        const selectedEntries = selectedIds.map((id) => entryMap.get(id)).filter(Boolean);
        if (!selectedEntries.length) {
          showToast('Chọn ít nhất 1 hình để xuất PDF');
          return;
        }

        function ensureJsPdf() {
          if (typeof window.jsPDF === 'function' || (typeof window.jsPDF === 'object' && window.jsPDF)) return Promise.resolve();
          return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/1.5.3/jspdf.min.js';
            s.onload = () => resolve();
            s.onerror = () => reject(new Error('Không tải được jsPDF'));
            document.head.appendChild(s);
          });
        }

        let success = 0;
        try {
          await ensureJsPdf();
        } catch (err) {
          showToast('Không thể tải thư viện tạo PDF (jsPDF). Vui lòng thử lại.');
          return;
        }

        try {
          for (const entry of selectedEntries) {
            try {
              const quote = entry.quoteKey ? findQuoteByKey(entry.quoteKey) : null;
              const data = quote ? buildQuotePreviewDataFromQuote(quote) : {
                quoteCode: entry.quoteCode || '---',
                outletCode: entry.outletCode || '',
                outletName: entry.outletName || '',
                area: entry.area || '',
                saleName: entry.saleName || '',
                saleCode: '',
                salePhone: '',
                saleType: 'Sale (SR)',
                ssName: entry.ssName || '',
                address: '',
                spoName: '',
                totalAmount: 0,
                items: [],
                primaryImage: null,
                brandFooter: 'Quảng cáo An Giang báo giá',
                brandApproval: 'Heineken Việt Nam duyệt',
                createdAt: null,
                updatedAt: null
              };
              if (!data.primaryImage && entry.hasImage && entry.src) data.primaryImage = { data: entry.src, name: entry.name || 'Hình báo giá' };

              const filenameBase = sanitizeFilenameForDownload(`${data.quoteCode || 'BG'} - ${data.outletName || 'Outlet'}`);
              const filename = `${filenameBase}.pdf`;

              const dataUrl = await renderPreviewToJpegDataUrl(data);

              const img = await new Promise((resolve, reject) => {
                const i = new Image();
                i.onload = () => resolve(i);
                i.onerror = reject;
                i.src = dataUrl;
              });

              const pdf = new jsPDF('l', 'mm', 'a4');
              const pxToMm = (px) => px * 0.264583;
              const imgWmm = pxToMm(img.naturalWidth || img.width || 1123);
              const imgHmm = pxToMm(img.naturalHeight || img.height || 794);
              const pageW = pdf.internal.pageSize.getWidth();
              const pageH = pdf.internal.pageSize.getHeight();
              const scale = Math.min(pageW / imgWmm, pageH / imgHmm);
              const drawW = imgWmm * scale;
              const drawH = imgHmm * scale;
              const x = (pageW - drawW) / 2;
              const y = (pageH - drawH) / 2;

              pdf.addImage(dataUrl, 'JPEG', x, y, drawW, drawH);
              pdf.save(filename);
              success += 1;
            } catch (err) {
              console.error('PDF export error', err);
            }
          }
          if (success) showToast(`Đã xuất ${success} PDF`);
        } catch (err) {
          console.error('Export selected images (PDF) error', err);
          showToast('Lỗi khi xuất PDF');
        } finally {
          // Reset selection after export attempt (consistent with JPG behavior)
          try {
            selectedQuoteGalleryIds = new Set();
            updateQuoteGallerySelectionUI();
            const searchEl = document.getElementById('quote-images-search');
            const searchTerm = searchEl ? (searchEl.value || '') : '';
            try { renderQuoteImagesGallery(searchTerm); } catch (e) { }
          } catch (e) {
            console.warn('Failed to reset gallery selection after PDF export:', e);
          }
        }
      }

      // Export a single quote as PDF (reuses preview render code)
      async function exportQuoteAsPdf(identifier) {
        const quote = findQuoteByIdentifier(identifier);
        if (!quote) {
          showToast && showToast('Không tìm thấy báo giá để xuất PDF');
          return;
        }
        function ensureJsPdf() {
          if (typeof window.jsPDF === 'function' || (typeof window.jsPDF === 'object' && window.jsPDF)) return Promise.resolve();
          return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/1.5.3/jspdf.min.js';
            s.onload = () => resolve();
            s.onerror = () => reject(new Error('Không tải được jsPDF'));
            document.head.appendChild(s);
          });
        }

        try {
          await ensureJsPdf();
        } catch (err) {
          showToast && showToast('Không thể tải thư viện tạo PDF (jsPDF). Vui lòng thử lại.');
          return;
        }

        try {
          const data = buildQuotePreviewDataFromQuote(quote);
          const filenameBase = sanitizeFilenameForDownload(`${data.quoteCode || 'BG'} - ${data.outletName || 'Outlet'}`);
          const filename = `${filenameBase}.pdf`;
          const dataUrl = await renderPreviewToJpegDataUrl(data);
          const img = await new Promise((resolve, reject) => {
            const i = new Image();
            i.onload = () => resolve(i);
            i.onerror = reject;
            i.src = dataUrl;
          });

          const pdf = new jsPDF('l', 'mm', 'a4');
          const pxToMm = (px) => px * 0.264583;
          const imgWmm = pxToMm(img.naturalWidth || img.width || 1123);
          const imgHmm = pxToMm(img.naturalHeight || img.height || 794);
          const pageW = pdf.internal.pageSize.getWidth();
          const pageH = pdf.internal.pageSize.getHeight();
          const scale = Math.min(pageW / imgWmm, pageH / imgHmm);
          const drawW = imgWmm * scale;
          const drawH = imgHmm * scale;
          const x = (pageW - drawW) / 2;
          const y = (pageH - drawH) / 2;

          pdf.addImage(dataUrl, 'JPEG', x, y, drawW, drawH);
          pdf.save(filename);
          showToast && showToast('Đã xuất PDF');
        } catch (err) {
          console.error('Export single quote PDF error', err);
          showToast && showToast('Lỗi khi xuất PDF');
        }
      }
      window.exportQuoteAsPdf = exportQuoteAsPdf;

      const galleryModal = document.getElementById('quote-images-modal');
      if (galleryModal && !galleryModal._bound) {
        galleryModal._bound = true;
        galleryModal.addEventListener('click', (event) => {
          if (event.target === galleryModal) closeQuoteImagesModal();
        });
      }
    }
    setupSidebar();
    // View mode toggle handlers
    function setupViewToggle() {
      const listBtn = document.getElementById('view-list-btn');
      const outletBtn = document.getElementById('view-outlet-btn');
      if (!listBtn || !outletBtn) return;
      const setActive = () => {
        if (viewMode === 'list') {
          listBtn.classList.add('bg-white','shadow','text-gray-800');
          outletBtn.classList.remove('bg-white','shadow','text-gray-800');
          outletBtn.classList.add('text-gray-600');
        } else {
          outletBtn.classList.add('bg-white','shadow','text-gray-800');
          listBtn.classList.remove('bg-white','shadow','text-gray-800');
          listBtn.classList.add('text-gray-600');
        }
      }
      listBtn.addEventListener('click', () => { if (viewMode !== 'list') { viewMode = 'list'; listPage = 1; setActive(); updateMainList(); } });
      outletBtn.addEventListener('click', () => { if (viewMode !== 'outlet') { viewMode = 'outlet'; outletPage = 1; setActive(); updateMainList(); } });
      setActive();
    }
    setupViewToggle();
    
    // Test Quote Seeder removed

    // Setup Excel import handler for 'Nhập dữ liệu SPO' button
    function setupExcelImportHandlers() {
      const input = document.getElementById('excel-upload');
      if (!input || input._bound) return;
      input._bound = true;

      input.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const ext = (file.name.split('.').pop() || '').toLowerCase();
        const reader = new FileReader();
        reader.onload = function(ev) {
          try {
            let workbook;
            if (ext === 'csv') {
              const text = ev.target.result;
              workbook = XLSX.read(text, { type: 'string' });
            } else {
              const data = ev.target.result;
              workbook = XLSX.read(data, { type: 'array' });
            }

            const sheetName = workbook.SheetNames && workbook.SheetNames[0];
            if (!sheetName) {
              alert('Không tìm thấy sheet trong file.');
              input.value = '';
              return;
            }
            const sheet = workbook.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });

            // Find SPO and Status columns by scanning rows top-down and taking first match
            let spoCol, statusCol;
            let spoRow = -1, statusRow = -1;
            for (let r = 0; r < rows.length; r++) {
              const row = rows[r] || [];
              for (let c = 0; c < row.length; c++) {
                const cell = String(row[c] || '').trim().toLowerCase();
                if (!spoCol && cell && cell.includes('spo')) { spoCol = c; spoRow = r; }
                if (!statusCol && cell && (cell.includes('status') || cell.includes('trạng') || cell.includes('trang'))) { statusCol = c; statusRow = r; }
                if (typeof spoCol !== 'undefined' && typeof statusCol !== 'undefined') break;
              }
              if (typeof spoCol !== 'undefined' && typeof statusCol !== 'undefined') break;
            }

            if (typeof statusCol === 'undefined') {
              alert('Không tìm thấy cột Status (status/trạng thái) trong file. Import bị hủy.');
              input.value = '';
              return;
            }
            if (typeof spoCol === 'undefined') {
              alert('Không tìm thấy cột SPO trong file. Import bị hủy.');
              input.value = '';
              return;
            }

            const startRow = Math.max(spoRow, statusRow) + 1;
            const updates = new Map(); // spoNumber -> status (last wins)
            let scanned = 0, invalid = 0;

            for (let r = startRow; r < rows.length; r++) {
              const row = rows[r] || [];
              const rawSpo = String(row[spoCol] || '').trim();
              const digitMatch = (rawSpo.match(/\d+/) || [])[0];
              if (!digitMatch || !/^\d{6,7}$/.test(digitMatch)) {
                // not a valid SPO (6 or 7 digits)
                invalid++;
                continue;
              }
              const spoVal = digitMatch;
              const rawStatus = String(row[statusCol] || '').trim();
              // Ignore empty status cells (do not overwrite existing)
              if (!rawStatus) {
                // still count as scanned (we saw SPO) but won't set an update
                scanned++;
                continue;
              }
              // last occurrence wins
              updates.set(spoVal, rawStatus);
              scanned++;
            }

            // Apply updates to currentQuotes (overwrite with latest file value). Do not remove others.
            let updated = 0;
            const notFoundList = [];
            // Work on a copy of keys to iterate remaining not found later
            const updateKeys = new Set(updates.keys());

            for (let i = 0; i < currentQuotes.length; i++) {
              const q = currentQuotes[i];
              const qNum = (String(q.spo_number || '').match(/\d+/) || [''])[0];
              if (qNum && updates.has(qNum)) {
                const newStatus = updates.get(qNum);
                const prevStatus = q.spo_status || '';
                if (prevStatus !== newStatus) {
                  // update and add system note
                  currentQuotes[i] = { ...q, spo_status: newStatus };
                  try { addSystemNoteForQuote(currentQuotes[i], `Cập nhật trạng thái SPO từ "${prevStatus || '-'}" → "${newStatus}" (import)`); } catch (e) { /* ignore */ }
                  updated++;
                }
                updateKeys.delete(qNum);
              }
            }

            updateKeys.forEach(k => notFoundList.push(k));

            // Re-render list
            try { renderQuotesList(currentQuotes); } catch (e) { /* ignore */ }

            alert(`Import hoàn thành.\nDòng hợp lệ (đã đọc): ${scanned}.\nĐã cập nhật: ${updated}.\nBỏ qua (SPO không hợp lệ): ${invalid}.\nSPO trong file không tìm thấy trong hệ thống: ${notFoundList.length}.`);

          } catch (err) {
            console.error('Excel import error:', err);
            alert('Lỗi khi đọc file Excel: ' + (err && err.message ? err.message : 'Không xác định'));
          } finally {
            // reset input so the same file can be re-selected
            input.value = '';
          }
        };
        if (ext === 'csv') reader.readAsText(file, 'utf-8'); else reader.readAsArrayBuffer(file);
      });
    }

    function formatCurrencyExact(amount) {
      if (amount == null) return '0 đ';
      const n = Number(amount);
      if (!Number.isFinite(n)) return '0 đ';
      const sign = n < 0 ? '-' : '';
      const abs = Math.abs(n);
      let s = String(abs);
      if (s.indexOf('e') !== -1) {
        s = abs.toFixed(12).replace(/0+$/, '');
        if (s.indexOf('.') !== -1) s = s.replace(/\.?0+$/, '');
      }
      const parts = s.split('.');
      let intPart = parts[0] || '0';
      const decPart = parts[1] || '';
      intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
      return decPart ? `${sign}${intPart},${decPart} đ` : `${sign}${intPart} đ`;
    }