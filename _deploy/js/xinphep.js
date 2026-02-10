(function(){
  function openModal(){
    const m = document.getElementById('xinphep-modal'); if(!m) return; m.classList.remove('hidden');
  }
  function closeModal(){
    const m = document.getElementById('xinphep-modal'); if(!m) return; m.classList.add('hidden');
  }
  document.addEventListener('DOMContentLoaded', function(){
    const btn = document.getElementById('xinphep-btn'); if(btn) btn.addEventListener('click', openModal);
    const close = document.getElementById('close-xinphep-modal'); if(close) close.addEventListener('click', closeModal);
    const backdrop = document.getElementById('xinphep-modal'); if(backdrop) backdrop.addEventListener('click', function(e){ if(e.target===backdrop) closeModal(); });
    // Center-screen transient message (prominent overlay)
    function showCenterMessage(msg, ms) {
      try {
        ms = typeof ms === 'number' ? ms : 3500;
        const existing = document.getElementById('xinphep-center-msg');
        if (existing) existing.remove();
        const wrap = document.createElement('div');
        wrap.id = 'xinphep-center-msg';
        wrap.className = 'fixed inset-0 z-[9999] flex items-center justify-center bg-black bg-opacity-40';
        wrap.innerHTML = `
          <div class="pointer-events-auto max-w-2xl mx-4 bg-red-600 text-white rounded-2xl shadow-2xl px-6 py-5 text-center" role="alert" aria-live="assertive">
            <div class="flex items-center justify-center gap-4">
              <svg class="w-6 h-6 flex-shrink-0" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M12 9v4" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M12 17h.01" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9 9 4.03 9 9z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <div class="text-lg font-semibold leading-tight">${String(msg)}</div>
            </div>
          </div>
        `;
        // Allow clicking overlay to dismiss early
        wrap.addEventListener('click', function(e){
          try { wrap.remove(); } catch(_){}}
        );
        document.body.appendChild(wrap);
        // auto-dismiss with fade
        setTimeout(() => {
          try {
            const box = document.querySelector('#xinphep-center-msg > div');
            if (box) box.classList.add('transition','duration-300','opacity-0');
            setTimeout(() => { try { wrap.remove(); } catch(_){} }, 320);
          } catch (e) { try { wrap.remove(); } catch(_){} }
        }, ms);
      } catch (e) { try { alert(msg); } catch(_){} }
    }
    // Count hạng mục (bảng) from an array of quote-like objects (same logic used when building aggregated rows)
    function countHangMucFromMatches(arr) {
      try {
        if (!Array.isArray(arr)) return 0;
        let countHangMuc = 0;
        try {
          const brandMapGlobalCount = new Map();
          arr.forEach(q => {
            try {
              let items = Array.isArray(q.items) ? q.items : null;
              if (!items && typeof q.items === 'string') {
                try { const parsed = JSON.parse(q.items || '[]'); if (Array.isArray(parsed)) items = parsed; } catch(_) { items = null; }
              }
              const rawStr = (!items && typeof q.items === 'string') ? String(q.items) : null;
              if (!Array.isArray(items) && rawStr) {
                const lines = rawStr.split(/\r?\n/).map(s => String(s||'').trim()).filter(Boolean);
                if (lines.length) { countHangMuc += lines.length; return; }
                const parts = rawStr.split(/\s*[,;\/\\]\s*/).map(s => String(s||'').trim()).filter(Boolean);
                if (parts.length) { countHangMuc += parts.length; return; }
              }
              if (!Array.isArray(items)) return;
              const localBrandMap = new Map();
              for (const it of items) {
                const b = (it && it.brand) ? String(it.brand).trim() : '';
                if (!b) continue;
                if (!localBrandMap.has(b)) localBrandMap.set(b, 0);
                localBrandMap.set(b, localBrandMap.get(b) + 1);
              }
              for (const [brand, cnt] of localBrandMap.entries()) {
                if (!brandMapGlobalCount.has(brand)) brandMapGlobalCount.set(brand, 0);
                brandMapGlobalCount.set(brand, brandMapGlobalCount.get(brand) + cnt);
              }
            } catch (e) { /* ignore per-quote */ }
          });
          for (const v of brandMapGlobalCount.values()) countHangMuc += v;
        } catch (e) { /* ignore overall */ }
        return countHangMuc;
      } catch (e) { return 0; }
    }
    // Setup filter toggle buttons
    // Update Select All button visibility based on active filters and tab
    window.__updateXinphepSelectAll = function() {
      try {
        const btn = document.getElementById('xinphep-select-all-btn');
        const deselect = document.getElementById('xinphep-deselect-btn');
        if (!btn) return;
        const hasFilter = window.__xinphepFilters && window.__xinphepFilters.size > 0;
        const isChuaxp = window.__xinphepActiveTab === 'chuaxp';
        const tbody = document.getElementById('xinphep-list-tbody');
        const hasRows = tbody && tbody.children && tbody.children.length > 0;
        if (hasFilter && isChuaxp && hasRows) btn.classList.remove('hidden'); else btn.classList.add('hidden');
        if (deselect) {
          if (hasFilter && isChuaxp && hasRows) deselect.classList.remove('hidden'); else deselect.classList.add('hidden');
        }
      } catch (e) { /* ignore */ }
    };

    try {
      // Use a Set but enforce single-selection: only one group allowed at a time
      window.__xinphepFilters = window.__xinphepFilters || new Set();
      const btns = document.querySelectorAll('#xinphep-filter-buttons .xinphep-filter-btn');
      btns.forEach(b => {
        b.addEventListener('click', function() {
          const g = this.dataset.xinphepGroup;
          if (!g) return;
          if (!window.__xinphepFilters) window.__xinphepFilters = new Set();
          const currentlyHas = window.__xinphepFilters.has(g);
          // Clear all selections first
          window.__xinphepFilters.clear();
          btns.forEach(x => { x.classList.remove('bg-blue-600','text-white'); x.classList.add('bg-white','text-black'); });
          if (!currentlyHas) {
            // select this one
            window.__xinphepFilters.add(g);
            this.classList.add('bg-blue-600','text-white');
            this.classList.remove('bg-white','text-black');
          } else {
            // clicking the active button again clears selection (no filters)
          }
          try { if (typeof window.renderXinphepList === 'function') window.renderXinphepList(window.__lastXinphepList || []); } catch (e) { console.warn(e); }
          try { if (typeof window.__updateXinphepSelectAll === 'function') window.__updateXinphepSelectAll(); } catch (e) { /* ignore */ }
        });
      });
    } catch (e) { /* ignore init errors */ }
    // Setup tab buttons for Xin Phép modal (Chưa xin phép / Danh sách Xin phép / Đã có giấy phép)
    try {
      window.__xinphepActiveTab = window.__xinphepActiveTab || 'chuaxp';
      const tabBtns = document.querySelectorAll('[data-xinphep-tab]');
      const panels = {
        chuaxp: document.getElementById('xinphep-tab-panel-chuaxp'),
        list: document.getElementById('xinphep-tab-panel-list'),
        have: document.getElementById('xinphep-tab-panel-have')
      };
      function renderXinphepTabs() {
        const filtersContainer = document.getElementById('xinphep-filter-buttons');
        tabBtns.forEach(b => {
          const v = b.getAttribute('data-xinphep-tab');
          if (v === window.__xinphepActiveTab) {
            b.classList.add('bg-white','shadow','text-gray-800');
            b.classList.remove('text-gray-600');
            b.setAttribute('aria-selected','true');
          } else {
            b.classList.remove('bg-white','shadow','text-gray-800');
            b.classList.add('text-gray-600');
            b.setAttribute('aria-selected','false');
          }
        });
        Object.keys(panels).forEach(k => {
          const p = panels[k]; if (!p) return;
          if (k === window.__xinphepActiveTab) p.classList.remove('hidden'); else p.classList.add('hidden');
        });
        // Show filter buttons only on the 'chuaxp' tab.
        // Use `invisible` (keep layout space) so the tab buttons stay fixed in place.
        try {
          if (filtersContainer) {
            if (window.__xinphepActiveTab === 'chuaxp') {
              filtersContainer.classList.remove('invisible','opacity-0','pointer-events-none');
            } else {
              filtersContainer.classList.add('invisible','opacity-0','pointer-events-none');
            }
          }
          // Footer buttons: hide all footer controls when viewing 'list' or 'have' tabs,
          // but keep the footer area present. Only show them on 'chuaxp'.
          try {
            const footerSelAll = document.getElementById('xinphep-select-all-btn');
            const footerDeselect = document.getElementById('xinphep-deselect-btn');
            const footerReg = document.getElementById('xinphep-register-btn');
            if (window.__xinphepActiveTab === 'chuaxp') {
              if (footerReg) footerReg.classList.remove('hidden');
            } else {
              if (footerSelAll) footerSelAll.classList.add('hidden');
              if (footerDeselect) footerDeselect.classList.add('hidden');
              if (footerReg) footerReg.classList.add('hidden');
            }
          } catch (e) { /* ignore footer toggle errors */ }
          // Select All button behavior
          try {
            const selAll = document.getElementById('xinphep-select-all-btn');
            const deselectBtn = document.getElementById('xinphep-deselect-btn');
            if (selAll && !selAll._xinphepBound) {
              selAll._xinphepBound = true;
              selAll.addEventListener('click', function() {
                try {
                  const tbody = document.getElementById('xinphep-list-tbody');
                  if (!tbody) return;
                  window.__xinphepSelected = window.__xinphepSelected || new Set();
                  Array.from(tbody.querySelectorAll('tr')).forEach(tr => {
                    const td = tr.querySelector('td'); if (!td) return;
                    const key = String((td.textContent||'').trim()); if (!key) return;
                    window.__xinphepSelected.add(key);
                  });
                  applyXinphepSelections();
                } catch (e) { console.warn(e); }
              });
            }
            if (deselectBtn && !deselectBtn._xinphepBound) {
              deselectBtn._xinphepBound = true;
              deselectBtn.addEventListener('click', function() {
                try {
                  window.__xinphepSelected = window.__xinphepSelected || new Set();
                  window.__xinphepSelected.clear();
                  applyXinphepSelections();
                } catch (e) { console.warn(e); }
              });
            }
          } catch (e) { /* ignore */ }
        } catch (e) { /* ignore */ }
      }
      tabBtns.forEach(btn => {
        if (btn._xinphepBound) return;
        btn._xinphepBound = true;
        btn.addEventListener('click', function() {
          const v = this.getAttribute('data-xinphep-tab');
          if (!v) return;
          if (v === window.__xinphepActiveTab) return;
          window.__xinphepActiveTab = v;
          try { renderXinphepTabs(); } catch (e) { console.warn(e); }
        });
      });
      // initial render
      try { renderXinphepTabs(); } catch (e) { /* ignore */ }

      // Selection state for rows (quote codes or ids)
      window.__xinphepSelected = window.__xinphepSelected || new Set();
          try { if (typeof window.__updateXinphepSelectAll === 'function') window.__updateXinphepSelectAll(); } catch (e) { /* ignore */ }

      // Apply selection classes to rows in the main tbody based on `__xinphepSelected` set
      function applyXinphepSelections() {
        try {
          const tbody = document.getElementById('xinphep-list-tbody');
          if (!tbody) return;
          const rows = Array.from(tbody.querySelectorAll('tr'));
          rows.forEach(tr => {
            const firstTd = tr.querySelector('td');
            const key = firstTd ? String((firstTd.textContent || '').trim()) : '';
            if (key && window.__xinphepSelected && window.__xinphepSelected.has(key)) {
              tr.classList.add('bg-blue-50');
            } else {
              tr.classList.remove('bg-blue-50');
            }
          });
          try { if (typeof window.__updateXinphepSelectAll === 'function') window.__updateXinphepSelectAll(); } catch (e) { /* ignore */ }
        } catch (e) { /* ignore */ }
      }

      // Observe tbody changes and reapply selections
      try {
        const tb = document.getElementById('xinphep-list-tbody');
        if (tb && !tb._xinphepObserverBound) {
          tb._xinphepObserverBound = true;
          const mo = new MutationObserver(function() { applyXinphepSelections(); try { if (typeof window.__updateXinphepSelectAll === 'function') window.__updateXinphepSelectAll(); } catch(e){} });
          mo.observe(tb, { childList: true, subtree: true });
        }
      } catch (e) { /* ignore */ }

      // Row click (delegate) to toggle selection - only active on 'chuaxp' tab
      try {
        const tbody = document.getElementById('xinphep-list-tbody');
        if (tbody && !tbody._xinphepClickBound) {
          tbody._xinphepClickBound = true;
          tbody.addEventListener('click', function(ev) {
            if (window.__xinphepActiveTab !== 'chuaxp') return;
            const tr = ev.target.closest('tr'); if (!tr) return;
            const firstTd = tr.querySelector('td'); if (!firstTd) return;
            const key = String((firstTd.textContent || '').trim()); if (!key) return;
            window.__xinphepSelected = window.__xinphepSelected || new Set();
            if (window.__xinphepSelected.has(key)) window.__xinphepSelected.delete(key); else window.__xinphepSelected.add(key);
            applyXinphepSelections();
          });
        }
      } catch (e) { /* ignore */ }

      // Helper to build a row element for a quote-like object (similar to renderXinphepList)
      function buildXinphepRow(q) {
        try {
          const esc = (s) => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"})[c]);
          const code = esc(q.quote_code || q.quoteCode || q.quote || q.id || q.__backendId || '');
          const name = esc(q.outlet_name || q.outletName || q.name || '');
          const areaDisp = esc(q.area || '');
          const address = esc(q.address || [q.house_number, q.street, q.ward, q.district, q.province].filter(Boolean).join(', '));
          let items = [];
          try { items = Array.isArray(q.items) ? q.items : JSON.parse(q.items || '[]'); } catch (e) { items = []; }
          const brandItems = new Map();
          for (const it of (Array.isArray(items) ? items : [])) {
            const b = (it && it.brand) ? String(it.brand).trim() : '';
            if (!b) continue;
            const rawW = it && (it.width != null) ? String(it.width).trim().replace(/m$/i, '').trim() : '';
            const rawH = it && (it.height != null) ? String(it.height).trim().replace(/m$/i, '').trim() : '';
            const wNum = (rawW !== '') && !Number.isNaN(parseFloat(rawW)) ? parseFloat(rawW) : null;
            const hNum = (rawH !== '') && !Number.isNaN(parseFloat(rawH)) ? parseFloat(rawH) : null;
            let sizeStr = '';
            if (wNum != null && hNum != null) sizeStr = `${rawW}m x ${rawH}m`; else sizeStr = (it && (it.content || it.code)) ? String(it.content || it.code).trim() : 'Không kích thước';
            if (!brandItems.has(b)) brandItems.set(b, []);
            brandItems.get(b).push({ size: sizeStr, wNum, hNum });
          }
          const tr = document.createElement('tr');
          let sizesHtml = '';
          let positionsHtml = '';
          if (brandItems.size > 0) {
            sizesHtml = Array.from(brandItems.values()).map(arr => arr.map(e => esc(e.size)).join('<br>')).join('<br>');
            positionsHtml = Array.from(brandItems.values()).map(arr => arr.map(e => {
              if (e.wNum != null && e.hNum != null) {
                if (e.wNum > e.hNum) return 'Mặt tiền quán';
                if (e.wNum < e.hNum) return 'Áp sát trụ phi cách mép đường 15m';
                return 'Không xác định';
              }
              return '-';
            }).join('<br>')).join('<br>');
          }
          tr.innerHTML = `\n                <td class="p-2 border-b">${code}</td>\n                <td class="p-2 border-b">${areaDisp}</td>\n                <td class="p-2 border-b">${Array.from(brandItems.keys()).map(esc).join('<br>')}</td>\n                <td class="p-2 border-b">${name}</td>\n                <td class="p-2 border-b">${address}</td>\n                <td class="p-2 border-b">${sizesHtml}</td>\n                <td class="p-2 border-b">${positionsHtml}</td>\n              `;
          return tr;
        } catch (e) { return document.createElement('tr'); }
      }

      // Build a modal row with STT + same columns as buildXinphepRow
      function buildXinphepModalRow(q, idx) {
        try {
          const esc = (s) => String(s || '').replace(/[&<>"']+/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c] || '');
          const code = esc(q.quote_code || q.quoteCode || q.quote || q.id || q.__backendId || '');
          const areaDisp = esc(q.area || '');
          const name = esc(q.outlet_name || q.outletName || q.name || '');
          const address = esc(q.address || [q.house_number, q.street, q.ward, q.district, q.province].filter(Boolean).join(', '));
          let items = [];
          try { items = Array.isArray(q.items) ? q.items : JSON.parse(q.items || '[]'); } catch (e) { items = []; }
          const brandItems = new Map();
          for (const it of (Array.isArray(items) ? items : [])) {
            const b = (it && it.brand) ? String(it.brand).trim() : '';
            if (!b) continue;
            const rawW = it && (it.width != null) ? String(it.width).trim().replace(/m$/i, '').trim() : '';
            const rawH = it && (it.height != null) ? String(it.height).trim().replace(/m$/i, '').trim() : '';
            const wNum = (rawW !== '') && !Number.isNaN(parseFloat(rawW)) ? parseFloat(rawW) : null;
            const hNum = (rawH !== '') && !Number.isNaN(parseFloat(rawH)) ? parseFloat(rawH) : null;
            let sizeStr = '';
            if (wNum != null && hNum != null) sizeStr = `${rawW}m x ${rawH}m`; else sizeStr = (it && (it.content || it.code)) ? String(it.content || it.code).trim() : 'Không kích thước';
            if (!brandItems.has(b)) brandItems.set(b, []);
            brandItems.get(b).push({ size: sizeStr, wNum, hNum });
          }
          let sizesHtml = '';
          let positionsHtml = '';
          if (brandItems.size > 0) {
            sizesHtml = Array.from(brandItems.values()).map(arr => arr.map(e => esc(e.size)).join('<br>')).join('<br>');
            positionsHtml = Array.from(brandItems.values()).map(arr => arr.map(e => {
              if (e.wNum != null && e.hNum != null) {
                if (e.wNum > e.hNum) return 'Mặt tiền quán';
                if (e.wNum < e.hNum) return 'Áp sát trụ phi cách mép đường 15m';
                return 'Không xác định';
              }
              return '-';
            }).join('<br>')).join('<br>');
          }
          const tr = document.createElement('tr');
          tr.innerHTML = `\n                <td class="p-2 border-b">${idx}</td>\n                <td class="p-2 border-b">${code}</td>\n                <td class="p-2 border-b">${areaDisp}</td>\n                <td class="p-2 border-b">${Array.from(brandItems.keys()).map(esc).join('<br>')}</td>\n                <td class="p-2 border-b">${name}</td>\n                <td class="p-2 border-b">${address}</td>\n                <td class="p-2 border-b">${sizesHtml}</td>\n                <td class="p-2 border-b">${positionsHtml}</td>\n              `;
          return tr;
        } catch (e) { return document.createElement('tr'); }
      }

      // Export helper: create one .doc (HTML) file per brand preserving list order
      function exportMatchesToWordFiles(arr, provinceName) {
        try {
          if (!Array.isArray(arr) || arr.length === 0) return;
          // Build global brand map preserving quote and entry order (same logic as modal)
          const brandMapGlobal = new Map();
          arr.forEach(q => {
            try {
              const items = Array.isArray(q.items) ? q.items : JSON.parse(q.items || '[]');
              if (!Array.isArray(items)) return;
              const localBrandMap = new Map();
              for (const it of items) {
                const b = (it && it.brand) ? String(it.brand).trim() : '';
                if (!b) continue;
                const rawW = it && (it.width != null) ? String(it.width).trim().replace(/m$/i,'').trim() : '';
                const rawH = it && (it.height != null) ? String(it.height).trim().replace(/m$/i,'').trim() : '';
                const wNum = (rawW !== '') && !Number.isNaN(parseFloat(rawW)) ? parseFloat(rawW) : null;
                const hNum = (rawH !== '') && !Number.isNaN(parseFloat(rawH)) ? parseFloat(rawH) : null;
                const sizeStr = (wNum != null && hNum != null) ? `${rawW}m x ${rawH}m` : ((it && (it.content || it.code)) ? String(it.content || it.code).trim() : 'Không kích thước');
                if (!localBrandMap.has(b)) localBrandMap.set(b, []);
                localBrandMap.get(b).push({ size: sizeStr, wNum, hNum });
              }
              for (const [brand, entries] of localBrandMap.entries()) {
                if (!brandMapGlobal.has(brand)) brandMapGlobal.set(brand, []);
                brandMapGlobal.get(brand).push({ quote: q, entries });
              }
            } catch (e) { /* ignore */ }
          });

          const sortedBrands = Array.from(brandMapGlobal.keys()).sort((a,b) => String(a).toLowerCase().localeCompare(String(b).toLowerCase()));

          // Build a flattened structure that preserves the modal's global STT numbering
          const perBrandRows = new Map();
          let globalIdx = 1;
          for (const brandName of sortedBrands) {
            const list = brandMapGlobal.get(brandName) || [];
            for (const item of list) {
              // one row per quote-brand pair; Hạng mục cell will combine multiple sizes
              const q = item.quote;
              const name = String(q.outlet_name || q.outletName || q.name || '').trim();
              const address = String(q.address || [q.house_number, q.street, q.ward, q.district, q.province].filter(Boolean).join(', ')).trim();
              const sizesArr = (item.entries || []).map(e => String(e.size || '').trim()).filter(Boolean);
              const positionsArr = (item.entries || []).map(e => {
                if (e.wNum != null && e.hNum != null) {
                  if (e.wNum > e.hNum) return 'Mặt tiền quán';
                  if (e.wNum < e.hNum) return 'Áp sát trụ phi cách mép đường 15m';
                  return 'Không xác định';
                }
                return '-';
              }).filter(Boolean);
              if (!perBrandRows.has(brandName)) perBrandRows.set(brandName, []);
              perBrandRows.get(brandName).push({ stt: globalIdx, name, address, sizesArr, positionsArr });
              globalIdx++;
            }
          }

          // prepare date tag dd_mm_yy
          const nowForFile = new Date();
          const _dd = String(nowForFile.getDate()).padStart(2,'0');
          const _mm = String(nowForFile.getMonth()+1).padStart(2,'0');
          const _yy = String(nowForFile.getFullYear()).slice(-2);
          const dateTag = `${_dd}_${_mm}_${_yy}`;

          const isAnGiang = String((provinceName || '')).trim().toLowerCase() === 'an giang' || String((provinceName || '')).trim().toLowerCase() === 'angiang';

          if (isAnGiang) {
            // Create one file per brand, title includes brand and fixed province text
            for (const brandName of sortedBrands) {
              try {
                const rows = perBrandRows.get(brandName) || [];
                let rowsHtml = '';
                for (const r of rows) {
                  const cleanName = String(r.name || '').replace(/\\/g, '');
                  const cleanAddress = String(r.address || '').replace(/\\/g, '');
                  const sizesHtml = (r.sizesArr || []).map(s => escapeHtml(String(s||'').replace(/\\/g,''))).join('<br>');
                  const positionsHtml = (r.positionsArr || []).map(p => escapeHtml(String(p||'').replace(/\\/g,''))).join('<br>');
                  rowsHtml += `<tr><td style="padding:6px;border:1px solid #444">${r.stt}</td><td style="padding:6px;border:1px solid #444">${escapeHtml(cleanName)}</td><td style="padding:6px;border:1px solid #444">${escapeHtml(cleanAddress)}</td><td style="padding:6px;border:1px solid #444">${sizesHtml}</td><td style="padding:6px;border:1px solid #444">${positionsHtml}</td></tr>`;
                }
                const title = `DANH SÁCH BẢNG HIỆU BIA ${brandName} KV TỈNH AN GIANG`;
                const docHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(brandName)}</title><style>@page{size:A4 landscape;}body{font-family:Arial,Helvetica,sans-serif}table{border-collapse:collapse;width:100%;}th,td{border:1px solid #444;padding:6px}</style></head><body><h3 style="text-align:center">${escapeHtml(title)}</h3><table><thead><tr><th>STT</th><th>Tên</th><th>Địa chỉ</th><th>Hạng mục</th><th>Vị trí lắp đặt</th></tr></thead><tbody>${rowsHtml}</tbody></table></body></html>`;
                const blob = new Blob([docHtml], { type: 'application/msword' });
                const a = document.createElement('a');
                const safeName = String(brandName || 'brand').replace(/[^a-z0-9\-\_\.\s]/ig,'_').replace(/\s+/g,'_');
                const filename = `${safeName}_An_Giang_${dateTag}.doc`;
                a.href = URL.createObjectURL(blob);
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                setTimeout(() => { try { URL.revokeObjectURL(a.href); a.remove(); } catch(_){} }, 3000);
              } catch (e) { console.warn(e); }
            }
          } else {
            // Single file for other provinces: include all brands in order
            try {
              let rowsHtml = '';
              const allBrands = Array.from(perBrandRows.keys()).sort((a,b) => String(a).toLowerCase().localeCompare(String(b).toLowerCase()));
              for (const brandName of allBrands) {
                const rows = perBrandRows.get(brandName) || [];
                for (const r of rows) {
                  const cleanName = String(r.name || '').replace(/\\/g, '');
                  const cleanAddress = String(r.address || '').replace(/\\/g, '');
                  const sizesHtml = (r.sizesArr || []).map(s => escapeHtml(String(s||'').replace(/\\/g,''))).join('<br>');
                  const positionsHtml = (r.positionsArr || []).map(p => escapeHtml(String(p||'').replace(/\\/g,''))).join('<br>');
                  rowsHtml += `<tr><td style=\"padding:6px;border:1px solid #444\">${r.stt}</td><td style=\"padding:6px;border:1px solid #444\">${escapeHtml(cleanName)}</td><td style=\"padding:6px;border:1px solid #444\">${escapeHtml(cleanAddress)}</td><td style=\"padding:6px;border:1px solid #444\">${sizesHtml}</td><td style=\"padding:6px;border:1px solid #444\">${positionsHtml}</td></tr>`;
                }
              }
              const provDisplay = String((provinceName || '')).trim() || 'UNKNOWN';
              const title = `DANH SÁCH BẢNG HIỆU KV TỈNH ${provDisplay}`;
              const docHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(provDisplay)}</title><style>@page{size:A4 landscape;}body{font-family:Arial,Helvetica,sans-serif}table{border-collapse:collapse;width:100%;}th,td{border:1px solid #444;padding:6px}</style></head><body><h3 style="text-align:center">${escapeHtml(title)}</h3><table><thead><tr><th>STT</th><th>Tên</th><th>Địa chỉ</th><th>Hạng mục</th><th>Vị trí lắp đặt</th></tr></thead><tbody>${rowsHtml}</tbody></table></body></html>`;
              const blob = new Blob([docHtml], { type: 'application/msword' });
              const a = document.createElement('a');
              const safeName = String((provinceName || 'province')).replace(/[^a-z0-9\-\_\.\s]/ig,'_').replace(/\s+/g,'_');
              const filename = `Danh_sach_Bang_hieu_${safeName}_${dateTag}.doc`;
              a.href = URL.createObjectURL(blob);
              a.download = filename;
              document.body.appendChild(a);
              a.click();
              setTimeout(() => { try { URL.revokeObjectURL(a.href); a.remove(); } catch(_){} }, 3000);
            } catch (e) { console.warn(e); }
          }
        } catch (e) { console.warn(e); }
      }

      function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"})[c]); }

      // Register button: move selected rows to 'Danh sách Xin phép' and switch tab
      try {
        const regBtn = document.getElementById('xinphep-register-btn');
        if (regBtn && !regBtn._xinphepBound) {
          regBtn._xinphepBound = true;
          regBtn.addEventListener('click', function() {
            try {
              const sel = Array.from(window.__xinphepSelected || []);
              if (!sel.length) return;
              const last = Array.isArray(window.__lastXinphepList) ? window.__lastXinphepList : [];
              const matches = last.filter(q => {
                const code = String(q.quote_code || q.quoteCode || q.quote || q.id || q.__backendId || '').trim();
                return sel.indexOf(code) !== -1;
              });

              // Determine area groups for selected items
              const camauCodes = new Set(['S5','S19']);
              const canthoCodes = new Set(['S4']);
              const groups = new Set();
              matches.forEach(q => {
                const area = String(q.area || '').toUpperCase();
                if (camauCodes.has(area)) groups.add('camau');
                else if (canthoCodes.has(area)) groups.add('cantho');
                else groups.add('angiang');
              });

              if (groups.size > 1) {
                const msg = 'Danh sách bạn chọn ở 2 tỉnh khác nhau, xin vui lòng chọn danh sách cùng 1 tỉnh để xin phép';
                try { showCenterMessage(msg, 3000); } catch (e) { try { alert(msg); } catch(_){} }
                return;
              }

              // Create an aggregated row for this registration in the 'Danh sách Xin phép' table
              const targetTbody = document.getElementById('xinphep-selected-tbody');
              if (targetTbody) {
                // compute totals
                const countPoints = matches.length;
                // Count hạng mục using shared helper to ensure consistency with modal
                const countHangMuc = countHangMucFromMatches(matches);
                // determine province label
                let provinceLabel = 'An Giang';
                if (groups.has('camau')) provinceLabel = 'Cà Mau';
                else if (groups.has('cantho')) provinceLabel = 'TP. Cần Thơ';

                const idx = (targetTbody.children && targetTbody.children.length) ? (targetTbody.children.length + 1) : 1;
                const date = new Date();
                const dd = String(date.getDate()).padStart(2,'0');
                const mm = String(date.getMonth()+1).padStart(2,'0');
                const yy = String(date.getFullYear());
                const dateStr = `${dd}/${mm}/${yy}`;

                const tr = document.createElement('tr');
                tr.className = 'cursor-pointer hover:bg-gray-50';
                tr.innerHTML = `
                  <td class="p-2 border-b">${idx}</td>
                  <td class="p-2 border-b">${dateStr}</td>
                  <td class="p-2 border-b">${provinceLabel}</td>
                  <td class="p-2 border-b">${countPoints}</td>
                  <td class="p-2 border-b">${countHangMuc}</td>
                  <td class="p-2 border-b"><button type="button" class="xinphep-export-word-btn px-2 py-1 border rounded text-sm">Xuất Word</button></td>
                `;
                // attach matches data for modal display
                tr.__xinphepMatches = matches;
                // wire export button (stop propagation so row click doesn't also fire)
                try {
                  const exBtn = tr.querySelector('.xinphep-export-word-btn');
                  if (exBtn && !exBtn._xinphepExportBound) {
                    exBtn._xinphepExportBound = true;
                    exBtn.addEventListener('click', function(ev) {
                      try { ev.stopPropagation(); } catch(_){ }
                      try { exportMatchesToWordFiles(matches || [], provinceLabel); } catch (e) { console.warn(e); }
                    });
                  }
                } catch (e) { /* ignore */ }

                // click to open modal showing selected list
                tr.addEventListener('click', function() {
                  try {
                    const modal = document.getElementById('xinphep-selected-modal');
                    const mtbody = document.getElementById('xinphep-selected-modal-tbody');
                    if (!modal || !mtbody) return;
                    mtbody.innerHTML = '';
                    const arr = this.__xinphepMatches || [];
                    // Group all selected quote-brand entries by brand across the whole selection
                    const brandMapGlobal = new Map();
                    arr.forEach(q => {
                      try {
                        const items = Array.isArray(q.items) ? q.items : JSON.parse(q.items || '[]');
                        if (!Array.isArray(items)) return;
                        // For each brand in this quote, collect entries
                        const localBrandMap = new Map();
                        for (const it of items) {
                          const b = (it && it.brand) ? String(it.brand).trim() : '';
                          if (!b) continue;
                          const rawW = it && (it.width != null) ? String(it.width).trim().replace(/m$/i,'').trim() : '';
                          const rawH = it && (it.height != null) ? String(it.height).trim().replace(/m$/i,'').trim() : '';
                          const wNum = (rawW !== '') && !Number.isNaN(parseFloat(rawW)) ? parseFloat(rawW) : null;
                          const hNum = (rawH !== '') && !Number.isNaN(parseFloat(rawH)) ? parseFloat(rawH) : null;
                          const sizeStr = (wNum != null && hNum != null) ? `${rawW}m x ${rawH}m` : ((it && (it.content || it.code)) ? String(it.content || it.code).trim() : 'Không kích thước');
                          if (!localBrandMap.has(b)) localBrandMap.set(b, []);
                          localBrandMap.get(b).push({ size: sizeStr, wNum, hNum });
                        }
                        // Merge into global brand map preserving quote order within each brand
                        for (const [brand, entries] of localBrandMap.entries()) {
                          if (!brandMapGlobal.has(brand)) brandMapGlobal.set(brand, []);
                          brandMapGlobal.get(brand).push({ quote: q, entries });
                        }
                      } catch (e) { /* ignore per-quote errors */ }
                    });

                    // Determine brand order (alphabetical, case-insensitive)
                    const sortedBrands = Array.from(brandMapGlobal.keys()).sort((a,b) => String(a).toLowerCase().localeCompare(String(b).toLowerCase()));

                    // Now render rows grouped by brand in sorted brand order
                    let globalIdx = 1;
                    for (const brandName of sortedBrands) {
                      const list = brandMapGlobal.get(brandName) || [];
                      for (let j = 0; j < list.length; j++) {
                        const obj = list[j];
                        const idx = globalIdx++;
                        const tr = document.createElement('tr');
                        try {
                          const esc = (s) => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"})[c]);
                          const q = obj.quote;
                          const code = esc(q.quote_code || q.quoteCode || q.quote || q.id || q.__backendId || '');
                          const areaDisp = esc(q.area || '');
                          const brandEsc = esc(brandName || '');
                          const name = esc(q.outlet_name || q.outletName || q.name || '');
                          const address = esc(q.address || [q.house_number, q.street, q.ward, q.district, q.province].filter(Boolean).join(', '));
                          const sizesHtml = obj.entries.map(e => esc(e.size)).join('<br>');
                          const positionsHtml = obj.entries.map(e => {
                            if (e.wNum != null && e.hNum != null) {
                              if (e.wNum > e.hNum) return 'Mặt tiền quán';
                              if (e.wNum < e.hNum) return 'Áp sát trụ phi cách mép đường 15m';
                              return 'Không xác định';
                            }
                            return '-';
                          }).join('<br>');
                          tr.innerHTML = `\n                  <td class="p-2 border-b">${idx}</td>\n                  <td class="p-2 border-b">${code}</td>\n                  <td class="p-2 border-b">${areaDisp}</td>\n                  <td class="p-2 border-b">${brandEsc}</td>\n                  <td class="p-2 border-b">${name}</td>\n                  <td class="p-2 border-b">${address}</td>\n                  <td class="p-2 border-b">${sizesHtml}</td>\n                  <td class="p-2 border-b">${positionsHtml}</td>\n                `;
                        } catch (e) { /* ignore row build errors */ }
                        mtbody.appendChild(tr);
                      }
                    }
                    modal.classList.remove('hidden');
                    // populate footer info
                    try {
                      const footerInfoEl = document.getElementById('xinphep-selected-modal-footer-info');
                      if (footerInfoEl) {
                        // points = number of quotes
                        const points = Array.isArray(arr) ? arr.length : 0;
                        // boards = sum of items/hạng mục across quotes (use shared helper)
                        const boards = countHangMucFromMatches(arr);
                        // license and dates from meta (may be present when opened from have tab)
                        const meta = (this && this.__xinphepMeta) ? this.__xinphepMeta : {};
                        const lic = (meta.license || '-') || '-';
                        const effRaw = meta.effective || '';
                        const expRaw = meta.expiry || '';
                        const prov = meta.province || '';
                        const fmt = (s) => {
                          if (!s) return '-';
                          try {
                            const parts = s.split('-'); if (parts.length===3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
                          } catch(_){ }
                          return s;
                        };
                        footerInfoEl.innerHTML = `Số Giấy Phép: ${lic || '-'} &nbsp;|&nbsp; Ngày có hiệu lực: ${fmt(effRaw)} &nbsp;|&nbsp; Ngày hết hiệu lực: ${fmt(expRaw)} &nbsp;|&nbsp; Số lượng điểm: ${points} &nbsp;|&nbsp; Số lượng bảng: ${boards}`;
                      }
                    } catch (e) { /* ignore footer populate errors */ }
                    const closeBtn = document.getElementById('close-xinphep-selected-modal');
                    if (closeBtn && !closeBtn._xinphepBound) {
                      closeBtn._xinphepBound = true;
                      closeBtn.addEventListener('click', function() { modal.classList.add('hidden'); });
                    }
                    // wire inline header/footer close buttons
                    try {
                      const inlineClose = document.getElementById('xinphep-selected-modal-close-inline');
                      if (inlineClose && !inlineClose._xinphepBound) { inlineClose._xinphepBound = true; inlineClose.addEventListener('click', function(){ modal.classList.add('hidden'); }); }
                    } catch(_){ }
                    try {
                      const footerClose = document.getElementById('xinphep-selected-modal-footer-close');
                      if (footerClose && !footerClose._xinphepBound) { footerClose._xinphepBound = true; footerClose.addEventListener('click', function(){ modal.classList.add('hidden'); }); }
                    } catch(_){ }
                  } catch (e) { console.warn(e); }
                });
                targetTbody.appendChild(tr);
                // Also clone this aggregated row into the 'Đã có giấy phép' table for display parity
                try {
                  const haveTbody = document.getElementById('xinphep-have-tbody');
                  if (haveTbody) {
                    const clone = tr.cloneNode(true);
                    // copy matches reference so search can inspect detailed quotes
                    try { clone.__xinphepMatches = tr.__xinphepMatches || []; } catch(_) { clone.__xinphepMatches = []; }
                    // Insert 'Số giấy phép' input cell after STT
                    try {
                      const tdsInit = clone.querySelectorAll('td');
                      if (tdsInit && tdsInit.length >= 1) {
                        const sttTd = tdsInit[0];
                        const licenseTd = document.createElement('td');
                        licenseTd.className = 'p-2 border-b';
                        const licenseInput = document.createElement('input');
                        licenseInput.type = 'text';
                        licenseInput.className = 'xinphep-license-input';
                        licenseInput.placeholder = 'Số giấy phép';
                        licenseInput.style.width = '160px';
                        const editBtn = document.createElement('button');
                        editBtn.type = 'button';
                        editBtn.className = 'xinphep-license-edit-btn spo-edit-btn text-gray-400 hover:text-gray-600 ml-2';
                        editBtn.title = 'Sửa';
                        editBtn.style.display = 'none';
                        editBtn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>';
                        licenseInput.addEventListener('keydown', function(ev) {
                          try { if (ev.key === 'Enter') { licenseInput.readOnly = true; editBtn.style.display = 'inline-block'; licenseInput.blur(); } } catch(e){}
                        });
                        editBtn.addEventListener('click', function(ev) { try { ev.stopPropagation(); } catch(_){} licenseInput.readOnly = false; licenseInput.focus(); editBtn.style.display = 'none'; });
                        licenseTd.appendChild(licenseInput);
                        licenseTd.appendChild(editBtn);
                        sttTd.parentNode.insertBefore(licenseTd, sttTd.nextSibling);
                      }
                    } catch (e) { /* ignore license insert errors */ }
                    // Replace the date cell with a date input (Ngày Hiệu Lực) and insert a new cell for Ngày hết hiệu lực
                    try {
                      const tds = Array.from(clone.querySelectorAll('td'));
                      if (tds && tds.length > 0) {
                        // Try to locate the original date cell by matching its text content to dateStr
                        let dateTd = null;
                        try {
                          const want = (dateStr || '').toString().trim();
                          if (want) dateTd = tds.find(td => (td.textContent || '').toString().trim() === want);
                        } catch (_) { dateTd = null; }
                        // fallback: find first cell that looks like dd/mm/yyyy
                        if (!dateTd) dateTd = tds.find(td => /\d{1,2}\/\d{1,2}\/\d{4}/.test((td.textContent||'')));
                        if (!dateTd && tds.length >= 2) dateTd = tds[1];
                        if (dateTd) {
                          const provinceTd = dateTd.nextElementSibling;
                          // store province text on cloned row for download filename
                          try { clone.__xinphep_province = (provinceTd && (provinceTd.textContent||'').toString().trim()) || ''; } catch(_) { clone.__xinphep_province = ''; }
                          // create effective date input and prefill from original dateStr (format dd/mm/yyyy -> yyyy-mm-dd)
                          const effInput = document.createElement('input');
                          effInput.type = 'date';
                          // per user request: do NOT auto-fill the effective date;
                          // leave `effInput.value` empty so it must be chosen manually
                          try { /* intentionally left blank to avoid autofill */ } catch (_) {}
                          // replace date cell content
                          dateTd.innerHTML = '';
                          dateTd.className = 'p-2 border-b';
                          dateTd.appendChild(effInput);
                          // insert expiry cell after dateTd
                          const expiryTd = document.createElement('td');
                          expiryTd.className = 'p-2 border-b';
                          const expInput = document.createElement('input');
                          expInput.type = 'date';
                          expiryTd.appendChild(expInput);
                          if (provinceTd && provinceTd.parentNode) provinceTd.parentNode.insertBefore(expiryTd, provinceTd);
                        }
                      }
                    } catch (e) { /* ignore date-insert errors */ }
                    // Re-bind export button on cloned node
                    try {
                      // Replace export button in cloned row with Upload PDF control
                      const cloneExport = clone.querySelector('.xinphep-export-word-btn');
                      if (cloneExport) {
                        const td = cloneExport.closest('td');
                        if (td) {
                          // clear cell
                          td.innerHTML = '';
                          // create upload UI: two buttons (Giấy Phép Gốc, Giấy Phép SPO) each with hidden file input and one URL anchor per line
                          const uploadBtnOrig = document.createElement('button');
                          uploadBtnOrig.type = 'button';
                          uploadBtnOrig.className = 'xinphep-upload-pdf-btn-original px-2 py-1 border rounded text-sm';
                          uploadBtnOrig.textContent = 'Giấy Phép Gốc';

                          const uploadBtnSPO = document.createElement('button');
                          uploadBtnSPO.type = 'button';
                          uploadBtnSPO.className = 'xinphep-upload-pdf-btn-spo px-2 py-1 border rounded text-sm';
                          uploadBtnSPO.textContent = 'Giấy Phép SPO';

                          const urlAnchorOrig = document.createElement('a');
                          urlAnchorOrig.href = '#';
                          urlAnchorOrig.target = '_blank';
                          urlAnchorOrig.style.display = 'inline-block';
                          urlAnchorOrig.style.marginLeft = '8px';
                          urlAnchorOrig.style.color = '#1a73e8';
                          urlAnchorOrig.style.textDecoration = 'underline';
                          urlAnchorOrig.textContent = '';

                          const urlAnchorSPO = document.createElement('a');
                          urlAnchorSPO.href = '#';
                          urlAnchorSPO.target = '_blank';
                          urlAnchorSPO.style.display = 'inline-block';
                          urlAnchorSPO.style.marginLeft = '8px';
                          urlAnchorSPO.style.color = '#1a73e8';
                          urlAnchorSPO.style.textDecoration = 'underline';
                          urlAnchorSPO.textContent = '';

                          const fileInputOrig = document.createElement('input');
                          fileInputOrig.type = 'file';
                          fileInputOrig.accept = 'application/pdf';
                          fileInputOrig.style.display = 'none';

                          const fileInputSPO = document.createElement('input');
                          fileInputSPO.type = 'file';
                          fileInputSPO.accept = 'application/pdf';
                          fileInputSPO.style.display = 'none';

                          // wire interactions for original
                          uploadBtnOrig.addEventListener('click', function(ev) {
                            try { ev.stopPropagation(); } catch(_){ }
                            fileInputOrig.click();
                          });
                          fileInputOrig.addEventListener('change', function(ev) {
                            try {
                              const f = (fileInputOrig.files && fileInputOrig.files[0]) || null;
                              if (!f) return;
                              try { if (clone.__permitPdfUrlOriginal) { try { URL.revokeObjectURL(clone.__permitPdfUrlOriginal); } catch(_){} } } catch(_){ }
                              const u = URL.createObjectURL(f);
                              clone.__permitPdfUrlOriginal = u;
                              urlAnchorOrig.href = u;
                              urlAnchorOrig.textContent = u;
                            } catch (e) { console.warn(e); }
                          });

                          // wire interactions for SPO
                          uploadBtnSPO.addEventListener('click', function(ev) {
                            try { ev.stopPropagation(); } catch(_){ }
                            fileInputSPO.click();
                          });
                          fileInputSPO.addEventListener('change', function(ev) {
                            try {
                              const f = (fileInputSPO.files && fileInputSPO.files[0]) || null;
                              if (!f) return;
                              try { if (clone.__permitPdfUrlSPO) { try { URL.revokeObjectURL(clone.__permitPdfUrlSPO); } catch(_){} } } catch(_){ }
                              const u = URL.createObjectURL(f);
                              clone.__permitPdfUrlSPO = u;
                              urlAnchorSPO.href = u;
                              urlAnchorSPO.textContent = u;
                            } catch (e) { console.warn(e); }
                          });

                          // Build inline wrappers so each button and its URL are on the same line
                          const wrapOrig = document.createElement('div');
                          wrapOrig.style.display = 'flex';
                          wrapOrig.style.alignItems = 'center';
                          wrapOrig.style.gap = '8px';
                          // framed URL box for original
                          const urlBoxOrig = document.createElement('div');
                          urlBoxOrig.style.border = '1px solid #e2e8f0';
                          urlBoxOrig.style.padding = '4px 8px';
                          urlBoxOrig.style.borderRadius = '6px';
                          urlBoxOrig.style.background = '#fff';
                          urlBoxOrig.appendChild(urlAnchorOrig);
                          wrapOrig.appendChild(uploadBtnOrig);
                          wrapOrig.appendChild(urlBoxOrig);
                          wrapOrig.appendChild(fileInputOrig);

                          const wrapSPO = document.createElement('div');
                          wrapSPO.style.display = 'flex';
                          wrapSPO.style.alignItems = 'center';
                          wrapSPO.style.gap = '8px';
                          wrapSPO.style.marginTop = '8px';
                          // framed URL box for SPO
                          const urlBoxSPO = document.createElement('div');
                          urlBoxSPO.style.border = '1px solid #e2e8f0';
                          urlBoxSPO.style.padding = '4px 8px';
                          urlBoxSPO.style.borderRadius = '6px';
                          urlBoxSPO.style.background = '#fff';
                          urlBoxSPO.appendChild(urlAnchorSPO);
                          wrapSPO.appendChild(uploadBtnSPO);
                          wrapSPO.appendChild(urlBoxSPO);
                          wrapSPO.appendChild(fileInputSPO);

                          // attach wrappers
                          td.appendChild(wrapOrig);
                          td.appendChild(wrapSPO);

                          // helper to create small icon buttons
                          const makeIconBtn = (svgHtml, title, extraClass) => {
                            const b = document.createElement('button');
                            b.type = 'button';
                            b.className = (extraClass || '') + ' text-gray-500 hover:text-gray-700 p-1 rounded';
                            b.title = title || '';
                            b.innerHTML = svgHtml;
                            b.style.border = 'none';
                            b.style.background = 'transparent';
                            b.style.cursor = 'pointer';
                            return b;
                          };

                          // SVGs
                          const svgDownload = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v12m0 0l-4-4m4 4l4-4M21 21H3"/></svg>';
                          
                          // filename helper: remove diacritics, replace spaces with underscore
                          const normalizeForFilename = (s) => {
                            if (!s) return '';
                            try { s = s.toString(); } catch(_) { s = String(s); }
                            // remove diacritics
                            try { s = s.normalize('NFD').replace(/\p{Diacritic}/gu, ''); } catch (e) { s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
                            // replace non-alphanumeric (except space) with empty, then spaces to underscore
                            s = s.replace(/[^\p{L}\p{N} ]+/gu, '');
                            s = s.replace(/\s+/g, '_');
                            return s;
                          };

                          // add buttons into url boxes for Original
                          const dlBtnOrig = makeIconBtn(svgDownload, 'Tải xuống (Gốc)', 'xinphep-download-url-btn');
                          const prBtnOrig = null; // print button removed per request
                          dlBtnOrig.addEventListener('click', function(ev) {
                            try { ev.stopPropagation(); } catch(_){ }
                            try {
                              const u = clone.__permitPdfUrlOriginal || null;
                              if (!u) return;
                              const a = document.createElement('a');
                              a.href = u;
                              // build filename: GP{license}_{province_no_diacritics}_{Goc}
                              try {
                                const licEl = clone.querySelector && clone.querySelector('.xinphep-license-input');
                                const lic = licEl ? (licEl.value||'').toString().trim() : '';
                                const prov = (clone.__xinphep_province || '').toString().trim();
                                const provNorm = normalizeForFilename(prov) || 'UNKNOWN_PROVINCE';
                                const licPart = lic ? ('GP' + lic) : 'GPUNKNOWN';
                                a.download = `${licPart}_${provNorm}_Goc.pdf`;
                              } catch (_) { a.download = 'giay_phep_goc.pdf'; }
                              document.body.appendChild(a);
                              a.click();
                              setTimeout(() => { try{ document.body.removeChild(a); } catch(_){} }, 1000);
                            } catch (e) { console.warn(e); }
                          });
                          urlBoxOrig.appendChild(dlBtnOrig);

                          // add buttons into url boxes for SPO
                          const dlBtnSPO = makeIconBtn(svgDownload, 'Tải xuống (SPO)', 'xinphep-download-url-btn');
                          const prBtnSPO = null; // print button removed per request
                          dlBtnSPO.addEventListener('click', function(ev) {
                            try { ev.stopPropagation(); } catch(_){ }
                            try {
                              const u = clone.__permitPdfUrlSPO || null;
                              if (!u) return;
                              const a = document.createElement('a');
                              a.href = u;
                              // build filename: GP{license}_{province_no_diacritics}_{SPO}
                              try {
                                const licEl = clone.querySelector && clone.querySelector('.xinphep-license-input');
                                const lic = licEl ? (licEl.value||'').toString().trim() : '';
                                const prov = (clone.__xinphep_province || '').toString().trim();
                                const provNorm = normalizeForFilename(prov) || 'UNKNOWN_PROVINCE';
                                const licPart = lic ? ('GP' + lic) : 'GPUNKNOWN';
                                a.download = `${licPart}_${provNorm}_SPO.pdf`;
                              } catch (_) { a.download = 'giay_phep_spo.pdf'; }
                              document.body.appendChild(a);
                              a.click();
                              setTimeout(() => { try{ document.body.removeChild(a); } catch(_){} }, 1000);
                            } catch (e) { console.warn(e); }
                          });
                          urlBoxSPO.appendChild(dlBtnSPO);
                        }
                      }
                      // Also ensure clicking clone opens the modal (mirror original behavior)
                      // but ignore clicks that start on the upload controls so upload does not open the modal
                      clone.addEventListener('click', function(ev) {
                        try {
                            if (ev && ev.target) {
                            // if click originated from upload buttons, file inputs, date inputs, license inputs/edit buttons, or the URL anchors, do nothing
                            if (ev.target.closest && (ev.target.closest('.xinphep-upload-pdf-btn-original') || ev.target.closest('.xinphep-upload-pdf-btn-spo') || ev.target.closest('input[type="file"]') || ev.target.closest('input[type="date"]') || ev.target.closest('.xinphep-license-input') || ev.target.closest('.xinphep-license-edit-btn') || ev.target.closest('a') || ev.target.closest('.xinphep-download-url-btn'))) {
                              return;
                            }
                          }
                          // before delegating to the original row handler, copy meta (license, dates, province) from clone into the original tr
                          try {
                            const licEl = clone.querySelector && clone.querySelector('.xinphep-license-input');
                            const dates = clone.querySelectorAll && clone.querySelectorAll('input[type="date"]');
                            const eff = (dates && dates[0]) ? (dates[0].value || '') : '';
                            const exp = (dates && dates[1]) ? (dates[1].value || '') : '';
                            const lic = licEl ? (licEl.value || '') : '';
                            try { tr.__xinphepMeta = tr.__xinphepMeta || {}; } catch(_) { tr.__xinphepMeta = {}; }
                            tr.__xinphepMeta.license = lic;
                            tr.__xinphepMeta.effective = eff;
                            tr.__xinphepMeta.expiry = exp;
                            tr.__xinphepMeta.province = clone.__xinphep_province || '';
                          } catch (e) { /* ignore meta copy errors */ }
                          tr.click();
                        } catch (e) { console.warn(e); }
                      });
                    } catch (e) { /* ignore clone binding errors */ }
                    haveTbody.appendChild(clone);
                  }
                } catch (e) { /* ignore have-tab clone errors */ }
              }

              // Clear selection and update UI
              // Remove registered quotes from the main source so they no longer appear in 'Chưa xin phép'
              try {
                if (Array.isArray(window.__lastXinphepList)) {
                  const selKeys = new Set((matches || []).map(q => String(q.quote_code || q.quoteCode || q.quote || q.id || q.__backendId || '').trim()));
                  window.__lastXinphepList = window.__lastXinphepList.filter(q => {
                    const k = String(q.quote_code || q.quoteCode || q.quote || q.id || q.__backendId || '').trim();
                    return !selKeys.has(k);
                  });
                  try { if (typeof window.renderXinphepList === 'function') window.renderXinphepList(window.__lastXinphepList || []); } catch(_){ }
                }
              } catch (e) { console.warn('xinphep: failed to remove registered quotes', e); }

              window.__xinphepSelected.clear();
              applyXinphepSelections();
              // Switch to list tab
              const listBtn = document.querySelector('[data-xinphep-tab="list"]');
              if (listBtn) listBtn.click();
            } catch (e) { console.warn(e); }
          });
        }
      } catch (e) { /* ignore */ }
    } catch (e) { /* ignore tab init errors */ }
  });
})();

// Header search input: filter Xin Phép tables across tabs
(function(){
  function filterXinphepTables(qraw) {
    try {
      const q = (qraw || '').toString().trim().toLowerCase();
      const ids = ['xinphep-list-tbody','xinphep-selected-tbody','xinphep-have-tbody'];
      ids.forEach(id => {
        try {
          const tb = document.getElementById(id);
          if (!tb) return;
          Array.from(tb.querySelectorAll('tr')).forEach(tr => {
            try {
              const text = (tr.textContent || '').toString().toLowerCase();
              let match = false;
              if (!q) match = true;
              else {
                // For aggregated lists (selected/have), prefer matching inside detailed matches array
                if ((id === 'xinphep-selected-tbody' || id === 'xinphep-have-tbody') && tr.__xinphepMatches && Array.isArray(tr.__xinphepMatches)) {
                  try {
                    for (const mq of tr.__xinphepMatches) {
                      try {
                        const code = ((mq.quote_code || mq.quoteCode || mq.quote || mq.id || mq.__backendId) || '').toString().toLowerCase();
                        const name = ((mq.outlet_name || mq.outletName || mq.name) || '').toString().toLowerCase();
                        if ((code && code.indexOf(q) !== -1) || (name && name.indexOf(q) !== -1)) { match = true; break; }
                      } catch(_){ }
                    }
                  } catch(_){ }
                }
                // fallback: match against row text (covers Mã BG and Tên Outlet for non-aggregated rows)
                if (!match && text.indexOf(q) !== -1) match = true;
                // additional: if have-tab, also check license input value
                if (!match && id === 'xinphep-have-tbody') {
                  const licEl = tr.querySelector && tr.querySelector('.xinphep-license-input');
                  if (licEl) {
                    const lv = (licEl.value||'').toString().toLowerCase();
                    if (lv.indexOf(q) !== -1) match = true;
                  }
                }
              }
              tr.style.display = match ? '' : 'none';
            } catch (e) { /* ignore per-row */ }
          });
        } catch (e) { /* ignore per-table */ }
      });
    } catch (e) { /* ignore */ }
  }

  document.addEventListener('input', function(ev){
    try {
      if (!ev || !ev.target) return;
      if (ev.target.id === 'xinphep-header-search') {
        filterXinphepTables(ev.target.value || '');
      } else if (ev.target.id === 'xinphep-selected-modal-search') {
        // filter rows inside the selected modal table by code or outlet name
        try {
          const q = (ev.target.value || '').toString().trim().toLowerCase();
          const tb = document.getElementById('xinphep-selected-modal-tbody');
          if (!tb) return;
          Array.from(tb.querySelectorAll('tr')).forEach(tr => {
            try {
              if (!q) { tr.style.display = ''; return; }
              const text = (tr.textContent || '').toString().toLowerCase();
              let match = false;
              if (text.indexOf(q) !== -1) match = true;
              // if the row has underlying quote matches, check them too
              if (!match && tr.__xinphepMatches && Array.isArray(tr.__xinphepMatches)) {
                for (const mq of tr.__xinphepMatches) {
                  try {
                    const code = ((mq.quote_code || mq.quoteCode || mq.quote || mq.id || mq.__backendId) || '').toString().toLowerCase();
                    const name = ((mq.outlet_name || mq.outletName || mq.name) || '').toString().toLowerCase();
                    if ((code && code.indexOf(q) !== -1) || (name && name.indexOf(q) !== -1)) { match = true; break; }
                  } catch(_){ }
                }
              }
              tr.style.display = match ? '' : 'none';
            } catch (e) { /* ignore per-row */ }
          });
        } catch (e) { /* ignore modal search */ }
      }
    } catch (e) {}
  });

  // also allow programmatic calls
  window.filterXinphepTables = filterXinphepTables;
})();
