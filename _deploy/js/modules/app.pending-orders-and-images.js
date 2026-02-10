                function setupPendingOrdersRealtimeListener() {
                  // Hook into existing SSE/WebSocket invalidate handler
                  const originalHandler = window.__qcagOnInvalidate;
                  window.__qcagOnInvalidate = function(payload) {
                    if (originalHandler) originalHandler(payload);
                    if (payload && payload.resource === 'pending_orders') {
                      // Reload pending orders from backend and always render
                      loadPendingOrdersFromBackend().then((loaded) => {
                        // Always render even if load failed (to show empty state)
                        try { renderPendingOrdersList(); } catch (e) {}
                      }).catch(() => {
                        // On error, still try to render current state
                        try { renderPendingOrdersList(); } catch (e) {}
                      });
                    }
                  };
                }
                
                // Backward compatibility - also keep localStorage fallback
                const PENDING_ORDERS_STORAGE_KEY = 'qcag_pending_orders';
                
                // Save pending orders - prefer backend, fallback to localStorage
                function savePendingOrdersToStorage() {
                  // Also save to localStorage as backup
                  try {
                    if (typeof localStorage !== 'undefined') {
                      localStorage.setItem(PENDING_ORDERS_STORAGE_KEY, JSON.stringify(pendingOrders || []));
                    }
                  } catch (e) {}
                }
                
                // Load pending orders - prefer backend, fallback to localStorage
                async function loadPendingOrdersFromStorage() {
                  // Try backend first
                  const backendLoaded = await loadPendingOrdersFromBackend();
                  if (backendLoaded) {
                    // Clear localStorage since backend is source of truth
                    try { localStorage.removeItem(PENDING_ORDERS_STORAGE_KEY); } catch (e) {}
                    return true;
                  }
                  
                  // Fallback to localStorage
                  try {
                    if (typeof localStorage !== 'undefined') {
                      const stored = localStorage.getItem(PENDING_ORDERS_STORAGE_KEY);
                      if (stored) {
                        const parsed = JSON.parse(stored);
                        if (Array.isArray(parsed)) {
                          pendingOrders = parsed;
                          // Remove quotes that are in pending orders from currentQuotes
                          const pendingQuoteKeys = new Set();
                          pendingOrders.forEach(order => {
                            if (Array.isArray(order.quotes)) {
                              order.quotes.forEach(q => {
                                const key = getQuoteKey(q);
                                if (key) pendingQuoteKeys.add(key);
                              });
                            }
                          });
                          // Filter out pending quotes from selection lists
                          if (pendingQuoteKeys.size > 0) {
                            currentQuotes = currentQuotes.filter(q => !pendingQuoteKeys.has(getQuoteKey(q)));
                            productionModalQuotesToFilter = productionModalQuotesToFilter.filter(q => !pendingQuoteKeys.has(getQuoteKey(q)));
                            productionModalFilteredQuotes = productionModalFilteredQuotes.filter(q => !pendingQuoteKeys.has(getQuoteKey(q)));
                          }
                          updatePendingCount();
                          return true;
                        }
                      }
                    }
                  } catch (e) {
                    console.warn('Cannot load pending orders from storage:', e);
                  }
                  return false;
                }
                // Acceptance images for Hình nghiệm thu modal (in-memory, per-order+quote)
                // Stored per composite key (quoteKey::orderKey) to avoid cross-order reuse.
                // V1.0 Logic: No session storage, work directly with quote.images in productionOrders

                function parseImagesField(raw) {
                  try {
                    if (Array.isArray(raw)) return raw;
                    if (typeof raw === 'string') {
                      const parsed = JSON.parse(raw || '[]');
                      return Array.isArray(parsed) ? parsed : [];
                    }
                    return [];
                  } catch (e) {
                    return [];
                  }
                }

                function findQuoteIndexByKeyInList(quotes, key) {
                  if (!Array.isArray(quotes)) return -1;
                  const resolvedKey = resolveQuoteKey(key);
                  if (!resolvedKey) return -1;
                  for (let i = 0; i < quotes.length; i++) {
                    const k = resolveQuoteKey(quotes[i]);
                    if (k && k === resolvedKey) return i;
                  }
                  return -1;
                }

                async function saveQuoteImages(quoteKey, images, options = {}) {
                  const resolvedKey = resolveQuoteKey(quoteKey);
                  if (!resolvedKey) return false;
                  const imgs = Array.isArray(images) ? images : [];
                  const imagesJson = JSON.stringify(imgs);
                  const shouldRender = options.render !== false;

                  let updatedOrder = null;
                  try {
                    const found = findQuoteInProductionOrders(resolvedKey);
                    if (found && found.order) {
                      const { order, orderIndex } = found;
                      let quotes = [];
                      try { quotes = JSON.parse(order.items || '[]'); } catch (e) { quotes = []; }
                      if (Array.isArray(quotes)) {
                        let qIdx = found.quoteIndex != null ? found.quoteIndex : -1;
                        if (qIdx < 0 || !quotes[qIdx]) {
                          qIdx = findQuoteIndexByKeyInList(quotes, resolvedKey);
                        }
                        if (qIdx >= 0 && quotes[qIdx]) {
                          quotes[qIdx].images = imagesJson;
                          quotes[qIdx].__imagesChanged = true;
                          updatedOrder = { ...order, items: JSON.stringify(quotes) };
                          productionOrders[orderIndex] = updatedOrder;
                          __qcagMarkProductionOrdersDirty(); // Invalidate cache
                        }
                      }
                    }
                    // If not updated via direct order match, attempt a broader scan
                    if (!updatedOrder && Array.isArray(productionOrders) && productionOrders.length) {
                      for (let oi = 0; oi < productionOrders.length; oi++) {
                        try {
                          const ord = productionOrders[oi];
                          if (!ord) continue;
                          let qArr = [];
                          try { qArr = JSON.parse(ord.items || '[]'); } catch (e) { qArr = []; }
                          if (!Array.isArray(qArr) || !qArr.length) continue;
                          const qi = findQuoteIndexByKeyInList(qArr, resolvedKey);
                          if (qi >= 0 && qArr[qi]) {
                            qArr[qi].images = imagesJson;
                            qArr[qi].__imagesChanged = true;
                            const newOrd = { ...ord, items: JSON.stringify(qArr) };
                            productionOrders[oi] = newOrd;
                            __qcagMarkProductionOrdersDirty(); // Invalidate cache
                            updatedOrder = newOrd;
                            break;
                          }
                        } catch (e) { /* ignore per-order errors */ }
                      }
                    }
                  } catch (e) { /* ignore */ }

                  try {
                    const master = (typeof findQuoteByKey === 'function') ? findQuoteByKey(resolvedKey) : null;
                    if (master) {
                      master.images = imagesJson;
                      master.__imagesChanged = true;
                    }
                  } catch (e) { /* ignore */ }

                  try {
                    if (Array.isArray(currentQuotes)) {
                      const idx = currentQuotes.findIndex(q => resolveQuoteKey(q) === resolvedKey);
                      if (idx >= 0) {
                        currentQuotes[idx].images = imagesJson;
                        currentQuotes[idx].__imagesChanged = true;
                      }
                    }
                  } catch (e) { /* ignore */ }

                  // If the acceptance detail modal is currently open for this quote, update its quoteRef
                  try {
                    if (typeof acceptanceDetailState !== 'undefined' && acceptanceDetailState && acceptanceDetailState.quoteKey) {
                      const activeKey = resolveQuoteKey(acceptanceDetailState.quoteKey);
                      if (activeKey && activeKey === resolvedKey) {
                        // Prefer to point to the up-to-date quote object from productionOrders when available
                        try {
                          const found2 = findQuoteInProductionOrders(resolvedKey);
                          if (found2 && found2.quote) {
                            acceptanceDetailState.quoteRef = found2.quote;
                          } else if (acceptanceDetailState.quoteRef) {
                            acceptanceDetailState.quoteRef.images = imagesJson;
                          }
                        } catch (e) {
                          if (acceptanceDetailState.quoteRef) acceptanceDetailState.quoteRef.images = imagesJson;
                        }
                      }
                    }
                  } catch (e) { /* ignore */ }

                  // Persist changes to backend (if available). Return success flag.
                  let saved = false;
                  if (window.dataSdk && typeof window.dataSdk.update === 'function') {
                    if (updatedOrder) {
                      try { await window.dataSdk.update(updatedOrder); saved = true; } catch (e) { console.warn('Không thể lưu ảnh vào order:', e); }
                    }
                    try {
                      const master = (typeof findQuoteByKey === 'function') ? findQuoteByKey(resolvedKey) : null;
                      if (master) {
                        const payload = { images: imagesJson };
                        if (master.__backendId != null) payload.__backendId = master.__backendId;
                        else if (master.id != null) payload.id = master.id;
                        if (payload.__backendId != null || payload.id != null) {
                          try { await window.dataSdk.update(payload); saved = true; } catch (e) { /* ignore */ }
                        } else {
                          try { await window.dataSdk.update(master); saved = true; } catch (e) { /* ignore */ }
                        }
                      }
                    } catch (e) { /* ignore */ }
                  } else {
                    // No backend SDK available in this runtime - treat as saved (legacy/local mode)
                    saved = true;
                  }

                  if (shouldRender && saved) {
                    try { window.__filteredAcceptanceOrders = null; } catch (e) {}
                    try { renderAcceptanceImages(); } catch (e) {}
                    try { renderAcceptanceDetailModal(); } catch (e) {}
                    try { window.__renderAcceptanceProductionOrders && window.__renderAcceptanceProductionOrders(); } catch (e) {}
                  }
                  return saved;
                }

                async function addAcceptanceImage(quoteKey, orderKey, dataUrl, name) {
                  const resolvedKey = resolveQuoteKey(quoteKey);
                  if (!resolvedKey) return;
                  
                  // NEW: Upload vào acceptance-images folder và lưu vào field riêng
                  const entryName = name || 'accept_upload';
                  
                  // Upload to GCS acceptance-images folder
                  let hostedUrl = dataUrl;
                  if (qcagShouldUseBackend()) {
                    try {
                      const url = await qcagUploadImageDataUrl(dataUrl, entryName, {
                        folder: 'acceptance-images',
                        quoteKey: String(resolvedKey),
                        orderKey: orderKey ? String(orderKey) : ''
                      });
                      if (url) hostedUrl = url;
                    } catch (e) {
                      console.warn('Upload acceptance image failed:', e);
                    }
                  }
                  
                  // Save to quote's acceptance_images field (separate from quote.images)
                  const found = findQuoteInProductionOrders(resolvedKey);
                  if (found && found.order) {
                    const { order, orderIndex, quote, quoteIndex } = found;
                    let quotes = [];
                    try { quotes = JSON.parse(order.items || '[]'); } catch (e) { quotes = []; }
                    
                    if (quoteIndex >= 0 && quotes[quoteIndex]) {
                      // Parse existing acceptance_images
                      let acceptImgs = [];
                      try { acceptImgs = parseImagesField(quotes[quoteIndex].acceptance_images); } catch (e) { acceptImgs = []; }
                      
                      // Add new image
                      acceptImgs.push({ data: hostedUrl, name: entryName });
                      quotes[quoteIndex].acceptance_images = JSON.stringify(acceptImgs);
                      
                      // Update order
                      const updatedOrder = { ...order, items: JSON.stringify(quotes) };
                      productionOrders[orderIndex] = updatedOrder;
                      __qcagMarkProductionOrdersDirty();
                      
                      // Persist to backend
                      if (window.dataSdk && typeof window.dataSdk.update === 'function') {
                        try { await window.dataSdk.update(updatedOrder); } catch (e) { console.warn('Persist acceptance image failed:', e); }
                      }
                    }
                  }
                  
                  window.__filteredAcceptanceOrders = null;
                  renderAcceptanceImages();
                  renderAcceptanceDetailModal();
                  window.__renderAcceptanceProductionOrders && window.__renderAcceptanceProductionOrders();
                }

                // Handle a File/Blob for acceptance modal - version 1.0 style with compression
                function handleAcceptanceImageFile(quoteKey, orderKey, file) {
                  if (!quoteKey || !file || !file.type.startsWith('image/')) return;
                  // Compress first to reduce upload size
                  compressImageFile(file, 1600, 0.8).then((dataUrl) => {
                    addAcceptanceImage(quoteKey, orderKey, dataUrl, file.name || 'upload');
                  }).catch(() => {
                    // Fallback to raw dataURL if compression fails
                    const reader = new FileReader();
                    reader.onload = function(ev) {
                      addAcceptanceImage(quoteKey, orderKey, ev.target.result, file.name || 'upload');
                    };
                    reader.readAsDataURL(file);
                  });
                }
                const noteModalState = {
                  activeQuoteKey: null,
                  pendingFiles: [],
                  // track mentions added via autocomplete: { username, name }
                  currentMentions: []
                };
                const NOTE_MODAL_MAX_FILES = 10;
                const NOTE_MAX_IMAGE_WIDTH = 1600;
                const NOTE_MAX_IMAGE_HEIGHT = 900;
                const NOTE_MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
                const NOTE_JPEG_QUALITY = 0.85;

                function ensureXlsxLib() {
                  if (typeof XLSX !== 'undefined') return Promise.resolve();
                  return new Promise((resolve, reject) => {
                    const s = document.createElement('script');
                    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.min.js';
                    s.onload = () => resolve();
                    s.onerror = () => reject(new Error('Không tải được thư viện XLSX'));
                    document.head.appendChild(s);
                  });
                }

                function escapeHtml(value) {
                  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                }

                function __qcagConfirmSPO(input, editFn) {
                  if (!input) return;
                  input.disabled = true;
                  input.classList.add('spo-confirmed');
                  const container = input.parentElement;
                  if (!container || container.querySelector('.spo-edit-btn')) return;
                  const editBtn = document.createElement('button');
                  editBtn.className = 'spo-edit-btn text-gray-400 hover:text-gray-600';
                  editBtn.title = 'Sửa SPO';
                  editBtn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>';
                  editBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (typeof editFn === 'function') editFn(input);
                  });
                  container.appendChild(editBtn);
                }

                function __qcagEditSPO(input) {
                  if (!input) return;
                  input.disabled = false;
                  input.classList.remove('spo-confirmed');
                  input.focus();
                  const container = input.parentElement;
                  const editBtn = container ? container.querySelector('.spo-edit-btn') : null;
                  if (editBtn) editBtn.remove();
                }

                const QUOTE_SEQUENCE_STORAGE_KEY = 'quote_sequence_counter_v1';
                const QUOTE_CODE_CACHE_KEY = 'quote_code_cache_v1';
                let quoteSequenceCounter = loadPersistedQuoteSequence();
                let quoteCodeCache = loadQuoteCodeCache();
                let pendingJumpToFirstPage = false;
                let lastQuoteCount = 0;
                // Client-side search index (built once when data changes)
                let quoteSearchIndex = [];
                function normalizeForSearch(s) {
                  try {
                    return String(s || '').normalize && String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
                  } catch (e) {
                    return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
                  }
                }

                function buildQuoteSearchIndex() {
                  try {
                    quoteSearchIndex = (currentQuotes || []).map(q => {
                      const parts = [q.outlet_name, q.outlet_code, q.quote_code || q.quoteCode, q.spo_number, q.area, q.sale_name];
                      const joined = parts.map(p => normalizeForSearch(p)).filter(Boolean).join(' ');
                      return { id: (typeof getQuoteKey === 'function') ? getQuoteKey(q) : (q.__backendId || q.id || ''), search: joined };
                    });
                  } catch (e) {
                    quoteSearchIndex = [];
                  }
                }

                function loadPersistedQuoteSequence() {
                    if (typeof window === 'undefined') {
                        return 0;
                    }
                    try {
                        const raw = window.localStorage ? window.localStorage.getItem(QUOTE_SEQUENCE_STORAGE_KEY) : null;
                        const parsed = raw != null ? parseInt(raw, 10) : NaN;
                        if (Number.isFinite(parsed)) {
                            window.__quoteSequenceFallback = parsed;
                            return parsed;
                        }
                        if (Number.isFinite(window.__quoteSequenceFallback)) {
                            return window.__quoteSequenceFallback;
                        }
                    } catch (err) {
                        console.warn('Không thể đọc bộ đếm mã báo giá:', err);
                    }
                    return 0;
                }

                // Acceptance detail state
                let acceptanceDetailState = { quoteKey: null, orderKey: null, quoteRef: null, pasteHandler: null };

                // Cached lookup to avoid O(N_orders * N_quotes) scans on every getQcagOrderNumber() call
                window.__qcagProductionOrdersStamp = window.__qcagProductionOrdersStamp || 1;
                const __qcagProductionQuoteIndexCache = { stamp: 0, map: null };

                function __qcagMarkProductionOrdersDirty() {
                    try { window.__qcagProductionOrdersStamp = (window.__qcagProductionOrdersStamp || 0) + 1; } catch (_) {}
                }

                function __qcagBuildProductionQuoteIndexMap() {
                    const stamp = window.__qcagProductionOrdersStamp || 0;
                    if (__qcagProductionQuoteIndexCache.map && __qcagProductionQuoteIndexCache.stamp === stamp) {
                        return __qcagProductionQuoteIndexCache.map;
                    }
                    const map = new Map();
                    try {
                        if (Array.isArray(productionOrders) && productionOrders.length) {
                            for (let oi = 0; oi < productionOrders.length; oi++) {
                                const order = productionOrders[oi];
                                if (!order) continue;
                                // Prefer cached parsing helpers if available
                                const payload = (typeof __qcagGetParsedOrderPayload === 'function') ?
                                    __qcagGetParsedOrderPayload(order) : { quoteKeys: [], items: (() => { try { return JSON.parse(order.items || '[]'); } catch (e) { return []; } })() };

                                const quoteKeys = payload && payload.quoteKeys ? payload.quoteKeys : [];
                                if (Array.isArray(quoteKeys) && quoteKeys.length) {
                                    for (let ki = 0; ki < quoteKeys.length; ki++) {
                                        const k0 = quoteKeys[ki];
                                        if (!k0 && k0 !== 0) continue;
                                        const k = String(k0);
                                        if (k && !map.has(k)) map.set(k, { order, orderIndex: oi, quote: null, quoteIndex: -1 });
                                    }
                                }

                                const quotes = payload && payload.items ? payload.items : [];
                                if (!Array.isArray(quotes) || !quotes.length) continue;
                                for (let qi = 0; qi < quotes.length; qi++) {
                                    const q = quotes[qi];
                                    if (!q) continue;
                                    let k = '';
                                    k = resolveQuoteKey(q);
                                    if (!k) continue;
                                    const ks = String(k);
                                    if (!map.has(ks)) map.set(ks, { order, orderIndex: oi, quote: q, quoteIndex: qi });
                                }
                            }
                        }
                    } catch (e) {
                        // ignore
                    }
                    __qcagProductionQuoteIndexCache.stamp = stamp;
                    __qcagProductionQuoteIndexCache.map = map;
                    return map;
                }

                function findQuoteInProductionOrders(quoteKey) {
                  const resolvedKey = resolveQuoteKey(quoteKey);
                  if (!resolvedKey || !Array.isArray(productionOrders)) return null;
                    try {
                        const map = __qcagBuildProductionQuoteIndexMap();
                    const hit = map && map.get ? map.get(String(resolvedKey)) : null;
                        if (hit) return hit;
                    } catch (e) { /* ignore */ }
                    // Fallback: slow scan (should rarely be hit)
                    for (let oi = 0; oi < productionOrders.length; oi++) {
                        const order = productionOrders[oi];
                        let quotes = [];
                        try { quotes = JSON.parse(order.items || '[]'); } catch (e) { quotes = []; }
                        if (!Array.isArray(quotes)) continue;
                        for (let qi = 0; qi < quotes.length; qi++) {
                            const q = quotes[qi];
                            const k = resolveQuoteKey(q);
                            if (k === resolvedKey) return { order, orderIndex: oi, quote: q, quoteIndex: qi };
                        }
                    }
                    return null;
                }

                function openAcceptanceDetailModal(quote, quoteKey, orderKey) {
                    const modal = document.getElementById('acceptance-detail-modal');
                    if (!modal) return;
                    acceptanceDetailState.quoteKey = resolveQuoteKey(quoteKey || quote);
                    acceptanceDetailState.orderKey = orderKey || null;
                    acceptanceDetailState.quoteRef = quote || null;
                    renderAcceptanceDetailModal();
                    // ensure this modal sits above others
                    try {
                        modal.style.zIndex = String((window.__modalZCounter = (window.__modalZCounter || 100000) + 1));
                    } catch (e) { /* ignore */ }
                    modal.classList.remove('hidden');
                    // Add drag and drop for center
                    const center = document.getElementById('acceptance-detail-preview');
                    if (center && !center._dragAdded) {
                        center._dragAdded = true;
                        center.tabIndex = 0;
                        center.addEventListener('paste', (e) => {
                          if (!e.clipboardData) return;
                          const items = e.clipboardData.items || [];
                          for (const it of items) {
                            if (it.type && it.type.indexOf('image') === 0) {
                              const blob = it.getAsFile();
                              if (!blob) continue;
                              // Use acceptance-specific handler (do NOT persist to quote.images automatically)
                              handleAcceptanceImageFile(acceptanceDetailState.quoteKey, blob);
                              e.preventDefault();
                              return;
                            }
                          }
                        });
                        center.addEventListener('dragover', (e) => {
                            e.preventDefault();
                            center.style.border = '2px dashed #10b981';
                        });
                        center.addEventListener('dragleave', (e) => {
                            e.preventDefault();
                            center.style.border = '';
                        });
                        center.addEventListener('drop', (e) => {
                          e.preventDefault();
                          center.style.border = '';
                          const files = e.dataTransfer.files;
                          if (files && files.length > 0) {
                            for (let i = 0; i < files.length; i++) {
                              const file = files[i];
                              if (file.type.startsWith('image/')) {
                                // Use acceptance-specific handler (order-aware)
                                handleAcceptanceImageFile(acceptanceDetailState.quoteKey, file);
                              }
                            }
                          }
                        });
                    }
                    // If quote has no images, immediately prompt upload/paste before viewing
                    try {
                        let imgs = [];
                        const qr = acceptanceDetailState.quoteRef;
                        try { imgs = JSON.parse((qr && qr.images) || '[]') || []; } catch (e) { imgs = []; }
                        // Không hiển thị upload/paste chooser khi chưa có ảnh
                    } catch (e) { /* ignore */ }
                    // bind close
                    const closeBtn = document.getElementById('close-acceptance-detail-modal');
                    if (closeBtn && !closeBtn._bound) {
                        closeBtn._bound = true;
                        closeBtn.addEventListener('click', closeAcceptanceDetailModal);
                    }
                    // file input
                    const fileInput = document.getElementById('acceptance-detail-file-input');
                    if (fileInput && !fileInput._bound) {
                      fileInput._bound = true;
                      fileInput.addEventListener('change', async(ev) => {
                        const files = ev.target.files || [];
                        for (const f of files) {
                          // Do not persist to quote.images here — keep acceptance uploads local to the modal
                          const dataUrl = await new Promise((res, rej) => {
                            const r = new FileReader();
                            r.onload = () => res(r.result);
                            r.onerror = rej;
                            r.readAsDataURL(f);
                          });
                          addAcceptanceImage(acceptanceDetailState.quoteKey, acceptanceDetailState.orderKey, dataUrl, f.name || 'accept_upload');
                        }
                        fileInput.value = '';
                      });
                    }
                }

                function closeAcceptanceDetailModal() {
                    const modal = document.getElementById('acceptance-detail-modal');
                    if (!modal) return;
                    modal.classList.add('hidden');
                    try { modal.style.zIndex = ''; } catch (e) { /* ignore */ }
                    acceptanceDetailState = { quoteKey: null, orderKey: null, quoteRef: null };
                }

                function renderAcceptanceDetailModal() {
                    const left = document.getElementById('acceptance-detail-col-left');
                    const center = document.getElementById('acceptance-detail-preview');
                    const right = document.getElementById('acceptance-detail-col-right');
                    if (!center || !left || !right) return;
                    left.innerHTML = '';
                    center.innerHTML = '';
                    right.innerHTML = '';
                    // Always refresh QC state before rendering detail modal
                    if (typeof collectQcSignageRows === 'function') {
                        collectQcSignageRows();
                    }
                    const info = findQuoteInProductionOrders(acceptanceDetailState.quoteKey) || { quote: acceptanceDetailState.quoteRef };
                    const masterQuote = (typeof findQuoteByKey === 'function') ? findQuoteByKey(resolveQuoteKey(acceptanceDetailState.quoteKey)) : null;
                    const quote = info.quote || masterQuote || acceptanceDetailState.quoteRef || null;
                    
                    // Đọc ảnh nghiệm thu từ acceptance_images (mới) hoặc fallback quote.images (cũ)
                    let images = [];
                    let imagesSource = 'none';
                    try {
                      // Try new field first
                      images = parseImagesField(quote && quote.acceptance_images);
                      if (images && images.length > 0) {
                        imagesSource = 'acceptance';
                      } else {
                        // Fallback to legacy quote.images
                        images = parseImagesField(quote && quote.images) || [];
                        if (images && images.length > 0) {
                          imagesSource = 'legacy';
                        }
                      }
                    } catch (e) { images = []; }
                    
                    // left thumbnails
                    images.forEach((imgObj, idx) => {
                        const t = document.createElement('div');
                        t.className = 'mb-2 cursor-pointer relative';
                        const th = document.createElement('img');
                        th.src = imgObj.data || imgObj.src || '';
                        th.className = 'w-full h-20 object-cover rounded';
                        th.alt = imgObj.name || `H${idx+1}`;
                        // X button always visible
                        const delBtn = document.createElement('button');
                        delBtn.type = 'button';
                        delBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12" /></svg>';
                        delBtn.className = 'absolute top-1 right-1 z-10 bg-white bg-opacity-80 rounded-full p-0.5 text-red-600 shadow hover:bg-red-100';
                        delBtn.title = 'Xoá hình này';
                        delBtn.addEventListener('click', async(e) => {
                            e.stopPropagation();
                            // Delete from appropriate source (acceptance_images or legacy quote.images)
                            const resolvedKey = resolveQuoteKey(acceptanceDetailState.quoteKey);
                            const info = findQuoteInProductionOrders(resolvedKey);
                            if (info && info.order && info.quoteIndex >= 0) {
                              let quotes = [];
                              try { quotes = JSON.parse(info.order.items || '[]'); } catch (e) { quotes = []; }
                              
                              if (quotes[info.quoteIndex]) {
                                const q = quotes[info.quoteIndex];
                                // Check which source we're deleting from
                                let imgs = parseImagesField(q.acceptance_images);
                                let isNewFormat = imgs && imgs.length > 0;
                                
                                if (!isNewFormat) {
                                  // Legacy format
                                  imgs = parseImagesField(q.images);
                                  imgs.splice(idx, 1);
                                  q.images = JSON.stringify(imgs);
                                } else {
                                  // New format
                                  imgs.splice(idx, 1);
                                  q.acceptance_images = JSON.stringify(imgs);
                                }
                                
                                // Update order
                                const updatedOrder = { ...info.order, items: JSON.stringify(quotes) };
                                productionOrders[info.orderIndex] = updatedOrder;
                                __qcagMarkProductionOrdersDirty();
                                
                                if (window.dataSdk && typeof window.dataSdk.update === 'function') {
                                  try { await window.dataSdk.update(updatedOrder); } catch (e) { console.warn('Delete failed:', e); }
                                }
                              }
                            }
                            window.__filteredAcceptanceOrders = null;
                            renderAcceptanceImages();
                            renderAcceptanceDetailModal();
                            // After delete, if current previewed image was deleted, show next image (or previous if last)
                            setTimeout(() => {
                              if (images.length > 0 && center) {
                                let nextIdx = 0;
                                if (currentPreviewIdx === idx) {
                                  nextIdx = Math.min(idx, images.length - 1);
                                } else if (currentPreviewIdx > idx) {
                                  nextIdx = currentPreviewIdx - 1;
                                } else {
                                  nextIdx = currentPreviewIdx;
                                }
                                const newImg = images[nextIdx];
                                if (newImg) {
                                  const center2 = document.getElementById('acceptance-detail-preview');
                                  if (center2) {
                                    center2.innerHTML = '';
                                    const img = document.createElement('img');
                                    img.src = newImg.data || newImg.src;
                                    img.className = 'max-h-full max-w-full object-contain rounded shadow';
                                    center2.appendChild(img);
                                  }
                                }
                              }
                            }, 0);
                        });
                        t.appendChild(th);
                        t.appendChild(delBtn);
                        t.addEventListener('click', () => {
                            renderCenterPreview(images[idx]);
                        });
                        left.appendChild(t);
                    });
                    // center preview
                    function renderCenterPreview(imgObj) {
                        center.innerHTML = '';
                        if (imgObj && (imgObj.data || imgObj.src)) {
                            const img = document.createElement('img');
                            img.src = imgObj.data || imgObj.src;
                            img.className = 'max-h-full max-w-full object-contain rounded shadow';
                            center.appendChild(img);
                        } else {
                            const plus = document.createElement('div');
                            plus.className = 'w-1/2 h-1/2 flex items-center justify-center border-2 border-dashed rounded-lg text-6xl text-gray-300 cursor-pointer';
                            plus.textContent = '+';
                            plus.tabIndex = 0;
                            plus.addEventListener('mouseenter', () => {
                                plus.style.boxShadow = 'inset 0 0 0 3px #2563eb';
                                plus.focus();
                            });
                            plus.addEventListener('mouseleave', () => {
                                plus.style.boxShadow = '';
                            });
                            plus.addEventListener('paste', (e) => {
                                if (!e.clipboardData) return;
                                const items = e.clipboardData.items || [];
                                for (const it of items) {
                                    if (it.type && it.type.indexOf('image') === 0) {
                                        const blob = it.getAsFile();
                                        if (!blob) continue;
                                        handleAcceptanceImageFile(acceptanceDetailState.quoteKey, blob);
                                        e.preventDefault();
                                        return;
                                    }
                                }
                            });
                            plus.addEventListener('dragover', (e) => {
                                e.preventDefault();
                                plus.style.boxShadow = 'inset 0 0 0 3px #10b981';
                            });
                            plus.addEventListener('dragleave', (e) => {
                                e.preventDefault();
                                plus.style.boxShadow = '';
                            });
                            plus.addEventListener('drop', (e) => {
                                e.preventDefault();
                                plus.style.boxShadow = '';
                                const files = e.dataTransfer.files;
                                if (files && files.length > 0) {
                                    for (let i = 0; i < files.length; i++) {
                                        const file = files[i];
                                        if (file.type.startsWith('image/')) {
                                            handleAcceptanceImageFile(acceptanceDetailState.quoteKey, file);
                                        }
                                    }
                                }
                            });
                            plus.addEventListener('click', () => {
                                // directly open file input
                                const fi = document.getElementById('acceptance-detail-file-input');
                                if (fi) fi.click();
                            });
                            center.appendChild(plus);
                        }
                    }
                    if (images.length) renderCenterPreview(images[0]);
                    else renderCenterPreview(null);
                    // right info
                    if (quote) {
                        // 1. Thông tin cơ bản
                        const outletName = (masterQuote && masterQuote.outlet_name) || quote.outlet_name || quote.outletCode || '-';
                        const quoteCode = (typeof formatQuoteCode === 'function' && quote.quote_code) ? formatQuoteCode(quote) : (quote.quote_code || quote.quoteCode || quote.spo_number || '-');
                        const saleName = (masterQuote && masterQuote.sale_name) || quote.sale_name || quote.saleName || '-';
                        const saleRole = (masterQuote && masterQuote.sale_role) || quote.sale_role || quote.saleRole || 'Sale';
                        const ssName = quote.ss_name || quote.ssName || '';
                        // SPO number/status: prefer latest from master (SQL), then production order, then quote copy
                        const displaySpoNumber = (masterQuote && masterQuote.spo_number) || (info && info.order && info.order.spo_number) || quote.spo_number || '-';
                        const displaySpoStatus = (masterQuote && masterQuote.spo_status) || quote.spo_status || '';
                        const outletCode = quote.outlet_code || '-';
                        const area = quote.area || '-';
                        let html = '';
                        html += `<div class="mb-2 text-xl font-bold text-gray-900">${outletName}</div>`;
                        html += `<div class="mb-2"><span class="font-semibold">Mã BG:</span> ${quoteCode}</div>`;
                        html += `<div class="mb-2"><span class="font-semibold">${saleRole}:</span> ${saleName}</div>`;
                        if (ssName) html += `<div class="mb-2"><span class="font-semibold">Tên SS:</span> ${ssName}</div>`;
                        html += `<div class="mb-2"><span class="font-semibold">SPO:</span> ${displaySpoNumber}</div>`;
                        if (displaySpoStatus) html += `<div class="mb-2"><span class="font-semibold">Trạng thái SPO:</span> ${displaySpoStatus}</div>`;
                        html += `<div class="mb-2"><span class="font-semibold">Outletcode:</span> ${outletCode}</div>`;
                        html += `<div class="mb-2"><span class="font-semibold">Khu vực:</span> ${area}</div>`;

                        // 2. Bảng hạng mục
                        let items = [];
                        try { items = JSON.parse(quote.items || '[]'); } catch (e) { items = []; }
                        if (!Array.isArray(items) || !items.length) {
                            // Có thể là quote không chứa items, thử lấy từ order
                            const found = findQuoteInProductionOrders(acceptanceDetailState.quoteKey);
                            if (found && found.quote && found.quote.items) {
                                try { items = JSON.parse(found.quote.items || '[]'); } catch (e) { items = []; }
                            }
                        }
                        html += `<div class="mb-2"><span class="font-semibold">Số hạng mục:</span> ${items.length}</div>`;
                        html += `<div class="overflow-x-auto"><table class="min-w-full border text-xs mb-2"><thead><tr><th class="border px-2 py-1">STT</th><th class="border px-2 py-1">Tên hạng mục</th><th class="border px-2 py-1">Trạng thái QC</th><th class="border px-2 py-1">Hành động</th></tr></thead><tbody>`;
                        // Determine orderKey for QC item key
                        let orderKey = null;
                        if (info && info.order) {
                            if (typeof getProductionOrderKey === 'function') {
                                orderKey = getProductionOrderKey(info.order);
                            } else {
                                orderKey = info.order.__backendId || info.order.id || info.order.outlet_code || '';
                            }
                        }
                        for (let i = 0; i < items.length; i++) {
                            const item = items[i];
                            const name = item.name || item.title || item.content || '-';
                            let qcStatus = '';
                            // Determine if item is allowed for QC
                            let isAllowedQc = false;
                            if (typeof qualifiesQcSignageItem === 'function') {
                                isAllowedQc = qualifiesQcSignageItem(item);
                            } else {
                                // fallback: check code in QC_SIGNAGE_ITEM_CODES or content has 'logo'
                                const code = String(item.code || '').trim();
                                isAllowedQc = (typeof QC_SIGNAGE_ITEM_CODES !== 'undefined' && QC_SIGNAGE_ITEM_CODES.has && QC_SIGNAGE_ITEM_CODES.has(code)) ||
                                    (item.content && /logo/i.test(item.content));
                            }
                            if (!isAllowedQc) {
                                qcStatus = '';
                            } else {
                                // Build QC key
                                let qcKey = null;
                                if (orderKey) {
                                  if (typeof buildQcSignageItemKey === 'function') {
                                    qcKey = buildQcSignageItemKey(orderKey, quote, i);
                                  } else {
                                    qcKey = [orderKey, quote && (quote.outlet_code || quote.spo_number || quote.sale_name || `point_${i}`), i].join('__').replace(/\s+/g, '_');
                                  }
                                }
                                let row = null;
                                if (qcKey && typeof qcSignageUiState !== 'undefined' && qcSignageUiState.itemsByKey && qcSignageUiState.itemsByKey.has(qcKey)) {
                                  row = qcSignageUiState.itemsByKey.get(qcKey);
                                }
                                if (!row && orderKey && typeof qcSignageUiState !== 'undefined' && qcSignageUiState.itemsByKey) {
                                  const outletCode = quote && quote.outlet_code ? String(quote.outlet_code) : '';
                                  const spoNumber = quote && quote.spo_number ? String(quote.spo_number) : '';
                                  const saleName = quote && quote.sale_name ? String(quote.sale_name) : '';
                                  const code = item && item.code ? String(item.code) : '';
                                  const content = item && item.content ? String(item.content) : '';
                                  qcSignageUiState.itemsByKey.forEach((r) => {
                                    if (row) return;
                                    if (r.orderKey !== orderKey) return;
                                    if (r.itemIndex !== i) return;
                                    if (outletCode && r.quoteRef && r.quoteRef.outletCode && String(r.quoteRef.outletCode) !== outletCode) return;
                                    if (spoNumber && r.quoteRef && r.quoteRef.spoNumber && String(r.quoteRef.spoNumber) !== spoNumber) return;
                                    if (!outletCode && !spoNumber && saleName && r.quoteRef && r.quoteRef.saleName && String(r.quoteRef.saleName) !== saleName) return;
                                    if (code && r.item && r.item.code && String(r.item.code) !== code) return;
                                    if (content && r.item && r.item.content && String(r.item.content) !== content) return;
                                    row = r;
                                  });
                                }
                                if (!row || !row.status) {
                                    qcStatus = 'Chưa đăng ký QC';
                                } else if (row.status === 'todo') {
                                    // Nếu có trạng thái thực tế (pending/fail/pass) thì ưu tiên hiển thị
                                    if (row.lastResult === 'pending') qcStatus = 'Pending';
                                    else if (row.lastResult === 'fail') qcStatus = 'Fail';
                                    else if (row.lastResult === 'pass') qcStatus = 'Pass';
                                    else qcStatus = 'Chưa đăng ký QC';
                                } else if (row.status === 'waiting') {
                                    qcStatus = 'Đã đăng ký QC';
                                } else if (row.status === 'pass') {
                                    qcStatus = 'Pass';
                                } else if (row.status === 'pending') {
                                    qcStatus = 'Pending';
                                } else if (row.status === 'fail') {
                                    qcStatus = 'Fail';
                                } else {
                                    qcStatus = '';
                                }
                            }
                            // Add icon for status
                            let iconHtml = '';
                            if (qcStatus === 'Pass') {
                                iconHtml = '<span class="inline-block align-middle ml-2 text-green-600" style="vertical-align:middle"><svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" /></svg></span>';
                            } else if (qcStatus === 'Pending') {
                                iconHtml = '<span class="inline-block align-middle ml-2 text-yellow-500" style="vertical-align:middle"><svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M12 8v4m0 4h.01" /><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="3" fill="none" /></svg></span>';
                            } else if (qcStatus === 'Fail') {
                                iconHtml = '<span class="inline-block align-middle ml-2 text-red-600" style="vertical-align:middle"><svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M6 18L18 6M6 6l12 12" /></svg></span>';
                            }
                            const isCancelled = item.isCancelled || false;
                            const nameClass = isCancelled ? 'line-through text-gray-500' : '';
                            const buttonText = isCancelled ? '<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>' : 'Hủy';
                            const buttonClass = isCancelled ? 'undo-item-btn bg-gray-500 hover:bg-gray-600' : 'remove-item-btn bg-red-500 hover:bg-red-600';
                            html += `<tr><td class="border px-2 py-1 text-center">${i+1}</td><td class="border px-2 py-1 ${nameClass}">${name}</td><td class="border px-2 py-1 text-center"><span class="flex items-center justify-center">${qcStatus}${iconHtml}</span></td><td class="border px-2 py-1 text-center"><button class="${buttonClass} text-white px-2 py-1 rounded text-xs" data-index="${i}">${buttonText}</button></td></tr>`;
                        }
                        html += `</tbody></table></div>`;
                        html += `<div id="acceptance-detail-notes" class="mt-2 text-sm text-gray-600"></div>`;

                        // 3. Nút tải ảnh lên cố định dưới cùng
                        // Tạo container flex cho cột phải
                        right.innerHTML = `<div class="flex flex-col h-full" style="min-height:100%"><div class="flex-1 overflow-y-auto">${html}</div><div class="flex justify-end items-end py-3 space-x-2"><button id="acceptance-detail-upload-btn" class="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2 rounded shadow text-sm">Tải hình lên</button><button id="download-acceptance-images" class="bg-green-600 hover:bg-green-700 text-white font-semibold px-4 py-2 rounded shadow text-sm">Tải xuống ảnh</button><button id="acceptance-detail-add-item-btn" class="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-4 py-2 rounded shadow text-sm">Thêm hạng mục</button></div></div>`;
                        // Bind lại sự kiện cho nút upload
                        const uploadBtn = document.getElementById('acceptance-detail-upload-btn');
                        if (uploadBtn) {
                            uploadBtn.addEventListener('click', () => {
                                const fi = document.getElementById('acceptance-detail-file-input');
                                if (fi) fi.click();
                            });
                        }
                        // Bind sự kiện cho nút download
                        const downloadBtn = document.getElementById('download-acceptance-images');
                        if (downloadBtn) {
                            downloadBtn.addEventListener('click', async() => {
                                let images = [];
                                try { images = JSON.parse(quote.images || '[]') || []; } catch (e) { images = []; }
                                if (!images.length) return;
                                // Chọn nơi lưu
                                if ('showDirectoryPicker' in window) {
                                    try {
                                        const dirHandle = await window.showDirectoryPicker();
                                        for (let idx = 0; idx < images.length; idx++) {
                                            const img = images[idx];
                                            const fileName = img.name || `image_${idx + 1}.png`;
                                            const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
                                            const writable = await fileHandle.createWritable();
                                            // Convert dataUrl to blob
                                            const response = await qcagFetchWithRetries(img.data);
                                            const blob = await response.blob();
                                            await writable.write(blob);
                                            await writable.close();
                                        }
                                    } catch (e) {
                                        // User cancelled or error
                                    }
                                } else if ('showSaveFilePicker' in window) {
                                    for (let idx = 0; idx < images.length; idx++) {
                                        const img = images[idx];
                                        try {
                                            const handle = await window.showSaveFilePicker({
                                                suggestedName: img.name || `image_${idx + 1}.png`,
                                                types: [{
                                                    description: 'PNG Image',
                                                    accept: { 'image/png': ['.png'] }
                                                }]
                                            });
                                            const writable = await handle.createWritable();
                                            // Convert dataUrl to blob
                                            const response = await qcagFetchWithRetries(img.data);
                                            const blob = await response.blob();
                                            await writable.write(blob);
                                            await writable.close();
                                        } catch (e) {
                                            // User cancelled or error
                                        }
                                    }
                                } else {
                                    // Fallback to download link
                                    images.forEach((img, idx) => {
                                        const link = document.createElement('a');
                                        link.href = img.data;
                                        link.download = img.name || `image_${idx + 1}.png`;
                                        document.body.appendChild(link);
                                        link.click();
                                        document.body.removeChild(link);
                                    });
                                }
                            });
                        }
                        // Bind sự kiện cho nút toggle item
                        // Helper: persist QCAG override status explicitly to backend
                        async function persistQcagOverride(quoteObj, desiredStatus) {
                            try {
                                if (!quoteObj) return;
                                if (!window.dataSdk || typeof window.dataSdk.update !== 'function') return;
                                if (!desiredStatus) {
                                    quoteObj.__overrideClearing = true; // suppress flicker while clearing
                                } else {
                                    delete quoteObj.__overrideClearing;
                                }
                                const payload = {
                                    qcag_override_status: desiredStatus ? 'Cần chỉnh báo giá' : null,
                                    qcag_note: desiredStatus ? (quoteObj.qcag_note || null) : null,
                                    qcag_at: desiredStatus ? new Date().toISOString() : null
                                };
                                if (quoteObj.__backendId != null) payload.__backendId = quoteObj.__backendId;
                                else if (quoteObj.id != null) payload.id = quoteObj.id;
                                await window.dataSdk.update(payload);
                            } catch (e) {
                                console.warn('persistQcagOverride failed', e);
                            }
                        }

                        const toggleBtns = right.querySelectorAll('.remove-item-btn, .undo-item-btn');
                        toggleBtns.forEach(btn => {
                            btn.addEventListener('click', (e) => {
                                const index = parseInt(e.target.closest('button').dataset.index);
                                if (isNaN(index)) return;
                                // Toggle isCancelled
                                if (quote && quote.items) {
                                    let currentItems = [];
                                    try { currentItems = JSON.parse(quote.items); } catch (e) { currentItems = []; }
                                    if (currentItems[index]) {
                                        const nextCancelled = !currentItems[index].isCancelled;
                                        currentItems[index].isCancelled = nextCancelled;
                                        quote.items = JSON.stringify(currentItems);
                                        

                                        // Mark QCAG status as needing quote update (overlay) until quote is updated or cancel is undone
                                        // Detect added items notes from the best available source (quote/prod order/master)
                                        let addedNotesJson = quote.added_items_notes;
                                        if (!addedNotesJson) {
                                            try {
                                                const foundForNotes = findQuoteInProductionOrders(acceptanceDetailState.quoteKey);
                                                if (foundForNotes) {
                                                    const { order: orderForNotes, quoteIndex: quoteIndexForNotes } = foundForNotes;
                                                    let quotesForNotes = [];
                                                    try { quotesForNotes = JSON.parse(orderForNotes.items || '[]'); } catch (e) { quotesForNotes = []; }
                                                    if (Array.isArray(quotesForNotes) && quotesForNotes[quoteIndexForNotes]) {
                                                        addedNotesJson = quotesForNotes[quoteIndexForNotes].added_items_notes;
                                                    }
                                                }
                                            } catch (e) {}
                                        }
                                        if (!addedNotesJson) {
                                            try {
                                                const masterForNotes = findQuoteByKey(acceptanceDetailState.quoteKey);
                                                if (masterForNotes) addedNotesJson = masterForNotes.added_items_notes;
                                            } catch (e) {}
                                        }

                                        let addedNotes = [];
                                        try { addedNotes = JSON.parse(addedNotesJson || '[]') || []; } catch (e) { addedNotes = []; }
                                        const hasAnyCancelled = Array.isArray(currentItems) && currentItems.some(it => it && it.isCancelled);
                                        const hasAnyAdded = Array.isArray(addedNotes) && addedNotes.length > 0;
                                        const stillNeedsUpdate = hasAnyCancelled || hasAnyAdded;
                                        if (stillNeedsUpdate) {
                                            quote.__updatedSinceQc = true;
                                            quote.__itemsChanged = true;
                                            quote.qcag_override_status = 'Cần chỉnh báo giá';
                                        } else {
                                            delete quote.__updatedSinceQc;
                                            delete quote.__itemsChanged;
                                            quote.qcag_override_status = null;
                                            quote.__overrideClearing = true;
                                        }
                                        try {
                                            console.log('[ACCEPTANCE] quoteKey=', acceptanceDetailState && acceptanceDetailState.quoteKey, 'stillNeedsUpdate=', !!stillNeedsUpdate, 'quoteFlags=', { __updatedSinceQc: quote.__updatedSinceQc, __itemsChanged: quote.__itemsChanged, __imagesChanged: quote.__imagesChanged });
                                        } catch (e) { /* ignore logging errors */ }

                                        const itemName = currentItems[index].name || currentItems[index].title || currentItems[index].content || '-';
                                        if (nextCancelled) {
                                            addPlainNoteForQuote(acceptanceDetailState.quoteKey || quote, `khi thông công đã báo huỷ ${itemName}`);
                                        } else {
                                            addPlainNoteForQuote(acceptanceDetailState.quoteKey || quote, `Đã hoàn tác lệnh báo huỷ ${itemName}`);
                                        }
                                        // Update productionOrders
                                        const found = findQuoteInProductionOrders(acceptanceDetailState.quoteKey);
                                        if (found) {
                                            const { order, orderIndex, quoteIndex } = found;
                                            let quotes = [];
                                            try { quotes = JSON.parse(order.items || '[]'); } catch (e) { quotes = []; }
                                            if (Array.isArray(quotes) && quotes[quoteIndex]) {
                                                quotes[quoteIndex].items = JSON.stringify(currentItems);
                                                if (stillNeedsUpdate) {
                                                    quotes[quoteIndex].__updatedSinceQc = true;
                                                    quotes[quoteIndex].__itemsChanged = true;
                                                    quotes[quoteIndex].qcag_override_status = 'Cần chỉnh báo giá';
                                                } else {
                                                    delete quotes[quoteIndex].__updatedSinceQc;
                                                    delete quotes[quoteIndex].__itemsChanged;
                                                    quotes[quoteIndex].qcag_override_status = null;
                                                    quotes[quoteIndex].__overrideClearing = true;
                                                }
                                                const updatedOrder = {...order, items: JSON.stringify(quotes) };
                                                productionOrders[orderIndex] = updatedOrder;
                                                if (window.dataSdk && typeof window.dataSdk.update === 'function') {
                                                    window.dataSdk.update(updatedOrder).catch(() => {});
                                                }
                                            }
                                        }

                                        // Also update the master quote record so the main list QCAG column updates immediately
                                        try {
                                            const master = findQuoteByKey(acceptanceDetailState.quoteKey);
                                            if (master) {
                                                if (stillNeedsUpdate) {
                                                    master.__updatedSinceQc = true;
                                                    master.__itemsChanged = true;
                                                    master.qcag_override_status = 'Cần chỉnh báo giá';
                                                } else {
                                                    delete master.__updatedSinceQc;
                                                    delete master.__itemsChanged;
                                                    master.qcag_override_status = null;
                                                    master.__overrideClearing = true;
                                                }
                                                try {
                                                    console.log('[ACCEPTANCE][MASTER] key=', (typeof getQuoteKey === 'function' ? getQuoteKey(master) : '<no-key>'), 'flags=', { __updatedSinceQc: master.__updatedSinceQc, __itemsChanged: master.__itemsChanged, __imagesChanged: master.__imagesChanged });
                                                } catch (e) {}
                                                persistQcagOverride(master, stillNeedsUpdate);
                                            }
                                        } catch (e) {}
                                        // Also ensure the `currentQuotes` array object (used by main list) is updated too
                                        try {
                                            const qKey = acceptanceDetailState && acceptanceDetailState.quoteKey;
                                            if (qKey && Array.isArray(currentQuotes)) {
                                                const idx = currentQuotes.findIndex(q => (typeof getQuoteKey === 'function' ? getQuoteKey(q) : '') === qKey);
                                                if (idx >= 0) {
                                                    if (stillNeedsUpdate) {
                                                        currentQuotes[idx].__updatedSinceQc = true;
                                                        currentQuotes[idx].__itemsChanged = true;
                                                        currentQuotes[idx].qcag_override_status = 'Cần chỉnh báo giá';
                                                    } else {
                                                        delete currentQuotes[idx].__updatedSinceQc;
                                                        delete currentQuotes[idx].__itemsChanged;
                                                        delete currentQuotes[idx].__imagesChanged;
                                                        currentQuotes[idx].qcag_override_status = null;
                                                        currentQuotes[idx].__overrideClearing = true;
                                                    }
                                                    // Persist clear/set to backend to avoid reverting on refresh
                                                    persistQcagOverride(currentQuotes[idx], stillNeedsUpdate);
                                                }
                                            }
                                        } catch (e) { /* ignore */ }
                                        // Re-render
                                        renderAcceptanceDetailModal();
                                        try { updateMainList(); } catch (e) {}
                                    }
                                }
                            });
                        });

                        // Bind thêm hạng mục (mở modal nhỏ)
                        const addItemBtn = document.getElementById('acceptance-detail-add-item-btn');
                        if (addItemBtn) {
                            addItemBtn.addEventListener('click', () => {
                                // Prevent duplicate modal
                                if (document.getElementById('add-item-modal')) return;
                                // Create modal overlay
                                const modal = document.createElement('div');
                                modal.id = 'add-item-modal';
                                modal.className = 'fixed inset-0 z-80 flex items-center justify-center bg-black bg-opacity-40';
                                try { modal.style.zIndex = String((window.__modalZCounter = (window.__modalZCounter || 100000) + 1)); } catch (e) { /* ignore */ }
                                const card = document.createElement('div');
                                card.className = 'bg-white rounded-lg shadow-lg p-4 w-full max-w-md';
                                const title = document.createElement('div');
                                title.className = 'text-lg font-semibold mb-2';
                                title.textContent = 'Thêm hạng mục';
                                const input = document.createElement('input');
                                input.type = 'text';
                                input.placeholder = 'Nhập nội dung hạng mục...';
                                input.className = 'w-full border px-3 py-2 rounded mb-3';
                                const hint = document.createElement('div');
                                hint.className = 'text-sm text-gray-500 mb-3';
                                hint.textContent = 'Lưu ý: không được thêm hạng mục nằm trong danh sách QC.';
                                const actions = document.createElement('div');
                                actions.className = 'flex justify-end gap-2';
                                const cancelBtn = document.createElement('button');
                                cancelBtn.className = 'bg-gray-300 hover:bg-gray-400 px-3 py-2 rounded';
                                cancelBtn.textContent = 'Hủy';
                                const confirmBtn = document.createElement('button');
                                confirmBtn.className = 'bg-green-600 hover:bg-green-700 text-white px-3 py-2 rounded';
                                confirmBtn.textContent = 'Xác nhận';
                                actions.appendChild(cancelBtn);
                                actions.appendChild(confirmBtn);
                                card.appendChild(title);
                                card.appendChild(input);
                                card.appendChild(hint);
                                card.appendChild(actions);
                                modal.appendChild(card);
                                document.body.appendChild(modal);
                                input.focus();
                                // Handlers
                                const closeModal = () => { if (modal && modal.parentNode) modal.parentNode.removeChild(modal); };
                                cancelBtn.addEventListener('click', closeModal);
                                modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
                                const onConfirm = () => {
                                    const val = (input.value || '').trim();
                                    if (!val) return;
                                    const valLower = val.toLowerCase();
                                    // check against QC list
                                    let inQc = false;
                                    if (typeof QC_SIGNAGE_ITEM_CODES !== 'undefined' && QC_SIGNAGE_ITEM_CODES) {
                                        for (const [code, name] of QC_SIGNAGE_ITEM_CODES) {
                                            if ((name && name.toLowerCase() === valLower) || (String(code).toLowerCase() === valLower)) { inQc = true; break; }
                                        }
                                    }
                                    if (inQc) {
                                        alert('Không thể thêm hạng mục nằm trong danh sách QC.');
                                        return;
                                    }
                                    // proceed to add
                                    let currentItems = [];
                                    try { currentItems = JSON.parse(quote.items || '[]'); } catch (e) { currentItems = []; }
                                    currentItems.push({ code: null, name: val, isCancelled: false });
                                    quote.items = JSON.stringify(currentItems);

                                    // Mark QCAG status as needing quote update (overlay) until quote is updated
                                    quote.__updatedSinceQc = true;
                                    quote.__itemsChanged = true;

                                    // Ghi chú theo yêu cầu khi thêm hạng mục
                                    addPlainNoteForQuote(acceptanceDetailState.quoteKey || quote, `Khi thi công đã phát sinh thêm hạng mục ${val}`);
                                    // add note
                                    let notes = [];
                                    try { notes = JSON.parse(quote.added_items_notes || '[]') || []; } catch (e) { notes = []; }
                                    notes.push(val);
                                    quote.added_items_notes = JSON.stringify(notes);
                                    // persist
                                    const found = findQuoteInProductionOrders(acceptanceDetailState.quoteKey);
                                    if (found) {
                                        const { order, orderIndex, quoteIndex } = found;
                                        let quotes = [];
                                        try { quotes = JSON.parse(order.items || '[]'); } catch (e) { quotes = []; }
                                        if (Array.isArray(quotes) && quotes[quoteIndex]) {
                                            quotes[quoteIndex].items = JSON.stringify(currentItems);
                                            quotes[quoteIndex].added_items_notes = JSON.stringify(notes);
                                            quotes[quoteIndex].__updatedSinceQc = true;
                                            quotes[quoteIndex].__itemsChanged = true;
                                            const updatedOrder = {...order, items: JSON.stringify(quotes) };
                                            productionOrders[orderIndex] = updatedOrder;
                                            if (window.dataSdk && typeof window.dataSdk.update === 'function') {
                                                window.dataSdk.update(updatedOrder).catch(() => {});
                                            }
                                        }
                                    }

                                    // Also update the master quote record so the main list QCAG column updates immediately
                                    try {
                                        const master = findQuoteByKey(acceptanceDetailState.quoteKey);
                                        if (master) {
                                            master.__updatedSinceQc = true;
                                            master.__itemsChanged = true;
                                            master.added_items_notes = JSON.stringify(notes);
                                            if (window.dataSdk && typeof window.dataSdk.update === 'function') {
                                                window.dataSdk.update(master).catch(() => {});
                                            }
                                        }
                                    } catch (e) {}
                                    closeModal();
                                    // re-render modal
                                    renderAcceptanceDetailModal();
                                    try { updateMainList(); } catch (e) {}
                                };
                                confirmBtn.addEventListener('click', onConfirm);
                                input.addEventListener('keydown', (e) => { if (e.key === 'Enter') onConfirm(); if (e.key === 'Escape') closeModal(); });
                            });
                        }

                        // Render added-item notes under the table
                        const notesEl = right.querySelector('#acceptance-detail-notes');
                        if (notesEl) {
                            let notes = [];
                            try { notes = JSON.parse(quote.added_items_notes || '[]') || []; } catch (e) { notes = []; }
                            notesEl.innerHTML = '';
                            notes.forEach(n => {
                                const d = document.createElement('div');
                                d.className = 'mb-1';
                                d.textContent = `Bổ sung hạng mục: ${n}`;
                                notesEl.appendChild(d);
                            });
                        }

                    } else {
                        right.innerHTML = '<div class="text-sm text-gray-500">Không có thông tin báo giá.</div>';
                    }
                }



                function handlePasteOrUploadImageToQuote(quoteRef, file) {
                    try {
                        if (!file || !file.type || !file.type.startsWith('image/')) return;
                    let quoteKey = resolveQuoteKey(quoteRef);
                        if (!quoteKey) return;
                        // Compress / resize client-side before uploading to reduce upload time
                        compressImageFile(file, 1600, 0.8).then((dataUrl) => {
                            try { addImageToQuote(quoteKey, dataUrl, file.name || 'upload'); } catch (e) {}
                        }).catch(() => {
                            // fallback to raw dataURL if compression fails
                            const reader = new FileReader();
                            reader.onload = function(ev) {
                                try { addImageToQuote(quoteKey, ev.target.result, file.name || 'upload'); } catch (e) {}
                            };
                            reader.readAsDataURL(file);
                        });
                    } catch (e) {
                        // ignore
                    }
                }

                // Compress an image File to a dataURL (WebP or JPEG) with max width and quality.
                function compressImageFile(file, maxWidth, quality) {
                    return new Promise((resolve, reject) => {
                        try {
                            const url = URL.createObjectURL(file);
                            const img = new Image();
                            img.onload = () => {
                                try {
                                    const ratio = img.width > maxWidth ? (maxWidth / img.width) : 1;
                                    const canvas = document.createElement('canvas');
                                    canvas.width = Math.round(img.width * ratio);
                                    canvas.height = Math.round(img.height * ratio);
                                    const ctx = canvas.getContext('2d');
                                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                                    // Prefer WebP if supported
                                    let mime = 'image/webp';
                                    let dataUrl = '';
                                    try {
                                        dataUrl = canvas.toDataURL(mime, quality);
                                        // some browsers may silently fall back to PNG if webp not supported
                                        if (!dataUrl || dataUrl.indexOf('data:image/webp') !== 0) throw new Error('webp not supported');
                                    } catch (e) {
                                        mime = 'image/jpeg';
                                        dataUrl = canvas.toDataURL(mime, quality);
                                    }
                                    URL.revokeObjectURL(url);
                                    resolve(dataUrl);
                                } catch (err) {
                                    URL.revokeObjectURL(url);
                                    reject(err);
                                }
                            };
                            img.onerror = (err) => {
                                URL.revokeObjectURL(url);
                                reject(err);
                            };
                            img.src = url;
                        } catch (err) { reject(err); }
                    });
                }

                async function addImageToQuote(quoteKey, dataUrl, name) {
                  const resolvedKey = resolveQuoteKey(quoteKey);
                  if (!resolvedKey) return;

                  let baseQuote = null;
                  let imgs = [];
                  const found = findQuoteInProductionOrders(resolvedKey);
                  if (found && found.order) {
                    if (found.quote) baseQuote = found.quote;
                    if (!baseQuote) {
                      let quotes = [];
                      try { quotes = JSON.parse(found.order.items || '[]'); } catch (e) { quotes = []; }
                      const idx = findQuoteIndexByKeyInList(quotes, resolvedKey);
                      if (idx >= 0) baseQuote = quotes[idx];
                    }
                  }
                  if (!baseQuote && typeof findQuoteByKey === 'function') {
                    baseQuote = findQuoteByKey(resolvedKey);
                  }
                  if (!baseQuote && acceptanceDetailState && resolveQuoteKey(acceptanceDetailState.quoteKey) === resolvedKey) {
                    baseQuote = acceptanceDetailState.quoteRef;
                  }
                  try { imgs = JSON.parse((baseQuote && baseQuote.images) || '[]') || []; } catch (e) { imgs = []; }

                  const entryName = name || ('img_' + (imgs.length + 1));
                  const entry = { data: dataUrl, name: entryName };
                  imgs.push(entry);

                  await saveQuoteImages(resolvedKey, imgs, { render: true });

                  // Upload to Cloud Storage via backend into maquette/ folder with quoteKey.
                  // This keeps maquette uploads separate from historical quote-images/ and acceptance-images/.
                  // Keep UX identical: preview immediately, then swap to URL when upload finishes.
                  try {
                    const url = await qcagUploadImageDataUrl(dataUrl, entryName, {
                      folder: 'maquette',
                      quoteKey: String(resolvedKey)
                    });
                    if (url) {
                      entry.data = url;
                      await saveQuoteImages(resolvedKey, imgs, { render: true });
                    }
                  } catch (e) {}
                }

                function persistQuoteSequence(value) {
                    quoteSequenceCounter = value;
                    if (typeof window === 'undefined') return;
                    window.__quoteSequenceFallback = value;
                    try {
                        if (window.localStorage) {
                            window.localStorage.setItem(QUOTE_SEQUENCE_STORAGE_KEY, String(value));
                        }
                    } catch (err) {
                        console.warn('Không thể lưu bộ đếm mã báo giá:', err);
                    }
                }

                function getNextQuoteSequence() {
                    const next = (quoteSequenceCounter || 0) + 1;
                    persistQuoteSequence(next);
                    return next;
                }

                function formatQuoteCodeFromSequence(seq, year = new Date().getFullYear()) {
                    const yy = String(year % 100).padStart(2, '0');
                    const padded = String(seq).padStart(5, '0');
                    return `${yy}${padded}`;
                }

                function extractSequenceFromQuoteCode(code) {
                    if (!code) return null;
                    const match = String(code).match(/(\d{5})$/);
                    if (!match) return null;
                    const value = parseInt(match[1], 10);
                    return Number.isFinite(value) ? value : null;
                }

                function generateQuoteCode() {
                    const next = getNextQuoteSequence();
                    if (next > 99999) {
                        throw new Error('Đã vượt quá giới hạn mã báo giá (99999)');
                    }
                    return formatQuoteCodeFromSequence(next);
                }

                function loadQuoteCodeCache() {
                    if (typeof window === 'undefined') {
                        return {};
                    }
                    try {
                        const raw = window.localStorage ? window.localStorage.getItem(QUOTE_CODE_CACHE_KEY) : null;
                        if (!raw) return {};
                        const parsed = JSON.parse(raw);
                        if (parsed && typeof parsed === 'object') {
                            window.__quoteCodeCacheFallback = parsed;
                            return parsed;
                        }
                    } catch (err) {
                        console.warn('Không thể đọc cache mã báo giá:', err);
                    }
                    return window.__quoteCodeCacheFallback || {};
                }

                function persistQuoteCodeCache() {
                    if (typeof window === 'undefined') return;
                    try {
                        if (window.localStorage) {
                            window.localStorage.setItem(QUOTE_CODE_CACHE_KEY, JSON.stringify(quoteCodeCache));
                        }
                        window.__quoteCodeCacheFallback = quoteCodeCache;
                    } catch (err) {
                        console.warn('Không thể lưu cache mã báo giá:', err);
                    }
                }

                function getQuoteIdentityKey(quote) {
                    if (!quote) return '';
                    return quote.__backendId || quote.id || `${quote.outlet_code || 'OUT'}-${quote.created_at || 'NODATE'}`;
                }

                function cacheQuoteCode(identityKey, code) {
                    if (!identityKey || !code) return;
                    if (quoteCodeCache[identityKey] === code) return;
                    quoteCodeCache[identityKey] = code;
                    persistQuoteCodeCache();
                }

                function syncSequenceFromQuoteCode(code) {
                    const seq = extractSequenceFromQuoteCode(code);
                    if (seq && seq > (quoteSequenceCounter || 0)) {
                        persistQuoteSequence(seq);
                    }
                }

                function ensureQuoteCodeForQuote(quote, { assignIfMissing = true } = {}) {
                    if (!quote) return false;
                    if (quote.quote_code) {
                        cacheQuoteCode(getQuoteIdentityKey(quote), quote.quote_code);
                        syncSequenceFromQuoteCode(quote.quote_code);
                        return false;
                    }
                    if (!assignIfMissing) return false;
                    const key = getQuoteIdentityKey(quote);
                    const cached = quoteCodeCache[key];
                    if (cached) {
                        quote.quote_code = cached;
                        syncSequenceFromQuoteCode(cached);
                        return false;
                    }
                    const code = generateQuoteCode();
                    quote.quote_code = code;
                    cacheQuoteCode(key, code);
                    return true;
                }

                function ensureQuoteCodes(quotes) {
                    if (!Array.isArray(quotes) || !quotes.length) return;
                    quotes.forEach(quote => {
                        if (quote && quote.quote_code) {
                            cacheQuoteCode(getQuoteIdentityKey(quote), quote.quote_code);
                            syncSequenceFromQuoteCode(quote.quote_code);
                        }
                    });
                }

                async function persistQuoteCodeAssignments(quotes) {
                    for (const quote of quotes) {
                        try {
                            await window.dataSdk.update(quote);
                        } catch (err) {
                            console.warn('Không thể đồng bộ mã báo giá', quote.__backendId || quote.id, err);
                        }
                    }
                }

                // Ensure body scroll is locked if any main modal is visible
                function ensureScrollLock() {
                    try {
                        const anyOpen = Array.from(document.querySelectorAll('.modal-backdrop'))
                            .some(m => !m.classList.contains('hidden'));
                        if (anyOpen) {
                            document.documentElement.classList.add('no-scroll');
                            document.body.classList.add('no-scroll');
                        } else {
                            document.documentElement.classList.remove('no-scroll');
                            document.body.classList.remove('no-scroll');
                        }
                    } catch (e) { /* silent */ }
                }

                function _appendCacheBust(url, token) {
                    try {
                        const raw = String(url || '');
                        if (!raw) return raw;
                        if (raw.startsWith('data:') || raw.startsWith('blob:')) return raw;
                        const parts = raw.split('#');
                        const base = parts[0];
                        const hash = parts.length > 1 ? ('#' + parts.slice(1).join('#')) : '';
                        const sep = base.includes('?') ? '&' : '?';
                        return base + sep + 'v=' + encodeURIComponent(String(token || Date.now())) + hash;
                    } catch (_) {
                        return url;
                    }
                }

                function ensureModalHasCloseX(modalEl) {
                    try {
                        if (!modalEl || modalEl.nodeType !== 1) return;
                        if (modalEl.__hasCloseX) return;
                        // Only target modal-like containers
                        const id = String(modalEl.id || '');
                        const isModalLike = modalEl.classList.contains('modal-backdrop') || (id && id.endsWith('-modal')) || modalEl.getAttribute('role') === 'dialog';
                        if (!isModalLike) return;

                        const listCloseXButtons = () => {
                            try {
                                return Array.from(modalEl.querySelectorAll('button'))
                                    .filter(b => ((b.textContent || '').trim() === '×'));
                            } catch (_) {
                                return [];
                            }
                        };

                        const dedupeCloseXButtons = () => {
                            try {
                                const btns = listCloseXButtons();
                                if (!btns || btns.length <= 1) return;
                                // Prefer keeping a non-injected close button if available
                                const nonInjected = btns.filter(b => !b.hasAttribute('data-modal-close-x'));
                                const keep = (nonInjected && nonInjected.length) ? nonInjected[0] : btns[0];
                                // Remove others; remove injected first
                                const toRemove = btns.filter(b => b !== keep);
                                toRemove.sort((a, b) => {
                                    const ai = a.hasAttribute('data-modal-close-x') ? 0 : 1;
                                    const bi = b.hasAttribute('data-modal-close-x') ? 0 : 1;
                                    return ai - bi;
                                });
                                toRemove.forEach(b => { try { b.remove(); } catch (_) {} });
                            } catch (e) { /* ignore */ }
                        };

                        // If duplicated already (likely from auto-inject + existing), clean up first.
                        dedupeCloseXButtons();

                        // If modal already has a close "×" button (non-injected), do not add another.
                        const hasNativeCloseX = listCloseXButtons().some(b => !b.hasAttribute('data-modal-close-x'));
                        if (hasNativeCloseX) {
                            modalEl.__hasCloseX = true;
                            return;
                        }

                        // If already has an explicit close X in markup, don't add another
                        if (modalEl.querySelector('[data-modal-close-x], #close-modal, #close-preview-modal, #close-quote-images-modal, #close-qc-signage-modal')) {
                            modalEl.__hasCloseX = true;
                            return;
                        }
                        if (modalEl.querySelector('button[aria-label="Đóng"], button[aria-label="Close"], button[aria-label="close"], button[aria-label="Đóng modal"], button.modal-close-x')) {
                            modalEl.__hasCloseX = true;
                            return;
                        }

                        // Find the modal panel
                        const panel = modalEl.querySelector('.modal-content, .bg-white') || modalEl.firstElementChild;
                        if (!panel) return;
                        // Ensure panel can host an absolute-positioned button
                        const pos = window.getComputedStyle(panel).position;
                        if (pos === 'static' || !pos) {
                            panel.style.position = 'relative';
                        }

                        const btn = document.createElement('button');
                        btn.type = 'button';
                        btn.className = 'modal-close-x absolute top-3 right-3 w-9 h-9 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 text-2xl leading-none';
                        btn.setAttribute('aria-label', 'Đóng');
                        btn.setAttribute('data-modal-close-x', '1');
                        btn.textContent = '×';

                        btn.addEventListener('click', (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            // Prefer cancel/close buttons if present so we preserve any custom cleanup.
                            const preferred =
                                modalEl.querySelector('button[id*="cancel" i], button[id*="close" i], button[id*="dismiss" i], button[data-modal-close]') ||
                                Array.from(modalEl.querySelectorAll('button')).find(b => {
                                    const t = (b.textContent || '').trim().toLowerCase();
                                    return t === 'hủy' || t === 'đóng' || t === 'ok';
                                });
                            if (preferred && preferred !== btn) {
                                try { preferred.click(); } catch (_) { /* ignore */ }
                            } else {
                                try { modalEl.classList.add('hidden'); } catch (_) { /* ignore */ }
                                try { ensureScrollLock(); } catch (_) { /* ignore */ }
                            }
                        });

                        panel.appendChild(btn);
                        modalEl.__hasCloseX = true;

                        // Final guard: ensure we still only have one X
                        dedupeCloseXButtons();
                    } catch (e) { /* ignore */ }
                }

                function ensureAllModalsHaveCloseX() {
                    try {
                        const modals = Array.from(document.querySelectorAll('.modal-backdrop, [id$="-modal"], [role="dialog"]'));
                        modals.forEach(ensureModalHasCloseX);
                    } catch (e) { /* ignore */ }
                }

                function installModalCloseXObserverOnce() {
                    try {
                        if (window.__qcagCloseXObserverInstalled) return;
                        window.__qcagCloseXObserverInstalled = true;
                        const observer = new MutationObserver((mutations) => {
                            for (const m of mutations) {
                                for (const node of Array.from(m.addedNodes || [])) {
                                    if (!node || node.nodeType !== 1) continue;
                                    if (node.classList && (node.classList.contains('modal-backdrop') || (node.id && String(node.id).endsWith('-modal')))) {
                                        ensureModalHasCloseX(node);
                                    }
                                    try {
                                        const inner = node.querySelectorAll ? node.querySelectorAll('.modal-backdrop, [id$="-modal"], [role="dialog"]') : [];
                                        if (inner && inner.length) inner.forEach(ensureModalHasCloseX);
                                    } catch (_) { /* ignore */ }
                                }
                            }
                        });
                        observer.observe(document.body, { childList: true, subtree: true });
                        // Also run once for any existing modals
                        ensureAllModalsHaveCloseX();
                    } catch (e) { /* ignore */ }
                }

                const canonicalBrandOrder = ['heineken', 'tiger', 'larue', 'bia viet', 'bivina', 'bivina export', 'strongbow'];
                const canonicalBrandMap = {
                    'heineken': 'Heineken',
                    'tiger': 'Tiger',
                    'larue': 'Larue',
                    'bia viet': 'Bia Việt',
                    'bia việt': 'Bia Việt',
                    'bia viet ': 'Bia Việt',
                    'bivina': 'Bivina',
                    'bivina export': 'Bivina Export',
                    'strongbow': 'StrongBow',
                    'strong bow': 'StrongBow'
                };

                const normalizeBrandLabel = (value = '') => {
                    if (!value) return '';
                    const key = value.toLowerCase().trim();
                    return canonicalBrandMap[key] || value;
                };

                const resolveBrandList = () => canonicalBrandOrder.map(lower => canonicalBrandMap[lower] || lower);

                const setShopnameBrand = (select) => {
                    if (!select) return;
                    select.innerHTML = '<option value="Shopname">Shopname</option>';
                    select.value = 'Shopname';
                    select.disabled = true;
                    select.style.backgroundColor = '#f9fafb';
                    select.dataset.activeBrands = 'Shopname';
                };

                const brands = resolveBrandList();

                const defaultBrandSelectOptions = `<option value="" disabled selected>Chọn Brand</option>${brands.map(b => `<option value="${b}">${b}</option>`).join('')}`;

        const catalogItems = [
          { code: '1.1', name: 'Hộp đèn hiflex 1 mặt', brand: 'Bivina', unit: 'm²', price: 1086000 },
          { code: '1.1', name: 'Hộp đèn hiflex 1 mặt', brand: 'Tiger', unit: 'm²', price: 1086000 },
          { code: '1.2', name: 'Hộp đèn hiflex 2 mặt', brand: 'Bivina', unit: 'm²', price: 1349000 },
          { code: '1.2', name: 'Hộp đèn hiflex 2 mặt', brand: 'Tiger', unit: 'm²', price: 1349000 },
          { code: '1.3', name: 'Hộp đèn hiflex 1 mặt (shopname)', brand: 'Shopname', unit: 'm²', price: 909000 },
          { code: '1.4', name: 'Hộp đèn hiflex 2 mặt (shopname)', brand: 'Shopname', unit: 'm²', price: 1255000 },
          { code: '2.1', name: 'Bảng hiệu hiflex 1 mặt', brand: 'Bivina', unit: 'm²', price: 307000 },
          { code: '2.1', name: 'Bảng hiệu hiflex 1 mặt', brand: 'Tiger', unit: 'm²', price: 307000 },
          { code: '2.1', name: 'Bảng hiệu giả hộp hiflex 1 mặt (2 bảng)', brand: 'Bivina', unit: 'm²', price: 307000 },
          { code: '2.1', name: 'Bảng hiệu giả hộp hiflex 1 mặt (2 bảng)', brand: 'Tiger', unit: 'm²', price: 307000 },
          { code: '2.2', name: 'Bảng hiệu hiflex 2 mặt', brand: 'Bivina', unit: 'm²', price: 379000 },
          { code: '3.3', name: 'Đèn chiếu sáng bảng tôn', brand: '', unit: 'bộ', price: 207000 },
          { code: '8.1', name: 'Trụ phi 74', brand: '', unit: 'm', price: 132000 },
          { code: '8.2', name: 'Trụ phi 90', brand: '', unit: 'm', price: 167000 },
          { code: 'S8.3', name: 'Trụ phi 114', brand: '', unit: 'm', price: 185000 },
          { code: 'S8.4', name: 'Sắt chữ V', brand: '', unit: 'm', price: 39000 },
          { code: 'S8.5', name: 'Chân sắt cho hộp đèn di động', brand: '', unit: 'cái', price: 276000 },
          { code: '9.1', name: 'Đèn huỳnh quang', brand: '', unit: 'bộ', price: 117000 },
          { code: '9.2', name: 'Thay bạt bảng hiệu hiflex 1 mặt (in 1 mặt)', brand: 'Bivina', unit: 'm²', price: 229000 },
          { code: '9.2', name: 'Thay bạt bảng hiệu hiflex 2 mặt (in 1 mặt)', brand: 'Bivina', unit: 'm²', price: 229000 },
          { code: '9.2', name: 'Thay bạt hộp đèn hiflex 1 mặt (in 1 mặt)', brand: 'Shopname', unit: 'm²', price: 229000 },
          { code: '9.3', name: 'Thay bạt hộp đèn hiflex 1 mặt (in 2 mặt)', brand: 'Bivina', unit: 'm²', price: 317000 },
          { code: '9.3', name: 'Thay bạt hộp đèn hiflex 2 mặt (in 2 mặt)', brand: 'Bivina', unit: 'm²', price: 317000 },
          { code: '9.3', name: 'Thay bạt hộp đèn hiflex 2 mặt (in 2 mặt)', brand: 'Tiger', unit: 'm²', price: 317000 },
          { code: 'S9.5', name: 'Decal', brand: '', unit: 'm²', price: 173000 },
          { code: 'S9.6', name: 'Mica', brand: '', unit: 'm²', price: 526000 },
          { code: 'S9.17', name: 'Tôn trắng kẽm dày 0.3mm', brand: '', unit: 'm²', price: 98000 },
          { code: 'S9.20', name: 'Dây điện', brand: '', unit: 'm', price: 15000 },
          { code: 'S9.21', name: 'Cầu dao (CB)', brand: '', unit: 'cái', price: 55000 },
          { code: 'L1', name: 'Giấy phép mới/gia hạn', brand: '', unit: 'điểm', price: 250000 },
          { code: 'N6', name: 'Sắt chữ L gia cố biển', brand: '', unit: 'm', price: 35000 },
          { code: 'N7', name: 'Bảng rôn', brand: '', unit: 'm²', price: 50000 },
          { code: 'N8', name: 'Bảng rôn - Phụ kiện', brand: '', unit: 'bộ', price: 33000 },
          { code: 'N31', name: 'Inox 304', brand: '', unit: 'kg', price: 195000 },
          { code: 'N32', name: 'Thép hộp tráng kẽm 20x40', brand: '', unit: 'm', price: 39000 },
          { code: 'N36', name: 'Nguồn đèn led 12V30A', brand: '', unit: 'cái', price: 520000 },
          { code: 'Add on 1', name: 'Đèn pha 50W', brand: '', unit: 'cái', price: 810000 },
          { code: 'Add on 2', name: 'Led neon 12V, 2835, IP68, ánh sáng trắng/xanh/vàng/cam', brand: '', unit: 'm', price: 110000 },
          { code: 'Add on 3', name: 'Led thanh Samsung', brand: '', unit: 'm²', price: 525000 },
          { code: 'LG1', name: 'Logo indoor', brand: '', unit: 'bộ', price: 0 },
          { code: 'LG2', name: 'Logo Outdoor', brand: '', unit: 'bộ', price: 0 }
        ];

        const catalogItemsToExcelRecords = (items = []) => items.map(item => ({
          code: item.code,
          content: `${item.name}${item.brand ? ' ' + item.brand : ''}`.trim(),
          price: item.price,
          unit: item.unit
        }));

        excelData = catalogItemsToExcelRecords(catalogItems);

        const normalizeContentLabel = (value = '') => value.toLowerCase().replace(/\s+/g, ' ').trim();

        const catalogByNameKey = (() => {
          const map = new Map();
          catalogItems.forEach(item => {
            const key = normalizeContentLabel(item.name);
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(item);
          });
          return map;
        })();

        const catalogByCode = (() => {
          const map = new Map();
          catalogItems.forEach(item => {
            const key = String(item.code).trim();
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(item);
          });
          return map;
        })();

        function getCatalogEntriesByName(name = '') {
          return catalogByNameKey.get(normalizeContentLabel(name)) || [];
        }

        function getCatalogEntriesByNameKey(key = '') {
          return catalogByNameKey.get(key) || [];
        }

        function getCatalogEntriesByCode(code = '') {
          return catalogByCode.get(String(code).trim()) || [];
        }

        function pickCatalogEntry(entries = [], preferredBrand = '') {
          if (!entries.length) return null;
          if (preferredBrand) {
            const normalized = normalizeBrandLabel(preferredBrand).toLowerCase();
            const matched = entries.find(entry => normalizeBrandLabel(entry.brand || '').toLowerCase() === normalized);
            if (matched) return matched;
          }
          return entries[0];
        }

        function resetBrandSelectElement(select, { keepEnabled = false, lockedValue = null } = {}) {
          if (!select) return;
          if (lockedValue && lockedValue.toLowerCase() === 'shopname') {
            setShopnameBrand(select);
            return;
          }
          select.innerHTML = defaultBrandSelectOptions;
          select.value = '';
          select.disabled = !keepEnabled;
          select.style.backgroundColor = keepEnabled ? '#ffffff' : '#f9fafb';
          delete select.dataset.activeBrands;
        }

        function applyBrandOptionsToSelect(select, entries = [], preferredBrand = '') {
          if (!select || !entries.length) return null;
          const normalizedPreferred = normalizeBrandLabel(preferredBrand || '').toLowerCase();
          if (normalizedPreferred) {
            const matched = entries.find(entry => normalizeBrandLabel(entry.brand || '').toLowerCase() === normalizedPreferred);
            if (matched) return matched.brand;
          }
          const currentValue = normalizeBrandLabel(select.value || '').toLowerCase();
          if (currentValue) {
            const matched = entries.find(entry => normalizeBrandLabel(entry.brand || '').toLowerCase() === currentValue);
            if (matched) return matched.brand;
          }
          return entries[0]?.brand || null;
        }

        const signagePriorityKeywords = ['bảng hiệu', 'hộp đèn'];
        const getContentPriorityScore = (label = '') => {
          const normalized = label.toLowerCase();
          return signagePriorityKeywords.some(keyword => normalized.includes(keyword)) ? 0 : 1;
        };

        function syncItemContentOptions() {
          const listEl = document.getElementById('item-content-options');
          if (!listEl) return [];
          const optionValues = Array.from(new Set(catalogItems.map(item => item.name))).sort((a, b) => {
            const diff = getContentPriorityScore(a) - getContentPriorityScore(b);
            if (diff !== 0) return diff;
            return a.localeCompare(b, 'vi', { sensitivity: 'base' });
          });
          listEl.innerHTML = optionValues.map(value => `<option value="${value}"></option>`).join('');
          return optionValues;
        }

        let itemContentOptionValues = syncItemContentOptions();

        const NO_OUTLET_CODE_LABEL = 'Chưa có code';

        function normalizeOutletCode(raw) {
          const str = (raw || '').toString().trim();
          return /^[0-9]{8}$/.test(str) ? str : NO_OUTLET_CODE_LABEL;
        }

        function setOutletCodePlaceholder() {
          const input = document.getElementById('outlet-code');
          if (!input) return;
          input.value = NO_OUTLET_CODE_LABEL;
          try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
          input.focus();
        }
        window.setOutletCodePlaceholder = setOutletCodePlaceholder;
