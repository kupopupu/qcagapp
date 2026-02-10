                // Local/offline fallback: provide dataSdk backed by localStorage when SDK is missing.
                // This enables running the app directly (no backend) while preserving create/update/delete behavior.
                (function ensureLocalDataSdk() {
                    try {
                        if (window.dataSdk && typeof window.dataSdk.init === 'function') return;

                        // IMPORTANT: In production (multi-user), do not silently fall back to localStorage.
                        // Only allow local fallback when explicitly in local mode or running from file://.
                        const isFileProtocol = (typeof location !== 'undefined' && location && location.protocol === 'file:');
                        if (!isFileProtocol && !window.QCAG_LOCAL_MODE) return;

                        const STORAGE_KEY = 'qcag_local_datasdk_items_v1';
                        let handler = null;

                        const safeParse = (raw, fallback) => {
                            try {
                                const parsed = JSON.parse(raw);
                                return parsed == null ? fallback : parsed;
                            } catch (_) {
                                return fallback;
                            }
                        };

                        const loadAll = () => {
                            const raw = localStorage.getItem(STORAGE_KEY);
                            const arr = safeParse(raw, []);
                            return Array.isArray(arr) ? arr : [];
                        };

                        const saveAll = (items) => {
                            try {
                                localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.isArray(items) ? items : []));
                                return true;
                            } catch (e) {
                                console.warn('localStorage full / blocked:', e);
                                return false;
                            }
                        };

                        const notify = (items) => {
                            try {
                                if (handler && typeof handler.onDataChanged === 'function') {
                                    handler.onDataChanged(Array.isArray(items) ? items : []);
                                }
                            } catch (e) {
                                console.warn('dataHandler.onDataChanged error:', e);
                            }
                        };

                        const ensureId = (obj) => {
                            if (!obj || typeof obj !== 'object') return obj;
                            if (!obj.__backendId) {
                                obj.__backendId = `local_${Date.now()}_${Math.random().toString(16).slice(2)}`;
                            }
                            return obj;
                        };

                        const findIndexById = (items, obj) => {
                            const backendId = obj && obj.__backendId ? String(obj.__backendId) : '';
                            if (backendId) {
                                return items.findIndex(it => it && String(it.__backendId || '') === backendId);
                            }
                            const id = obj && obj.id ? String(obj.id) : '';
                            if (id) {
                                return items.findIndex(it => it && String(it.id || '') === id);
                            }
                            return -1;
                        };

                        window.dataSdk = {
                            init: async(h) => {
                                handler = h || null;
                                const items = loadAll();
                                notify(items);
                                return { isOk: true, local: true };
                            },
                            create: async(obj) => {
                                const items = loadAll();
                                if (!obj || typeof obj !== 'object') {
                                    return { isOk: false, error: new Error('Invalid create payload') };
                                }
                                ensureId(obj); // mutate input so caller also receives __backendId
                                const idx = findIndexById(items, obj);
                                const clone = {...obj };
                                if (idx >= 0) items[idx] = {...items[idx], ...clone };
                                else items.push(clone);
                                const ok = saveAll(items);
                                notify(items);
                                return { isOk: ok, local: true, data: clone };
                            },
                            update: async(obj) => {
                                const items = loadAll();
                                if (!obj || typeof obj !== 'object') {
                                    return { isOk: false, error: new Error('Invalid update payload') };
                                }
                                ensureId(obj); // mutate input so it becomes addressable
                                const idx = findIndexById(items, obj);
                                const clone = {...obj };
                                if (idx >= 0) items[idx] = {...items[idx], ...clone };
                                else items.push(clone);
                                const ok = saveAll(items);
                                notify(items);
                                return { isOk: ok, local: true, data: clone };
                            },
                            delete: async(obj) => {
                                const items = loadAll();
                                const idx = findIndexById(items, obj || {});
                                if (idx >= 0) items.splice(idx, 1);
                                const ok = saveAll(items);
                                notify(items);
                                return { isOk: ok, local: true };
                            },
                            list: async() => {
                                const items = loadAll();
                                return { isOk: true, local: true, data: items };
                            }
                        };
                    } catch (e) {
                        console.warn('Failed to init local dataSdk fallback:', e);
                    }
                })();

                // ------- Offline (TEST) mode: allow toggling a local-only mode which prevents any writes to backend -------
                (function(){
                  // Global click debounce to prevent duplicate rapid requests (double-clicks)
                  try {
                    (function(){
                      const clickLock = new WeakMap();
                      const DEBOUNCE_MS = 300; // Reduced from 700ms for faster interaction
                      document.addEventListener('click', function(e){
                        try {
                          const btn = e.target.closest && e.target.closest('button, a, [data-action], input[type="button"], input[type="submit"]');
                          if (!btn) return;
                          // allow opt-out
                          if (btn.dataset && (btn.dataset.allowMultiple === '1' || btn.dataset.allowMultiple === 'true')) return;
                          const last = clickLock.get(btn) || 0;
                          const now = Date.now();
                          if (now - last < DEBOUNCE_MS) {
                            e.stopImmediatePropagation();
                            e.preventDefault();
                            return;
                          }
                          clickLock.set(btn, now);
                        } catch (_) {}
                      }, true);
                    })();
                  } catch (e) {}
                  const OFFLINE_KEY = 'qcag_offline_mode';
                  function _setBanner(on){
                    try {
                      const b = document.getElementById('offline-banner');
                      const btn = document.getElementById('offline-toggle-btn') || document.getElementById('toggle-test-mode-btn');
                      if (b) b.classList.toggle('hidden', !on);
                      if (btn) {
                        btn.classList.toggle('bg-red-500', on);
                        btn.classList.toggle('text-white', on);
                        btn.classList.toggle('bg-gray-100', !on);
                        btn.textContent = on ? 'TEST: ON' : 'TEST: OFF';
                      }
                    } catch(e){}
                  }
                  function enableOffline(){
                    try {
                      if (!window._origDataSdk) window._origDataSdk = window.dataSdk;
                      const stub = {
                        init: async (h) => { try { if (h && typeof h.onDataChanged === 'function') h.onDataChanged([]); } catch(e){} return { isOk: true }; },
                        list: function(){ return Promise.resolve({ isOk: true, data: [] }); },
                        get: function(){ return Promise.resolve({ isOk: true, data: null }); },
                        create: function(data){ window.__qcagOfflineLog = window.__qcagOfflineLog || []; window.__qcagOfflineLog.push({op:'create', at: new Date().toISOString(), data}); console.log('OFFLINE create (logged):', data); return Promise.resolve({ isOk: true, data }); },
                        update: function(data){ window.__qcagOfflineLog = window.__qcagOfflineLog || []; window.__qcagOfflineLog.push({op:'update', at: new Date().toISOString(), data}); console.log('OFFLINE update (logged):', data); return Promise.resolve({ isOk: true, data }); },
                        remove: function(id){ window.__qcagOfflineLog = window.__qcagOfflineLog || []; window.__qcagOfflineLog.push({op:'remove', at: new Date().toISOString(), id}); console.log('OFFLINE remove (logged):', id); return Promise.resolve({ isOk: true }); }
                      };
                      window.dataSdk = stub;
                      localStorage.setItem(OFFLINE_KEY, '1');
                      _setBanner(true);
                      showToast && showToast('Chế độ TEST đã bật — các ghi chép sẽ không được gửi lên backend.');
                    } catch(e){ console.warn('enableOffline failed', e); }
                  }
                  function disableOffline(){
                    try {
                      if (window._origDataSdk) { window.dataSdk = window._origDataSdk; window._origDataSdk = null; }
                      localStorage.removeItem(OFFLINE_KEY);
                      _setBanner(false);
                      showToast && showToast('Chế độ TEST đã tắt — kết nối backend được khôi phục.');
                    } catch(e){ console.warn('disableOffline failed', e); }
                  }
                  function initOfflineToggle(){
                    try {
                      // Support both the legacy id and an alternate id used in some HTML
                      const btn = document.getElementById('offline-toggle-btn') || document.getElementById('toggle-test-mode-btn');
                      if (!btn) {
                        // no visible toggle in DOM; nothing to bind but still set banner state
                        const startOnFallback = !!localStorage.getItem(OFFLINE_KEY);
                        _setBanner(startOnFallback);
                        return;
                      }
                      btn.addEventListener('click', function(){ const isOn = !!localStorage.getItem(OFFLINE_KEY); if (isOn) disableOffline(); else enableOffline(); });
                      const startOn = !!localStorage.getItem(OFFLINE_KEY);
                      if (startOn) enableOffline(); else _setBanner(false);
                    } catch(e){}
                  }
                  try {
                    // Expose control APIs for external bindings / legacy HTML
                    window.qcagEnableOffline = enableOffline;
                    window.qcagDisableOffline = disableOffline;
                    window.qcagIsOffline = function() { try { return !!localStorage.getItem(OFFLINE_KEY); } catch (e) { return false; } };
                    window.qcagToggleOffline = function() { try { if (window.qcagIsOffline()) disableOffline(); else enableOffline(); } catch (e) {} };
                  } catch (e) {}
                  document.addEventListener('DOMContentLoaded', initOfflineToggle);
                })();

                function qcagGetApiBaseUrl() {
                    try {
                        const raw = (window && window.API_BASE_URL) ? String(window.API_BASE_URL) : '';
                        return raw.replace(/\/+$/, '');
                    } catch (e) {
                        return '';
                    }
                }

                function qcagShouldUseBackend() {
                    try {
                        if (window.QCAG_LOCAL_MODE) return false;
                        const base = qcagGetApiBaseUrl();
                        if (!base) return false;
                        return true;
                    } catch (e) {
                        return false;
                    }
                }

                async function qcagUploadImageDataUrl(dataUrl, filename, options) {
                    if (!qcagShouldUseBackend()) return null;
                    const base = qcagGetApiBaseUrl();
                    if (!base) return null;
                    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return null;
                    try {
                    const opts = (options && typeof options === 'object') ? options : {};
                        const res = await fetch(base + '/images/upload', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        dataUrl: dataUrl,
                        filename: filename || '',
                        folder: opts.folder || undefined,
                        quoteKey: opts.quoteKey || undefined,
                        orderKey: opts.orderKey || undefined
                      })
                        });
                        const json = await res.json().catch(() => null);
                        if (!res.ok) return null;
                        if (!json || !json.ok || !json.url) return null;
                        return String(json.url);
                    } catch (e) {
                        return null;
                    }
                }

                async function qcagDeleteImage(imageUrl) {
                    if (!qcagShouldUseBackend()) return false;
                    const base = qcagGetApiBaseUrl();
                    if (!base) return false;
                    if (!imageUrl || typeof imageUrl !== 'string') return false;
                    try {
                        const res = await fetch(base + '/images/delete', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ url: imageUrl })
                        });
                        const json = await res.json().catch(() => null);
                        if (!res.ok) return false;
                        return json && json.ok === true;
                    } catch (e) {
                        return false;
                    }
                }

                // ============ APPROVED USERS CACHE (fetch from backend) ============
                // Global cache for approved users - shared across all features
                window.__qcagApprovedUsersCache = {
                    users: [],      // [{ username, name }, ...]
                    fetched: false, // has initial fetch completed?
                    fetching: false // is fetch in progress?
                };

                // Fetch approved users from backend - call once on startup
                async function qcagFetchApprovedUsers() {
                    const cache = window.__qcagApprovedUsersCache;
                    if (cache.fetching) return cache.users; // avoid duplicate fetches
                    if (!qcagShouldUseBackend()) return cache.users;
                    const base = qcagGetApiBaseUrl();
                    if (!base) return cache.users;

                    cache.fetching = true;
                    try {
                        const res = await fetch(base + '/users/approved', {
                            method: 'GET',
                            headers: { 'Accept': 'application/json' }
                        });
                        const json = await res.json().catch(() => null);
                        if (res.ok && json && json.ok && Array.isArray(json.users)) {
                            cache.users = json.users.map(u => ({
                                username: String(u.username || ''),
                                name: String(u.name || u.username || '')
                            })).filter(u => u.username);
                            cache.fetched = true;
                            console.log('[qcagFetchApprovedUsers] Loaded', cache.users.length, 'users from backend');
                        }
                    } catch (e) {
                        console.warn('[qcagFetchApprovedUsers] Error:', e);
                    } finally {
                        cache.fetching = false;
                    }
                    return cache.users;
                }

                // Get approved users - returns cached data, fallback to localStorage
                function qcagGetApprovedUsers() {
                    const cache = window.__qcagApprovedUsersCache;
                    // If we have fetched from backend, use that
                    if (cache.fetched && cache.users.length > 0) {
                        return cache.users;
                    }
                    // Fallback to localStorage (for offline/local mode)
                    try {
                        const raw = localStorage.getItem('qcag_registered_users');
                        const users = raw ? JSON.parse(raw) : [];
                        if (Array.isArray(users)) {
                            return users
                                .filter(u => u && u.username && (u.approved !== false))
                                .map(u => ({ username: String(u.username), name: String(u.name || u.username) }));
                        }
                    } catch (e) {}
                    return [];
                }

                // Initialize - fetch users on page load
                (function initFetchApprovedUsers() {
                    if (typeof document !== 'undefined') {
                        document.addEventListener('DOMContentLoaded', function() {
                            // Slight delay to ensure API_BASE_URL is set
                            setTimeout(function() {
                                qcagFetchApprovedUsers().catch(function(e) {
                                    console.warn('[initFetchApprovedUsers] Error:', e);
                                });
                            }, 500);
                        });
                    }
                })();

                // Hàm phân loại trạng thái SPO

                // Legacy simple handlers removed to avoid conflict with modern selection/filter logic.
                // The production modal now uses centralized toggle/filter variables (approvedOnly, unapprovedOnly, areaFilters, activeFilter, termForSelection) and applySelectionFilters().

                function classifySPOStatus(status, spoNumber) {
                    // Nếu chưa có SPO cũng coi là 'SPO chưa duyệt'
                    if (!spoNumber) return 'SPO chưa duyệt';
                    if (!status) return 'SPO chưa duyệt';
                    const s = String(status).toLowerCase();
                    if (s.includes('approved') || s.includes('variation')) return 'SPO được duyệt';
                    if (s.includes('cancelled') || s.includes('rejected')) return 'SPO hủy';
                    if (s.includes('accept') || s.includes('installed') || s.includes('finish')) return 'SPO hoàn thành';
                    return 'SPO chưa duyệt';
                }

                // Trung tâm tính toán trạng thái QCAG (không mutate dữ liệu)
                // Trả về object: { status: string, warning: boolean }
                const __qcagAcceptanceImageFlagCache = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;

                function __qcagHasAcceptanceImageFast(quote) {
                    if (!quote || typeof quote !== 'object') return false;
                    const raw = quote.images;
                    if (__qcagAcceptanceImageFlagCache) {
                        const cached = __qcagAcceptanceImageFlagCache.get(quote);
                        if (cached && cached.raw === raw) return !!cached.has;
                    }
                    let has = false;
                    try {
                        if (Array.isArray(raw)) {
                            has = raw.length > 0;
                        } else if (typeof raw === 'string') {
                            const s = raw.trim();
                            has = !!(s && s !== '[]' && s !== 'null' && s !== '""');
                        } else {
                            has = false;
                        }
                    } catch (e) {
                        has = false;
                    }
                    if (__qcagAcceptanceImageFlagCache) {
                        __qcagAcceptanceImageFlagCache.set(quote, { raw, has });
                    }
                    return has;
                }

                function computeQCAGStatus(quote) {
                    if (!quote || typeof quote !== 'object') return { status: '', warning: false };
                    // Helpers
                    const orderNumber = (typeof getQcagOrderNumber === 'function') ? getQcagOrderNumber(quote) : (quote && (quote.order_number || quote.spo_number) ? (quote.order_number || '') : '');
                    const spoNumber = quote && quote.spo_number ? String(quote.spo_number).trim() : '';
                    const spoStatus = classifySPOStatus(quote && quote.spo_status, spoNumber);
                    const hasAcceptanceImage = __qcagHasAcceptanceImageFast(quote);

                    // Respect explicit user-requested "Chờ tạo đơn" flag if present on quote (UI may set this transiently)
                    if (quote && String(quote.qcag_status) === 'Chờ tạo đơn') return { status: 'Chờ tạo đơn', warning: false };

                    // STEP 1 - Chờ SPO: chưa có số SPO
                    if (!spoNumber) {
                        return { status: 'Chờ SPO', warning: !!orderNumber };
                    }

                    // STEP 2 - Chờ duyệt SPO: có số SPO, chưa import (SPO chưa duyệt)
                    if (spoNumber && spoStatus === 'SPO chưa duyệt') {
                        return { status: 'Chờ Duyệt SPO', warning: !!orderNumber };
                    }

                    // STEP 3 - Chưa sản xuất: SPO duyệt, chưa có order
                    if (spoStatus === 'SPO được duyệt' && !orderNumber) {
                        return { status: 'Chưa sản xuất', warning: false };
                    }

                    // STEP 4 - Đã ra đơn: có order_number
                    if (orderNumber) {
                        // If SPO explicitly finished or cancelled, reflect that
                        if (spoStatus === 'SPO hủy') return { status: 'Hủy', warning: false };
                        if (spoStatus === 'SPO hoàn thành') return { status: 'Hoàn thành', warning: false };

                        // Special-case: if UI/flow marks this quote as recreate-requested, surface "Chờ tạo đơn"
                        if (quote && quote.__recreateRequested) return { status: 'Chờ tạo đơn', warning: false };

                        // Chờ QCAG Upload: SPO duyệt + có ảnh
                        if (spoStatus === 'SPO được duyệt' && hasAcceptanceImage) return { status: 'Chờ QCAG Upload', warning: false };

                        // Chờ Sale nghiệm thu: spo_status = Sign Maker Installed Signage
                        if (quote && typeof quote.spo_status === 'string' && quote.spo_status === 'Sign Maker Installed Signage') return { status: 'Chờ Sale nghiệm thu', warning: false };

                        // Default for orders
                        return { status: 'Đã ra đơn', warning: false };
                    }

                    // STEP 5 - Fallback checks for final states: Hoàn thành / Hủy theo spo_status
                    if (quote && typeof quote.spo_status === 'string' && quote.spo_status === 'Sign Maker Installed Signage') return { status: 'Chờ Sale nghiệm thu', warning: false };
                    if (spoStatus === 'SPO hoàn thành') return { status: 'Hoàn thành', warning: false };
                    if (spoStatus === 'SPO hủy') return { status: 'Hủy', warning: false };

                    return { status: '', warning: false };
                }

                // Backwards-compatible wrapper for old callers expecting the simple signature
                function classifyQCAGStatus(params) {
                    const { spoNumber, orderNumber, spoStatus, hasAcceptanceImage } = params || {};
                    const warning = ' ⚠️';
                    if (!spoNumber) return orderNumber ? 'Chờ SPO' + warning : 'Chờ SPO';
                    if (spoNumber && !orderNumber) return 'Chưa sản xuất';
                    if (orderNumber) {
                        if (spoStatus === 'SPO chưa duyệt') return 'Chờ Duyệt SPO' + warning;
                        if (spoStatus === 'SPO được duyệt' && hasAcceptanceImage) return 'Chờ nghiệm thu';
                        if (spoStatus === 'SPO hoàn thành') return 'Hoàn thành';
                        if (spoStatus === 'SPO hủy') return 'Hủy';
                    }
                    return '';
                }

                // Helper used by production modal to decide visibility
                // Rules: If quote has no order_number -> can appear. If QCAG == 'Chờ tạo đơn' -> can appear even if had an order. Otherwise cannot.
                function canAppearInProductionModal(quote) {
                    try {
                        const qc = computeQCAGStatus(quote) || { status: '' };
                        // If quote has no order_number (never had an order) -> show
                        if (!quote || !quote.order_number) return true;
                        // If QCAG explicitly 'Chờ tạo đơn' -> allow re-appearance
                        if (qc.status === 'Chờ tạo đơn') return true;
                        return false;
                    } catch (e) { return false; }
                }

                // Helper to detect if a quote has local edits since last QC (non-persistent, relies on transient flags populated elsewhere)
                function hasQuotePendingUpdate(quote) {
                    if (!quote || typeof quote !== 'object') return false;
                    // This intentionally checks for ephemeral/internal flags only. If none exist, return false.
                    return !!(quote.__updatedSinceQc || quote.__itemsChanged || quote.__imagesChanged);
                }

                // Clear transient pending flags across all known caches (currentQuotes, productionOrders, acceptance refs)
                function clearPendingFlagsEverywhere(quoteKey) {
                    const key = quoteKey || '';
                    if (!key) return;

                    // 1) currentQuotes
                    try {
                        if (Array.isArray(currentQuotes)) {
                            const idx = currentQuotes.findIndex(q => (typeof getQuoteKey === 'function' ? getQuoteKey(q) : '') === key);
                            if (idx >= 0 && currentQuotes[idx]) {
                                delete currentQuotes[idx].__updatedSinceQc;
                                delete currentQuotes[idx].__itemsChanged;
                                delete currentQuotes[idx].__imagesChanged;
                                if (currentQuotes[idx].added_items_notes) delete currentQuotes[idx].added_items_notes;
                            }
                        }
                    } catch (_) {}

                    // 2) productionOrders copies
                    try {
                        if (Array.isArray(productionOrders)) {
                            let ordersChanged = false;
                            for (let oi = 0; oi < productionOrders.length; oi++) {
                                const order = productionOrders[oi];
                                let quotes = [];
                                try { quotes = JSON.parse(order.items || '[]'); } catch (e) { quotes = []; }
                                let updated = false;
                                if (Array.isArray(quotes)) {
                                    for (let qi = 0; qi < quotes.length; qi++) {
                                        const q = quotes[qi];
                                        const k = (typeof getQuoteKey === 'function') ? getQuoteKey(q) : (q && (q.__backendId || q.id || q.quote_code || q.spo_number || q.outlet_code || ''));
                                        if (k && k === key) {
                                            delete q.__updatedSinceQc;
                                            delete q.__itemsChanged;
                                            delete q.__imagesChanged;
                                            if (q.added_items_notes) delete q.added_items_notes;
                                            quotes[qi] = q;
                                            updated = true;
                                        }
                                    }
                                }
                                if (updated) {
                                    productionOrders[oi] = {...order, items: JSON.stringify(quotes) };
                                    ordersChanged = true;
                                    try {
                                        if (window.dataSdk && typeof window.dataSdk.update === 'function') {
                                            window.dataSdk.update(productionOrders[oi]).catch(() => {});
                                        }
                                    } catch (_) {}
                                }
                            }
                        }
                    } catch (_) {}

                    // 3) acceptanceDetailState quoteRef
                    try {
                        if (typeof acceptanceDetailState === 'object' && acceptanceDetailState && acceptanceDetailState.quoteRef) {
                            const refKey = (typeof getQuoteKey === 'function') ? getQuoteKey(acceptanceDetailState.quoteRef) : '';
                            if (refKey && refKey === key) {
                                delete acceptanceDetailState.quoteRef.__updatedSinceQc;
                                delete acceptanceDetailState.quoteRef.__itemsChanged;
                                delete acceptanceDetailState.quoteRef.__imagesChanged;
                                if (acceptanceDetailState.quoteRef.added_items_notes) delete acceptanceDetailState.quoteRef.added_items_notes;
                            }
                        }
                    } catch (_) {}
                }

                // Helper to determine whether a quote ever had an order (prevents deletion)
                function hasEverHadOrder(quote) {
                    try {
                        if (!quote || typeof quote !== 'object') return false;
                        // Check explicit fields
                        if (quote.order_number) return true;
                        if (quote.qcag_order_number) return true;
                        // getQcagOrderNumber parses qcag_status; prefer that
                        if (typeof getQcagOrderNumber === 'function' && getQcagOrderNumber(quote)) return true;
                        // Also check productionOrders linkage (use cached finder)
                        const qKey = (typeof getQuoteKey === 'function') ? getQuoteKey(quote) : (quote.__backendId || quote.id || '');
                        if (qKey && typeof findQuoteInProductionOrders === 'function') {
                            const found = findQuoteInProductionOrders(String(qKey));
                            if (found) return true;
                        }
                    } catch (e) { /* ignore */ }
                    return false;
                }
                // Thêm hàm xử lý paste/upload ảnh cho thumbnail nghiệm thu
                function handleImageFile(quoteKey, file) {
                    if (!quoteKey || !file || !file.type.startsWith('image/')) return;
                    const reader = new FileReader();
                    reader.onload = function(ev) {
                        addImageToQuote(quoteKey, ev.target.result, file.name || 'upload');
                    };
                    reader.readAsDataURL(file);
                }
                // Hiển thị modal Hình Nghiệm Thu
                // (removed) local-only backend connectivity test snippet

                document.addEventListener('DOMContentLoaded', function() {
                    var btn = document.getElementById('acceptance-image');
                    var modal = document.getElementById('acceptance-image-modal');
                    var closeBtn = document.getElementById('close-acceptance-image-modal');
                    if (btn && modal && closeBtn) {
                        btn.addEventListener('click', function() {
                            modal.classList.remove('hidden');
                            window.__acceptanceFilter = 'all';
                            window.__acceptanceSearch = '';
                            window.__filteredAcceptanceOrders = null; // Always reset filter list to force fresh data
                            document.querySelectorAll('.acceptance-filter-btn').forEach(b => b.classList.remove('active'));
                            document.querySelector('.acceptance-filter-btn[data-filter="all"]').classList.add('active');
                            var searchInput = document.getElementById('acceptance-search-input');
                            if (searchInput) searchInput.value = '';
                            // initialize paging defaults when opening modal
                            window.__acceptancePageSize = window.__acceptancePageSize || 10;
                            window.__acceptancePage = 1;
                            try { renderAcceptanceImages(); } catch (e) { /* ignore */ }
                            try { renderProductionOrdersForAcceptance(); } catch (e) { /* ignore */ }
                            // Attach paging control listeners (idempotent)
                            if (!window.__acceptancePagingInitialized) {
                              try {
                                var prev = document.getElementById('acceptance-prev-btn');
                                var next = document.getElementById('acceptance-next-btn');
                                var size = document.getElementById('acceptance-page-size');
                                if (prev) prev.addEventListener('click', function() { window.__acceptancePage = Math.max(1, (window.__acceptancePage||1) - 1); renderAcceptanceImages(); });
                                if (next) next.addEventListener('click', function() { window.__acceptancePage = (window.__acceptancePage||1) + 1; renderAcceptanceImages(); });
                                if (size) size.addEventListener('change', function(e) { window.__acceptancePageSize = parseInt(e.target.value,10) || 10; window.__acceptancePage = 1; renderAcceptanceImages(); });
                              } catch (e) {}
                              window.__acceptancePagingInitialized = true;
                            }
                        });
                        closeBtn.addEventListener('click', function() {
                            modal.classList.add('hidden');
                            // Reset filter and search when closing to ensure next open is default 'all'
                            window.__acceptanceFilter = 'all';
                            window.__acceptanceSearch = '';
                        });
                        // Đóng modal khi click ra ngoài phần nội dung
                        modal.addEventListener('click', function(e) {
                            if (e.target === modal) {
                                modal.classList.add('hidden');
                                // Reset filter and search when closing to ensure next open is default 'all'
                                window.__acceptanceFilter = 'all';
                                window.__acceptanceSearch = '';
                            }
                        });
                    }
                    // Render lại danh sách đơn hàng khi dữ liệu thay đổi (nếu modal đang mở)
                    window.__renderAcceptanceProductionOrders = function() {
                            var modal = document.getElementById('acceptance-image-modal');
                            if (modal && !modal.classList.contains('hidden')) {
                                try { renderProductionOrdersForAcceptance(); } catch (e) { /* ignore */ }
                            }
                        }
                        // Biến cho filter và search
                    window.__acceptanceFilter = 'all';
                    window.__acceptanceSearch = '';
                    // Event listeners cho filter buttons
                    document.querySelectorAll('.acceptance-filter-btn').forEach(btn => {
                      btn.addEventListener('click', function() {
                        window.__acceptanceFilter = this.dataset.filter;
                        document.querySelectorAll('.acceptance-filter-btn').forEach(b => b.classList.remove('active'));
                        this.classList.add('active');
                        // reset paging when filter changes
                        window.__acceptancePage = 1;
                        renderProductionOrdersForAcceptance();
                        renderAcceptanceImages();
                      });
                    });
                    // Event listener cho search input
                    var searchInput = document.getElementById('acceptance-search-input');
                    if (searchInput) {
                      var accDeb = debounce(function(val) {
                        window.__acceptanceSearch = (val || '').toLowerCase();
                        // reset paging when search changes
                        window.__acceptancePage = 1;
                        renderProductionOrdersForAcceptance();
                        renderAcceptanceImages();
                      }, 200);
                      searchInput.addEventListener('input', function() { accDeb(this.value || ''); });
                    }
                    // Hiển thị danh sách đơn hàng sản xuất ở cột phải modal Hình Nghiệm Thu
                    function renderProductionOrdersForAcceptance() {
                        var container = document.getElementById('acceptance-production-orders-list');
                        if (!container) return;
                        container.innerHTML = '';
                        if (!Array.isArray(productionOrders) || !productionOrders.length) {
                            container.innerHTML = '<div class="text-gray-400 text-sm text-center mt-8">Chưa có đơn hàng sản xuất</div>';
                            return;
                        }
                        // Luôn render danh sách production
                        var sorted = [...productionOrders].sort(function(a, b) {
                            return new Date(b.created_at) - new Date(a.created_at);
                        });
                        // Filter by status and search
                        var filtered = sorted.filter(function(order) {
                            var orderId = order.spo_number && order.spo_number !== 'Chưa nhập số đơn hàng' ? order.spo_number : '';
                            var unit = order.address && order.address !== 'Chưa nhập đơn vị thi công' ? order.address : '';
                            var due = order.due_date && order.due_date !== 'Chưa nhập hạn thi công' ? order.due_date : '';
                            var missingFields = [];
                            if (!orderId) missingFields.push('Số đơn hàng');
                            if (!unit) missingFields.push('Đơn vị thi công');
                            if (!due) missingFields.push('Ngày hoàn thành');
                            var isFullImage = true;
                            var isOverdue = false;
                            var now = new Date();
                            var quotes = [];
                            try { quotes = JSON.parse(order.items || '[]'); } catch (e) { quotes = []; }
                            var orderKey = order.__backendId || order.id || '';
                            if (Array.isArray(quotes) && quotes.length) {
                                for (var i = 0; i < quotes.length; i++) {
                                  var q = quotes[i];
                                  // Prefer acceptance_images (new uploads) then fallback to legacy images
                                  var imgs = parseImagesField(q.acceptance_images);
                                  if (!imgs || !imgs.length) {
                                    imgs = parseImagesField(q.images);
                                  }
                                  if (!imgs.length) isFullImage = false;
                                  if (!imgs.length && due) {
                                    var dueDate = new Date(due);
                                    if (!isNaN(dueDate) && dueDate < now) isOverdue = true;
                                  }
                                }
                            } else {
                                isFullImage = false;
                            }
                            var status = '';
                            if (!due) {
                                status = 'missing';
                            } else if (isFullImage) {
                                status = 'full';
                            } else if (isOverdue) {
                                status = 'overdue';
                            } else {
                                status = 'normal';
                            }
                            if (window.__acceptanceFilter !== 'all' && status !== window.__acceptanceFilter) return false;
                            // Search in orderId, unit, due, quote_keys, and quote fields (Mã BG/SPO/Outlet)
                            if (window.__acceptanceSearch) {
                                var search = window.__acceptanceSearch;
                                var quoteKeys = [];
                                try { quoteKeys = JSON.parse(order.quote_keys || '[]'); } catch (e) { quoteKeys = []; }
                                var hasMatch = orderId.toLowerCase().includes(search) || unit.toLowerCase().includes(search) || due.toLowerCase().includes(search);
                              if (!hasMatch) {
                                var quotesInOrder = [];
                                try { quotesInOrder = JSON.parse(order.items || '[]'); } catch (e) { quotesInOrder = []; }
                                if (Array.isArray(quotesInOrder)) {
                                  for (var qi = 0; qi < quotesInOrder.length; qi++) {
                                    var qq = quotesInOrder[qi] || {};
                                    var qOutletName = (qq.outlet_name || '').toString().toLowerCase();
                                    var qOutletCode = (qq.outlet_code || '').toString().toLowerCase();
                                    var qSpo = (qq.spo_number || '').toString().toLowerCase();
                                    var qQuoteCode = '';
                                    try {
                                      qQuoteCode = String((typeof formatQuoteCode === 'function' ? formatQuoteCode(qq) : (qq.quote_code || '')) || '').toLowerCase();
                                    } catch (e) {
                                      qQuoteCode = String(qq.quote_code || '').toLowerCase();
                                    }
                                    var qOrderNo = '';
                                    try {
                                      qOrderNo = String((typeof getQcagOrderNumber === 'function' ? getQcagOrderNumber(qq) : '') || (qq.order_number || qq.qcag_order_number || '') || '').toLowerCase();
                                    } catch (e) {
                                      qOrderNo = String((qq.order_number || qq.qcag_order_number || '') || '').toLowerCase();
                                    }
                                    if (qOutletName.includes(search) || qOutletCode.includes(search) || qSpo.includes(search) || qQuoteCode.includes(search) || qOrderNo.includes(search)) {
                                      hasMatch = true;
                                      break;
                                    }
                                  }
                                }
                              }
                                if (!hasMatch) {
                                    for (var k = 0; k < quoteKeys.length; k++) {
                                        if (quoteKeys[k].toLowerCase().includes(search)) {
                                            hasMatch = true;
                                            break;
                                        }
                                    }
                                }
                                if (!hasMatch) return false;
                            }
                            return true;
                        });
                        var selectedOrderId = window.__acceptanceSelectedOrderId || null;
                        window.__filteredAcceptanceOrders = filtered;
                        filtered.forEach(function(order) {
                            var orderId = order.spo_number && order.spo_number !== 'Chưa nhập số đơn hàng' ? order.spo_number : '';
                            var unit = order.address && order.address !== 'Chưa nhập đơn vị thi công' ? order.address : '';
                            var due = order.due_date && order.due_date !== 'Chưa nhập hạn thi công' ? order.due_date : '';
                            var missingFields = [];
                            if (!orderId) missingFields.push('Số đơn hàng');
                            if (!unit) missingFields.push('Đơn vị thi công');
                            if (!due) missingFields.push('Ngày hoàn thành');
                            // === Xác định trạng thái màu ===
                            var statusClass = '';
                            var isOverdue = false;
                            var now = new Date();
                            var quotes = [];
                            try { quotes = JSON.parse(order.items || '[]'); } catch (e) { quotes = []; }
                            var orderKey = order.__backendId || order.id || '';
                            var completedCount = 0;
                            var totalCount = (Array.isArray(quotes) && quotes.length) ? quotes.length : 0;
                            if (Array.isArray(quotes) && quotes.length) {
                              for (var i = 0; i < quotes.length; i++) {
                                var q = quotes[i];
                                // Prefer acceptance_images (new uploads) then fallback to legacy images
                                var imgs = parseImagesField(q.acceptance_images);
                                if (!imgs || !imgs.length) imgs = parseImagesField(q.images);
                                if (imgs && imgs.length) completedCount++;
                                if ((!imgs || !imgs.length) && due) {
                                  var dueDate = new Date(due);
                                  if (!isNaN(dueDate) && dueDate < now) isOverdue = true;
                                }
                              }
                            }
                            if (missingFields.length) {
                              statusClass = 'acceptance-status-missing';
                            } else if (totalCount > 0 && completedCount >= totalCount) {
                              statusClass = 'acceptance-status-full';
                            } else if (completedCount < totalCount && isOverdue) {
                              statusClass = 'acceptance-status-overdue';
                            } else {
                              statusClass = 'acceptance-status-normal';
                            }
                            var el = document.createElement('div');
                            el.className = 'acceptance-order-item cursor-pointer rounded px-2 py-2 mb-1 flex flex-col transition group relative ' + statusClass;
                            if (selectedOrderId && String(selectedOrderId) === String(order.__backendId)) {
                                el.classList.add('bg-blue-200', 'ring-2', 'ring-blue-500', 'ring-inset');
                            }
                            el.dataset.orderId = order.__backendId;
                            var iconHtml = '';
                            if (statusClass === 'acceptance-status-missing') {
                                iconHtml = '<svg class="w-4 h-4 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>';
                            } else if (statusClass === 'acceptance-status-full') {
                                iconHtml = '<svg class="w-4 h-4 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>';
                            } else if (statusClass === 'acceptance-status-overdue') {
                                iconHtml = '<svg class="w-4 h-4 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>';
                            } else {
                                iconHtml = '<svg class="w-4 h-4 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>';
                            }
                            var quotes = [];
                            try { quotes = JSON.parse(order.items || '[]'); } catch (e) { quotes = []; }
                            var completed = 0;
                            var orderKey = order.__backendId || order.id || '';
                            for (var i = 0; i < quotes.length; i++) {
                              // Prefer acceptance_images then fallback to legacy images when counting progress
                              var imgs = parseImagesField(quotes[i].acceptance_images);
                              if (!imgs || !imgs.length) imgs = parseImagesField(quotes[i].images);
                              if (imgs.length > 0) completed++;
                            }
                            var total = quotes.length;
                            var progress = total > 0 ? `${completed}/${total}` : '0/0';
                            var statusNote = '';
                            if (statusClass === 'acceptance-status-missing') statusNote = 'Thiếu thông tin';
                            else if (statusClass === 'acceptance-status-full') statusNote = 'Hoàn thành';
                            else if (statusClass === 'acceptance-status-overdue') statusNote = 'Trễ hạn';
                            else statusNote = 'Đang sản xuất và thi công';
                            var displayDue = 'Chưa có';
                            if (due) {
                                var dObj = new Date(due);
                                if (!isNaN(dObj)) displayDue = dObj.toLocaleDateString('vi-VN');
                                else displayDue = due;
                            }
                            el.innerHTML = `
                              <div class="text-sm text-black font-semibold mb-1">Số đơn hàng: ${orderId || 'Chưa có'}</div>
                              <div class="text-sm text-black font-semibold mb-1">Đơn vị thi công: ${unit || 'Chưa có'}</div>
                              <div class="text-sm text-black font-semibold mb-1">Thời hạn thi công: ${displayDue}</div>
                              <div class="text-sm text-gray-700 mb-1">Ngày tạo: ${order && order.created_at ? new Date(order.created_at).toLocaleString('vi-VN', {year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit'}) : 'Chưa có'}</div>
                              <div class="flex items-center justify-between mt-1">
                                <div class="text-sm italic text-gray-700 border border-dashed border-black rounded px-2 py-0.5">${statusNote}</div>
                                <div class="text-sm text-gray-600 font-semibold">${progress}</div>
                              </div>
                              <div class="absolute top-1 right-1">${iconHtml}</div>
                            `;
                            el.addEventListener('click', function() {
                                if (window.__acceptanceSelectedOrderId && String(window.__acceptanceSelectedOrderId) === String(order.__backendId)) {
                                    window.__acceptanceSelectedOrderId = null;
                                } else {
                                    window.__acceptanceSelectedOrderId = order.__backendId;
                                }
                              renderProductionOrdersForAcceptance();
                              // Reset to first page when user selects an order
                              window.__acceptancePage = 1;
                              renderAcceptanceImages();
                            });
                            container.appendChild(el);
                        });
                    }
                });
                // Modal hiển thị lý do pending/fail
                // Modal xác nhận bỏ chọn tất cả
                function ensureQcUnselectConfirmModal() {
                    let modal = document.getElementById('qc-unselect-confirm-modal');
                    if (modal) return modal;
                    modal = document.createElement('div');
                    modal.id = 'qc-unselect-confirm-modal';
                    modal.className = 'hidden fixed inset-0 z-50 modal-backdrop';
                    modal.innerHTML = `
                <div class="flex items-center justify-center min-h-full p-4">
                  <div class="bg-white rounded-lg shadow-xl w-full max-w-sm">
                    <div class="px-6 py-5 text-center">
                      <div class="text-lg font-semibold mb-3">Bạn có chắc chắn muốn bỏ chọn tất cả?</div>
                      <div class="flex justify-center gap-4 mt-6">
                        <button id="qc-unselect-cancel" class="px-4 py-2 rounded border border-gray-300 bg-white hover:bg-gray-100">Hủy</button>
                        <button id="qc-unselect-confirm" class="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white font-semibold">Xác nhận</button>
                      </div>
                    </div>
                  </div>
                </div>`;
                    document.body.appendChild(modal);
                    return modal;
                }
                // Modal xác nhận Pass tất cả
                function ensureQcPassAllConfirmModal() {
                    let modal = document.getElementById('qc-pass-all-confirm-modal');
                    if (modal) return modal;
                    modal = document.createElement('div');
                    modal.id = 'qc-pass-all-confirm-modal';
                    modal.className = 'hidden fixed inset-0 z-50 modal-backdrop';
                    modal.innerHTML = `
                <div class="flex items-center justify-center min-h-full p-4">
                  <div class="bg-white rounded-lg shadow-xl w-full max-w-sm">
                    <div class="px-6 py-5 text-center">
                      <div class="text-lg font-semibold mb-3">Bạn có chắc chắn Pass tất cả danh sách?</div>
                      <div class="flex justify-center gap-4 mt-6">
                        <button id="qc-pass-all-cancel" class="px-4 py-2 rounded border border-gray-300 bg-white hover:bg-gray-100">Hủy</button>
                        <button id="qc-pass-all-confirm" class="px-4 py-2 rounded bg-green-600 hover:bg-green-700 text-white font-semibold">Xác nhận</button>
                      </div>
                    </div>
                  </div>
                </div>`;
                    document.body.appendChild(modal);
                    return modal;
                }
                const defaultConfig = {
                    app_title: "Hệ Thống Quản Lý Báo Giá QCAG",
                    button_text: "Tạo Báo Giá Mới",
                    primary_color: "#2563eb",
                    text_color: "#1f2937",
                    accent_color: "#10b981",
                    surface_color: "#f9fafb",
                    font_family: "Segoe UI",
                    font_size: 16
                };

                let excelData = [];
                let excelLoadedFromFile = false;
                let currentQuotes = [];
                let currentEditingQuoteKey = null;
                let newQuoteCodePreGenerated = null; // Pre-generated code for new quotes (used for maquette folder naming)
                let itemCounter = 0;
                let selectedQuotes = new Set();
                let selectedQuoteGalleryIds = new Set();
                let quoteGalleryDateMode = 'created'; // 'created' or 'updated'
                let quoteGallerySelectedArea = 'all'; // 'all' or area name (single-select)
                // Pagination state for quote images gallery
                let quoteGalleryPage = 1;
                let quoteGalleryPageSize = 24;
                let productionOrders = [];
                let filteredProductionOrders = [];
                let currentProductionData = [];
                let selectedManageOrders = new Set();
                // Pending orders for production (chờ duyệt tạo đơn) - grouped by user/session
                // Each order: {id, createdBy, createdAt, quotes: [], totalPoints, totalAmount}
                let pendingOrders = [];
                let productionModalCurrentTab = 'select'; // 'select' or 'pending'
                // Quote code used for maquette upload (to ensure consistency with folder name)
                let maquetteUploadQuoteCode = null;
                // Track maquette upload progress to prevent submit before upload completes
                window.maquetteUploadInProgress = false;
                
                // ========== PENDING ORDERS BACKEND API ==========
                // Save pending order to backend
                async function savePendingOrderToBackend(order) {
                  if (!qcagShouldUseBackend()) return false;
                  const base = qcagGetApiBaseUrl();
                  if (!base) return false;
                  try {
                    const res = await fetch(base + '/pending-orders', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(order)
                    });
                    const json = await res.json().catch(() => null);
                    return json && json.ok === true;
                  } catch (e) {
                    console.warn('Cannot save pending order to backend:', e);
                    return false;
                  }
                }
                
                // Delete pending order from backend
                async function deletePendingOrderFromBackend(orderId) {
                  if (!qcagShouldUseBackend()) return { ok: false, quotes: [] };
                  const base = qcagGetApiBaseUrl();
                  if (!base) return { ok: false, quotes: [] };
                  try {
                    const res = await fetch(base + '/pending-orders/' + encodeURIComponent(orderId), {
                      method: 'DELETE',
                      headers: { 'Content-Type': 'application/json' }
                    });
                    const json = await res.json().catch(() => null);
                    return { ok: json && json.ok === true, quotes: (json && json.quotes) || [] };
                  } catch (e) {
                    console.warn('Cannot delete pending order from backend:', e);
                    return { ok: false, quotes: [] };
                  }
                }
                
                // Delete all pending orders from backend
                async function clearAllPendingOrdersFromBackend() {
                  if (!qcagShouldUseBackend()) return { ok: false, quotes: [] };
                  const base = qcagGetApiBaseUrl();
                  if (!base) return { ok: false, quotes: [] };
                  try {
                    const res = await fetch(base + '/pending-orders', {
                      method: 'DELETE',
                      headers: { 'Content-Type': 'application/json' }
                    });
                    const json = await res.json().catch(() => null);
                    return { ok: json && json.ok === true, quotes: (json && json.quotes) || [] };
                  } catch (e) {
                    console.warn('Cannot clear pending orders from backend:', e);
                    return { ok: false, quotes: [] };
                  }
                }
                
                // Load pending orders from backend
                async function loadPendingOrdersFromBackend() {
                  if (!qcagShouldUseBackend()) return false;
                  const base = qcagGetApiBaseUrl();
                  if (!base) return false;
                  try {
                    const res = await fetch(base + '/pending-orders', {
                      method: 'GET',
                      headers: { 'Content-Type': 'application/json' }
                    });
                    const json = await res.json().catch(() => null);
                    if (!json || !json.ok || !Array.isArray(json.data)) return false;
                    
                    pendingOrders = json.data;
                    
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
                  } catch (e) {
                    console.warn('Cannot load pending orders from backend:', e);
                    return false;
                  }
                }
                
                // Listen for realtime updates from backend (WebSocket/SSE)
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

          // Resolve quote key from various shapes/inputs (object or string)
          function resolveQuoteKey(input, fallbackKey) {
            if (!input && !fallbackKey) return '';
            if (typeof input === 'string' || typeof input === 'number') return String(input);
            const q = input || {};
            try {
              if (typeof getQuoteKey === 'function') {
                const k = getQuoteKey(q);
                if (k) return String(k);
              }
            } catch (e) { /* ignore */ }
            const direct = q.quote_key || q.quoteKey || q.quote_code || q.quoteCode || q.__backendId || q.id || q.spo_number || q.outlet_code;
            if (direct) return String(direct);
            if (fallbackKey) return String(fallbackKey);
            return '';
          }

        // Display code for "Mã báo giá" consistently across views
        function formatQuoteCode(q) {
          if (!q) return '';
          // Prefer explicit human identifiers
          if (q.quote_code) return String(q.quote_code);
          if (q.spo_number) return String(q.spo_number);
          if (q.__backendId) return String(q.__backendId);
          if (q.id) return String(q.id);
          // Compact from key if needed
          const key = getQuoteKey(q);
          // Try to shorten long composite keys
          if (key.includes('__')) {
            const parts = key.split('__');
            const outlet = parts[0] || '';
            const dateStr = parts[2] || '';
            const ymd = dateStr ? new Date(dateStr).toISOString().slice(0,10).replace(/-/g,'') : '';
            return `BG-${outlet}-${ymd}`;
          }
          return key || '';
        }

        function updateStatsBar() {
            const APPROVED = getApprovedSet();
            const PRODUCED = getProducedSet();
            const eligible = currentQuotes.filter(q => APPROVED.has(q.spo_status) && !PRODUCED.has(q.spo_status));
            const selectedList = currentQuotes.filter(q => selectedQuotes.has(getQuoteKey(q)));
            const totalSelected = selectedList.reduce((sum, q) => sum + (parseMoney(q.total_amount) || 0), 0);

            const eligibleEl = document.getElementById('eligible-count');
            const selCountEl = document.getElementById('selected-count-stat');
            const selTotalEl = document.getElementById('selected-total-stat');
            if (eligibleEl) eligibleEl.textContent = eligible.length;
            if (selCountEl) selCountEl.textContent = selectedQuotes.size;
            if (selTotalEl) selTotalEl.textContent = formatCurrency(totalSelected);
        }

        // Extract Số ĐH: prefer production order record (SQL), then dedicated fields, then fallback parsing qcag_status
        function getQcagOrderNumber(q) {
          if (!q) return '';
          // 1) If this quote appears inside a production order, use its spo_number (saved in SQL)
          try {
            const key = resolveQuoteKey(q);
            const found = typeof findQuoteInProductionOrders === 'function' ? findQuoteInProductionOrders(String(key)) : null;
            const orderNum = found && found.order && found.order.spo_number;
            if (orderNum && orderNum !== 'Chưa nhập số đơn hàng') return String(orderNum);
          } catch (e) { /* ignore */ }

          // 2) Dedicated fields on the quotation itself
          if (q.qcag_order_number) return String(q.qcag_order_number);
          if (q.order_number) return String(q.order_number);

          // 3) Fallback: parse qcag_status text
          const s = q.qcag_status ? String(q.qcag_status) : '';
          const m = s.match(/\bĐH\s*(\S+)/i);
          return m ? m[1] : '';
        }

        function escapeForNotes(value) {
          if (value === undefined || value === null) return '';
          const str = String(value);
          if (typeof escapeHtml === 'function') {
            return escapeHtml(str);
          }
          return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        }

        function findQuoteByIdentifier(identifier) {
          if (identifier === undefined || identifier === null) return null;
          const identifierStr = String(identifier);
          if (!identifierStr || identifierStr === 'undefined' || identifierStr === 'null') return null;
          return currentQuotes.find(q => {
            if (!q) return false;
            const key = getQuoteKey(q);
            if (key && key === identifierStr) return true;
            if (q.__backendId != null && String(q.__backendId) === identifierStr) return true;
            if (q.id != null && String(q.id) === identifierStr) return true;
            if (q.spo_number != null && String(q.spo_number) === identifierStr) return true;
            return false;
          }) || null;
        }

        function openQuoteNotesModal(identifier) {
          const modal = document.getElementById('quote-notes-modal');
          const subtitle = document.getElementById('note-modal-subtitle');
          // Always show the modal if available
          if (!modal) {
            if (typeof showToast === 'function') showToast('Không tìm thấy cửa sổ ghi chú.');
            return;
          }
          const quote = findQuoteByIdentifier(identifier);
          modal.classList.remove('hidden');
          ensureScrollLock();
          if (!quote) {
            // No quote found: still allow composing a generic note (won't persist)
            noteModalState.activeQuoteKey = null;
            if (subtitle) subtitle.textContent = '';
            document.getElementById('note-history').innerHTML = '<div class="note-empty-state">Không tìm thấy báo giá. Bạn có thể nhập ghi chú nhưng sẽ không được lưu.</div>';
            resetNoteComposer({ clearFiles: true, focus: true });
            try { setupNoteMentions(); } catch (e) {}
            return;
          }
          noteModalState.activeQuoteKey = getQuoteKey(quote);
          const outlet = quote.outlet_name || quote.outlet_code || '';
          const spo = quote.spo_number ? ` • SPO: ${quote.spo_number}` : '';
          if (subtitle) subtitle.textContent = `${outlet}${spo}`;
          renderNoteHistory(quote);
          resetNoteComposer({ clearFiles: true, focus: true });
          try { setupNoteMentions(); } catch (e) {}
        }
        window.openQuoteNotesModal = openQuoteNotesModal;

        function closeQuoteNotesModal() {
          const modal = document.getElementById('quote-notes-modal');
          if (!modal) return;
          modal.classList.add('hidden');
          noteModalState.activeQuoteKey = null;
          resetNoteComposer({ focus: false });
          ensureScrollLock();
        }

        function renderNoteHistory(quote) {
          const container = document.getElementById('note-history');
          if (!container) return;
          const notes = getQuoteNotes(quote);
          if (!notes.length) {
            container.innerHTML = '<div class="note-empty-state">Chưa có ghi chú nào. Bấm gửi để thêm ghi chú đầu tiên.</div>';
            return;
          }

          const html = `<ul class="note-list">${notes.map((note) => {
            const timestamp = note && note.at ? new Date(note.at).toLocaleString('vi-VN') : 'Không rõ thời gian';
            const rawText = note && note.text ? String(note.text) : '';
            const isUser = note && note.user_generated === true;
            // For legacy auto notes that start with [Tự động], strip the prefix for display
            let displayText = rawText;
            if (!isUser) displayText = displayText.replace(/^\[Tự động\]\s*/i, '');

            // Highlight @mentions after escaping. Use explicit mention map when available
            const escaped = escapeForNotes(displayText || '');
            function escapeRegex(s) { return String(s || '').replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'); }
            let textWithMentions = String(escaped);
            try {
              if (Array.isArray(note && note.mentions) && note.mentions.length) {
                note.mentions.forEach(m => {
                  const disp = escapeForNotes(m.name || m.username || '');
                  if (!disp) return;
                  const re = new RegExp('@' + escapeRegex(disp), 'g');
                  textWithMentions = textWithMentions.replace(re, `<span class="note-mention" style="background:#e6f0ff;color:#0366d6;padding:2px 4px;border-radius:4px;display:inline-block;white-space:nowrap">@${disp}</span>`);
                });
              }
            } catch (e) {}
            // fallback: highlight simple @username tokens
            textWithMentions = textWithMentions.replace(/@([a-zA-Z0-9_.-]+)/g, function(m, uname) {
              return `<span class="note-mention" style="background:#e6f0ff;color:#0366d6;padding:2px 4px;border-radius:4px">@${escapeForNotes(uname)}</span>`;
            });
            const textBlock = displayText ? `<p>${textWithMentions}</p>` : '';
            const authorLabel = getNoteAuthorLabel(note);
            const authorHtml = authorLabel ? `<span class="note-author">${escapeForNotes(authorLabel)}</span>` : '';
            const badge = `<span class="note-badge ${isUser ? 'note-badge-user' : 'note-badge-system'}">${isUser ? 'Chủ động' : 'Tự động'}</span>`;
            const attachments = Array.isArray(note?.attachments) ? note.attachments : [];
            const attachmentsHtml = attachments.length ? `<div class="note-attachments">${attachments.map((att, attIdx) => renderNoteAttachment(att, attIdx)).join('')}</div>` : '';
            const fallbackText = (!textBlock && !attachmentsHtml) ? '<p class="italic text-gray-500">(Không có nội dung)</p>' : '';
            const metaParts = [badge, `<span class="note-timestamp">${escapeForNotes(timestamp)}</span>`];
            if (authorHtml) metaParts.push(authorHtml);
            const metaRow = `<div class="note-meta">${metaParts.join('<span class="note-meta-sep">•</span>')}</div>`;
            return `
              <li class="note-entry">
                ${metaRow}
                <div class="note-bubble ${isUser ? 'user-note' : 'system-note'}">
                  ${textBlock || ''}
                  ${fallbackText}
                  ${attachmentsHtml}
                </div>
              </li>
            `;
          }).join('')}</ul>`;

          container.innerHTML = html;
          attachNoteImagePreviewHandlers(container);
          container.scrollTop = container.scrollHeight;
        }

        function renderNoteAttachment(attachment, index) {
          if (!attachment) return '';
          const isImage = isImageAttachment(attachment);
          const dataUrl = attachment.data || attachment.url || '';
          if (isImage && dataUrl) {
            const imageName = escapeForNotes(attachment.name || `Hình ảnh ${index + 1}`);
            const altText = escapeForNotes(`Hình ảnh ghi chú ${index + 1}`);
            return `
              <div class="note-attachment-item is-image">
                <img src="${dataUrl}" alt="${altText}" data-viewer-name="${imageName}" loading="lazy" decoding="async" draggable="false">
              </div>
            `;
          }
          const name = escapeForNotes(attachment.name || `Tệp ${index + 1}`);
          const sizeLabel = attachment.size ? `<span class="text-xs text-gray-500">${formatFileSize(attachment.size)}</span>` : '';
          const icon = '[FILE]';
          const downloadLink = dataUrl ? `<a class="text-xs text-blue-600 hover:underline" href="${dataUrl}" download="${name}">Tải xuống</a>` : '';
          return `
            <div class="note-attachment-item">
              <span class="font-semibold">${icon} ${name}</span>
              ${sizeLabel}
              ${downloadLink}
            </div>
          `;
        }

        function attachNoteImagePreviewHandlers(container) {
          if (!container) return;
          const images = container.querySelectorAll('.note-attachment-item.is-image img');
          images.forEach((img) => {
            if (img._viewerBound) return;
            img._viewerBound = true;
            img.addEventListener('click', () => {
              const src = img.getAttribute('src');
              if (!src) return;
              const name = img.getAttribute('data-viewer-name') || '';
              openImageViewer(src, name);
            });
          });
        }

        function isImageAttachment(attachment) {
          if (!attachment) return false;
          const type = attachment.type || '';
          if (type.startsWith('image/')) return true;
          const dataUrl = attachment.data || attachment.url || '';
          return dataUrl.startsWith('data:image') || dataUrl.match(/\.(png|jpe?g|gif|webp|svg)(\?|$)/i);
        }

        function renderPendingFiles() {
          const wrap = document.getElementById('note-pending-files');
          if (!wrap) return;
          const pending = noteModalState.pendingFiles;
          if (!pending.length) {
            wrap.innerHTML = '';
            wrap.classList.add('hidden');
            syncNoteSubmitState();
            return;
          }

          wrap.classList.remove('hidden');
          wrap.innerHTML = pending.map((file, idx) => {
            const name = escapeForNotes(file.name || `Tệp ${idx + 1}`);
            const sizeLabel = file.size ? ` (${formatFileSize(file.size)})` : '';
            return `<span class="pending-file-pill">${name}${sizeLabel}<button type="button" data-remove-index="${idx}" aria-label="Xóa tệp">×</button></span>`;
          }).join('');

          wrap.querySelectorAll('button[data-remove-index]').forEach(btn => {
            if (btn._bound) return;
            btn._bound = true;
            btn.addEventListener('click', (event) => {
              const index = Number(event.currentTarget.getAttribute('data-remove-index'));
              if (!Number.isNaN(index)) {
                noteModalState.pendingFiles.splice(index, 1);
                renderPendingFiles();
              }
            });
          });

          syncNoteSubmitState();
        }

        function resetNoteComposer(options = {}) {
          const { clearFiles = true, focus = true } = options;
          const messageInput = document.getElementById('note-message-input');
          const formEl = document.getElementById('note-compose-form');
          if (messageInput) {
            messageInput.value = '';
            messageInput.setAttribute('value', '');
            messageInput.textContent = '';
            messageInput.defaultValue = '';
            if (typeof messageInput.setRangeText === 'function') {
              messageInput.setRangeText('');
            }
            if (typeof messageInput.setSelectionRange === 'function') {
              messageInput.setSelectionRange(0, 0);
            } else {
              messageInput.selectionStart = 0;
              messageInput.selectionEnd = 0;
            }
          }
          if (clearFiles) {
            noteModalState.pendingFiles = [];
            // clear any mention tracking
            noteModalState.currentMentions = [];
            try { hideMentionDropdown(); } catch (e) {}
          }
          renderPendingFiles();
          if (formEl && clearFiles) {
            formEl.reset();
          }
          if (messageInput) {
            const ensureCleared = () => {
              messageInput.value = '';
              messageInput.dispatchEvent(new Event('input', { bubbles: true }));
              if (focus) {
                messageInput.focus();
              }
            };
            const schedule = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb) => setTimeout(cb, 0);
            schedule(ensureCleared); // Defer to avoid stale text from async DOM work
          } else {
            syncNoteSubmitState();
          }
        }

        // --- Mention autocomplete for note composer (@username) ---
        function getRegisteredUsersForMentions() {
          // Use backend-fetched users (global cache)
          return qcagGetApprovedUsers();
        }

        let __noteMentionState = { dropdown: null, items: [], visible: false, selectedIndex: -1 };

        function ensureNoteMentionDropdown() {
          if (__noteMentionState.dropdown) return __noteMentionState.dropdown;
          const dd = document.createElement('div');
          dd.id = 'note-mention-dropdown';
          dd.style.position = 'absolute';
          dd.style.zIndex = 1200;
          dd.style.minWidth = '200px';
          dd.style.maxHeight = '220px';
          dd.style.overflow = 'auto';
          dd.style.background = '#fff';
          dd.style.border = '1px solid #ddd';
          dd.style.boxShadow = '0 6px 18px rgba(0,0,0,0.08)';
          dd.style.borderRadius = '6px';
          dd.style.display = 'none';
          dd.className = 'note-mention-dropdown';
          document.body.appendChild(dd);
          __noteMentionState.dropdown = dd;
          dd.addEventListener('mousedown', function(e){ e.preventDefault(); });
          return dd;
        }

        function showMentionDropdownFor(textarea, query) {
          const dd = ensureNoteMentionDropdown();
          const all = getRegisteredUsersForMentions();
          const q = String(query || '').replace(/^@/, '').toLowerCase();
          const filtered = all.filter(u => (u.username || '').toLowerCase().includes(q) || (u.name || '').toLowerCase().includes(q)).slice(0, 50);
          __noteMentionState.items = filtered;
          __noteMentionState.selectedIndex = filtered.length ? 0 : -1;
          dd.innerHTML = filtered.map((u, idx) => `<div data-idx="${idx}" class="mention-item" style="padding:6px 8px;cursor:pointer;border-bottom:1px solid #f3f3f3">` +
            `<div style="font-size:13px;font-weight:600">${escapeForNotes(u.name)}</div>` +
            `<div style="font-size:12px;color:#666">@${escapeForNotes(u.username)}</div>` +
            `</div>`).join('');

          // Position dropdown near caret
          try {
            const rect = textarea.getBoundingClientRect();
            dd.style.left = (rect.left + window.pageXOffset + 8) + 'px';
            // Measure actual content height after rendering
            dd.style.display = 'block';
            dd.style.visibility = 'hidden';
            const actualHeight = dd.scrollHeight;
            dd.style.visibility = 'visible';
            // choose above if not enough space below
            const spaceBelow = window.innerHeight - rect.bottom;
            const maxHeight = 220;
            const neededHeight = Math.min(actualHeight, maxHeight);
            if (spaceBelow < neededHeight && rect.top > neededHeight) {
              // show above textarea: anchor bottom at rect.top - 6 and set height so it shrinks from top
              const bottomAnchor = rect.top + window.pageYOffset - 6;
              dd.style.height = neededHeight + 'px';
              dd.style.top = (bottomAnchor - neededHeight) + 'px';
            } else {
              // show below textarea: anchor top at rect.bottom + 6 and set height
              dd.style.height = neededHeight + 'px';
              dd.style.top = (rect.bottom + window.pageYOffset + 6) + 'px';
            }
          } catch (e) {}

          dd.style.display = filtered.length ? 'block' : 'none';
          __noteMentionState.visible = filtered.length > 0;

          dd.querySelectorAll('.mention-item').forEach(el => {
            el.addEventListener('click', function(ev){
              const idx = Number(ev.currentTarget.getAttribute('data-idx'));
              const u = __noteMentionState.items[idx];
              if (u) insertMentionAtCursor(textarea, u.username, u.name);
              hideMentionDropdown();
              textarea.focus();
            });
          });
        }

        function hideMentionDropdown() {
          const dd = ensureNoteMentionDropdown();
          dd.style.display = 'none';
          __noteMentionState.visible = false;
          __noteMentionState.items = [];
          __noteMentionState.selectedIndex = -1;
        }

        function insertMentionAtCursor(textarea, username, displayName) {
          if (!textarea) return;
          const val = textarea.value || '';
          const selStart = textarea.selectionStart || 0;
          const selEnd = textarea.selectionEnd || selStart;
          // find the @ token start before selStart
          let atPos = val.lastIndexOf('@', selStart - 1);
          if (atPos < 0) atPos = selStart; // fallback
          // build new value: before @ + @displayName + space + after token
          const before = val.slice(0, atPos);
          const after = val.slice(selEnd);
          // trim to remove any extra spaces in name
          const nameToInsert = String(displayName || username || '').trim();
          const insertText = `@${nameToInsert} `;
          const newPos = before.length + insertText.length;
          textarea.value = before + insertText + after;
          // track mention mapping for submission
          try {
            noteModalState.currentMentions = noteModalState.currentMentions || [];
            // avoid duplicates
            const exists = noteModalState.currentMentions.find(m => String(m.username) === String(username));
            if (!exists) {
              noteModalState.currentMentions.push({ username: String(username), name: String(nameToInsert) });
            }
          } catch (e) {}
          // fire input event
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          try { textarea.setSelectionRange(newPos, newPos); } catch (e) {}
        }

        function setupNoteMentions() {
          const ta = document.getElementById('note-message-input');
          if (!ta) return;
          // prevent double-binding
          if (ta._mentionsBound) return; ta._mentionsBound = true;

          ta.addEventListener('input', function(e){
            const v = ta.value || '';
            const sel = ta.selectionStart || v.length;
            const lastAt = v.lastIndexOf('@', sel - 1);
            if (lastAt >= 0) {
              // ensure @ is either at start or preceded by whitespace
              const pre = v.charAt(lastAt - 1);
              if (lastAt === 0 || /\s/.test(pre)) {
                const token = v.slice(lastAt, sel);
                // if token contains space or newline, cancel
                if (/\s/.test(token)) { hideMentionDropdown(); return; }
                showMentionDropdownFor(ta, token);
                return;
              }
            }
            hideMentionDropdown();
          });

          ta.addEventListener('keydown', function(e){
            const dd = ensureNoteMentionDropdown();
            if (!__noteMentionState.visible) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              __noteMentionState.selectedIndex = Math.min(__noteMentionState.selectedIndex + 1, __noteMentionState.items.length - 1);
              // highlight
              dd.querySelectorAll('.mention-item').forEach((el, idx) => el.style.background = idx === __noteMentionState.selectedIndex ? '#f0f8ff' : '');
              return;
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              __noteMentionState.selectedIndex = Math.max(__noteMentionState.selectedIndex - 1, 0);
              dd.querySelectorAll('.mention-item').forEach((el, idx) => el.style.background = idx === __noteMentionState.selectedIndex ? '#f0f8ff' : '');
              return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              if (__noteMentionState.selectedIndex >= 0 && __noteMentionState.items[__noteMentionState.selectedIndex]) {
                e.preventDefault();
                const u = __noteMentionState.items[__noteMentionState.selectedIndex];
                insertMentionAtCursor(ta, u.username, u.name);
                hideMentionDropdown();
              }
            }
            if (e.key === 'Escape') {
              hideMentionDropdown();
            }
          });

          document.addEventListener('click', function(ev){
            const dd = __noteMentionState.dropdown;
            if (!dd || !__noteMentionState.visible) return;
            if (ev.target === dd || dd.contains(ev.target)) return;
            if (ev.target === ta) return;
            hideMentionDropdown();
          });
        }

        function submitNoteComposer() {
          const messageInput = document.getElementById('note-message-input');
          const message = messageInput ? messageInput.value.trim() : '';
          const hasFiles = noteModalState.pendingFiles.length > 0;
          if (!message && !hasFiles) {
            if (typeof showToast === 'function') {
              showToast('Vui lòng nhập ghi chú hoặc đính kèm tệp.');
            }
            return false;
          }

          if (!noteModalState.activeQuoteKey) {
            return false;
          }

          const idx = currentQuotes.findIndex(q => getQuoteKey(q) === noteModalState.activeQuoteKey);
          if (idx < 0) {
            if (typeof showToast === 'function') {
              showToast('Không thể lưu ghi chú cho báo giá này.');
            }
            return false;
          }

          const entry = {
            text: message,
            at: new Date().toISOString(),
            // mark as user-generated so render logic treats this as an active message
            user_generated: true
          };

          // Attach mentions collected via autocomplete (if any)
          try {
            if (Array.isArray(noteModalState.currentMentions) && noteModalState.currentMentions.length) {
              // store array of { username, name }
              entry.mentions = noteModalState.currentMentions.map(m => ({ username: String(m.username), name: String(m.name || m.username) }));
            }
          } catch (e) { /* ignore */ }

          if (noteModalState.pendingFiles.length) {
            entry.attachments = noteModalState.pendingFiles.map(file => ({
              name: file.name,
              size: file.size,
              type: file.type,
              data: file.data
            }));
          }

          const updated = appendNoteEntryToQuote(idx, entry, 'Đã lưu ghi chú');
          if (!updated) {
            return false;
          }
          // Aggressively clear input state immediately on success
          try {
            if (messageInput) {
              messageInput.value = '';
              messageInput.textContent = '';
              messageInput.defaultValue = '';
              messageInput.setAttribute('value', '');
              messageInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
            noteModalState.pendingFiles = [];
            // Defer a hard reset to ensure no stale text remains after DOM updates
            const schedule = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb) => setTimeout(cb, 0);
            schedule(() => {
              resetNoteComposer({ clearFiles: true, focus: true });
              syncNoteSubmitState();
            });
          } catch (_) {}
          return true;
        }

        function getQuoteNotes(quote) {
          if (!quote) return [];
          const raw = quote.notes;
          if (Array.isArray(raw)) return raw;
          if (typeof raw === 'string') {
            try {
              const parsed = JSON.parse(raw);
              return Array.isArray(parsed) ? parsed : [];
            } catch (_) {
              return [];
            }
          }
          return [];
        }

        function appendNoteEntryToQuote(idx, entry, toastMessage) {
          if (idx < 0 || idx >= currentQuotes.length) return null;
          const quote = currentQuotes[idx];
          if (!quote) return null;
          const enrichedEntry = ensureNoteHasAuthor(entry);
          const notes = [...getQuoteNotes(quote), enrichedEntry];
          const updated = { ...quote, notes };
          currentQuotes[idx] = updated;

          if (window.dataSdk && typeof window.dataSdk.update === 'function') {
            try {
              window.dataSdk.update(updated);
            } catch (err) {
              console.error('Lỗi cập nhật ghi chú:', err);
            }
          }

          if (noteModalState.activeQuoteKey === getQuoteKey(updated)) {
            renderNoteHistory(updated);
          }

          // Cập nhật phần xem nhanh ghi chú trong chi tiết báo giá
          const rowKey = getQuoteKey(updated);
          updateQuoteDetailsNotesPreview(rowKey, updated);
          updateNoteButtonsForQuote(rowKey, updated);

          if (toastMessage && typeof showToast === 'function') {
            showToast(toastMessage);
          }

          return updated;
        }

        function addSystemNoteForQuote(target, message) {
          if (!message || !target) return;
          const key = typeof target === 'string' ? target : getQuoteKey(target);
          if (!key) return;
          const idx = currentQuotes.findIndex(q => getQuoteKey(q) === key);
          if (idx < 0) return;
          appendNoteEntryToQuote(idx, {
            text: `[Tự động] ${message}`,
            at: new Date().toISOString()
          }, null);
        }

        function addPlainNoteForQuote(target, text) {
          if (!text || !target) return;
          const key = typeof target === 'string' ? target : getQuoteKey(target);
          if (!key) return;
          const idx = currentQuotes.findIndex(q => getQuoteKey(q) === key);
          if (idx < 0) return;
          appendNoteEntryToQuote(idx, {
            text: String(text),
            at: new Date().toISOString()
          }, null);
        }

        function getCurrentAuthUser() {
          try {
            const u = window && window.__qcagAuthUser ? window.__qcagAuthUser : null;
            if (!u || typeof u !== 'object') return null;
            return {
              username: u.username ? String(u.username) : '',
              name: u.name ? String(u.name) : '',
              role: u.role ? String(u.role) : ''
            };
          } catch (e) {
            return null;
          }
        }

        function getNoteAuthorLabel(note) {
          if (!note || typeof note !== 'object') return '';
          const name = note.author_name ? String(note.author_name).trim() : '';
          const username = note.author_username ? String(note.author_username).trim() : '';
          if (name) return name;
          if (username) return username;
          return '';
        }

        function ensureNoteHasAuthor(entry) {
          if (!entry || typeof entry !== 'object') return entry;
          if (entry.author_name || entry.author_username) return entry;
          const u = getCurrentAuthUser();
          if (!u) return entry;
          return {
            ...entry,
            author_name: u.name || '',
            author_username: u.username || ''
          };
        }

        // Hàm helper để render preview ghi chú (hiển thị toàn bộ danh sách)
        function renderNotesPreviewHTML(quote) {
          const notes = getQuoteNotes(quote);
          if (!notes.length) {
            return `
              <div class="bg-gray-100 border border-gray-200 rounded-lg p-3 h-full flex items-center justify-center">
                <div class="text-center text-gray-400 text-xs">
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-8 h-8 mx-auto mb-2 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"/></svg>
                  <p>Chưa có ghi chú</p>
                </div>
              </div>
            `;
          }

          const newestFirst = [...notes].reverse();
          const headerTime = newestFirst[0]?.at ? new Date(newestFirst[0].at).toLocaleString('vi-VN') : '';
          const entries = newestFirst.map((note, idx) => {
            const timeLabel = note?.at ? new Date(note.at).toLocaleString('vi-VN') : 'Không rõ thời gian';
            const author = getNoteAuthorLabel(note);
            const authorHtml = author ? `<div class="text-[11px] text-gray-500 mt-1">${escapeForNotes(author)}</div>` : '';
            const rawText = note?.text ? String(note.text) : '';
            const escText = escapeForNotes(rawText);
            // highlight mentions from attached mentions array if present
            let textWithMentionsPreview = escText;
            try {
              if (Array.isArray(note?.mentions) && note.mentions.length) {
                note.mentions.forEach(m => {
                  const disp = escapeForNotes(m.name || m.username || '');
                  if (!disp) return;
                  const re = new RegExp('@' + disp.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g');
                  textWithMentionsPreview = textWithMentionsPreview.replace(re, `<span class="note-mention" style="background:#e6f0ff;color:#0366d6;padding:2px 4px;border-radius:4px;display:inline-block;white-space:nowrap">@${disp}</span>`);
                });
              }
            } catch (e) {}
            textWithMentionsPreview = textWithMentionsPreview.replace(/@([a-zA-Z0-9_.-]+)/g, function(m, uname){ return `<span class="note-mention" style="background:#e6f0ff;color:#0366d6;padding:2px 4px;border-radius:4px;display:inline-block;white-space:nowrap">@${escapeForNotes(uname)}</span>`; });
            const textHtml = rawText ? `<div class="text-xs text-gray-800 whitespace-pre-wrap break-words mt-1">${textWithMentionsPreview}</div>` : '<div class="text-xs italic text-gray-500 mt-1">(Không có nội dung văn bản)</div>';
            const attachments = Array.isArray(note?.attachments) ? note.attachments : [];
            const attachmentsHtml = attachments.length
              ? `<div class="flex flex-wrap gap-2 mt-2">${attachments.map((att, attIdx) => renderNoteAttachment(att, attIdx)).join('')}</div>`
              : '';
            return `
              <div class="bg-white/80 border border-yellow-200 rounded-md p-2 shadow-sm">
                <div class="flex items-center justify-between text-[11px] text-yellow-700">
                  <span>Ghi chú #${newestFirst.length - idx}</span>
                  <span>${escapeForNotes(timeLabel)}</span>
                </div>
                ${textHtml}
                ${authorHtml}
                ${attachmentsHtml}
              </div>
            `;
          }).join('');

          return `
            <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3 h-full flex flex-col">
              <div class="flex items-center justify-between mb-2">
                <h4 class="font-semibold text-yellow-800 text-xs flex items-center gap-1">
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"/></svg>
                  <span>Ghi chú (${notes.length})</span>
                </h4>
                <span class="text-[10px] text-yellow-700">Mới nhất: ${escapeForNotes(headerTime)}</span>
              </div>
              <div class="flex-1 overflow-y-auto space-y-2 max-h-72">
                ${entries}
              </div>
            </div>
          `;
        }

        function updateNoteButtonsForQuote(rowKey, quote) {
          const buttons = document.querySelectorAll(`[data-note-btn="${rowKey}"]`);
          if (!buttons.length) return;
          const count = getQuoteNotes(quote).length;
          buttons.forEach(btn => {
            const countBox = btn.querySelector('.note-btn-count');
            if (!countBox) return;
            countBox.textContent = count || 0;
            countBox.classList.toggle('has-notes', count > 0);
          });
        }

        // Cập nhật phần preview ghi chú trong chi tiết báo giá đang mở
        function updateQuoteDetailsNotesPreview(rowKey, quote) {
          const containers = document.querySelectorAll(`[data-notes-preview="${rowKey}"]`);
          if (!containers.length) return;
          const html = renderNotesPreviewHTML(quote);
          containers.forEach(container => {
            container.innerHTML = html;
          });
          updateNoteButtonsForQuote(rowKey, quote);
        }

        function syncNoteSubmitState() {
          const messageInput = document.getElementById('note-message-input');
          const submitBtn = document.getElementById('note-submit-btn');
          if (!submitBtn) return;
          const hasMessage = messageInput ? messageInput.value.trim().length > 0 : false;
          const hasFiles = noteModalState.pendingFiles.length > 0;
          submitBtn.disabled = !(hasMessage || hasFiles);
        }

        function handleNoteFiles(fileList, options = {}) {
          if (!fileList || !fileList.length) return;
          const imagesOnly = !!options.imagesOnly;
          const availableSlots = NOTE_MODAL_MAX_FILES - noteModalState.pendingFiles.length;
          if (availableSlots <= 0) {
            if (typeof showToast === 'function') {
              showToast(`Chỉ có thể đính tối đa ${NOTE_MODAL_MAX_FILES} tệp.`);
            }
            return;
          }

          let files = Array.from(fileList).slice(0, availableSlots);
          if (files.length < fileList.length && typeof showToast === 'function') {
            showToast(`Đã chọn quá ${NOTE_MODAL_MAX_FILES} tệp, chỉ lấy ${files.length} tệp đầu tiên.`);
          }

          if (imagesOnly) {
            const invalid = files.filter(file => !isImageFile(file));
            if (invalid.length && typeof showToast === 'function') {
              showToast('Vui lòng chọn tệp hình ảnh.');
            }
            files = files.filter(file => isImageFile(file));
          }

          if (!files.length) {
            syncNoteSubmitState();
            return;
          }

          const processors = files.map(file => (
            isImageFile(file) ? processImageFile(file) : processNonImageFile(file)
          ));

          Promise.allSettled(processors)
            .then(results => {
              const successfulFiles = [];
              results.forEach((result, idx) => {
                const original = files[idx];
                if (result.status === 'fulfilled') {
                  successfulFiles.push(result.value);
                } else {
                  const reason = result.reason || {};
                  if (reason && reason.code === 'FILE_TOO_LARGE') {
                    if (typeof showToast === 'function') {
                      showToast(`Tệp "${original.name}" vượt quá 5MB. Vui lòng chọn tệp nhỏ hơn.`);
                    }
                  } else if (typeof showToast === 'function') {
                    showToast(`Không thể xử lý "${original.name}". Vui lòng thử lại.`);
                  }
                }
              });

              if (imagesOnly) {
                if (!successfulFiles.length) {
                  syncNoteSubmitState();
                  return;
                }
                const quoteIdx = currentQuotes.findIndex(q => getQuoteKey(q) === noteModalState.activeQuoteKey);
                if (quoteIdx < 0) {
                  if (typeof showToast === 'function') {
                    showToast('Không tìm thấy báo giá để gửi ảnh.');
                  }
                  syncNoteSubmitState();
                  return;
                }
                let sentCount = 0;
                successfulFiles.forEach(fileObj => {
                  const entry = {
                    text: '',
                    at: new Date().toISOString(),
                    attachments: [fileObj]
                  };
                  const updated = appendNoteEntryToQuote(quoteIdx, entry, null);
                  if (updated) sentCount++;
                });
                if (sentCount && typeof showToast === 'function') {
                  showToast(sentCount > 1 ? `Đã gửi ${sentCount} ảnh` : 'Đã gửi ảnh');
                }
                syncNoteSubmitState();
              } else {
                if (successfulFiles.length) {
                  noteModalState.pendingFiles.push(...successfulFiles);
                  renderPendingFiles();
                } else {
                  syncNoteSubmitState();
                }
              }
            })
            .finally(() => {
              const fileInputEl = document.getElementById('note-file-input');
              if (fileInputEl) fileInputEl.value = '';
              const imageInputEl = document.getElementById('note-image-input');
              if (imageInputEl) imageInputEl.value = '';
              syncNoteSubmitState();
            });
        }

        function formatFileSize(bytes) {
          if (bytes === undefined || bytes === null || isNaN(bytes)) return '';
          const thresh = 1024;
          if (Math.abs(bytes) < thresh) return `${bytes} B`;
          const units = ['KB', 'MB', 'GB', 'TB'];
          let u = -1;
          let size = bytes;
          do {
            size /= thresh;
            ++u;
          } while (Math.abs(size) >= thresh && u < units.length - 1);
          return `${size.toFixed(1)} ${units[u]}`;
        }

        function isImageFile(file) {
          if (!file) return false;
          if (file.type) {
            return file.type.startsWith('image/');
          }
          const name = file.name || '';
          const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
          return ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'].includes(ext);
        }

        function convertNameToJpg(name) {
          if (!name) return 'image.jpg';
          const base = name.replace(/\.[^.]+$/, '');
          return `${base}.jpg`;
        }

        function scaleImageDimensions(width, height) {
          const w = Math.max(1, Math.round(width || 1));
          const h = Math.max(1, Math.round(height || 1));
          const ratio = Math.min(1,
            NOTE_MAX_IMAGE_WIDTH / w,
            NOTE_MAX_IMAGE_HEIGHT / h
          );
          if (ratio >= 1) {
            return { width: w, height: h };
          }
          return {
            width: Math.max(1, Math.round(w * ratio)),
            height: Math.max(1, Math.round(h * ratio))
          };
        }

        function processImageFile(file) {
          return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const img = new Image();
              img.onload = () => {
                const dims = scaleImageDimensions(img.naturalWidth || img.width, img.naturalHeight || img.height);
                const canvas = document.createElement('canvas');
                canvas.width = dims.width;
                canvas.height = dims.height;
                const ctx = canvas.getContext('2d', { alpha: false });
                if (!ctx) {
                  reject(new Error('Không thể xử lý ảnh.'));
                  return;
                }
                ctx.drawImage(img, 0, 0, dims.width, dims.height);
                canvas.toBlob((blob) => {
                  if (!blob) {
                    reject(new Error('Không thể chuyển đổi ảnh.'));
                    return;
                  }
                  const finalReader = new FileReader();
                  finalReader.onload = () => {
                    resolve({
                      name: convertNameToJpg(file.name),
                      size: blob.size,
                      type: 'image/jpeg',
                      data: finalReader.result
                    });
                  };
                  finalReader.onerror = () => reject(finalReader.error || new Error('Không thể đọc ảnh đã chuyển đổi.'));
                  finalReader.readAsDataURL(blob);
                }, 'image/jpeg', NOTE_JPEG_QUALITY);
              };
              img.onerror = () => reject(new Error('Không thể tải ảnh.'));
              img.src = reader.result;
            };
            reader.onerror = () => reject(reader.error || new Error('Không thể đọc ảnh.'));
            reader.readAsDataURL(file);
          });
        }

        function processNonImageFile(file) {
          return new Promise((resolve, reject) => {
            if (file.size > NOTE_MAX_FILE_SIZE) {
              reject({ code: 'FILE_TOO_LARGE', file });
              return;
            }
            const reader = new FileReader();
            reader.onload = () => {
              resolve({
                name: file.name,
                size: file.size,
                type: file.type || 'application/octet-stream',
                data: reader.result
              });
            };
            reader.onerror = () => reject(reader.error || new Error('Không thể đọc tệp.'));
            reader.readAsDataURL(file);
          });
        }

        function setupNoteModal() {
          const imageBtn = document.getElementById('note-attach-image-btn');
          if (imageBtn && !imageBtn._bound) {
            imageBtn._bound = true;
            imageBtn.addEventListener('click', (event) => {
              event.preventDefault();
              const input = document.getElementById('note-image-input');
              if (input) input.click();
            });
          }

          const fileBtn = document.getElementById('note-attach-file-btn');
          if (fileBtn && !fileBtn._bound) {
            fileBtn._bound = true;
            fileBtn.addEventListener('click', (event) => {
              event.preventDefault();
              const input = document.getElementById('note-file-input');
              if (input) input.click();
            });
          }

          const closeBtn = document.getElementById('close-note-modal');
          if (closeBtn && !closeBtn._bound) {
            closeBtn._bound = true;
            closeBtn.addEventListener('click', (event) => {
              event.preventDefault();
              closeQuoteNotesModal();
            });
          }

          const imageInput = document.getElementById('note-image-input');
          if (imageInput && !imageInput._bound) {
            imageInput._bound = true;
            imageInput.addEventListener('change', (event) => {
              handleNoteFiles(event.target.files, { imagesOnly: true });
            });
          }

          const fileInput = document.getElementById('note-file-input');
          if (fileInput && !fileInput._bound) {
            fileInput._bound = true;
            fileInput.addEventListener('change', (event) => {
              handleNoteFiles(event.target.files, { imagesOnly: false });
            });
          }

          const form = document.getElementById('note-compose-form');
          if (form && !form._bound) {
            form._bound = true;
            form.addEventListener('submit', (event) => {
              event.preventDefault();
              if (submitNoteComposer()) {
                resetNoteComposer();
              }
            });
          }

          const messageInput = document.getElementById('note-message-input');
          if (messageInput && !messageInput._bound) {
            messageInput._bound = true;
            messageInput.addEventListener('input', () => {
              syncNoteSubmitState();
            });
            // Allow Enter to send the note, Shift+Enter keeps new lines
            messageInput.addEventListener('keydown', (event) => {
              if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
                return;
              }
              const hasContent = messageInput.value.trim().length > 0 || noteModalState.pendingFiles.length > 0;
              if (!hasContent) {
                return;
              }
              event.preventDefault();
              if (submitNoteComposer()) {
                resetNoteComposer();
              }
            });
          }

          if (!document._noteModalEscBound) {
            document._noteModalEscBound = true;
            document.addEventListener('keydown', (event) => {
              if (event.key === 'Escape') {
                const modal = document.getElementById('quote-notes-modal');
                if (modal && !modal.classList.contains('hidden')) {
                  closeQuoteNotesModal();
                }
              }
            });
          }

          const backdrop = document.getElementById('quote-notes-modal');
          if (backdrop && !backdrop._bound) {
            backdrop._bound = true;
            backdrop.addEventListener('click', (event) => {
              if (event.target === backdrop) {
                closeQuoteNotesModal();
              }
            });
          }
        }

        setupNoteModal();

        // ===== Manage Order Details Modal Logic =====
        const MOD_PAGE_SIZE = 6; // items per page (tune for A4 look)
        function openManageOrderDetailsModal(backendId) {
          const modal = document.getElementById('manage-order-details-modal');
          if (!modal) return;
          const order = productionOrders.find(o => String(o.__backendId) === String(backendId));
          modal.classList.remove('hidden');
          // mark which order is currently open so data updates can re-resolve quotes
          try { modal.dataset.openOrderId = String(backendId); } catch (e) {}
          ensureScrollLock();
          if (!order) {
            document.getElementById('manage-order-details-title').textContent = 'Chi tiết đơn hàng sản xuất';
            document.getElementById('manage-order-details-subtitle').textContent = '';
            document.getElementById('manage-order-pages').innerHTML = '<div class="text-sm text-gray-500">Không tìm thấy đơn hàng.</div>';
            return;
          }
          const title = `Đơn hàng: ${order.spo_number || 'Chưa có số đơn hàng'}`;
          const subtitle = `Đơn vị thi công: ${(order.address && order.address !== 'Chưa nhập đơn vị thi công') ? order.address : 'Chưa có'} • Hạn thi công: ${(order.due_date && order.due_date !== 'Chưa nhập hạn thi công') ? order.due_date : 'Chưa có'}`;
          document.getElementById('manage-order-details-title').textContent = title;
          document.getElementById('manage-order-details-subtitle').textContent = subtitle;
          let quotes = [];
          try { quotes = JSON.parse(order.items || '[]'); } catch (_) { quotes = []; }
          // Resolve each quote reference against authoritative currentQuotes so totals/prices are up-to-date
          try {
            quotes = quotes.map(q => resolveQuoteReference(q));
          } catch (e) { /* ignore resolution errors */ }
          renderManageOrderPages(quotes);
          bindManageOrderPager();
        }

        function renderManageOrderPages(quotes, page=1) {
          const container = document.getElementById('manage-order-pages');
          if (!container) return;
          const totalItems = Array.isArray(quotes) ? quotes.length : 0;
          const pages = Math.max(1, Math.ceil(totalItems / MOD_PAGE_SIZE));
          const safePage = Math.min(Math.max(1, page), pages);
          const totalEl = document.getElementById('mod-page-total');
          if (totalEl) totalEl.textContent = String(pages);
          const totalTopEl = document.getElementById('mod-page-total-top');
          if (totalTopEl) totalTopEl.textContent = String(pages);
          let html = '';
          for (let p = 1; p <= pages; p++) {
            const start = (p - 1) * MOD_PAGE_SIZE;
            const slice = quotes.slice(start, start + MOD_PAGE_SIZE);
            html += `
              <div class="align-top" style="width: 794px; min-width: 794px; height: 100%; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; box-shadow: 0 2px 6px rgba(0,0,0,0.06); background: white; display: flex; flex-direction: column; flex: 0 0 794px;">
                <div class="flex items-center justify-between mb-3 flex-shrink-0">
                  <div class="font-semibold text-gray-800">Danh sách điểm (Trang ${p})</div>
                  <div class="text-sm text-gray-500">${slice.length} điểm</div>
                </div>
                <div class="space-y-2 page-scroll flex-grow" style="overflow-y: auto; padding-right: 8px;">
                  ${slice.map((q, idx) => renderManageOrderPointRow(q, start + idx + 1)).join('')}
                </div>
              </div>`;
          }
          container.innerHTML = html;
          container.style.display = 'flex';
          container.style.flexDirection = 'row';
          container.style.flexWrap = 'nowrap';
          container.style.gap = '0';
          container.style.position = 'relative';
          container.style.alignItems = 'stretch';
          container.style.justifyContent = 'flex-start';
          container.dataset.snap = 'true';
          container._totalPages = pages;
          container._quotes = quotes;
          container._currentPage = 0;
          container.scrollLeft = 0;
          requestAnimationFrame(() => scrollManageOrderToPage(safePage, false));
        }

        // Resolve a quote reference (from production order items) to authoritative currentQuotes entry
        function resolveQuoteReference(ref) {
          if (!ref) return ref || {};
          try {
            const qKey = (typeof getQuoteKey === 'function') ? String(getQuoteKey(ref)) : (ref.__backendId || ref.id || ref.quote_code || ref.quoteCode || '');
            const master = (Array.isArray(currentQuotes) && currentQuotes.length) ? currentQuotes.find(q => {
              try { return (typeof getQuoteKey === 'function') ? String(getQuoteKey(q)) === qKey : (String(q.__backendId || q.id || q.quote_code || q.quoteCode || '') === qKey);
              } catch (e) { return false; }
            }) : null;
            const source = master || ref;
            // Ensure items array and numeric total are normalized for rendering
            let items = [];
            try { items = Array.isArray(source.items) ? source.items : JSON.parse(source.items || '[]'); } catch (e) { items = []; }
            const total_amount = parseMoney(source.total_amount) || parseMoney(ref.total_amount) || 0;
            return { ...source, items: items, total_amount: total_amount };
          } catch (e) { return ref || {}; }
        }

        function scrollManageOrderToPage(page, smooth = true) {
          const container = document.getElementById('manage-order-pages');
          if (!container) return;
          const total = container._totalPages || container.children.length || 1;
          const target = Math.min(Math.max(1, page), total);
          const child = container.children[target - 1];
          if (child) {
            const left = child.offsetLeft;
            if (smooth && typeof container.scrollTo === 'function') {
              container.scrollTo({ left, top: 0, behavior: 'smooth' });
            } else {
              container.scrollLeft = left;
            }
          }
          container._currentPage = target;
          const curEl = document.getElementById('mod-page-cur');
          if (curEl) curEl.textContent = String(target);
        }

        function renderManageOrderPointRow(q, idx) {
          const items = Array.isArray(q.items) ? q.items : (() => { try { return JSON.parse(q.items || '[]'); } catch (_) { return []; } })();
          const totalAmount = (typeof q.total_amount !== 'undefined' && q.total_amount !== null) ? parseMoney(q.total_amount) || 0 : (parseMoney(q.total || 0) || 0);
          const quoteCode = (typeof formatQuoteCode === 'function' && q.quote_code) ? formatQuoteCode(q) : (q.quote_code || q.quoteCode || '-');
          const outletName = q.outlet_name || '-';
          const saleName = q.sale_name || '-';
          const spoNumber = (q.spo_number && q.spo_number !== 'Chưa nhập số đơn hàng') ? q.spo_number : '-';
          const outletCode = q.outlet_code || '-';
          const safeAddress = (q.address && !q.address.startsWith('Địa chỉ sẽ')) ? q.address : '';
          const addressDisplay = safeAddress || 'Chưa có địa chỉ';
          const outletPhone = q.phone || q.outlet_phone || q.contact_phone || '';
          const phoneDisplay = outletPhone || 'Chưa có SĐT';
          return `
            <div>
              <div class="flex items-start justify-between gap-4">
                <div class="flex-1 min-w-0">
                  <div class="text-base font-semibold text-gray-900 leading-tight">
                    ${idx}. ${outletName}
                    <span class="text-sm font-normal text-gray-700"> - Sale: ${saleName} - SPO: ${spoNumber} - Outletcode: ${outletCode}</span>
                  </div>
                  <div class="text-xs text-gray-600 mt-1">Địa chỉ: ${addressDisplay} • SĐT: ${phoneDisplay}</div>
                </div>
                <div style="text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:4px">
                  <div class="text-sm font-semibold text-blue-600 whitespace-nowrap">${formatCurrency(totalAmount)}</div>
                  <div style="font-size:12px;color:#333">Mã BG: <strong>${quoteCode}</strong></div>
                </div>
              </div>
              <div class="mt-2 overflow-x-auto">
                <table class="min-w-full text-xs">
                  <thead class="bg-gray-100">
                    <tr>
                      <th class="px-2 py-1 text-left">Code</th>
                      <th class="px-2 py-1 text-left">Nội dung</th>
                      <th class="px-2 py-1 text-left">Brand</th>
                      <th class="px-2 py-1 text-left">Kích thước</th>
                      <th class="px-2 py-1 text-left">SL</th>
                      <th class="px-2 py-1 text-left">ĐVT</th>
                      <th class="px-2 py-1 text-left">Đơn giá</th>
                      <th class="px-2 py-1 text-left">Thành tiền</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y">
                    ${items.map(it => `
                      <tr>
                        <td class="px-2 py-1">${it.code || ''}</td>
                        <td class="px-2 py-1">${it.content || ''}</td>
                        <td class="px-2 py-1">${it.brand || '-'}</td>
                        <td class="px-2 py-1">${(it.width && it.height) ? `${it.width}m × ${it.height}m` : '-'}</td>
                        <td class="px-2 py-1">${it.quantity || ''}</td>
                        <td class="px-2 py-1">${it.unit || ''}</td>
                        <td class="px-2 py-1">${formatCurrency(parseMoney(it.price) || 0)}</td>
                        <td class="px-2 py-1 text-blue-600 font-semibold">${formatCurrencyExact((parseMoney(it.price) || 0) * (parseNumber(it.quantity) || 0))}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>`;
        }

        function bindManageOrderPager() {
          const prev = document.getElementById('mod-prev');
          const next = document.getElementById('mod-next');
          if (prev && !prev._bound) {
            prev._bound = true;
            prev.addEventListener('click', () => {
              const container = document.getElementById('manage-order-pages');
              if (!container) return;
              const cur = container._currentPage || 1;
              if (cur > 1) scrollManageOrderToPage(cur - 1);
            });
          }
          if (next && !next._bound) {
            next._bound = true;
            next.addEventListener('click', () => {
              const container = document.getElementById('manage-order-pages');
              if (!container) return;
              const cur = container._currentPage || 1;
              const total = container._totalPages || container.children.length || 1;
              if (cur < total) scrollManageOrderToPage(cur + 1);
            });
          }
          const closeBtn = document.getElementById('close-manage-order-details');
          if (closeBtn && !closeBtn._bound) {
            closeBtn._bound = true;
            closeBtn.addEventListener('click', () => {
              const modal = document.getElementById('manage-order-details-modal');
              if (modal) {
                modal.classList.add('hidden');
                try { delete modal.dataset.openOrderId; } catch (e) {}
              }
              ensureScrollLock();
            });
          }
        }

        // Export production list to Excel (Thi công)
        async function exportProductionExcelForOrder(order) {
          try {
            await ensureXlsxLib();

            let quotes = JSON.parse(order.items || '[]');
            // Sort quotes so the earliest/lowest quote appears first.
            try {
              const quoteKeySort = function(q) {
                try {
                  if (typeof extractSequenceFromQuoteCode === 'function') {
                    const s = extractSequenceFromQuoteCode(q && (q.quote_code || q.quoteCode));
                    if (Number.isFinite(s)) return s;
                  }
                } catch (e) {}
                try { if (q && q.created_at) return new Date(q.created_at).getTime(); } catch (e) {}
                return 0;
              };
              if (Array.isArray(quotes) && quotes.length) quotes.sort((a,b) => (quoteKeySort(a) || 0) - (quoteKeySort(b) || 0));
            } catch (e) { /* ignore sort errors */ }
            const data = [];
            data.push(['STT', 'Sale', 'Outlet Info', 'Code', 'Nội dung', 'Brand', 'Width (m)', 'Height (m)', 'SL', 'ĐVT', 'Đơn giá', 'Thành tiền', 'SPO', 'Outlet Code', 'Tổng tiền Outlet']);
            let globalIndex = 0;
            quotes.forEach(q => {
              const items = JSON.parse(q.items || '[]');
              const outletTotal = parseMoney(q.total_amount) || 0;
              items.forEach(item => {
                globalIndex++;
                const priceVal = parseMoney(item.price) || 0;
                const qtyVal = parseNumber(item.quantity) || 0;
                const parsedTotal = parseMoney(item.total) || 0;
                const computedTotal = priceVal * qtyVal;
                const useTotal = (parsedTotal > 0 && Math.abs(parsedTotal - computedTotal) / (computedTotal || 1) <= 0.1) ? parsedTotal : computedTotal;
                // Do NOT set values for merged columns here (only set at start row later).
                  data.push([
                    '',
                    q.sale_name || '',
                    `${q.outlet_name || ''}\n(${q.address || ''})\n${q.phone || q.outlet_phone || q.contact_phone || ''}`,
                    item.code || '',
                    item.content || '',
                    item.brand || '',
                    item.width || '',
                    item.height || '',
                    item.quantity || '',
                    item.unit || '',
                    priceVal || 0,
                    useTotal || 0,
                    q.spo_number || '',
                    q.outlet_code || '',
                    outletTotal || 0
                  ]);
              });
            });

            const merges = [];
            const groups = {};
            data.forEach((row, idx) => {
              if (idx === 0) return; // skip header
              const key = `${row[2] || ''}|${row[12] || ''}|${row[13] || ''}`; // C, M, N
              if (!groups[key]) groups[key] = [];
              groups[key].push(idx);
            });

            // For each group of rows, only keep values at the start row for merged columns, then create merges
            Object.values(groups).forEach(indices => {
              if (indices.length > 1) {
                indices.sort((a, b) => a - b);
                const start = Math.min(...indices);
                const end = Math.max(...indices);
                const mergeCols = [0, 1, 2, 12, 13, 14];
                mergeCols.forEach(c => {
                  const val = data[start] && data[start][c] ? data[start][c] : '';
                  if (!data[start]) data[start] = [];
                  data[start][c] = val;
                  for (let k = 1; k < indices.length; k++) {
                    const ridx = indices[k];
                    if (!data[ridx]) continue;
                    data[ridx][c] = '';
                  }
                });
                data[start][0] = 1;
                merges.push({ s: { r: start, c: 0 }, e: { r: end, c: 0 } });
                merges.push({ s: { r: start, c: 1 }, e: { r: end, c: 1 } });
                merges.push({ s: { r: start, c: 2 }, e: { r: end, c: 2 } });
                merges.push({ s: { r: start, c: 12 }, e: { r: end, c: 12 } });
                merges.push({ s: { r: start, c: 13 }, e: { r: end, c: 13 } });
                merges.push({ s: { r: start, c: 14 }, e: { r: end, c: 14 } });
              }
            });
            const ws = XLSX.utils.aoa_to_sheet(data);
            ws['!merges'] = merges;
            // Format numeric money columns: Đơn giá (10), Thành tiền (11), Tổng tiền Outlet (14)
            try {
              const lastRow = data.length - 1;
              for (let r = 1; r <= lastRow; r++) {
                [10, 11, 14].forEach(c => {
                  const cellRef = XLSX.utils.encode_cell({ c, r });
                  if (ws[cellRef] && ws[cellRef].t === 'n') ws[cellRef].z = '#,##0';
                });
              }
            } catch (e) { /* ignore formatting errors */ }
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Thi công');
            const filename = `Thi_cong_${order.spo_number || 'Chua_co'}.xlsx`;
            XLSX.writeFile(wb, filename);
          } catch (e) {
            console.error('exportProductionExcel error', e);
            if (typeof showToast === 'function') showToast('Không thể xuất Excel: ' + (e.message || 'Lỗi'));
          }
        }

        // Export pending order to Excel (Thi công - Pending Order)
        async function exportPendingOrderToExcel(orderId) {
          try {
            await ensureXlsxLib();

            const order = pendingOrders.find(o => o.id === orderId);
            if (!order) {
              showToast('Không tìm thấy đơn chờ duyệt');
              return;
            }

            let quotes = order.quotes;
            // Sort quotes so the earliest/lowest quote appears first
            try {
              const quoteKeySort = function(q) {
                try {
                  if (typeof extractSequenceFromQuoteCode === 'function') {
                    const s = extractSequenceFromQuoteCode(q && (q.quote_code || q.quoteCode));
                    if (Number.isFinite(s)) return s;
                  }
                } catch (e) {}
                try { if (q && q.created_at) return new Date(q.created_at).getTime(); } catch (e) {}
                return 0;
              };
              if (Array.isArray(quotes) && quotes.length) quotes.sort((a,b) => (quoteKeySort(a) || 0) - (quoteKeySort(b) || 0));
            } catch (e) { /* ignore sort errors */ }

            const data = [];
            data.push(['STT', 'Sale', 'Outlet Info', 'Code', 'Nội dung', 'Brand', 'Width (m)', 'Height (m)', 'SL', 'ĐVT', 'Đơn giá', 'Thành tiền', 'SPO', 'Outlet Code', 'Tổng tiền Outlet']);
            
            let globalIndex = 0;
            quotes.forEach(q => {
              const items = JSON.parse(q.items || '[]');
              const outletTotal = parseMoney(q.total_amount) || 0;
              items.forEach(item => {
                globalIndex++;
                const priceVal = parseMoney(item.price) || 0;
                const qtyVal = parseNumber(item.quantity) || 0;
                const parsedTotal = parseMoney(item.total) || 0;
                const computedTotal = priceVal * qtyVal;
                const useTotal = (parsedTotal > 0 && Math.abs(parsedTotal - computedTotal) / (computedTotal || 1) <= 0.1) ? parsedTotal : computedTotal;
                data.push([
                  '',
                  q.sale_name || '',
                  `${q.outlet_name || ''}\n(${q.address || ''})\n${q.phone || q.outlet_phone || q.contact_phone || ''}`,
                  item.code || '',
                  item.content || '',
                  item.brand || '',
                  item.width || '',
                  item.height || '',
                  item.quantity || '',
                  item.unit || '',
                  priceVal || 0,
                  useTotal || 0,
                  q.spo_number || '',
                  q.outlet_code || '',
                  outletTotal || 0
                ]);
              });
            });

            // Create merges for grouped rows
            const merges = [];
            const groups = {};
            data.forEach((row, idx) => {
              if (idx === 0) return; // skip header
              const key = `${row[2] || ''}|${row[12] || ''}|${row[13] || ''}`; // C, M, N
              if (!groups[key]) groups[key] = [];
              groups[key].push(idx);
            });

            // For each group of rows, only keep values at the start row for merged columns
            Object.values(groups).forEach(indices => {
              if (indices.length > 1) {
                indices.sort((a, b) => a - b);
                const start = Math.min(...indices);
                const end = Math.max(...indices);
                const mergeCols = [0, 1, 2, 12, 13, 14];
                mergeCols.forEach(c => {
                  const val = data[start] && data[start][c] ? data[start][c] : '';
                  if (!data[start]) data[start] = [];
                  data[start][c] = val;
                  for (let k = 1; k < indices.length; k++) {
                    const ridx = indices[k];
                    if (!data[ridx]) continue;
                    data[ridx][c] = '';
                  }
                });
                data[start][0] = 1;
                merges.push({ s: { r: start, c: 0 }, e: { r: end, c: 0 } });
                merges.push({ s: { r: start, c: 1 }, e: { r: end, c: 1 } });
                merges.push({ s: { r: start, c: 2 }, e: { r: end, c: 2 } });
                merges.push({ s: { r: start, c: 12 }, e: { r: end, c: 12 } });
                merges.push({ s: { r: start, c: 13 }, e: { r: end, c: 13 } });
                merges.push({ s: { r: start, c: 14 }, e: { r: end, c: 14 } });
              }
            });

            const ws = XLSX.utils.aoa_to_sheet(data);
            ws['!merges'] = merges;
            
            // Format numeric money columns: Đơn giá (10), Thành tiền (11), Tổng tiền Outlet (14)
            try {
              const lastRow = data.length - 1;
              for (let r = 1; r <= lastRow; r++) {
                [10, 11, 14].forEach(c => {
                  const cellRef = XLSX.utils.encode_cell({ c, r });
                  if (ws[cellRef] && ws[cellRef].t === 'n') ws[cellRef].z = '#,##0';
                });
              }
            } catch (e) { /* ignore formatting errors */ }

            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Thi công');
            
            // Generate filename with timestamp
            const timestamp = new Date(order.createdAt).toLocaleDateString('vi-VN').replace(/\//g, '-');
            const filename = `Don_cho_duyet_${order.createdBy}_${timestamp}.xlsx`;
            
            XLSX.writeFile(wb, filename);
            showToast('Đã xuất Excel thành công');
          } catch (e) {
            console.error('exportPendingOrderToExcel error', e);
            showToast('Không thể xuất Excel: ' + (e.message || 'Lỗi'));
          }
        }

        // Export generate order to Excel (Ra Đơn Hàng)
        async function exportGenerateOrderExcel(order) {
          try {
            await ensureXlsxLib();

            let quotes = JSON.parse(order.items || '[]');
            // Ensure quotes are ordered by earliest quote first (by code sequence or created_at)
            try {
              const quoteKeySort = function(q) {
                try {
                  if (typeof extractSequenceFromQuoteCode === 'function') {
                    const s = extractSequenceFromQuoteCode(q && (q.quote_code || q.quoteCode));
                    if (Number.isFinite(s)) return s;
                  }
                } catch (e) {}
                try { if (q && q.created_at) return new Date(q.created_at).getTime(); } catch (e) {}
                return 0;
              };
              if (Array.isArray(quotes) && quotes.length) quotes.sort((a,b) => (quoteKeySort(a) || 0) - (quoteKeySort(b) || 0));
            } catch (e) { /* ignore */ }
            // Build rows grouped by Sale to match PDF ordering (shipping sorting removed)
            const data = [];
            data.push(['STT', 'Sale', 'Outlet Info', 'Code', 'Nội dung', 'Brand', 'Width (m)', 'Height (m)', 'SL', 'ĐVT', 'Đơn giá', 'Thành tiền', 'SPO', 'Outlet Code', 'Tổng tiền Outlet']);
            let globalIndex = 0;
            const groupedBySale = {};
            const saleOrder = [];
            quotes.forEach(q => {
              const saleType = q.sale_type === 'TBA' ? 'TBA' : 'Sale (SR)';
              const saleName = q.sale_name || 'Không có tên';
              const saleKey = `${saleType} - ${saleName}`;
              if (!groupedBySale[saleKey]) { groupedBySale[saleKey] = []; saleOrder.push(saleKey); }
              groupedBySale[saleKey].push(q);
            });

            saleOrder.forEach(saleKey => {
              const group = groupedBySale[saleKey] || [];
              group.forEach(q => {
                const items = JSON.parse(q.items || '[]');
                const outletTotal = parseMoney(q.total_amount) || 0;
                items.forEach(item => {
                  globalIndex++;
                  const priceVal = parseMoney(item.price) || 0;
                  const qtyVal = parseNumber(item.quantity) || 0;
                  const parsedTotal = parseMoney(item.total) || 0;
                  const computedTotal = priceVal * qtyVal;
                  // Prefer parsedTotal when it closely matches computedTotal; otherwise prefer computedTotal
                  const useTotal = (parsedTotal > 0 && Math.abs(parsedTotal - computedTotal) / (computedTotal || 1) <= 0.1) ? parsedTotal : computedTotal;
                  data.push([
                    '',
                    q.sale_name || '',
                    `${q.outlet_name || ''}\n(${q.address || ''})\n${q.phone || q.outlet_phone || q.contact_phone || ''}`,
                    item.code || '',
                    item.content || '',
                    item.brand || '',
                    item.width || '',
                    item.height || '',
                    item.quantity || '',
                    item.unit || '',
                    priceVal,
                    useTotal || 0,
                    q.spo_number || '',
                    q.outlet_code || '',
                    parseMoney(q.total_amount) || 0
                  ]);
                });
              });
            });

            const merges = [];
            const groups = {};
            data.forEach((row, idx) => {
              if (idx === 0) return; // skip header
              const key = `${row[2] || ''}|${row[12] || ''}|${row[13] || ''}`; // C, M, N
              if (!groups[key]) groups[key] = [];
              groups[key].push(idx);
            });

            // For each group of rows, only keep values at the start row for merged columns, then create merges
            Object.values(groups).forEach(indices => {
              if (indices.length > 1) {
                indices.sort((a, b) => a - b);
                const start = Math.min(...indices);
                const end = Math.max(...indices);
                const mergeCols = [0, 1, 2, 12, 13, 14];
                mergeCols.forEach(c => {
                  const val = data[start] && data[start][c] ? data[start][c] : '';
                  if (!data[start]) data[start] = [];
                  data[start][c] = val;
                  for (let k = 1; k < indices.length; k++) {
                    const ridx = indices[k];
                    if (!data[ridx]) continue;
                    data[ridx][c] = '';
                  }
                });
                data[start][0] = 1;
                merges.push({ s: { r: start, c: 0 }, e: { r: end, c: 0 } });
                merges.push({ s: { r: start, c: 1 }, e: { r: end, c: 1 } });
                merges.push({ s: { r: start, c: 2 }, e: { r: end, c: 2 } });
                merges.push({ s: { r: start, c: 12 }, e: { r: end, c: 12 } });
                merges.push({ s: { r: start, c: 13 }, e: { r: end, c: 13 } });
                merges.push({ s: { r: start, c: 14 }, e: { r: end, c: 14 } });
              }
            });
            const ws = XLSX.utils.aoa_to_sheet(data);
            ws['!merges'] = merges;
            // Format numeric money columns: Đơn giá (10), Thành tiền (11), Tổng tiền Outlet (14)
            try {
              const lastRow = data.length - 1;
              for (let r = 1; r <= lastRow; r++) {
                [10, 11, 14].forEach(c => {
                  const cellRef = XLSX.utils.encode_cell({ c, r });
                  if (ws[cellRef] && ws[cellRef].t === 'n') ws[cellRef].z = '#,##0';
                });
              }
            } catch (e) { /* ignore formatting errors */ }
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Ra Đơn Hàng');
            const filename = `Ra_don_hang_${order.spo_number || 'Chua_co'}.xlsx`;
            XLSX.writeFile(wb, filename);
            // Mark order as exported and persist
            try {
              const now = new Date().toISOString();
              order.is_exported = true;
              order.exported_at = now;
              order.qcag_status = 'Đã ra đơn';
              if (window.dataSdk && typeof window.dataSdk.update === 'function') {
                try { window.dataSdk.update(order); } catch (e) { /* ignore */ }
              }
              // Re-render list to reflect status change
              try { renderProductionOrdersList(productionOrders); } catch (e) { /* ignore */ }
            } catch (err) { /* ignore marking errors */ }
          } catch (e) {
            console.error('exportGenerateOrderExcel error', e);
            if (typeof showToast === 'function') showToast('Không thể xuất Excel: ' + (e.message || 'Lỗi'));
          }
        }

        // Export production list to A4 PDF (Thi công) — replaces "Mã BG" with a square box for on-paper marking
        async function exportProductionPdf() {
          try {
            const container = document.getElementById('manage-order-pages');
            const titleText = (document.getElementById('manage-order-details-title') || {}).textContent || '';
            const subtitleText = (document.getElementById('manage-order-details-subtitle') || {}).textContent || '';
            const quotes = (container && container._quotes) ? container._quotes : [];

            const printEl = document.createElement('div');
            printEl.id = 'print-production-container';
            printEl.style.background = '#fff';
            printEl.style.width = 'calc(190mm + 10px)';
            printEl.style.minHeight = '277mm';
            printEl.style.boxSizing = 'border-box';
            printEl.style.padding = '15px';
            printEl.style.margin = '0 auto';
            printEl.style.fontFamily = 'Segoe UI, Arial, sans-serif';
            printEl.style.color = '#111';
            printEl.style.fontSize = '12px';

            // Ensure QR library (QRious) is loaded before generating QR images
            function ensureQrLib() {
              if (typeof window.QRious === 'function') return Promise.resolve();
              return new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrious/4.0.2/qrious.min.js';
                s.onload = () => resolve();
                s.onerror = () => reject(new Error('Không tải được thư viện QRious'));
                document.head.appendChild(s);
              });
            }

            const orderMatch = titleText.match(/Đơn hàng:\s*(.*)/i);
            const orderNumber = orderMatch ? orderMatch[1].trim() : (titleText || '');
            const unitMatch = subtitleText.match(/Đơn vị thi công:\s*([^•]+)/i);
            const unit = unitMatch ? unitMatch[1].trim() : '';
            const dueMatch = subtitleText.match(/Hạn thi công:\s*(.*)/i);
            const due = dueMatch ? dueMatch[1].trim() : '';
            var displayDue = 'Chưa có';
            if (due) {
              var dObj = new Date(due);
              if (!isNaN(dObj)) displayDue = dObj.toLocaleDateString('vi-VN');
              else displayDue = due;
            }

            const headerHtml = `
              <div style="text-align:center;margin-bottom:8mm">
                <h1 style="margin:0;font-size:18px;">Danh sách thi công đơn hàng: <strong style="font-weight:700">${escapeHtml(orderNumber)}</strong></h1>
                <div style="font-size:12px;color:#555;margin-top:6px">Thi công: <strong>${escapeHtml(unit)}</strong> - Thời hạn thi công <strong>${escapeHtml(displayDue)}</strong></div>
              </div>
              <div style="margin-bottom:6mm;font-size:12px;">Tổng điểm: ${quotes.length}</div>
            `;

            // Render per-outlet WITHOUT prices; show QR (encoding outlet name) instead of square box
            function renderManageOrderPointRowNoPrice(q, idx, qrDataUrl) {
              const items = (() => { try { return JSON.parse(q.items || '[]'); } catch (_) { return []; } })();
              // Filter out unwanted item categories for PDF export:
              // - Remove items whose content mentions 'Giấy phép' or 'Vận chuyển'
              // - If the quote contains an item with code '2.1', also remove items with code 'S9.17' (tôn kẽm)
              const hasCode21 = Array.isArray(items) && items.some(it => String((it.code || '')).replace(/^s/i, '').trim() === '2.1');
              const filteredItems = (Array.isArray(items) ? items : []).filter(it => {
                try {
                  const codeRaw = String(it.code || '').trim();
                  const codeNorm = codeRaw.replace(/^s/i, '').trim();
                  const content = String(it.content || '').toLowerCase();
                  if (content.includes('giấy phép') || content.includes('vận chuyển')) return false;
                  if (codeNorm === '9.17' || /^s9\.17$/i.test(codeRaw)) {
                    // only remove S9.17 when code 2.1 is present
                    if (hasCode21) return false;
                  }
                } catch (e) {
                  return true;
                }
                return true;
              });
              const outletName = q.outlet_name || '-';
              const saleName = q.sale_name || '-';
              const spoNumber = (q.spo_number && q.spo_number !== 'Chưa nhập số đơn hàng') ? q.spo_number : '-';
              const outletCode = q.outlet_code || '-';
              const safeAddress = (q.address && !q.address.startsWith('Địa chỉ sẽ')) ? q.address : '';
              const addressDisplay = safeAddress || 'Chưa có địa chỉ';
              const outletPhone = q.phone || q.outlet_phone || q.contact_phone || '';
              const phoneDisplay = outletPhone || 'Chưa có SĐT';
              const salePhone = q.sale_phone || q.sale_phone_number || q.salePhone || '';
              const salePhoneDisplay = salePhone ? salePhone : 'Chưa có SĐT';
              const quoteCode = (typeof formatQuoteCode === 'function' && q.quote_code) ? formatQuoteCode(q) : (q.quote_code || q.quoteCode || '-');

              return `
                <div>
                  <div class="flex items-start justify-between gap-4">
                    <div class="flex-1 min-w-0">
                      <div class="text-base font-semibold text-gray-900 leading-tight">
                        ${idx}. ${escapeHtml(outletName)}
                        <span class="text-sm font-normal text-gray-700"> - Sale: ${escapeHtml(saleName)} <span class="text-xs text-gray-500">(SĐT Sale: ${escapeHtml(salePhoneDisplay)})</span></span>
                      </div>
                      <div class="text-xs text-gray-600 mt-1">Địa chỉ: ${escapeHtml(addressDisplay)} • SĐT: ${escapeHtml(phoneDisplay)}</div>
                      <div class="text-xs text-gray-700 mt-1">SPO: ${escapeHtml(spoNumber)} • Outletcode: ${escapeHtml(outletCode)}</div>
                    </div>
                    <div class="text-right">
                      <!-- Quote code label on the left, QR on the right; aligned to bottom -->
                      <div style="display:flex;align-items:flex-end;gap:12px;justify-content:flex-end">
                        <div style="height:72px;display:flex;flex-direction:column;justify-content:flex-end;text-align:right;font-size:12px;color:#333;">
                          <div style="font-style:italic;">Dùng ZALO quét mã QR</div>
                          <div style="font-style:italic;">để xem hình ảnh phối cảnh</div>
                          <div style="font-weight:600;">Mã BG: <span style="font-weight:700;">${escapeHtml(quoteCode)}</span></div>
                        </div>
                        ${qrDataUrl ? `<div style="width:72px;height:72px;display:flex;align-items:center;justify-content:center;border:1px solid #333;border-radius:6px;background:#fff;padding:4px;box-sizing:border-box"><img src="${qrDataUrl}" alt="QR" style="width:100%;height:100%;display:block;object-fit:contain;border-radius:2px"/></div>` : `<div style="width:72px;height:72px;border:1px solid #333;border-radius:6px;background:#fff"></div>`}
                      </div>
                    </div>
                  </div>
                  <div class="mt-2 overflow-x-auto">
                    <table class="min-w-full text-xs">
                      <thead class="bg-gray-100">
                        <tr>
                          <th class="px-2 py-1 text-left">Code</th>
                          <th class="px-2 py-1 text-left">Nội dung</th>
                          <th class="px-2 py-1 text-left">Brand</th>
                          <th class="px-2 py-1 text-left">Kích thước</th>
                          <th class="px-2 py-1 text-left">SL</th>
                          <th class="px-2 py-1 text-left">ĐVT</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y">
                        ${filteredItems.map(it => `
                          <tr>
                            <td class="px-2 py-1">${escapeHtml(it.code || '')}</td>
                            <td class="px-2 py-1">${escapeHtml(it.content || '')}</td>
                            <td class="px-2 py-1">${escapeHtml(it.brand || '-')}</td>
                            <td class="px-2 py-1">${(it.width && it.height) ? escapeHtml(`${it.width}m × ${it.height}m`) : '-'}</td>
                            <td class="px-2 py-1">${escapeHtml(it.quantity || '')}</td>
                            <td class="px-2 py-1">${escapeHtml(it.unit || '')}</td>
                          </tr>
                        `).join('')}
                      </tbody>
                    </table>
                  </div>
                </div>`;
            }

            // Generate QR before rendering (if library available)
            try {
              await ensureQrLib();
            } catch (e) {
              console.warn('QR library load failed', e);
            }

            // Generate QR images for each quote. Prefer images from the original/master quote
            // (lookup via `findQuoteByKey`) before falling back to the copy inside the production order.
            // If the image is a data URL, attempt upload via `qcagUploadImageDataUrl`, then try creating a shortlink.
            const qrMap = [];
            for (let qi = 0; qi < quotes.length; qi++) {
              const q = quotes[qi];
              try {
                let val = '';
                try {
                  // Prefer master quote images when available
                  let master = null;
                  try { master = (typeof findQuoteByKey === 'function') ? findQuoteByKey(getQuoteKey(q)) : null; } catch (e) { master = null; }
                  const imagesField = (master && master.images) ? master.images : q.images;
                  const imgs = JSON.parse(imagesField || '[]');
                  if (Array.isArray(imgs) && imgs.length) {
                    const first = imgs[0] || {};
                    val = String(first.url || first.data || first.src || '') || '';
                    if (val && val.indexOf('data:image/') === 0 && typeof qcagUploadImageDataUrl === 'function') {
                      try {
                        const uploaded = await qcagUploadImageDataUrl(val, (first.name || ('img_' + Date.now())));
                        if (uploaded) val = uploaded;
                      } catch (e) { /* ignore upload errors */ }
                    }
                  }
                } catch (e) { /* ignore parse errors */ }

                if (!val) val = q.outlet_name || '';

                // Try to create a shortlink via backend. Expect POST { target } -> { ok:true, shortUrl }
                let shortUrl = '';
                try {
                  const base = (window.API_BASE_URL || '').replace(/\/+$/, '');
                  if (base) {
                    const resp = await fetch(base + '/shortlinks', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ target: val })
                    });
                    if (resp && resp.ok) {
                      const j = await resp.json().catch(() => null);
                      if (j && j.shortUrl) shortUrl = String(j.shortUrl);
                      else if (j && j.code) shortUrl = base + '/r/' + String(j.code);
                    }
                  }
                } catch (e) { /* ignore shortlink creation errors */ }

                const qrValue = shortUrl || val;
                if (typeof QRious === 'function') {
                  try {
                    const qr = new QRious({ value: qrValue, size: 256 });
                    qrMap.push(qr.toDataURL());
                    continue;
                  } catch (e) { console.warn('QR generation error', e); }
                }
              } catch (e) {
                console.warn('QR map loop error', e);
              }
              qrMap.push(null);
            }

            // Group quotes by sale while preserving original order of groups and items
            const groupedBySale = {};
            const saleOrder = [];
            quotes.forEach(q => {
              const saleType = q.sale_type === 'TBA' ? 'TBA' : 'Sale (SR)';
              const saleName = q.sale_name || 'Không có tên';
              const saleKey = `${saleType} - ${saleName}`;
              if (!groupedBySale[saleKey]) { groupedBySale[saleKey] = []; saleOrder.push(saleKey); }
              groupedBySale[saleKey].push(q);
            });

            let globalIndex = 0;
            let bodyHtml = '';
            saleOrder.forEach(saleKey => {
              const group = groupedBySale[saleKey] || [];
              const groupTotal = group.reduce((s, q) => s + (parseMoney(q.total_amount) || 0), 0);
              // Spacer preserved, sale header intentionally removed per request
              bodyHtml += '<div style="margin-bottom:8px;"></div>';
              group.forEach(q => {
                globalIndex++;
                const originalIndex = quotes.indexOf(q);
                const qr = (Array.isArray(qrMap) ? qrMap[originalIndex] : null);
                bodyHtml += `<div class="print-outlet" style="margin-bottom:5px;border:1px solid #333;border-radius:6px;padding:8px;">${renderManageOrderPointRowNoPrice(q, globalIndex, qr)}</div>`;
              });
            });

            if (!bodyHtml) bodyHtml = '<div style="color:#666;font-size:12px">Không có dữ liệu</div>';

            printEl.innerHTML = headerHtml + bodyHtml;

            const styleTag = document.createElement('style');
            styleTag.id = 'print-production-style';
            styleTag.textContent = `
              @media print {
                @page { size: A4 portrait; margin: 10mm; @bottom-center { content: counter(page) " / " counter(pages) " trang"; } }
                body > *:not(#print-production-container) { display: none !important; }
                /* Center and constrain to printable area, padding 15px */
                #print-production-container { box-shadow: none !important; margin: 0 auto !important; width: calc(190mm + 10px); padding: 15px; box-sizing: border-box; position: relative; left: -30px; }
                #print-production-container .print-outlet { page-break-inside: avoid; margin-bottom: 5px; width: 100%; box-sizing: border-box; border: 1px solid #333; border-radius: 6px; padding: 8px; }
                #print-production-container .manage-page { page-break-inside: avoid; }
                /* Tables: horizontal separators only + compact header */
                #print-production-container table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 11px; box-sizing: border-box; }
                #print-production-container thead th { background: #f3f4f6; padding: 4px 8px; font-weight: 700; color: #111; }
                #print-production-container thead th:first-child { border-top-left-radius: 8px; border-bottom-left-radius: 8px; }
                #print-production-container thead th:last-child { border-top-right-radius: 8px; border-bottom-right-radius: 8px; }
                #print-production-container th, #print-production-container td { border: none; padding: 4px 6px; text-align: left; vertical-align: top; }
                /* Darken horizontal separators for print */
                #print-production-container tbody tr td { border-bottom: 1px solid #333; }
                /* Remove extra vertical spacing inside outlet blocks */
                #print-production-container .print-outlet > * { margin-top: 0 !important; margin-bottom: 0 !important; }
                #print-production-container .print-outlet .mt-2 { margin-top: 2px !important; }
                #print-production-container .print-outlet table { margin-top: 4px !important; margin-bottom: 4px !important; }
                /* Make images and wide elements scale down to available width */
                #print-production-container img, #print-production-container svg { max-width: 100% !important; height: auto !important; }
              }
              /* Preview styles when not printing */
              #print-production-container { width: calc(190mm + 10px); margin: 0 auto; padding: 15px; box-sizing: border-box; position: relative; left: -30px; }
              /* Preview: also make separators and outlet frames more visible */
              #print-production-container .print-outlet { border: 1px solid #333; border-radius: 6px; padding: 8px; }
              #print-production-container tbody tr td { border-bottom: 1px solid #333; }
              #print-production-container table { width: 100%; border-collapse: separate; border-spacing: 0; }
              #print-production-container thead th { background: #f3f4f6; padding: 4px 8px; font-weight: 700; color: #111; }
              #print-production-container th, #print-production-container td { padding: 4px 6px; }
            `;

            document.head.appendChild(styleTag);
            document.body.appendChild(printEl);

            function cleanup() {
              try { document.body.removeChild(printEl); } catch (e) { /* ignore */ }
              try { document.head.removeChild(styleTag); } catch (e) { /* ignore */ }
              window.removeEventListener('afterprint', cleanup);
              try { document.getElementById('export-production-pdf-btn').disabled = false; } catch (e) { }
            }

            window.addEventListener('afterprint', cleanup);
            try { document.getElementById('export-production-pdf-btn').disabled = true; } catch (e) { }
            setTimeout(() => { window.print(); }, 50);
          } catch (e) {
            console.error('exportProductionPdf error', e);
            if (typeof showToast === 'function') showToast('Không thể xuất PDF: ' + (e.message || 'Lỗi'));
          }
        }

        // Bind export button
        const exportBtn = document.getElementById('export-production-pdf-btn');
        if (exportBtn && !exportBtn._bound) {
          exportBtn._bound = true;
          exportBtn.addEventListener('click', exportProductionPdf);
        }

        // Independent 'Ra Đơn Hàng' exporter (duplicate of Thi công's behavior but includes prices)
        function exportGenerateOrderPdf() {
          try {
            const container = document.getElementById('manage-order-pages');
            const title = (document.getElementById('manage-order-details-title') || {}).textContent || '';
            const subtitle = (document.getElementById('manage-order-details-subtitle') || {}).textContent || '';
            const quotes = (container && container._quotes) ? container._quotes : [];

            const printEl = document.createElement('div');
            printEl.id = 'print-generate-container';
            printEl.style.background = '#fff';
            printEl.style.width = 'calc(190mm + 10px)';
            printEl.style.minHeight = '277mm';
            printEl.style.boxSizing = 'border-box';
            printEl.style.padding = '15px';
            printEl.style.margin = '0 auto';
            printEl.style.fontFamily = 'Segoe UI, Arial, sans-serif';
            printEl.style.color = '#111';
            printEl.style.fontSize = '12px';

            const titleText = (document.getElementById('manage-order-details-title') || {}).textContent || title;
            const subtitleText = (document.getElementById('manage-order-details-subtitle') || {}).textContent || subtitle;
            const orderMatch = titleText.match(/Đơn hàng:\s*(.*)/i);
            const orderNumber = orderMatch ? orderMatch[1].trim() : (titleText || '');
            const unitMatch = subtitleText.match(/Đơn vị thi công:\s*([^•]+)/i);
            const unit = unitMatch ? unitMatch[1].trim() : '';
            const dueMatch = subtitleText.match(/Hạn thi công:\s*(.*)/i);
            const due = dueMatch ? dueMatch[1].trim() : '';
            var displayDue = 'Chưa có';
            if (due) {
              var dObj = new Date(due);
              if (!isNaN(dObj)) displayDue = dObj.toLocaleDateString('vi-VN');
              else displayDue = due;
            }

            // Total money of all quotes (for header on page 1)
            const totalAmount = (quotes || []).reduce((s, q) => s + (parseMoney(q.total_amount) || 0), 0);

            const headerHtml = `
              <div style="text-align:center;margin-bottom:8mm">
                <h1 style="margin:0;font-size:18px;">Danh sách thi công đơn hàng: <strong style="font-weight:700">${escapeHtml(orderNumber)}</strong></h1>
                <div style="font-size:12px;color:#555;margin-top:6px">Thi công: <strong>${escapeHtml(unit)}</strong> - Thời hạn thi công <strong>${escapeHtml(displayDue)}</strong></div>
                <div style="font-size:13px;color:#111;margin-top:8px">Tổng tiền toàn bộ: <strong>${formatCurrency(totalAmount)}</strong></div>
              </div>
              <div style="margin-bottom:6mm;font-size:12px;">Tổng điểm: ${quotes.length}</div>
            `;

            // Group quotes by sale and render groups with continuous numbering
            const groupedBySale2 = {};
            const saleOrder2 = [];
            quotes.forEach(q => {
              const saleType = q.sale_type === 'TBA' ? 'TBA' : 'Sale (SR)';
              const saleName = q.sale_name || 'Không có tên';
              const saleKey = `${saleType} - ${saleName}`;
              if (!groupedBySale2[saleKey]) { groupedBySale2[saleKey] = []; saleOrder2.push(saleKey); }
              groupedBySale2[saleKey].push(q);
            });

            let globalIndex2 = 0;
            let bodyHtml = '';
            saleOrder2.forEach(saleKey => {
              const group = groupedBySale2[saleKey] || [];
              const groupTotal = group.reduce((s, q) => s + (parseMoney(q.total_amount) || 0), 0);
              bodyHtml += `<div style="margin-bottom:8px;"><h2 style="margin:0;font-size:14px;">${escapeHtml(saleKey)} (${group.length} báo giá - ${formatCurrency(groupTotal)})</h2></div>`;
              group.forEach(q => {
                globalIndex2++;
                bodyHtml += `<div class="print-outlet" style="margin-bottom:5px;border:1px solid #333;border-radius:6px;padding:8px;">${renderManageOrderPointRow(q, globalIndex2)}</div>`;
              });
            });
            if (!bodyHtml) bodyHtml = '<div style="color:#666;font-size:12px">Không có dữ liệu</div>';

            printEl.innerHTML = headerHtml + bodyHtml;

            const styleTag = document.createElement('style');
            styleTag.id = 'print-generate-style';
            styleTag.textContent = `
              @media print {
                @page { size: A4 portrait; margin: 10mm; @bottom-center { content: counter(page) " / " counter(pages) " trang"; } }
                body > *:not(#print-generate-container) { display: none !important; }
                #print-generate-container { box-shadow: none !important; margin: 0 auto !important; width: calc(190mm + 10px); padding: 15px; box-sizing: border-box; position: relative; left: -30px; }
                #print-generate-container .print-outlet { page-break-inside: avoid; margin-bottom: 5px; width: 100%; box-sizing: border-box; }
                #print-generate-container table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 11px; box-sizing: border-box; }
                #print-generate-container thead th { background: #f3f4f6; padding: 4px 8px; font-weight: 700; color: #111; }
                #print-generate-container th, #print-generate-container td { border: none; padding: 4px 6px; text-align: left; vertical-align: top; }
                #print-generate-container tbody tr td { border-bottom: 1px solid #333; }
              }
              #print-generate-container { width: calc(190mm + 10px); margin: 0 auto; padding: 15px; box-sizing: border-box; position: relative; left: -30px; }
              #print-generate-container table { width: 100%; border-collapse: separate; border-spacing: 0; }
              #print-generate-container thead th { background: #f3f4f6; padding: 4px 8px; font-weight: 700; color: #111; }
              #print-generate-container th, #print-generate-container td { padding: 4px 6px; }
            `;

            document.head.appendChild(styleTag);
            document.body.appendChild(printEl);

            function cleanup() {
              try { document.body.removeChild(printEl); } catch (e) { /* ignore */ }
              try { document.head.removeChild(styleTag); } catch (e) { /* ignore */ }
              window.removeEventListener('afterprint', cleanup);
              try { document.getElementById('generate-order-pdf-btn').disabled = false; } catch (e) { }
            }

            window.addEventListener('afterprint', cleanup);
            try { document.getElementById('generate-order-pdf-btn').disabled = true; } catch (e) { }
            setTimeout(() => { window.print(); }, 50);
          } catch (e) {
            console.error('exportGenerateOrderPdf error', e);
            if (typeof showToast === 'function') showToast('Không thể xuất PDF: ' + (e.message || 'Lỗi'));
          }
        }

        // Bind independent generate order button
        const genBtn = document.getElementById('generate-order-pdf-btn');
        if (genBtn && !genBtn._bound) {
          genBtn._bound = true;
          genBtn.addEventListener('click', exportGenerateOrderPdf);
        }

        // --- Production modal performance helpers ---
        // Avoid repeatedly JSON.parse-ing productionOrders quote_keys/items for every quote.
        // Cache parsed arrays in a WeakMap so we don't mutate order objects (safe for persistence).
        const __qcagProductionOrderParseCache = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;

        function __qcagSafeParseJsonArray(value) {
          if (!value) return [];
          if (Array.isArray(value)) return value;
          if (typeof value !== 'string') return [];
          try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
          } catch (e) {
            return [];
          }
        }

        function __qcagGetParsedOrderPayload(order) {
          if (!order) return { quoteKeys: [], items: [] };
          if (!__qcagProductionOrderParseCache) {
            return {
              quoteKeys: __qcagSafeParseJsonArray(order.quote_keys),
              items: __qcagSafeParseJsonArray(order.items),
            };
          }
          const cached = __qcagProductionOrderParseCache.get(order);
          if (cached) return cached;
          const payload = {
            quoteKeys: __qcagSafeParseJsonArray(order.quote_keys),
            items: __qcagSafeParseJsonArray(order.items),
          };
          __qcagProductionOrderParseCache.set(order, payload);
          return payload;
        }

        function __qcagBuildProductionQuoteKeySet() {
          const set = new Set();
          try {
            if (!Array.isArray(productionOrders) || productionOrders.length === 0) return set;
            for (let oi = 0; oi < productionOrders.length; oi++) {
              const ord = productionOrders[oi];
              if (!ord) continue;
              const payload = __qcagGetParsedOrderPayload(ord);
              const keys = payload.quoteKeys;
              if (Array.isArray(keys) && keys.length) {
                for (let ki = 0; ki < keys.length; ki++) {
                  const k = keys[ki];
                  if (k !== undefined && k !== null && String(k)) set.add(String(k));
                }
              }
              const items = payload.items;
              if (Array.isArray(items) && items.length) {
                for (let ii = 0; ii < items.length; ii++) {
                  const it = items[ii];
                  if (!it) continue;
                  let k2 = '';
                  try {
                    if (typeof getQuoteKey === 'function') k2 = getQuoteKey(it);
                  } catch (e) { /* ignore */ }
                  if (!k2) k2 = it.quote_key || it.quote_code || it.__backendId || it.id || it.spo_number || '';
                  if (k2) set.add(String(k2));
                }
              }
            }
          } catch (e) {
            // ignore
          }
          return set;
        }

        function renderProductionQuotes(quotes) {
            const container = document.getElementById('production-quotes-list');

            const __qcagProfile = (() => {
              try { return String(localStorage.getItem('QCAG_PROFILE_PRODUCTION_MODAL') || '') === '1'; } catch (e) { return false; }
            })();
            const __t0 = (__qcagProfile && window.performance && typeof performance.now === 'function') ? performance.now() : 0;

            if (quotes.length === 0) {
                container.innerHTML = '<p class="text-gray-500 text-center py-6 text-sm">Không có báo giá nào</p>';
                // Reset container state to prevent stale data
                if (container._prodRowMap) container._prodRowMap.clear();
                if (container._prodIndex) container._prodIndex = [];
                if (container._prodVisible) container._prodVisible.clear();
                if (container._prodSearchIndex) container._prodSearchIndex.clear();
                container._prodPage = 1;
                return;
            }

            // Compact, single-line rows matching header (STT - Mã BG - Khu Vực - SPO - Outlet Code - Tên Outlet - Tên Sale - Số Tiền - Trạng Thái)


            // Lọc theo filter trạng thái SPO
            let filterType = window.__productionSPOFilter || 'all';
            const __tFilter0 = (__qcagProfile && window.performance && typeof performance.now === 'function') ? performance.now() : 0;

            // Build once per render (uses WeakMap to avoid repeat JSON.parse)
            const __inProductionKeySet = __qcagBuildProductionQuoteKeySet();

            const filteredQuotes = quotes.filter(quote => {
                const spoNumber = quote.spo_number && String(quote.spo_number).trim();
                const spoStatus = String(quote.spo_status || '').toLowerCase();
                const isApproved = !!spoNumber && (spoStatus.includes('approved') || spoStatus.includes('variation'));
                const isUnapproved = !spoNumber || (!isApproved && (!spoStatus.includes('cancelled') && !spoStatus.includes('rejected') && !spoStatus.includes('accept') && !spoStatus.includes('installed') && !spoStatus.includes('finish')));
                if (filterType === 'approved') return isApproved;
                if (filterType === 'unapproved') return isUnapproved;
              // Exclude quotes that already belong to a production order or have an order number,
              // unless QCAG explicitly indicates a recreate/"Chờ tạo đơn" request.
              try {
                const qKey = (typeof getQuoteKey === 'function') ? String(getQuoteKey(quote)) : '';
                const hasOrderNumber = !!(quote && (quote.qcag_order_number || quote.order_number));
                const inProduction = !!(qKey && __inProductionKeySet && __inProductionKeySet.has(qKey));
                if (hasOrderNumber || inProduction) {
                  const q = computeQCAGStatus(quote);
                  if (!q || q.status !== 'Chờ tạo đơn') return false;
                }
              } catch (e) { /* ignore and proceed */ }
              return isApproved || isUnapproved;
            });

            const __tFilter1 = (__qcagProfile && window.performance && typeof performance.now === 'function') ? performance.now() : 0;

            const __tHtml0 = (__qcagProfile && window.performance && typeof performance.now === 'function') ? performance.now() : 0;

            // Pagination setup (defaults)
            const paginationId = 'production-pagination';
            const pageSizeOptions = [25,50,100,200];
            const defaultPageSize = 50;
            if (!container._prodPageSize) container._prodPageSize = defaultPageSize;
            if (!container._prodPage) container._prodPage = 1;
            const totalMatches = filteredQuotes.length;
            const totalPages = Math.max(1, Math.ceil(totalMatches / container._prodPageSize));
            if (container._prodPage > totalPages) container._prodPage = totalPages;
            const pageStart = (container._prodPage - 1) * container._prodPageSize;
            const pageEnd = pageStart + container._prodPageSize;
            const pageSlice = filteredQuotes.slice(pageStart, pageEnd);
            const pageIds = new Set(pageSlice.map(q => getQuoteKey(q)));

            // Ensure pagination controls exist (insert above the list container)
            (function ensurePaginationControls() {
              let pagEl = document.getElementById(paginationId);
              if (!pagEl) {
                pagEl = document.createElement('div');
                pagEl.id = paginationId;
                pagEl.className = 'flex items-center gap-2 px-2 py-2 text-sm';
                // simple controls: prev, info, next, pageSize
                pagEl.innerHTML = `
                  <button id="production-page-prev" class="px-2 py-1 border rounded">Prev</button>
                  <div id="production-page-info" class="text-xs text-gray-600">Trang ${container._prodPage} / ${totalPages} (${totalMatches})</div>
                  <button id="production-page-next" class="px-2 py-1 border rounded">Next</button>
                  <div class="ml-auto">Số hàng: <select id="production-page-size" class="border px-1 py-0.5">${pageSizeOptions.map(s => `<option value="${s}" ${s===container._prodPageSize? 'selected':''}>${s}</option>`).join('')}</select></div>
                `;
                // insert pagEl above the header row if possible (user requested pagination above header)
                const header = container.previousElementSibling;
                if (header && header.parentNode) header.parentNode.insertBefore(pagEl, header);
                else if (container && container.parentNode) container.parentNode.insertBefore(pagEl, container);
              } else {
                // update info and page-size options
                const info = pagEl.querySelector('#production-page-info');
                if (info) info.textContent = `Trang ${container._prodPage} / ${totalPages} (${totalMatches})`;
                const ps = pagEl.querySelector('#production-page-size');
                if (ps) ps.value = String(container._prodPageSize);
              }

              // bind controls once
              try {
                if (!pagEl._bound) {
                  pagEl._bound = true;
                  const prevBtn = pagEl.querySelector('#production-page-prev');
                  const nextBtn = pagEl.querySelector('#production-page-next');
                  const sizeSel = pagEl.querySelector('#production-page-size');
                  if (prevBtn) prevBtn.addEventListener('click', () => { container._prodPage = Math.max(1, (container._prodPage||1) - 1); renderProductionQuotes(productionModalFilteredQuotes); });
                  if (nextBtn) nextBtn.addEventListener('click', () => { const tp = Math.max(1, Math.ceil((productionModalFilteredQuotes || []).length / container._prodPageSize)); container._prodPage = Math.min(tp, (container._prodPage||1) + 1); renderProductionQuotes(productionModalFilteredQuotes); });
                  if (sizeSel) sizeSel.addEventListener('change', function() { container._prodPageSize = parseInt(this.value, 10) || defaultPageSize; container._prodPage = 1; renderProductionQuotes(productionModalFilteredQuotes); });
                }
              } catch (e) { /* ignore */ }
            })();

            // Incremental DOM rendering: build rows once and then show/hide by diffing ids
            // Store per-container maps on the container element to avoid globals
            // IMPORTANT: If filteredQuotes is empty after filtering, reset container state
            // to prevent stale incremental DOM from blocking fresh renders
            if (filteredQuotes.length === 0 && container._prodRowMap) {
              container._prodRowMap.clear();
              container._prodIndex = [];
              container._prodVisible.clear();
              container._prodSearchIndex.clear();
              container.innerHTML = '<p class="text-gray-500 text-center py-6 text-sm">Không có báo giá nào</p>';
              return;
            }
            
            if (!container._prodRowMap) {
              container._prodRowMap = new Map(); // id -> element
              container._prodIndex = []; // array of ids in insertion order
              container._prodVisible = new Set();
              container._prodSearchIndex = new Map();
              // build DOM nodes
              container.innerHTML = '';
              const frag = document.createDocumentFragment();
              filteredQuotes.forEach((quote, idx) => {
                const key = getQuoteKey(quote);
                const el = document.createElement('div');
                el.className = 'quote-row flex items-center text-[12px] px-2 py-4 border-b hover:bg-gray-50 cursor-pointer';
                if (selectedQuotes.has(key)) el.classList.add('bg-blue-50');
                // Visual indicator for quotes requesting recreation (đã báo hủy, chờ tạo đơn mới)
                const isRecreateRequest = !!(quote && quote.__recreateRequested);
                if (isRecreateRequest) el.classList.add('border-l-4', 'border-l-orange-500', 'bg-orange-50');
                el.dataset.quoteId = key;
                // build inner structure
                const recreateLabel = isRecreateRequest ? '<span class="text-[10px] bg-orange-500 text-white px-1.5 py-0.5 rounded ml-1" title="Đã báo hủy, chờ tạo đơn mới">TẠO ĐƠN MỚI</span>' : '';
                el.innerHTML = `
                  <div class="w-6 flex items-center justify-center">
                    <input type="checkbox" class="quote-checkbox w-3.5 h-3.5 text-blue-600" data-quote-id="${key}" ${selectedQuotes.has(key) ? 'checked' : ''} />
                  </div>
                  <div class="w-20 text-gray-500 select-none">${idx + 1}</div>
                  <div class="w-20 whitespace-nowrap font-medium">${quote.quote_code || '-'}${recreateLabel}</div>
                  <div class="w-20 whitespace-nowrap">${quote.area || '-'}</div>
                  <div class="w-24 text-center whitespace-nowrap">${quote.spo_number || '-'}</div>
                  <div class="w-24 ml-3 whitespace-nowrap">${quote.outlet_code || '-'}</div>
                  <div class="w-72 min-w-0 whitespace-nowrap overflow-hidden text-ellipsis">${quote.outlet_name || '-'}</div>
                  <div class="w-36 whitespace-nowrap overflow-hidden text-ellipsis text-gray-700">${quote.sale_name || ''}</div>
                  <div class="w-20 text-right font-semibold text-blue-600 whitespace-nowrap">${formatCurrency(parseMoney(quote.total_amount) || 0)}</div>
                  <div class="w-52 pl-2 whitespace-nowrap"><span class="px-1.5 py-0.5 rounded">${quote.spo_number ? (quote.spo_status || '') : 'Chưa có SPO'}</span></div>
                `;
                // attach handlers
                const checkbox = el.querySelector('input.quote-checkbox');
                if (checkbox) {
                  checkbox.addEventListener('change', function(e) {
                    const quoteId = String(this.dataset.quoteId);
                    if (this.checked) selectedQuotes.add(quoteId);
                    else selectedQuotes.delete(quoteId);
                    updateSelectedCount();
                    updateSelectedSummary();
                    const row = this.closest('.quote-row');
                    if (row) row.classList.toggle('bg-blue-50', this.checked);
                    updateSelectAllState();
                  });
                }
                el.addEventListener('click', function(e) {
                  if (e.target.closest('input.quote-checkbox')) return;
                  const quoteId = this.dataset.quoteId;
                  const cb = this.querySelector('input.quote-checkbox');
                  const willSelect = !selectedQuotes.has(quoteId);
                  if (willSelect) { selectedQuotes.add(quoteId); if (cb) cb.checked = true; }
                  else { selectedQuotes.delete(quoteId); if (cb) cb.checked = false; }
                  this.classList.toggle('bg-blue-50', willSelect);
                  updateSelectedCount();
                  updateSelectedSummary();
                  updateSelectAllState();
                });

                // compute and store searchable text on element for potential client-side filters

                try {
                  const parts = [quote.outlet_name, quote.outlet_code, quote.quote_code || quote.quoteCode, quote.spo_number, quote.area, quote.sale_name, quote.ss_name];
                  el.dataset.search = parts.map(p => normalizeForSearch(p)).filter(Boolean).join(' ');
                } catch (e) { el.dataset.search = '' }
                // populate container-level search index
                try { container._prodSearchIndex.set(key, el.dataset.search || ''); } catch (e) { /* ignore */ }

                // hide rows not on current page
                if (!pageIds.has(key)) {
                  el.classList.add('hidden');
                } else {
                  container._prodVisible.add(key);
                }
                frag.appendChild(el);
                container._prodRowMap.set(key, el);
                container._prodIndex.push(key);
              });
              container.appendChild(frag);
            } else {
              // Container already built: compute which ids should be visible based on current page slice
              const newVisible = pageIds; // show only ids on the current page
              // add any new rows that don't exist yet
              const toCreate = [];
              newVisible.forEach(id => { if (!container._prodRowMap.has(id)) toCreate.push(id); });
              if (toCreate.length) {
                const frag2 = document.createDocumentFragment();
                toCreate.forEach(id => {
                  // find quote data from 'quotes' param or currentQuotes
                  const quote = (filteredQuotes.find(q => getQuoteKey(q) === id) || currentQuotes.find(q => getQuoteKey(q) === id));
                  if (!quote) return;
                  const idx = container._prodIndex.length + 1;
                  const el = document.createElement('div');
                  el.className = 'quote-row flex items-center text-[12px] px-2 py-4 border-b hover:bg-gray-50 cursor-pointer';
                  if (selectedQuotes.has(id)) el.classList.add('bg-blue-50');
                  // Visual indicator for quotes requesting recreation
                  const isRecreateRequest = !!(quote && quote.__recreateRequested);
                  if (isRecreateRequest) el.classList.add('border-l-4', 'border-l-orange-500', 'bg-orange-50');
                  el.dataset.quoteId = id;
                  const recreateLabel = isRecreateRequest ? '<span class="text-[10px] bg-orange-500 text-white px-1.5 py-0.5 rounded ml-1" title="Đã báo hủy, chờ tạo đơn mới">TẠO ĐƠN MỚI</span>' : '';
                  el.innerHTML = `
                    <div class="w-6 flex items-center justify-center">
                      <input type="checkbox" class="quote-checkbox w-3.5 h-3.5 text-blue-600" data-quote-id="${id}" ${selectedQuotes.has(id) ? 'checked' : ''} />
                    </div>
                    <div class="w-20 text-gray-500 select-none">${idx}</div>
                    <div class="w-20 whitespace-nowrap font-medium">${quote.quote_code || '-'}${recreateLabel}</div>
                    <div class="w-20 whitespace-nowrap">${quote.area || '-'}</div>
                    <div class="w-24 text-center whitespace-nowrap">${quote.spo_number || '-'}</div>
                    <div class="w-24 ml-3 whitespace-nowrap">${quote.outlet_code || '-'}</div>
                    <div class="w-72 min-w-0 whitespace-nowrap overflow-hidden text-ellipsis">${quote.outlet_name || '-'}</div>
                    <div class="w-36 whitespace-nowrap overflow-hidden text-ellipsis text-gray-700">${quote.sale_name || ''}</div>
                    <div class="w-20 text-right font-semibold text-blue-600 whitespace-nowrap">${formatCurrency(parseMoney(quote.total_amount) || 0)}</div>
                    <div class="w-52 pl-2 whitespace-nowrap"><span class="px-1.5 py-0.5 rounded">${quote.spo_number ? (quote.spo_status || '') : 'Chưa có SPO'}</span></div>
                  `;
                  const checkbox = el.querySelector('input.quote-checkbox');
                  if (checkbox) checkbox.addEventListener('change', function() {
                    const quoteId = String(this.dataset.quoteId);
                    if (this.checked) selectedQuotes.add(quoteId); else selectedQuotes.delete(quoteId);
                    updateSelectedCount(); updateSelectedSummary();
                    const row = this.closest('.quote-row'); if (row) row.classList.toggle('bg-blue-50', this.checked);
                    updateSelectAllState();
                  });
                  el.addEventListener('click', function(e) {
                    if (e.target.closest('input.quote-checkbox')) return;
                    const quoteId = this.dataset.quoteId;
                    const cb = this.querySelector('input.quote-checkbox');
                    const willSelect = !selectedQuotes.has(quoteId);
                    if (willSelect) { selectedQuotes.add(quoteId); if (cb) cb.checked = true; } else { selectedQuotes.delete(quoteId); if (cb) cb.checked = false; }
                    this.classList.toggle('bg-blue-50', willSelect);
                    updateSelectedCount(); updateSelectedSummary(); updateSelectAllState();
                  });
                  try { const parts = [quote.outlet_name, quote.outlet_code, quote.quote_code || quote.quoteCode, quote.spo_number, quote.area, quote.sale_name, quote.ss_name]; el.dataset.search = parts.map(p => normalizeForSearch(p)).filter(Boolean).join(' '); } catch(e){ el.dataset.search=''; }
                  try { container._prodSearchIndex.set(id, el.dataset.search || ''); } catch (e) { /* ignore */ }
                  frag2.appendChild(el);
                  container._prodRowMap.set(id, el);
                  container._prodIndex.push(id);
                });
                container.appendChild(frag2);
              }

              // compute diffs
              const currentlyVisible = container._prodVisible || new Set();
              const toHide = [];
              const toShow = [];
              currentlyVisible.forEach(id => { if (!newVisible.has(id)) toHide.push(id); });
              newVisible.forEach(id => { if (!currentlyVisible.has(id)) toShow.push(id); });

              if (toHide.length || toShow.length) {
                window.requestAnimationFrame(() => {
                  toHide.forEach(id => { const r = container._prodRowMap.get(id); if (r) r.classList.add('hidden'); container._prodVisible.delete(id); });
                  toShow.forEach(id => { const r = container._prodRowMap.get(id); if (r) r.classList.remove('hidden'); container._prodVisible.add(id); });
                });
              }
            }

            const __tHtml1 = (__qcagProfile && window.performance && typeof performance.now === 'function') ? performance.now() : 0;
            const __tDom1 = (__qcagProfile && window.performance && typeof performance.now === 'function') ? performance.now() : __tHtml1;

            // Select-all control (footer button toggling visible rows)
            const selectAllBtn = document.getElementById('production-select-all-btn');
            function updateSelectAllState() {
              if (!selectAllBtn) return;
              const allCheckboxes = Array.from(container.querySelectorAll('.quote-checkbox'));
              const checkboxes = allCheckboxes.filter(cb => { const r = cb.closest('.quote-row'); return r && !r.classList.contains('hidden'); });
              if (!checkboxes || checkboxes.length === 0) {
                selectAllBtn.disabled = true;
                selectAllBtn.textContent = 'Chọn tất cả';
                return;
              }
              selectAllBtn.disabled = false;
              const total = checkboxes.length;
              const checkedCount = checkboxes.filter(cb => cb.checked).length;
              if (checkedCount === total) {
                selectAllBtn.textContent = 'Bỏ chọn tất cả';
              } else if (checkedCount === 0) {
                selectAllBtn.textContent = 'Chọn tất cả';
              } else {
                selectAllBtn.textContent = `Chọn tất cả (${total - checkedCount})`;
              }
            }
            // initialize state
            updateSelectAllState();
            if (selectAllBtn && !selectAllBtn._bound) {
              selectAllBtn._bound = true;
                selectAllBtn.addEventListener('click', function() {
                const allCheckboxes = Array.from(container.querySelectorAll('.quote-checkbox'));
                const checkboxes = allCheckboxes.filter(cb => { const r = cb.closest('.quote-row'); return r && !r.classList.contains('hidden'); });
                if (!checkboxes || checkboxes.length === 0) return;
                const total = checkboxes.length;
                const checkedCount = checkboxes.filter(cb => cb.checked).length;
                const willSelectAll = checkedCount !== total;
                checkboxes.forEach(cb => {
                  const id = String(cb.dataset.quoteId);
                  cb.checked = willSelectAll;
                  if (willSelectAll) selectedQuotes.add(id);
                  else selectedQuotes.delete(id);
                  const row = cb.closest('.quote-row');
                  if (row) row.classList.toggle('bg-blue-50', willSelectAll);
                });
                updateSelectedCount();
                updateSelectedSummary();
                updateSelectAllState();
              });
            }

            if (__qcagProfile) {
              try {
                const __tEnd = (window.performance && typeof performance.now === 'function') ? performance.now() : __t0;
                console.log('renderProductionQuotes', {
                  inputCount: quotes.length,
                  filteredCount: filteredQuotes.length,
                  filterMs: Math.round(__tFilter1 - __tFilter0),
                  htmlMs: Math.round(__tHtml1 - __tHtml0),
                  domSetMs: Math.round(__tDom1 - __tHtml1),
                  totalMs: Math.round(__tEnd - __t0)
                });
              } catch (e) { /* ignore */ }
            }
        }

        function updateSelectedCount() {
            document.getElementById('selected-count').textContent = selectedQuotes.size;
            document.getElementById('create-production-list').disabled = selectedQuotes.size === 0;
            // Update stats bar figures too
            const selectedQuotesList = currentQuotes.filter(q => selectedQuotes.has(getQuoteKey(q)));
            const totalAmount = selectedQuotesList.reduce((sum, q) => sum + (parseMoney(q.total_amount) || 0), 0);
            const selCountEl = document.getElementById('selected-count-stat');
            const selTotalEl = document.getElementById('selected-total-stat');
            if (selCountEl) selCountEl.textContent = selectedQuotes.size;
            if (selTotalEl) selTotalEl.textContent = formatCurrency(totalAmount);
            const sideCount = document.getElementById('selected-count-side');
            if (sideCount) sideCount.textContent = selectedQuotes.size;
        }

        function updateSelectedSummary() {
            const listDiv = document.getElementById('selected-quotes-simple');
            if (!listDiv) return;
            const selectedQuotesList = currentQuotes.filter(q => selectedQuotes.has(getQuoteKey(q)));
            if (selectedQuotesList.length === 0) {
                listDiv.innerHTML = '<div class="text-[12px] text-gray-500">Chưa chọn báo giá nào</div>';
                return;
            }
            listDiv.innerHTML = selectedQuotesList.map(q => `
        <div class="flex items-center justify-between text-[12px] bg-white border rounded px-2 py-1 whitespace-nowrap">
          <span class="overflow-hidden text-ellipsis pr-2">${q.outlet_name || '-'}</span>
          <span class="text-gray-600">${q.sale_name || ''}</span>
        </div>
      `).join('');
        }

        // Close the production selection modal
        function closeProductionModal(preserveSelection = false) {
            const modal = document.getElementById('production-order-modal');
            if (!modal) return;
            modal.classList.add('hidden');
            if (!preserveSelection) selectedQuotes.clear();
            ensureScrollLock();
        }

        // ========== PRODUCTION MODAL TAB FUNCTIONS ==========
        
        // Switch between tabs in production modal
        function switchProductionTab(tabName) {
          productionModalCurrentTab = tabName;
          const tabSelect = document.getElementById('production-tab-select');
          const tabPending = document.getElementById('production-tab-pending');
          const contentSelect = document.getElementById('production-tab-content-select');
          const contentPending = document.getElementById('production-tab-content-pending');
          
          if (tabName === 'select') {
            tabSelect.classList.add('text-blue-600', 'border-b-2', 'border-blue-600');
            tabSelect.classList.remove('text-gray-500');
            tabPending.classList.remove('text-blue-600', 'border-b-2', 'border-blue-600');
            tabPending.classList.add('text-gray-500');
            contentSelect.classList.remove('hidden');
            contentPending.classList.add('hidden');
          } else {
            tabPending.classList.add('text-blue-600', 'border-b-2', 'border-blue-600');
            tabPending.classList.remove('text-gray-500');
            tabSelect.classList.remove('text-blue-600', 'border-b-2', 'border-blue-600');
            tabSelect.classList.add('text-gray-500');
            contentPending.classList.remove('hidden');
            contentSelect.classList.add('hidden');
            renderPendingOrdersList();
          }
        }
        
        // Add selected quotes to pending list (or to existing order if in add-more mode)
        function addToPendingList() {
          const createBtn = document.getElementById('create-production-list');
          const addingToOrderId = createBtn && createBtn._addingToOrder;
          
          const selectedQuotesList = currentQuotes.filter(q => selectedQuotes.has(getQuoteKey(q)));
          
          if (selectedQuotesList.length === 0) {
            showToast('Vui lòng chọn ít nhất một báo giá');
            return;
          }
          
          if (addingToOrderId) {
            // Adding to existing order
            const order = pendingOrders.find(o => o.id === addingToOrderId);
            if (order) {
              // Add quotes to order (avoid duplicates)
              const existingKeys = new Set(order.quotes.map(q => getQuoteKey(q)));
              let addedCount = 0;
              
              selectedQuotesList.forEach(quote => {
                const key = getQuoteKey(quote);
                if (!existingKeys.has(key)) {
                  order.quotes.push(quote);
                  addedCount++;
                }
              });
              
              // Update order totals
              order.totalPoints = order.quotes.length;
              order.totalAmount = 0;
              order.quotes.forEach(q => {
                order.totalAmount += parseMoney(q.total_amount) || 0;
              });
              
              // Remove added quotes from selection list
              const keysToRemove = new Set(selectedQuotesList.map(q => getQuoteKey(q)));
              currentQuotes = currentQuotes.filter(q => !keysToRemove.has(getQuoteKey(q)));
              productionModalQuotesToFilter = productionModalQuotesToFilter.filter(q => !keysToRemove.has(getQuoteKey(q)));
              productionModalFilteredQuotes = productionModalFilteredQuotes.filter(q => !keysToRemove.has(getQuoteKey(q)));
              
              selectedQuotes.clear();
              renderProductionQuotes(productionModalFilteredQuotes);
              updateSelectedCount();
              updatePendingCount();
              
              // Save to backend
              savePendingOrderToBackend(order).then(() => {
                savePendingOrdersToStorage(); // Also backup to localStorage
              });
              
              showToast(`Đã thêm ${addedCount} báo giá vào đơn`);
              
              // Reset button
              createBtn.textContent = 'Thêm Vào Chờ Duyệt';
              delete createBtn._addingToOrder;
              
              // Re-open detail modal
              openPendingOrderDetailModal(addingToOrderId);
              return;
            }
          }
          
          // Original logic: Create new order
          const orderId = 'pending_' + Date.now();
          const authUser = (typeof window !== 'undefined' && window.__qcagAuthUser) ? window.__qcagAuthUser : null;
          const userName = (authUser && authUser.name && authUser.name.trim()) ? authUser.name : (authUser && authUser.username ? authUser.username : 'User');
          let totalAmount = 0;
          selectedQuotesList.forEach(q => {
            totalAmount += parseMoney(q.total_amount) || 0;
          });
          
          const newOrder = {
            id: orderId,
            createdBy: userName,
            createdAt: Date.now(),
            quotes: [...selectedQuotesList],
            totalPoints: selectedQuotesList.length,
            totalAmount: totalAmount
          };
          
          pendingOrders.push(newOrder);
          
          // Remove added quotes from currentQuotes so they don't appear in selection tab anymore
          const keysToRemove = new Set(selectedQuotesList.map(q => getQuoteKey(q)));
          currentQuotes = currentQuotes.filter(q => !keysToRemove.has(getQuoteKey(q)));
          productionModalQuotesToFilter = productionModalQuotesToFilter.filter(q => !keysToRemove.has(getQuoteKey(q)));
          productionModalFilteredQuotes = productionModalFilteredQuotes.filter(q => !keysToRemove.has(getQuoteKey(q)));
          
          // Clear selection
          selectedQuotes.clear();
          renderProductionQuotes(productionModalFilteredQuotes);
          updateSelectedCount();
          
          // Update pending count badge
          updatePendingCount();
          
          // Save to backend
          savePendingOrderToBackend(newOrder).then(() => {
            savePendingOrdersToStorage(); // Also backup to localStorage
          });
          
          showToast(`Đã thêm ${selectedQuotesList.length} báo giá vào danh sách chờ duyệt`);
          
          // Switch to pending tab
          switchProductionTab('pending');
        }
        
        // Remove order from pending list
        async function removePendingOrder(orderId) {
          const removedOrder = pendingOrders.find(o => o.id === orderId);
          if (!removedOrder) return;
          
          if (!confirm(`Bạn có chắc muốn xóa đơn này (${removedOrder.totalPoints} báo giá)?`)) return;
          
          // Delete from backend first
          const result = await deletePendingOrderFromBackend(orderId);
          
          pendingOrders = pendingOrders.filter(o => o.id !== orderId);
          
          // Add all quotes from this order back to selection list
          removedOrder.quotes.forEach(quote => {
            currentQuotes.push(quote);
            productionModalQuotesToFilter.push(quote);
            productionModalFilteredQuotes.push(quote);
          });
          
          updatePendingCount();
          savePendingOrdersToStorage();
          renderPendingOrdersList();
          showToast('Đã xóa đơn và trả lại các báo giá vào danh sách chọn');
        }
        
        // Clear all pending orders
        async function clearPendingList() {
          if (pendingOrders.length === 0) return;
          if (!confirm('Bạn có chắc muốn xóa tất cả đơn chờ duyệt?')) return;
          
          // Delete all from backend
          const result = await clearAllPendingOrdersFromBackend();
          
          // Add all quotes from all orders back to selection list
          pendingOrders.forEach(order => {
            order.quotes.forEach(quote => {
              currentQuotes.push(quote);
              productionModalQuotesToFilter.push(quote);
              productionModalFilteredQuotes.push(quote);
            });
          });
          
          pendingOrders = [];
          
          updatePendingCount();
          savePendingOrdersToStorage();
          renderPendingOrdersList();
          showToast('Đã xóa tất cả đơn chờ duyệt');
        }
        
        // Update pending count badge
        function updatePendingCount() {
          const countEl = document.getElementById('pending-count');
          let totalCount = 0;
          pendingOrders.forEach(o => totalCount += o.totalPoints);
          if (countEl) countEl.textContent = totalCount;
          
          // Update save button state
          const saveBtn = document.getElementById('pending-save-order');
          if (saveBtn) saveBtn.disabled = pendingOrders.length === 0;
        }
        
        // Render pending orders list (summary view)
        function renderPendingOrdersList() {
          const container = document.getElementById('pending-quotes-list');
          if (!container) return;
          
          // Apply search filter
          const searchInput = document.getElementById('pending-search');
          const searchTerm = (searchInput && searchInput.value || '').toLowerCase().trim();
          
          let filtered = pendingOrders;
          if (searchTerm) {
            filtered = pendingOrders.filter(order => {
              const text = order.createdBy.toLowerCase() + ' ' + order.id.toLowerCase();
              return text.includes(searchTerm);
            });
          }
          
          if (filtered.length === 0) {
            container.innerHTML = '<div class="p-8 text-center text-gray-500">Chưa có đơn chờ duyệt nào</div>';
            updatePendingSummary([]);
            return;
          }
          
          let html = '';
          filtered.forEach((order, idx) => {
            const createdDate = new Date(order.createdAt).toLocaleString('vi-VN');
            const amount = typeof formatCurrency === 'function' ? formatCurrency(order.totalAmount || 0) : (order.totalAmount || 0);
            
            // Extract unique areas from quotes
            const uniqueAreas = [...new Set(order.quotes.map(q => q.area).filter(Boolean))];
            const areasText = uniqueAreas.length > 0 ? uniqueAreas.join(', ') : '-';
            
            html += `
              <div class="flex items-center px-3 py-2 border-b border-gray-100 hover:bg-gray-50 text-sm" data-order-id="${order.id}">
                <div class="w-16 text-gray-600">${idx + 1}</div>
                <div class="w-28 font-medium text-blue-600">${order.totalPoints}</div>
                <div class="w-32 font-semibold text-green-600">${amount}</div>
                <div class="w-48 text-gray-700 text-xs truncate" title="${areasText}">${areasText}</div>
                <div class="w-32 text-gray-700">${order.createdBy}</div>
                <div class="w-44 text-xs text-gray-600">${createdDate}</div>
                <div class="flex-1 flex justify-center gap-2">
                  <button class="pending-view-detail-btn px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white text-xs rounded" data-order-id="${order.id}">
                    Xem Chi Tiết
                  </button>
                  <button class="pending-export-excel-btn px-3 py-1 bg-purple-500 hover:bg-purple-600 text-white text-xs rounded" data-order-id="${order.id}">
                    Xuất Excel
                  </button>
                  <button class="pending-save-single-btn px-3 py-1 bg-green-500 hover:bg-green-600 text-white text-xs rounded" data-order-id="${order.id}">
                    Lưu Đơn Này
                  </button>
                  <button class="pending-remove-order-btn px-3 py-1 bg-red-500 hover:bg-red-600 text-white text-xs rounded" data-order-id="${order.id}">
                    Xóa
                  </button>
                </div>
              </div>
            `;
          });
          
          container.innerHTML = html;
          
          // Bind view detail buttons
          container.querySelectorAll('.pending-view-detail-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              const orderId = btn.dataset.orderId;
              openPendingOrderDetailModal(orderId);
            });
          });
          
          // Bind export excel buttons
          container.querySelectorAll('.pending-export-excel-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              const orderId = btn.dataset.orderId;
              exportPendingOrderToExcel(orderId);
            });
          });
          
          // Bind save single order buttons
          container.querySelectorAll('.pending-save-single-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              const orderId = btn.dataset.orderId;
              saveSinglePendingOrder(orderId);
            });
          });
          
          // Bind remove buttons
          container.querySelectorAll('.pending-remove-order-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              const orderId = btn.dataset.orderId;
              removePendingOrder(orderId);
            });
          });
          
          updatePendingSummary(filtered);
        }
        
        // Update pending summary (total points and amount)
        function updatePendingSummary(orders) {
          const list = orders || pendingOrders;
          let totalPoints = 0;
          let totalAmount = 0;
          list.forEach(order => {
            totalPoints += order.totalPoints;
            totalAmount += order.totalAmount;
          });
          
          const pointsEl = document.getElementById('pending-total-points');
          const amountEl = document.getElementById('pending-total-amount');
          if (pointsEl) pointsEl.textContent = totalPoints;
          if (amountEl) amountEl.textContent = typeof formatCurrency === 'function' ? formatCurrency(totalAmount) : totalAmount + ' đ';
        }
        
        // Open modal to view detail of a pending order
        let currentViewingOrderId = null; // Track which order is being viewed
        
        function openPendingOrderDetailModal(orderId) {
          const order = pendingOrders.find(o => o.id === orderId);
          if (!order) return;
          
          currentViewingOrderId = orderId;
          
          // Open a new modal showing the detail list
          const modal = document.getElementById('pending-order-detail-modal');
          if (!modal) return;
          
          // Render order info and quotes list
          renderPendingOrderDetail(order);
          
          modal.classList.remove('hidden');
          ensureScrollLock();
        }
        
        // Render detail of a pending order in modal
        function renderPendingOrderDetail(order) {
          const headerEl = document.getElementById('pending-order-detail-header');
          const listEl = document.getElementById('pending-order-detail-list');
          
          if (headerEl) {
            const createdDate = new Date(order.createdAt).toLocaleString('vi-VN');
            const amount = typeof formatCurrency === 'function' ? formatCurrency(order.totalAmount || 0) : (order.totalAmount || 0);
            headerEl.innerHTML = `
              <div class="flex items-center justify-between">
                <div>
                  <h3 class="text-xl font-bold text-gray-800">Chi Tiết Đơn Chờ Duyệt</h3>
                  <div class="mt-1 text-sm text-gray-600">
                    <span>Người tạo: <span class="font-medium">${order.createdBy}</span></span>
                    <span class="mx-2">|</span>
                    <span>Thời gian: ${createdDate}</span>
                  </div>
                </div>
                <div class="text-right">
                  <div class="text-sm text-gray-600">Tổng số điểm: <span class="font-bold text-blue-600">${order.totalPoints}</span></div>
                  <div class="text-sm text-gray-600">Tổng giá trị: <span class="font-bold text-green-600">${amount}</span></div>
                </div>
              </div>
            `;
          }
          
          if (listEl) {
            let html = '';
            order.quotes.forEach((quote, idx) => {
              const quoteKey = getQuoteKey(quote);
              const quoteCode = (typeof formatQuoteCode === 'function' && quote.quote_code) ? formatQuoteCode(quote) : (quote.quote_code || '-');
              const amount = typeof formatCurrency === 'function' ? formatCurrency(quote.total_amount || 0) : (quote.total_amount || 0);
              
              html += `
                <div class="flex items-center px-2 py-2 border-b border-gray-100 hover:bg-gray-50 text-sm">
                  <div class="w-16 text-gray-600">${idx + 1}</div>
                  <div class="w-24 font-medium text-blue-600">${quoteCode}</div>
                  <div class="w-20">${quote.area || '-'}</div>
                  <div class="w-28 text-center">${quote.spo_number || '-'}</div>
                  <div class="w-28">${quote.outlet_code || '-'}</div>
                  <div class="w-72 min-w-0 truncate">${quote.outlet_name || '-'}</div>
                  <div class="w-36 truncate">${quote.sale_name || '-'}</div>
                  <div class="w-24 text-right font-medium text-green-600">${amount}</div>
                  <div class="w-20 text-center">
                    <button class="pending-detail-remove-quote-btn text-red-500 hover:text-red-700 p-1" data-quote-key="${quoteKey}" title="Xóa báo giá">
                      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                </div>
              `;
            });
            
            if (order.quotes.length === 0) {
              html = '<div class="p-8 text-center text-gray-500">Chưa có báo giá nào trong đơn này</div>';
            }
            
            listEl.innerHTML = html;
            
            // Bind remove quote buttons
            listEl.querySelectorAll('.pending-detail-remove-quote-btn').forEach(btn => {
              btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const quoteKey = btn.dataset.quoteKey;
                removeQuoteFromPendingOrder(order.id, quoteKey);
              });
            });
          }
        }
        
        // Remove a quote from a specific pending order
        function removeQuoteFromPendingOrder(orderId, quoteKey) {
          const order = pendingOrders.find(o => o.id === orderId);
          if (!order) return;
          
          const removedQuote = order.quotes.find(q => getQuoteKey(q) === quoteKey);
          if (!removedQuote) return;
          
          // Remove quote from order
          order.quotes = order.quotes.filter(q => getQuoteKey(q) !== quoteKey);
          
          // Update order totals
          order.totalPoints = order.quotes.length;
          order.totalAmount = 0;
          order.quotes.forEach(q => {
            order.totalAmount += parseMoney(q.total_amount) || 0;
          });
          
          // Add quote back to selection list
          currentQuotes.push(removedQuote);
          productionModalQuotesToFilter.push(removedQuote);
          productionModalFilteredQuotes.push(removedQuote);
          
          // If order is now empty, remove it
          if (order.quotes.length === 0) {
            pendingOrders = pendingOrders.filter(o => o.id !== orderId);
            // Close detail modal
            const detailModal = document.getElementById('pending-order-detail-modal');
            if (detailModal) detailModal.classList.add('hidden');
            ensureScrollLock();
          } else {
            // Re-render detail modal
            renderPendingOrderDetail(order);
          }
          
          // Update pending list and counts
          renderPendingOrdersList();
          updatePendingCount();
          savePendingOrdersToStorage();
          
          showToast('Đã xóa báo giá khỏi đơn');
        }
        
        // Save a single pending order as production order
        async function saveSinglePendingOrder(orderId) {
          const order = pendingOrders.find(o => o.id === orderId);
          if (!order) return;
          
          if (order.quotes.length === 0) {
            showToast('Đơn này không có báo giá nào');
            return;
          }
          
          // Use the existing saveToManagement logic
          currentProductionData = order.quotes;
          
          // Call existing save function
          await saveToManagement();
          
          // If save successful, remove this order from pending
          if (currentProductionData.length === 0) {
            // Delete from backend first
            await deletePendingOrderFromBackend(orderId);
            
            // Then remove from local array
            pendingOrders = pendingOrders.filter(o => o.id !== orderId);
            updatePendingCount();
            savePendingOrdersToStorage();
            renderPendingOrdersList();
            
            // Close detail modal if open
            const detailModal = document.getElementById('pending-order-detail-modal');
            if (detailModal && !detailModal.classList.contains('hidden')) {
              detailModal.classList.add('hidden');
              ensureScrollLock();
            }
          }
        }
        
        // Save pending orders as production orders
        async function savePendingAsProductionOrder() {
          if (pendingOrders.length === 0) {
            showToast('Không có đơn chờ duyệt nào');
            return;
          }
          
          // Combine all quotes from all pending orders
          let allQuotes = [];
          pendingOrders.forEach(order => {
            allQuotes = allQuotes.concat(order.quotes);
          });
          
          // Use the existing saveToManagement logic with all quotes
          currentProductionData = allQuotes;
          
          // Call existing save function
          await saveToManagement();
          
          // If save successful, clear pending orders
          if (currentProductionData.length === 0) {
            // Clear from backend first
            await clearAllPendingOrdersFromBackend();
            
            // Then clear local array
            pendingOrders = [];
            updatePendingCount();
            savePendingOrdersToStorage();
            // Close production modal
            closeProductionModal(false);
            // Reset tab to select
            switchProductionTab('select');
          }
        }
        
        // Open modal to add more quotes to current viewing order
        function openAddQuotesToOrderModal() {
          if (!currentViewingOrderId) return;
          
          const order = pendingOrders.find(o => o.id === currentViewingOrderId);
          if (!order) return;
          
          // Switch back to select tab
          switchProductionTab('select');
          
          // Clear current selection
          selectedQuotes.clear();
          
          // Hide detail modal but keep it for return
          const detailModal = document.getElementById('pending-order-detail-modal');
          if (detailModal) detailModal.classList.add('hidden');
          
          // Show message to user
          showToast('Chọn báo giá để thêm vào đơn, sau đó nhấn "Thêm Vào Đơn Này"');
          
          // Change button text temporarily
          const createBtn = document.getElementById('create-production-list');
          if (createBtn) {
            createBtn.textContent = 'Thêm Vào Đơn Này';
            createBtn._addingToOrder = currentViewingOrderId;
          }
        }
        
        // Setup production modal tab handlers (call once)
        function setupProductionModalTabHandlers() {
          const modal = document.getElementById('production-order-modal');
          if (!modal || modal._tabHandlersBound) return;
          modal._tabHandlersBound = true;
          
          // Tab buttons
          const tabSelect = document.getElementById('production-tab-select');
          const tabPending = document.getElementById('production-tab-pending');
          
          if (tabSelect) tabSelect.addEventListener('click', () => switchProductionTab('select'));
          if (tabPending) tabPending.addEventListener('click', () => switchProductionTab('pending'));
          
          // Pending tab buttons
          const clearAllBtn = document.getElementById('pending-clear-all');
          const backBtn = document.getElementById('pending-back-to-select');
          const saveBtn = document.getElementById('pending-save-order');
          
          if (clearAllBtn) clearAllBtn.addEventListener('click', clearPendingList);
          if (backBtn) backBtn.addEventListener('click', () => switchProductionTab('select'));
          if (saveBtn) saveBtn.addEventListener('click', savePendingAsProductionOrder);
          
          // Pending search
          const searchInput = document.getElementById('pending-search');
          if (searchInput) {
            searchInput.addEventListener('input', () => {
              renderPendingOrdersList();
            });
          }
          
          // Setup detail modal close button
          const detailModal = document.getElementById('pending-order-detail-modal');
          if (detailModal && !detailModal._closeHandlerBound) {
            detailModal._closeHandlerBound = true;
            const closeBtn = document.getElementById('close-pending-order-detail-modal');
            const closeBtn2 = document.getElementById('pending-detail-close');
            const addMoreBtn = document.getElementById('pending-detail-add-more');
            
            if (closeBtn) {
              closeBtn.addEventListener('click', () => {
                detailModal.classList.add('hidden');
                currentViewingOrderId = null;
                ensureScrollLock();
              });
            }
            
            if (closeBtn2) {
              closeBtn2.addEventListener('click', () => {
                detailModal.classList.add('hidden');
                currentViewingOrderId = null;
                ensureScrollLock();
              });
            }
            
            if (addMoreBtn) {
              addMoreBtn.addEventListener('click', () => {
                openAddQuotesToOrderModal();
              });
            }
          }
        }
        
        // ========== END PRODUCTION MODAL TAB FUNCTIONS ==========

        function createProductionList() {
            // Changed: Now adds to pending list instead of creating immediately
            addToPendingList();
        }

        function renderProductionList(groupedBySale) {
            const container = document.getElementById('production-list-content');
            let html = '';
            let globalIndex = 0; // Số thứ tự liên tục cho toàn bộ danh sách

            Object.keys(groupedBySale).forEach(saleKey => {
                        const quotes = groupedBySale[saleKey];
                        const totalAmount = quotes.reduce((sum, q) => sum + q.total_amount, 0);

                        html += `
          <div class="mb-8">
            <!-- Cấp 1: Individual Sale Header -->
            <h2 class="text-2xl font-bold text-gray-800 mb-6">${saleKey} (${quotes.length} báo giá - ${formatCurrency(totalAmount)})</h2>
            <div class="space-y-4">
              ${quotes.map((quote) => {
                globalIndex++; // Tăng số thứ tự liên tục
                const items = JSON.parse(quote.items || '[]');
                return `
                  <!-- Cấp 2: Quote Summary (1 hàng duy nhất) -->
                  <div class="border border-gray-300 rounded-lg overflow-hidden">
                    <div class="bg-gray-100 px-3 py-2 flex items-center justify-between text-sm">
                      <div class="flex items-center gap-3 min-w-0">
                        <span class="font-bold text-blue-600">${globalIndex}</span>
                        <span class="font-semibold text-gray-800 truncate max-w-[220px]">${quote.outlet_name}</span>
                        <span class="text-gray-600 whitespace-nowrap">| ${quote.outlet_code}</span>
                        ${quote.spo_number ? `<span class="text-gray-700 whitespace-nowrap">| ${quote.spo_number}</span>` : ''}
                        ${quote.address && quote.address !== 'Địa chỉ sẽ hiển thị tự động khi nhập' ? `<span class="text-gray-500 truncate max-w-[260px]">| ${quote.address}</span>` : ''}
                      </div>
                      <span class="font-bold text-blue-600 whitespace-nowrap">${formatCurrency(quote.total_amount)}</span>
                    </div>
                    
                    <!-- Cấp 3: Items Detail -->
                    <div class="p-3">
                      <table class="w-full text-sm">
                        <thead class="bg-gray-50">
                          <tr>
                            <th class="px-3 py-2 text-left text-xs font-medium text-gray-600">Code</th>
                            <th class="px-3 py-2 text-left text-xs font-medium text-gray-600">Nội dung</th>
                            <th class="px-3 py-2 text-left text-xs font-medium text-gray-600">Brand</th>
                            <th class="px-3 py-2 text-left text-xs font-medium text-gray-600">Kích thước</th>
                            <th class="px-3 py-2 text-left text-xs font-medium text-gray-600">SL</th>
                            <th class="px-3 py-2 text-left text-xs font-medium text-gray-600">ĐVT</th>
                            <th class="px-3 py-2 text-left text-xs font-medium text-gray-600">Đơn giá</th>
                            <th class="px-3 py-2 text-left text-xs font-medium text-gray-600">Thành tiền</th>
                          </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-200">
                          ${items.map(item => `
                            <tr class="hover:bg-gray-50">
                              <td class="px-3 py-2 font-medium text-gray-900">${item.code}</td>
                              <td class="px-3 py-2 text-gray-700">${item.content}</td>
                              <td class="px-3 py-2 text-gray-600">${item.brand || '-'}</td>
                              <td class="px-3 py-2 text-gray-600">
                                ${item.width && item.height ? `${item.width}m × ${item.height}m` : '-'}
                              </td>
                              <td class="px-3 py-2 text-gray-900">${item.quantity}</td>
                              <td class="px-3 py-2 text-gray-600">${item.unit}</td>
                              <td class="px-3 py-2 text-gray-900">${formatCurrency(parseMoney(item.price) || 0)}</td>
                              <td class="px-3 py-2 font-semibold text-blue-600">${item.total}</td>
                            </tr>
                          `).join('')}
                        </tbody>
                      </table>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      });
      
      container.innerHTML = html;
    }

    // Bind controls for the production list modal once
    function setupProductionListHandlersOnce() {
      const saveBtn = document.getElementById('save-to-management');
      if (saveBtn && !saveBtn._bound) {
        saveBtn._bound = true;
        saveBtn.addEventListener('click', () => {
          // save the currentProductionData as a production order
          saveToManagement();
        });
      }

      const exportExcelBtn = document.getElementById('export-production-list-excel');
      if (exportExcelBtn && !exportExcelBtn._bound) {
        exportExcelBtn._bound = true;
        exportExcelBtn.addEventListener('click', async() => {
          try {
            if (!currentProductionData || !currentProductionData.length) {
              showToast('Không có dữ liệu để xuất');
              return;
            }
            // Sort currentProductionData so earliest quote/code appears first
            let sortedCurrentProduction = Array.isArray(currentProductionData) ? currentProductionData.slice() : [];
            try {
              const quoteKeySort = function(q) {
                try {
                  if (typeof extractSequenceFromQuoteCode === 'function') {
                    const s = extractSequenceFromQuoteCode(q && (q.quote_code || q.quoteCode));
                    if (Number.isFinite(s)) return s;
                  }
                } catch (e) {}
                try { if (q && q.created_at) return new Date(q.created_at).getTime(); } catch (e) {}
                return 0;
              };
              sortedCurrentProduction.sort((a,b) => (quoteKeySort(a) || 0) - (quoteKeySort(b) || 0));
            } catch (e) { /* ignore */ }
            const tmpOrder = {
              spo_number: 'Chua_co',
              address: '',
              due_date: '',
              items: JSON.stringify(sortedCurrentProduction)
            };
            await exportGenerateOrderExcel(tmpOrder);
          } catch (e) {
            console.error('export-production-list-excel error', e);
            showToast('Không thể xuất Excel');
          }
        });
      }

      const xinPhepBtn = document.getElementById('open-xinphep-from-production');
      if (xinPhepBtn && !xinPhepBtn._bound) {
        xinPhepBtn._bound = true;
        xinPhepBtn.addEventListener('click', function(){
          try { if (typeof window.xinphepRefreshFromProduction === 'function') window.xinphepRefreshFromProduction(); } catch(e){}
          try { if (typeof window.openXinphepModal === 'function') window.openXinphepModal(); else document.getElementById('xinphep-btn').click(); } catch (e) {}
        });
      }

      const closeBtn = document.getElementById('close-production-list-modal');
      if (closeBtn && !closeBtn._bound) {
        closeBtn._bound = true;
        closeBtn.addEventListener('click', () => closeProductionListModal());
      }
      const backBtn = document.getElementById('back-to-selection');
      if (backBtn && !backBtn._bound) {
        backBtn._bound = true;
          backBtn.addEventListener('click', () => {
          closeProductionListModal();
          // reopen selection without preserving search/filters so UI resets
          openProductionOrderModal({ preserveSelection: false });
        });
      }
    }

    function closeProductionListModal() {
      const modal = document.getElementById('production-list-modal');
      if (!modal) return;
      modal.classList.add('hidden');
      ensureScrollLock();
    }

    // Open saved production order details in a modal
    window.openSavedProductionOrderModal = function(backendId) {
      const order = productionOrders.find(o => o.__backendId === backendId);
      if (!order) return;

      // Title
      const titleEl = document.getElementById('saved-order-title');
      const orderNo = order.spo_number && order.spo_number !== 'Chưa nhập số đơn hàng' ? order.spo_number : '(Chưa có số đơn hàng)';
      titleEl.textContent = `Đơn Hàng: ${orderNo} — Đơn vị: ${order.address || 'Chưa nhập đơn vị thi công'} — Hạn: ${order.due_date || 'Chưa nhập hạn thi công'}`;

      // Content
      const container = document.getElementById('saved-order-content');
      let html = '';
      let quotes = [];
      try {
        quotes = JSON.parse(order.items || '[]');
      } catch (e) {
        quotes = [];
      }

      if (!Array.isArray(quotes) || quotes.length === 0) {
        html = '<p class="text-gray-500">Không có dữ liệu chi tiết</p>';
      } else {
        let idx = 0;
        html += '<div class="space-y-4">';
        quotes.forEach((quote) => {
          idx++;
          let items = [];
          try { items = JSON.parse(quote.items || '[]'); } catch (e) { items = []; }
          html += `
            <div class="border border-gray-200 rounded-lg overflow-hidden">
              <div class="bg-gray-100 px-3 py-2 flex items-center justify-between text-sm">
                <div class="flex items-center gap-3 min-w-0">
                  <span class="font-bold text-blue-600">${idx}</span>
                  <span class="font-semibold text-gray-800 truncate max-w-[240px]">${quote.outlet_name || '-'}</span>
                  <span class="text-gray-600 whitespace-nowrap">| ${quote.outlet_code || '-'}</span>
                  ${quote.spo_number ? `<span class="text-gray-700 whitespace-nowrap">| ${quote.spo_number}</span>` : ''}
                  ${quote.address && quote.address !== 'Địa chỉ sẽ hiển thị tự động khi nhập' ? `<span class="text-gray-500 truncate max-w-[300px]">| ${quote.address}</span>` : ''}
                </div>
                <span class="font-bold text-blue-600 whitespace-nowrap">${formatCurrency(parseMoney(quote.total_amount) || 0)}</span>
              </div>
              <div class="p-3">
                <table class="w-full text-sm">
                  <thead class="bg-gray-50">
                    <tr>
                      <th class="px-3 py-2 text-left text-xs font-medium text-gray-600">Code</th>
                      <th class="px-3 py-2 text-left text-xs font-medium text-gray-600">Nội dung</th>
                      <th class="px-3 py-2 text-left text-xs font-medium text-gray-600">Brand</th>
                      <th class="px-3 py-2 text-left text-xs font-medium text-gray-600">Kích thước</th>
                      <th class="px-3 py-2 text-left text-xs font-medium text-gray-600">SL</th>
                      <th class="px-3 py-2 text-left text-xs font-medium text-gray-600">ĐVT</th>
                      <th class="px-3 py-2 text-left text-xs font-medium text-gray-600">Đơn giá</th>
                      <th class="px-3 py-2 text-left text-xs font-medium text-gray-600">Thành tiền</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-200">
                    ${items.map(item => `
                      <tr>
                        <td class="px-3 py-2 font-medium text-gray-900">${item.code || '-'}</td>
                        <td class="px-3 py-2 text-gray-700">${item.content || '-'}</td>
                        <td class="px-3 py-2 text-gray-600">${item.brand || '-'}</td>
                        <td class="px-3 py-2 text-gray-600">${item.width && item.height ? `${item.width}m × ${item.height}m` : '-'}</td>
                        <td class="px-3 py-2 text-gray-900">${item.quantity || '-'}</td>
                        <td class="px-3 py-2 text-gray-600">${item.unit || '-'}</td>
                        <td class="px-3 py-2 text-gray-900">${formatCurrency(parseMoney(item.price) || 0)}</td>
                        <td class="px-3 py-2 font-semibold text-blue-600">${item.quantity ? formatCurrencyExact((parseMoney(item.price) || 0) * (parseNumber(item.quantity) || 0)) : '-'}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          `;
        });
        html += '</div>';
      }

      container.innerHTML = html;
      document.getElementById('saved-production-order-modal').classList.remove('hidden');
      const closeBtn = document.getElementById('close-saved-order-modal');
      closeBtn.onclick = function() {
        document.getElementById('saved-production-order-modal').classList.add('hidden');
        ensureScrollLock();
      };
      ensureScrollLock();
    };
    function exportProductionExcel() {
      if (!currentProductionData || currentProductionData.length === 0) {
        showToast('Không có dữ liệu để xuất');
        return;
      }
      
      const selectedQuotesList = currentProductionData;
      
      // Prepare data for Excel export
      const excelData = [];
      
      // Group by sale type
      const groupedBySale = {};
      selectedQuotesList.forEach(quote => {
        const saleKey = quote.sale_type === 'TBA' ? 'TBA' : 'Sale (SR)';
        if (!groupedBySale[saleKey]) {
          groupedBySale[saleKey] = [];
        }
        groupedBySale[saleKey].push(quote);
      });
      
      let globalIndex = 0; // Số thứ tự liên tục cho Excel
      
      Object.keys(groupedBySale).forEach(saleKey => {
        const quotes = groupedBySale[saleKey];
        
        // Add individual sale header
        excelData.push([`=== ${saleKey} ===`, '', '', '', '', '', '', '']);
        excelData.push(['STT', 'Outlet Code', 'Tên Outlet', 'SPO', 'Sale', 'Tổng Tiền', 'Khu Vực', 'Trạng Thái']);
        
        quotes.forEach((quote) => {
          globalIndex++; // Tăng số thứ tự liên tục
          // Add quote summary
          excelData.push([
            globalIndex,
            quote.outlet_code,
            quote.outlet_name,
            quote.spo_number || '',
            quote.sale_name || '',
            parseMoney(quote.total_amount) || 0,
            quote.area,
            quote.spo_status
          ]);
          
          // Add items detail header
          excelData.push(['', 'Code', 'Nội dung', 'Brand', 'Kích thước', 'SL', 'ĐVT', 'Đơn giá', 'Thành tiền']);
          
          // Add items
          const items = JSON.parse(quote.items || '[]');
          items.forEach(item => {
            excelData.push([
              '',
              item.code,
              item.content,
              item.brand || '',
              item.width && item.height ? `${item.width}m × ${item.height}m` : '',
              item.quantity,
              item.unit,
              parseMoney(item.price) || 0,
              parseMoney(item.total) || 0
            ]);
          });
          
          excelData.push(['', '', '', '', '', '', '', '', '']); // Empty row
        });
        
        excelData.push(['', '', '', '', '', '', '', '', '']); // Empty row between sale types
      });
      
      // Create and download Excel file
      const ws = XLSX.utils.aoa_to_sheet(excelData);
      // Apply number format for money columns: Tổng Tiền (5), Đơn giá (7), Thành tiền (8)
      try {
        const lastRow = excelData.length - 1;
              for (let r = 1; r <= lastRow; r++) {
          [5, 7, 8].forEach(c => {
            const cellRef = XLSX.utils.encode_cell({ c, r });
            if (ws[cellRef] && ws[cellRef].t === 'n') ws[cellRef].z = '#,##0';
          });
        }
      } catch (e) { /* ignore */ }
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Danh Sách Sản Xuất');
      
      const fileName = `DanhSachSanXuat_${new Date().toISOString().slice(0, 10)}.xlsx`;
      XLSX.writeFile(wb, fileName);
      
      showToast('Đã xuất file Excel thành công!');
    }

    // Manage Production Orders Functions
    function openManageProductionOrdersModal() {
      document.getElementById('manage-production-orders-modal').classList.remove('hidden');
      renderProductionOrdersList(productionOrders);
      setupManageProductionHandlers();
      ensureScrollLock();
    }

    function setupManageProductionHandlers() {
      // Close modal handler
      document.getElementById('close-manage-production-modal').addEventListener('click', closeManageProductionModal);
      
      // Search handler
      const _ms = document.getElementById('manage-search');
      if (_ms) {
        _ms.addEventListener('input', debounce(filterManageProductionOrders, 250));
      }
      
  // Removed: sample production orders button handler
      // Export toolbar handlers
      const exportBtn = document.getElementById('manage-export-btn');
      const cbOrder = document.getElementById('ex-type-order');
      const cbProduction = document.getElementById('ex-type-production');
      const cbContractor = document.getElementById('ex-type-contractor');

      function updateExportEnable() {
        if (!exportBtn) return;
        exportBtn.disabled = selectedManageOrders.size === 0 || (!cbOrder.checked && !cbProduction.checked && !cbContractor.checked);
      }

      [cbOrder, cbProduction, cbContractor].forEach(cb => cb && cb.addEventListener('change', updateExportEnable));

      if (exportBtn) {
        exportBtn.addEventListener('click', () => {
          if (exportBtn.disabled) return;
          const ids = Array.from(selectedManageOrders);
          const variants = [];
            if (cbOrder.checked) variants.push('order');
            if (cbProduction.checked) variants.push('production');
            if (cbContractor.checked) variants.push('contractor');
          exportMultipleVariants(ids, variants);
        });
      }
      updateExportEnable();
    }

    // Export multiple variants
    function exportMultipleVariants(selectedIds, variants) {
      variants.forEach(v => exportManageOrdersExcel(v, selectedIds));
    }

    // Export selected orders (single variant)
    function exportManageOrdersExcel(variant, selectedIds) {
      try {
        const chosen = productionOrders.filter(o => selectedIds.includes(String(o.__backendId)));
        if (chosen.length === 0) {
          showToast('Không có đơn hàng đã chọn');
          return;
        }

        let aoa = [];
        const _manage_group_records = []; // { start, value }

        if (variant === 'order') {
          // Chi tiết: mỗi đơn hàng, rồi từng quote, rồi items có giá
          let globalIndex = 0;
          chosen.forEach(order => {
            aoa.push([`=== Đơn hàng: ${order.spo_number || '(chưa có)'} — Hạn: ${order.due_date || '(chưa)'} — Đơn vị: ${order.address || '(chưa)'} ===`]);
            let quotes = [];
            try { quotes = JSON.parse(order.items || '[]'); } catch (e) { quotes = []; }
            quotes.forEach(q => {
              globalIndex++;
              aoa.push(['']);
              aoa.push(['#', 'Outlet Code', 'Tên Outlet', 'SPO', 'Địa chỉ']);
              const startIdx = aoa.length;
              // push empty first cell for merged columns; record to set only start cell later
              aoa.push([
                '',
                q.outlet_code || '',
                q.outlet_name || '',
                q.spo_number || '',
                (q.address && !q.address.startsWith('Địa chỉ sẽ')) ? q.address : ''
              ]);
              _manage_group_records.push({ start: startIdx, value: globalIndex });
              let items = [];
              try { items = JSON.parse(q.items || '[]'); } catch (e) { items = []; }
              aoa.push(['', 'Code', 'Nội dung', 'Kích thước', 'SL', 'ĐVT', 'Đơn giá', 'Thành tiền']);
              items.forEach(it => {
                const size = (it.width && it.height) ? `${it.width}m × ${it.height}m` : '';
                const priceNum = parseMoney(it.price) || 0;
                const qtyNum = parseNumber(it.quantity) || 0;
                const parsedT = parseMoney(it.total) || 0;
                const computedT = priceNum * qtyNum;
                const finalTotal = (parsedT > 0 && Math.abs(parsedT - computedT) / (computedT || 1) <= 0.1) ? parsedT : computedT;
                aoa.push(['', it.code || '', it.content || '', size, it.quantity || '', it.unit || '', priceNum, finalTotal || 0]);
              });
            });
            aoa.push(['']);
          });
  } else if (variant === 'production' || variant === 'contractor') {
          // Build header counts
          const counts = countSpecialItems(chosen);
          aoa.push(['Tổng hợp số lượng']);
          aoa.push(['Trụ 90 (8.1)', counts.tru90]);
          aoa.push(['Trụ 114 (S8.3)', counts.tru114]);
          aoa.push(['Sắt chỏi (S8.4)', counts.satChoi]);
          aoa.push(['Đèn Pha', counts.denPha]);
          aoa.push(['']);

          let globalIndex = 0;
          chosen.forEach((order, orderIdx) => {
            aoa.push([`=== Đơn hàng: ${order.spo_number || '(chưa có)'} — Hạn: ${order.due_date || '(chưa)'} — Đơn vị: ${order.address || '(chưa)'} ===`]);
            let quotes = [];
            try { quotes = JSON.parse(order.items || '[]'); } catch (e) { quotes = []; }
            quotes.forEach(q => {
              globalIndex++;
              // Cấp 2: quote summary
              aoa.push(['']);
              aoa.push(['#', 'Outlet Code', 'Tên Outlet', 'SPO', 'Địa chỉ']);
              const startIdx = aoa.length;
              aoa.push([
                '',
                q.outlet_code || '',
                q.outlet_name || '',
                q.spo_number || '',
                (q.address && !q.address.startsWith('Địa chỉ sẽ')) ? q.address : ''
              ]);
              _manage_group_records.push({ start: startIdx, value: globalIndex });

              // Cấp 3: items
              let items = [];
              try { items = JSON.parse(q.items || '[]'); } catch (e) { items = []; }
              // Remove items containing 'Giấy phép'
              items = items.filter(it => !String(it.content || '').toLowerCase().includes('giấy phép'));
              if (variant === 'production') {
                aoa.push(['', 'Code', 'Nội dung', 'Kích thước', 'SL', 'ĐVT']);
              } else {
                aoa.push(['', 'Code', 'Nội dung', 'Kích thước', 'SL', 'ĐVT', 'Đơn giá', 'Thành tiền']);
              }
              items.forEach(it => {
                const size = (it.width && it.height) ? `${it.width}m × ${it.height}m` : '';
                if (variant === 'production') {
                  aoa.push(['', it.code || '', it.content || '', size, it.quantity || '', it.unit || '']);
                } else {
                  const price = 0; // placeholder until pricing provided
                  const qty = parseNumber(it.quantity) || 0;
                  const total = Math.round(price * qty);
                  aoa.push(['', it.code || '', it.content || '', size, it.quantity || '', it.unit || '', price, total]);
                }
              });
            });
            aoa.push(['']);
          });
        } else {
          showToast('Loại xuất không hợp lệ');
          return;
        }

        // Process recorded groups: determine end row, clear non-start cells for merged columns, then create merges
        const merges = [];
        _manage_group_records.forEach(rec => {
          let j = rec.start + 1;
          while (j < aoa.length && Array.isArray(aoa[j]) && aoa[j][0] === '' && typeof aoa[j][1] !== 'undefined') {
            j++;
          }
          const end = j - 1;
          if (end >= rec.start) {
            const mergeCols = [0,1,2,3,4];
            // set start cell value
            if (!aoa[rec.start]) aoa[rec.start] = [];
            aoa[rec.start][0] = rec.value;
            // clear other rows in merged columns
            for (let r = rec.start + 1; r <= end; r++) {
              if (!aoa[r]) continue;
              mergeCols.forEach(c => aoa[r][c] = '');
            }
            merges.push({ s: { r: rec.start, c: 0 }, e: { r: end, c: 0 } });
            merges.push({ s: { r: rec.start, c: 1 }, e: { r: end, c: 1 } });
            merges.push({ s: { r: rec.start, c: 2 }, e: { r: end, c: 2 } });
            merges.push({ s: { r: rec.start, c: 3 }, e: { r: end, c: 3 } });
            merges.push({ s: { r: rec.start, c: 4 }, e: { r: end, c: 4 } });
          }
        });

        const ws = XLSX.utils.aoa_to_sheet(aoa);
        if (!ws['!merges']) ws['!merges'] = [];
        ws['!merges'] = ws['!merges'].concat(merges);
        // Apply number formats for money columns in manage export
        try {
          const lastRow = aoa.length - 1;
          if (variant === 'order') {
            // item Đơn giá (6), Thành tiền (7), and quote total may be at col 5 in summary rows
            for (let r = 1; r <= lastRow; r++) {
              [6, 7].forEach(c => {
                const cellRef = XLSX.utils.encode_cell({ c, r });
                if (ws[cellRef] && ws[cellRef].t === 'n') ws[cellRef].z = '#,##0';
              });
            }
          } else {
            // production/contractor: possible money columns at 6/7 as well
            for (let r = 1; r <= lastRow; r++) {
              [6, 7].forEach(c => {
                const cellRef = XLSX.utils.encode_cell({ c, r });
                if (ws[cellRef] && ws[cellRef].t === 'n') ws[cellRef].z = '#,##0';
              });
            }
          }
        } catch (e) { /* ignore */ }
        const wb = XLSX.utils.book_new();
  const sheetName = variant === 'order' ? 'Ra Don Hang' : (variant === 'production' ? 'San Xuat & Thi Cong' : 'Thau Phu');
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
        const dateStr = new Date().toISOString().slice(0, 10);
        const fileName = variant === 'order'
          ? `DonHang_${dateStr}.xlsx`
          : (variant === 'production' ? `SanXuat_ThiCong_${dateStr}.xlsx` : `ThauPhu_${dateStr}.xlsx`);
        XLSX.writeFile(wb, fileName);
        // Mark orders as exported and persist (for 'order' variant)
        if (variant === 'order') {
          const now = new Date().toISOString();
          chosen.forEach(order => {
            order.is_exported = true;
            order.exported_at = now;
            order.qcag_status = 'Đã ra đơn';
            if (window.dataSdk && typeof window.dataSdk.update === 'function') {
              try { window.dataSdk.update(order); } catch (e) { /* ignore */ }
            }
          });
          renderProductionOrdersList(productionOrders);
        }
        showToast('Đã xuất Excel thành công');
      } catch (e) {
        console.error('Export error:', e);
        showToast('Lỗi khi xuất Excel');
      }
    }

    function safeCountConstructionPoints(order) {
      try {
        const pd = JSON.parse(order.items || '[]');
        return Array.isArray(pd) ? pd.length : parseInt(order.phone) || 0;
      } catch (e) {
        return parseInt(order.phone) || 0;
      }
    }

    function countSpecialItems(orders) {
      const result = { tru90: 0, tru114: 0, satChoi: 0, denPha: 0 };
      orders.forEach(order => {
        let quotes = [];
        try { quotes = JSON.parse(order.items || '[]'); } catch (e) { quotes = []; }
        quotes.forEach(q => {
          let items = [];
          try { items = JSON.parse(q.items || '[]'); } catch (e) { items = []; }
          items.forEach(it => {
            const code = String(it.code || '').toUpperCase();
            const content = String(it.content || '').toLowerCase();
            const qty = parseNumber(it.quantity) || 0;
            if (code === '8.1') result.tru90 += qty;
            if (code === 'S8.3') result.tru114 += qty;
            if (code === 'S8.4') result.satChoi += qty;
            if (content.includes('đèn pha') || code === 'DENPHA' || code === 'DP') result.denPha += qty;
          });
        });
      });
      return result;
    }

    // Placeholder contractor price lookup
    const contractorPriceTable = {
      // 'Thau A': { '1.1': 400000, '2.1': 700000 },
      // 'Thau B': { '1.1': 420000 }
    };
    function lookupContractorPrice(contractor, item) {
      if (!contractor || !contractorPriceTable[contractor]) return 0;
      const map = contractorPriceTable[contractor];
      const code = String(item.code || '').toUpperCase();
      return Number(map[code] || 0);
    }

    function closeManageProductionModal() {
      document.getElementById('manage-production-orders-modal').classList.add('hidden');
      ensureScrollLock();
    }

    function filterManageProductionOrders() {
      const searchTerm = document.getElementById('manage-search').value.toLowerCase();
      
      if (searchTerm === '') {
        filteredProductionOrders = productionOrders;
      } else {
        filteredProductionOrders = productionOrders.filter(order =>
          (order.spo_number && String(order.spo_number).toLowerCase().includes(searchTerm)) ||
          (order.address && String(order.address).toLowerCase().includes(searchTerm)) ||
          (order.due_date && String(order.due_date).toLowerCase().includes(searchTerm))
        );
      }
      
      renderProductionOrdersList(filteredProductionOrders);
    }

    function renderProductionOrdersList(orders) {
      const container = document.getElementById('production-orders-list');
      
      if (!Array.isArray(orders) || orders.length === 0) {
        container.innerHTML = '<p class="text-gray-500 text-center py-8">Chưa có đơn hàng sản xuất nào</p>';
        return;
      }

      const sortedOrders = [...orders].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      // ===== Người phụ trách helpers (use backend-fetched users) =====
      const escapeHtmlLocal = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const authUser = (typeof window !== 'undefined' && window.__qcagAuthUser) ? window.__qcagAuthUser : null;
      const currentUsername = authUser && authUser.username ? String(authUser.username).trim() : '';
      const currentIsAdmin = currentUsername === 'adminqcag' || (authUser && !!authUser.is_admin);

      const getResponsibleAccountOptions = () => {
        // Use backend-fetched approved users
        const backendUsers = qcagGetApprovedUsers();
        const map = new Map();
        // Always include adminqcag first
        map.set('adminqcag', { username: 'adminqcag', name: 'adminqcag' });
        // Add all approved users from backend
        backendUsers.forEach(u => {
          const username = u && u.username ? String(u.username).trim() : '';
          const name = u && u.name ? String(u.name).trim() : '';
          if (username && !map.has(username)) {
            map.set(username, { username, name: name || username });
          }
        });
        return Array.from(map.values()).sort((a, b) => String(a.name || a.username).localeCompare(String(b.name || b.username), 'vi', { sensitivity: 'base' }));
      };

      const responsibleAccounts = getResponsibleAccountOptions();
      const accountNameByUsername = (() => {
        const m = new Map();
        responsibleAccounts.forEach(u => m.set(String(u.username), String(u.name || u.username)));
        return m;
      })();

      const getDisplayNameByUsername = (username, order) => {
        if (!username) return '';
        const key = String(username);
        if (accountNameByUsername.has(key)) return accountNameByUsername.get(key);
        try {
          if (order && order.created_by && String(order.created_by) === key && order.created_by_name) {
            return String(order.created_by_name);
          }
        } catch (e) { /* ignore */ }
        return key;
      };

      const parseResponsiblesJson = (raw) => {
        try {
          const arr = JSON.parse(raw || '[]');
          return Array.isArray(arr) ? arr.map(x => String(x || '').trim()).filter(Boolean) : [];
        } catch (e) {
          return [];
        }
      };

      const normalizeResponsiblesDraft = (creatorUsername, list) => {
        const creator = creatorUsername ? String(creatorUsername).trim() : '';
        let next = Array.isArray(list) ? list.map(x => String(x || '').trim()).filter(Boolean) : [];
        if (creator) {
          next = next.filter(u => String(u) !== String(creator));
          next.unshift(creator);
        }
        return Array.from(new Set(next));
      };

      const buildResponsiblesCellHtml = (order, draftJson, { isEditable, canAdd, canRemove, creatorUsername }) => {
        const draft = normalizeResponsiblesDraft(creatorUsername, parseResponsiblesJson(draftJson));
        const normalizedJson = JSON.stringify(draft);
        const excludedUsernames = new Set(draft.map(u => String(u)));
        const creatorLabel = creatorUsername ? (getDisplayNameByUsername(creatorUsername, order) || '-') : '-';
        const creatorPlus = (isEditable && canAdd)
          ? `<button type="button" class="ml-1 w-4 h-4 rounded border border-gray-300 text-gray-700 text-[11px] leading-none hover:bg-gray-50" data-resp-plus data-id="${order.__backendId}" title="Thêm người phụ trách">+</button>`
          : '';

        const creatorChip = `
          <div class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]">
            <div class="flex items-center gap-1">
              <div class="text-[11px] font-semibold text-gray-800 leading-tight">${escapeHtmlLocal(creatorLabel)}</div>
              <div class="text-[9px] italic text-gray-500 leading-tight">người tạo</div>
            </div>
            ${isEditable ? creatorPlus : ''}
          </div>
        `;

        const otherChips = draft
          .filter(u => !creatorUsername || String(u) !== String(creatorUsername))
          .map(u => {
            const label = getDisplayNameByUsername(u, order) || String(u);
            const removeBtn = (isEditable && canRemove)
              ? `<button type="button" class="ml-1 text-gray-500 hover:text-red-600 text-[11px]" data-resp-remove data-id="${order.__backendId}" data-username="${String(u).replace(/"/g, '&quot;')}" title="Xóa">×</button>`
              : '';
            return `
              <div class="inline-flex items-center rounded px-1.5 py-0.5 text-[11px]">
                <div class="text-[11px] font-medium text-gray-800 truncate max-w-[120px]">${escapeHtmlLocal(label)}</div>
                ${isEditable ? removeBtn : ''}
              </div>
            `;
          }).join('');

        const dropdown = (isEditable && canAdd)
          ? `
            <div class="hidden absolute left-0 mt-1 w-48 max-h-56 overflow-auto bg-white border border-gray-200 rounded shadow-lg z-50" data-resp-dropdown data-id="${order.__backendId}">
              ${responsibleAccounts.filter(u => !excludedUsernames.has(String(u.username))).map(u => {
                const uname = String(u.username);
                const label = String(u.name || u.username);
                return `<button type="button" class="block w-full text-left px-3 py-1.5 text-[12px] hover:bg-gray-50 truncate" data-resp-pick data-id="${order.__backendId}" data-username="${uname.replace(/"/g, '&quot;')}">${escapeHtmlLocal(label)}</button>`;
              }).join('')}
            </div>
          `
          : '';

        return `
          <div class="relative" data-resp-root data-id="${order.__backendId}">
            <div class="flex flex-col items-start gap-2" data-resp-chips data-id="${order.__backendId}">${creatorChip}${otherChips}</div>
            <input type="hidden" class="inline-edit" data-id="${order.__backendId}" data-field="responsibles" data-original='${normalizedJson}' value='${normalizedJson}' />
            ${dropdown}
          </div>
        `;
      };

      container.innerHTML = `
        <div class="w-full overflow-x-auto">
          <table class="min-w-full table-fixed border-separate border-spacing-0 divide-y divide-gray-200">
            <colgroup>
              <col style="width:48px;">
              <col style="width:180px;">
              <col style="width:120px;">
              <col style="width:120px;">
              <col style="width:160px;">
              <col style="width:220px;">
              <col style="width:260px;">
              <col style="width:120px;">
            </colgroup>
            <thead class="bg-gray-50">
              <tr>
                <th class="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">STT</th>
                <th class="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Số Đơn Hàng</th>
                <th class="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Ngày tạo đơn hàng</th>
                <th class="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Số lượng điểm</th>
                <th class="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Hạn thi công</th>
                <th class="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Đơn Vị Thi Công</th>
                <th class="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Người phụ trách</th>
                <th class="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Thao tác</th>
              </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
              ${sortedOrders.map((order, index) => {
                let constructionPointsCount = 0;
                try {
                  const pd = JSON.parse(order.items || '[]');
                  constructionPointsCount = Array.isArray(pd) ? pd.length : parseInt(order.phone) || 0;
                } catch (e) {
                  constructionPointsCount = parseInt(order.phone) || 0;
                }
                const displayOrderNo = (order.spo_number && order.spo_number !== 'Chưa nhập số đơn hàng') ? order.spo_number : '';
                const displayDue = order.due_date && order.due_date !== 'Chưa nhập hạn thi công' ? order.due_date : '';
                const displayUnit = order.address && order.address !== 'Chưa nhập đơn vị thi công' ? order.address : '';
                const checked = selectedManageOrders.has(String(order.__backendId)) ? 'checked' : '';
                const isConfirmed = !!order.is_confirmed;
                const isEditing = !!order.is_editing;
                const disableInputs = isConfirmed && !isEditing ? 'disabled' : '';

                // Người phụ trách UI: show +/× only when allowed by current lock/edit state
                const isEditable = (!isConfirmed) || isEditing;
                const rawResp = (typeof order.responsibles === 'string') ? order.responsibles : JSON.stringify(order.responsibles || []);
                const rawArr = parseResponsiblesJson(rawResp);
                const creatorUsername = order && order.created_by ? String(order.created_by).trim() : '';
                const effectiveCreator = creatorUsername || (rawArr[0] || '');
                const normalizedDraft = JSON.stringify(normalizeResponsiblesDraft(effectiveCreator, rawArr));
                const draftArr = parseResponsiblesJson(normalizedDraft);
                const canAdd = isEditable && !!currentUsername;
                const canRemove = isEditable && !!currentUsername;
                const responsiblesCell = buildResponsiblesCellHtml(order, normalizedDraft, { isEditable, canAdd, canRemove, creatorUsername: effectiveCreator });
                const actionCell = (() => {
                  if (isEditing) {
                    return `<div class=\"flex items-center gap-2\">
                      <button class=\"px-3 py-1 text-xs bg-green-600 text-white rounded\" data-row-action=\"confirm\" data-id=\"${order.__backendId}\">Xác nhận</button>
                      <button class=\"px-3 py-1 text-xs bg-gray-300 text-gray-800 rounded\" data-row-action=\"cancel\" data-id=\"${order.__backendId}\">Hủy</button>
                    </div>`;
                  }
                  const wrench = `<svg xmlns=\"http://www.w3.org/2000/svg\" class=\"w-5 h-5\" fill=\"none\" viewBox=\"0 0 24 24\" stroke=\"currentColor\"><path stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\" d=\"M21 16l-4-4m0 0l-4-4m4 4L7 21H3v-4l9-10\"/></svg>`;
                  const editBtn = `<button class=\"px-2 py-1 text-xs bg-blue-600 text-white rounded inline-flex items-center gap-1\" title=\"Chỉnh sửa\" data-row-action=\"edit\" data-id=\"${order.__backendId}\">${wrench}</button>`;
                  if (isConfirmed) {
                    return `<div class=\"flex items-center gap-2 whitespace-nowrap\">${editBtn}<button class=\"px-2 py-1 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded\" data-row-action=\"export-production\" data-id=\"${order.__backendId}\">Thi công</button>\n                    <button class=\"px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded\" data-row-action=\"export-generate\" data-id=\"${order.__backendId}\">Ra Đơn Hàng</button><button class=\"px-2 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded\" data-row-action=\"export-generate-excel\" data-id=\"${order.__backendId}\">Xuất Excel</button></div>`;
                  }
                  // Only block confirm when required fields are missing.
                  const missing = [];
                  if (!displayOrderNo) missing.push('Số đơn hàng');
                  if (!displayDue) missing.push('Hạn thi công');
                  if (!displayUnit) missing.push('Đơn vị thi công');
                  const disableAttr = missing.length ? `data-disabled=\"true\" data-missing=\"${missing.join(', ')}\"` : '';
                  return `<div class=\"flex items-center gap-2 whitespace-nowrap\">\n                    <button class=\"px-3 py-1 text-xs bg-green-600 text-white rounded\" data-row-action=\"confirm\" data-id=\"${order.__backendId}\" ${disableAttr}>Xác nhận</button>\n                    <button class=\"px-2 py-1 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded\" data-row-action=\"export-production\" data-id=\"${order.__backendId}\">Thi công</button>\n                    <button class=\"px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded\" data-row-action=\"export-generate\" data-id=\"${order.__backendId}\">Ra Đơn Hàng</button><button class=\"px-2 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded\" data-row-action=\"export-generate-excel\" data-id=\"${order.__backendId}\">Xuất Excel</button>\n                  </div>`;
                })();
                return `
                  <tr class="hover:bg-gray-50" data-id="${order.__backendId}">
                    <td class="px-2 py-3 whitespace-nowrap text-sm text-gray-900 align-top">${index + 1}</td>
                    <td class="px-2 py-3 whitespace-nowrap text-sm align-top">
                      <input 
                        type="text"
                        class="inline-edit w-44 px-3 py-1.5 border border-gray-200 rounded-full shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="+ Nhập số đơn hàng"
                        value="${displayOrderNo}"
                        data-id="${order.__backendId}"
                        data-field="spo_number"
                        data-original="${displayOrderNo}"
                        ${disableInputs}
                      />
                    </td>
                    <td class="px-2 py-3 whitespace-nowrap text-sm align-top">${new Date(order.created_at).toLocaleString('vi-VN')}</td>
                    <td class="px-2 py-3 whitespace-nowrap text-sm text-center align-top">
                      <button class="px-2 py-1 text-xs bg-gray-600 hover:bg-gray-700 text-white rounded" title="Xem chi tiết" onclick="openManageOrderDetailsModal('${order.__backendId}')">${constructionPointsCount}</button>
                    </td>
                    <td class="px-2 py-3 whitespace-nowrap text-sm align-top">
                      <input 
                        type="date"
                        class="inline-edit w-36 px-3 py-1.5 border border-gray-200 rounded-full shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="+ Nhập hạn thi công"
                        value="${displayDue}"
                        data-id="${order.__backendId}"
                        data-field="due_date"
                        data-original="${displayDue}"
                        ${disableInputs}
                      />
                    </td>
                    <td class="px-2 py-3 whitespace-nowrap text-sm align-top">
                      <input 
                        type="text"
                        class="inline-edit w-56 px-3 py-1.5 border border-gray-200 rounded-full shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="+ Nhập đơn vị thi công"
                        value="${displayUnit}"
                        data-id="${order.__backendId}"
                        data-field="address"
                        data-original="${displayUnit}"
                        ${disableInputs}
                      />
                    </td>
                    <td class="px-2 py-3 whitespace-nowrap text-sm align-top" data-resp-cell data-id="${order.__backendId}">${responsiblesCell}</td>
                    <td class="px-2 py-3 whitespace-nowrap text-sm align-top action-cell">${actionCell}</td>
                  </tr>
                  ${isEditing ? `<tr id="manage-history-${order.__backendId}"><td colspan=\"8\" class=\"px-4 pb-4 bg-yellow-50\">${buildOrderHistoryHTML(order)}</td></tr>` : ''}
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;

      // Inject admin delete buttons for confirmed orders when current user is admin
      try {
        if (currentIsAdmin) {
          const rows = container.querySelectorAll('tr[data-id]');
          rows.forEach(tr => {
            try {
              const id = tr.getAttribute('data-id');
              if (!id) return;
              const order = productionOrders.find(o => String(o.__backendId) === String(id));
              if (!order || !order.is_confirmed) return;
              const actionCell = tr.querySelector('.action-cell > div');
              if (!actionCell) return;
              if (actionCell.querySelector('button[data-row-action="admin-delete"]')) return;
              const btn = document.createElement('button');
              btn.className = 'px-2 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded';
              btn.setAttribute('data-row-action', 'admin-delete');
              btn.setAttribute('data-id', id);
              btn.title = 'Xóa (Admin)';
              btn.textContent = 'Xóa';
              actionCell.appendChild(btn);
            } catch (e) { /* ignore per-row errors */ }
          });
        }
      } catch (e) { /* ignore injection errors */ }

      // Ensure action buttons do not wrap – keep them on one line
      container.querySelectorAll('.action-cell').forEach(td => {
        td.style.whiteSpace = 'nowrap';
        const inner = td.querySelector('div');
        if (inner) { inner.style.flexWrap = 'nowrap'; inner.style.whiteSpace = 'nowrap'; }
      });
      // Bind inline edit events and row-level confirm/enable
      container.querySelectorAll('input.inline-edit').forEach((input) => {
        input.addEventListener('click', (e) => e.stopPropagation());
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            input.blur();
          }
        });
        const original = input.getAttribute('data-original') || input.value;
        input.addEventListener('input', () => {
          const row = input.closest('tr');
          const orderId = row?.dataset.id;
          if (!orderId) return;
          const btn = container.querySelector(`button[data-row-action="confirm"][data-id="${orderId}"]`);
          if (btn) btn.removeAttribute('data-disabled');
        });
      });

      // ===== Người phụ trách interactions (draft only; saved on Confirm) =====
      const closeAllRespDropdowns = () => {
        container.querySelectorAll('[data-resp-dropdown]').forEach(el => {
          el.classList.add('hidden');
          el.style.left = '';
          el.style.top = '';
          el.style.zIndex = '';
        });
      };

      if (!window.__qcagRespPickerBound) {
        window.__qcagRespPickerBound = true;
        document.addEventListener('click', (e) => {
          try {
            const root = document.getElementById('production-orders-list');
            if (!root) return;
            if (e && e.target && e.target.closest && e.target.closest('[data-resp-root]')) return;
            root.querySelectorAll('[data-resp-dropdown]').forEach(el => el.classList.add('hidden'));
          } catch (_) { /* ignore */ }
        });
      }

      const updateRespChipsFromHidden = (backendId) => {
        const root = container.querySelector(`[data-resp-root][data-id="${backendId}"]`);
        if (!root) return;
        const chips = root.querySelector('[data-resp-chips]');
        const hidden = root.querySelector('input.inline-edit[data-field="responsibles"]');
        if (!chips || !hidden) return;

        const idx = productionOrders.findIndex(o => String(o.__backendId) === String(backendId));
        const order = idx >= 0 ? productionOrders[idx] : null;
        const isConfirmed = order ? !!order.is_confirmed : false;
        const isEditing = order ? !!order.is_editing : false;
        const isEditable = (!isConfirmed) || isEditing;

        const creatorUsername = order && order.created_by ? String(order.created_by).trim() : '';
        const currentDraftArr = parseResponsiblesJson(hidden.value || '[]');
        const effectiveCreator = creatorUsername || (currentDraftArr[0] || '');
        const normalized = JSON.stringify(normalizeResponsiblesDraft(effectiveCreator, currentDraftArr));
        hidden.value = normalized;

        const draftArr = parseResponsiblesJson(normalized);
        const canAdd = isEditable && !!currentUsername;
        const canRemove = isEditable && !!currentUsername;

        const tmp = document.createElement('div');
        tmp.innerHTML = buildResponsiblesCellHtml(order || {}, normalized, { isEditable, canAdd, canRemove, creatorUsername: effectiveCreator });
        const newChips = tmp.querySelector('[data-resp-chips]');
        if (newChips) chips.innerHTML = newChips.innerHTML;

        const dropdown = root.querySelector('[data-resp-dropdown]');
        const newDropdown = tmp.querySelector('[data-resp-dropdown]');
        if (dropdown && newDropdown) dropdown.innerHTML = newDropdown.innerHTML;
      };

      // Use event delegation so newly-rendered chips keep working
      if (!container.__qcagRespDelegationBound) {
        container.__qcagRespDelegationBound = true;
        container.addEventListener('click', (e) => {
          const plusBtn = e.target && e.target.closest ? e.target.closest('button[data-resp-plus]') : null;
          if (plusBtn && container.contains(plusBtn)) {
            e.stopPropagation();
            const id = plusBtn.dataset.id;
            if (!id) return;
            const dropdown = container.querySelector(`[data-resp-dropdown][data-id="${id}"]`);
            if (!dropdown) return;
            // compute position so dropdown appears to the right of the + button
            closeAllRespDropdowns();
            try {
              const rootEl = container.querySelector(`[data-resp-root][data-id="${id}"]`) || dropdown.closest('[data-resp-root]');
              const rootRect = rootEl ? rootEl.getBoundingClientRect() : { left: 0, top: 0 };
              const btnRect = plusBtn.getBoundingClientRect();
              const leftPx = Math.round(btnRect.right - rootRect.left + 6); // 6px gap
              const topPx = Math.round(btnRect.top - rootRect.top);
              dropdown.style.left = leftPx + 'px';
              dropdown.style.top = topPx + 'px';
              dropdown.style.zIndex = '9999';
            } catch (err) { /* ignore positioning errors */ }
            dropdown.classList.remove('hidden');
            return;
          }

          const pickBtn = e.target && e.target.closest ? e.target.closest('button[data-resp-pick]') : null;
          if (pickBtn && container.contains(pickBtn)) {
            e.stopPropagation();
            const id = pickBtn.dataset.id;
            const username = pickBtn.dataset.username;
            if (!id || !username) return;
            const root = container.querySelector(`[data-resp-root][data-id="${id}"]`);
            if (!root) return;
            const hidden = root.querySelector('input.inline-edit[data-field="responsibles"]');
            if (!hidden) return;
            const idx = productionOrders.findIndex(o => String(o.__backendId) === String(id));
            const order = idx >= 0 ? productionOrders[idx] : null;
            const creatorUsername = order && order.created_by ? String(order.created_by).trim() : '';
            const curArr = parseResponsiblesJson(hidden.value || '[]');
            const effectiveCreator = creatorUsername || (curArr[0] || '');
            const draft = normalizeResponsiblesDraft(effectiveCreator, curArr);
            if (!draft.includes(String(username))) {
              const next = [...draft, String(username)];
              hidden.value = JSON.stringify(normalizeResponsiblesDraft(effectiveCreator, next));
              const confirmBtn = container.querySelector(`button[data-row-action="confirm"][data-id="${id}"]`);
              if (confirmBtn) confirmBtn.removeAttribute('data-disabled');
            }
            updateRespChipsFromHidden(id);
            return;
          }

          const removeBtn = e.target && e.target.closest ? e.target.closest('button[data-resp-remove]') : null;
          if (removeBtn && container.contains(removeBtn)) {
            e.stopPropagation();
            const id = removeBtn.dataset.id;
            const username = removeBtn.dataset.username;
            if (!id || !username) return;
            const root = container.querySelector(`[data-resp-root][data-id="${id}"]`);
            if (!root) return;
            const hidden = root.querySelector('input.inline-edit[data-field="responsibles"]');
            if (!hidden) return;
            const idx = productionOrders.findIndex(o => String(o.__backendId) === String(id));
            const order = idx >= 0 ? productionOrders[idx] : null;
            const creatorUsername = order && order.created_by ? String(order.created_by).trim() : '';
            const curArr = parseResponsiblesJson(hidden.value || '[]');
            const effectiveCreator = creatorUsername || (curArr[0] || '');
            if (effectiveCreator && String(username) === String(effectiveCreator) && String(currentUsername) !== String(effectiveCreator)) return;
            const draft = normalizeResponsiblesDraft(effectiveCreator, curArr);
            hidden.value = JSON.stringify(draft.filter(u => String(u) !== String(username)));
            const confirmBtn = container.querySelector(`button[data-row-action="confirm"][data-id="${id}"]`);
            if (confirmBtn) confirmBtn.removeAttribute('data-disabled');
            updateRespChipsFromHidden(id);
          }
        });
      }

      // Row-level actions
      container.querySelectorAll('button[data-row-action]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const action = btn.dataset.rowAction;
          const id = btn.dataset.id;
          if (action === 'edit') {
            setOrderEditing(id, true);
            return;
          }
          // delete and notes actions removed per request
          if (action === 'cancel') {
            // revert values to originals and exit editing
            revertRowValues(id);
            setOrderEditing(id, false);
            return;
          }
          if (action === 'confirm') {
            if (btn.hasAttribute('data-disabled')) {
              const missing = btn.getAttribute('data-missing') || '';
              showToast(missing ? `Vui lòng nhập: ${missing}` : 'Vui lòng nhập đủ thông tin trước khi xác nhận');
              return;
            }

            const __profile = (() => {
              try { return String(localStorage.getItem('QCAG_PROFILE_MANAGE_PRODUCTION_CONFIRM') || '') === '1'; } catch (_) { return false; }
            })();
            const __t0 = __profile && typeof performance !== 'undefined' ? performance.now() : 0;

            const values = collectRowValues(id);
            const finalizedAt = new Date().toISOString();

            // FIX: Update qcag_status of child quotes when confirming production order
            const idxOrder = productionOrders.findIndex(o => String(o.__backendId) === String(id));
            if (idxOrder >= 0) {
              const order = productionOrders[idxOrder];
              const spoNumber = order.spo_number || values.spo_number;
              
              // Parse quotes from items field
              let quotes = [];
              try { 
                quotes = JSON.parse(order.items || '[]'); 
              } catch (e) { 
                console.warn('[QCAG] Failed to parse production order items:', e);
              }
              
              // Update currentQuotes to reflect confirmed status
              if (Array.isArray(quotes) && quotes.length > 0 && spoNumber) {
                const matchSet = new Set(quotes.map(q => `${q.outlet_code || ''}__${q.sale_name || ''}`));
                currentQuotes = currentQuotes.map(q => {
                  const key = `${q.outlet_code || ''}__${q.sale_name || ''}`;
                  if (matchSet.has(key)) {
                    // Update status to "Đã ra đơn" unless it's cancelled or recreate status
                    const shouldUpdate = q.qcag_status !== 'Hủy' && q.qcag_status !== 'Ra lại đơn hàng';
                    return shouldUpdate ? { 
                      ...q, 
                      qcag_status: 'Đã ra đơn',
                      qcag_order_number: spoNumber 
                    } : q;
                  }
                  return q;
                });
                console.log(`[QCAG] Confirm: Updated qcag_status for ${quotes.length} quotes in production order ${spoNumber}`);
              }
            }

            // Save once, then render once (previously: saveRowFields + setOrderConfirmed + setOrderEditing caused 3 renders and 2 updates)
            await saveRowFields(id, values, {
              skipRender: true,
              skipUpdateMainList: true,
              backgroundPersist: true,
              extraUpdates: { is_confirmed: true, last_confirmed_at: finalizedAt, is_editing: false }
            });

            const __t1 = __profile && typeof performance !== 'undefined' ? performance.now() : 0;
            renderProductionOrdersList(productionOrders);
            const __t2 = __profile && typeof performance !== 'undefined' ? performance.now() : 0;

            // Defer heavy main list refresh so the table paints first.
            const __defer = (fn) => {
              try {
                if (typeof requestAnimationFrame === 'function') {
                  requestAnimationFrame(() => setTimeout(fn, 0));
                } else {
                  setTimeout(fn, 0);
                }
              } catch (_) {
                setTimeout(fn, 0);
              }
            };

            if (typeof updateMainList === 'function') {
              __defer(() => {
                const __u0 = __profile && typeof performance !== 'undefined' ? performance.now() : 0;
                try { updateMainList(); } catch (e) { /* ignore */ }
                const __u1 = __profile && typeof performance !== 'undefined' ? performance.now() : 0;
                if (__profile) {
                  console.log('[QCAG] manage-production updateMainList timing', { updateMainListMs: Math.round(__u1 - __u0) });
                }
              });
            }

            if (__profile) {
              console.log('[QCAG] manage-production confirm timing', {
                saveMs: Math.round(__t1 - __t0),
                renderMs: Math.round(__t2 - __t1),
                totalMs: Math.round(__t2 - __t0)
              });
            }
            return;
          }

          if (action === 'admin-delete') {
            // Admin-only: delete a confirmed production order and revert associated quotes
            if (!currentIsAdmin) return;
            if (!confirm('Bạn có chắc chắn muốn xóa đơn hàng này? Hành động sẽ trả các điểm về trạng thái trước khi tạo đơn.')) return;
            const idxOrder = productionOrders.findIndex(o => String(o.__backendId) === String(id));
            if (idxOrder < 0) return;
            const orderToDelete = productionOrders[idxOrder];
            const orderLabel = orderToDelete.spo_number || orderToDelete.outlet_code || orderToDelete.id || '';
            try {
              const quotes = JSON.parse(orderToDelete.items || '[]');
              quotes.forEach(q => {
                const targetKey = q.quote_key || `${q.outlet_code || ''}__${q.sale_name || ''}`;
                const foundIdx = currentQuotes.findIndex(c => {
                  try {
                    if (typeof getQuoteKey === 'function') {
                      const k = getQuoteKey(c);
                      if (k && targetKey && String(k) === String(targetKey)) return true;
                    }
                  } catch (e) {}
                  const k2 = `${c.outlet_code || ''}__${c.sale_name || ''}`;
                  return String(k2) === String(targetKey);
                });
                if (foundIdx >= 0) {
                  try {
                    const old = currentQuotes[foundIdx];
                    const notes = (() => { try { return JSON.parse(old.added_items_notes || '[]') || []; } catch (e) { return []; } })();
                    notes.push(`Đơn Hàng ${orderLabel} đã được admin hủy.`);
                    const updated = { ...old, qcag_status: '', qcag_order_number: '', order_number: '', added_items_notes: JSON.stringify(notes) };
                    currentQuotes[foundIdx] = updated;
                  } catch (e) { /* ignore per-item errors */ }
                }
              });
            } catch (e) { /* ignore parse errors */ }

            const removed = productionOrders.splice(idxOrder, 1);

            // Persist master-quote updates and delete order on backend (if available)
            const mastersToUpdate = [];
            try {
              const quotes = JSON.parse(orderToDelete.items || '[]');
              quotes.forEach(q => {
                const targetKey = q.quote_key || `${q.outlet_code || ''}__${q.sale_name || ''}`;
                try {
                  const foundIdx = currentQuotes.findIndex(c => {
                    try {
                      if (typeof getQuoteKey === 'function') {
                        const k = getQuoteKey(c);
                        if (k && targetKey && String(k) === String(targetKey)) return true;
                      }
                    } catch (e) {}
                    const k2 = `${c.outlet_code || ''}__${c.sale_name || ''}`;
                    return String(k2) === String(targetKey);
                  });
                  if (foundIdx >= 0) {
                    const old = currentQuotes[foundIdx];
                    try {
                      const master = (typeof findQuoteByKey === 'function') ? findQuoteByKey(getQuoteKey(old)) : null;
                      if (master) {
                        mastersToUpdate.push(master);
                      }
                    } catch (e) { /* ignore */ }
                  }
                } catch (e) { /* ignore per-item */ }
              });
            } catch (e) { /* ignore parse */ }

            if (mastersToUpdate.length && window.dataSdk && typeof window.dataSdk.update === 'function') {
              try {
                const results = await Promise.allSettled(mastersToUpdate.map(m => {
                  try { m.qcag_status = ''; m.qcag_order_number = ''; m.order_number = ''; } catch(e){}
                  try {
                    const notes = (() => { try { return JSON.parse(m.added_items_notes || '[]') || []; } catch (e) { return []; } })();
                    notes.push(`Đơn Hàng ${orderLabel} đã được admin hủy.`);
                    m.added_items_notes = JSON.stringify(notes);
                  } catch (e) {}
                  return window.dataSdk.update(m);
                }));
                const failed = results.filter(r => r.status === 'rejected');
                if (failed.length) showToast('Một số thay đổi không lưu được lên backend (kiểm tra quyền).', 'warning');
              } catch (e) {
                console.error('admin-delete: failed updating masters', e);
                showToast('Không lưu được thay đổi lên backend', 'warning');
              }
            }

            if (removed && removed.length && window.dataSdk && typeof window.dataSdk.delete === 'function') {
              try {
                await window.dataSdk.delete(removed[0]);
              } catch (e) {
                console.error('admin-delete: failed deleting order on backend', e);
                showToast('Không xóa được đơn hàng trên backend; kiểm tra quyền.', 'warning');
              }
            }

            try { if (typeof __qcagMarkProductionOrdersDirty === 'function') __qcagMarkProductionOrdersDirty(); } catch (e) { /* ignore */ }

            renderProductionOrdersList(productionOrders);
            try { updateRecentQuotesPreview(); } catch (e) {}
            if (typeof updateMainList === 'function') updateMainList();
            // Also refresh acceptance UI and any open acceptance detail/modal views
            try { window.__filteredAcceptanceOrders = null; } catch (e) {}
            try { if (typeof window.__renderAcceptanceProductionOrders === 'function') window.__renderAcceptanceProductionOrders(); } catch (e) {}
            try { renderAcceptanceImages(); } catch (e) {}
            try { renderProductionOrdersForAcceptance(); } catch (e) {}
            try { renderAcceptanceDetailModal(); } catch (e) {}
            showToast('Đã xóa đơn hàng (Admin) và trả các điểm về trạng thái ban đầu');
            return;
          }

          
          
          if (action === 'export-generate-excel') {
            try {
              const order = productionOrders.find(o => String(o.__backendId) === String(id));
              if (!order) return;
              // prepare pages context for exporter
              const pagesContainer = document.getElementById('manage-order-pages');
              try { pagesContainer._quotes = JSON.parse(order.items || '[]'); } catch (e) { pagesContainer._quotes = []; }
              try { document.getElementById('manage-order-details-title').textContent = `Đơn hàng: ${order.spo_number || '(Chưa có số đơn hàng)'}`; } catch (e) { /* ignore */ }
              try { document.getElementById('manage-order-details-subtitle').textContent = `Đơn vị thi công: ${order.address || 'Chưa có'} • Hạn thi công: ${order.due_date || 'Chưa có'}`; } catch (e) { /* ignore */ }
              // Call same exporter used by "Ra Đơn Hàng" so layout is 100% identical
              await exportGenerateOrderExcel(order);
            } catch (e) {
              console.error('export-generate-excel handler error', e);
            }
            return;
          }

          if (action === 'export-production') {
            try {
              const order = productionOrders.find(o => String(o.__backendId) === String(id));
              if (!order) return;
              // populate manage-order-pages._quotes with order items so exporter reads them
              const pagesContainer = document.getElementById('manage-order-pages');
              try { pagesContainer._quotes = JSON.parse(order.items || '[]'); } catch (e) { pagesContainer._quotes = []; }
              // set title/subtitle so header info is correct for the export
              try { document.getElementById('manage-order-details-title').textContent = `Đơn hàng: ${order.spo_number || '(Chưa có số đơn hàng)'}`; } catch (e) { /* ignore */ }
              try { document.getElementById('manage-order-details-subtitle').textContent = `Đơn vị thi công: ${order.address || 'Chưa có'} • Hạn thi công: ${order.due_date || 'Chưa có'}`; } catch (e) { /* ignore */ }
              // Removed Excel export here per request; only generate PDF for "Thi công"
              if (typeof exportProductionPdf === 'function') exportProductionPdf();
            } catch (e) {
              console.error('export-production handler error', e);
            }
            return;
          }

          if (action === 'export-generate') {
            try {
              const order = productionOrders.find(o => String(o.__backendId) === String(id));
              if (!order) return;
              const pagesContainer = document.getElementById('manage-order-pages');
              try { pagesContainer._quotes = JSON.parse(order.items || '[]'); } catch (e) { pagesContainer._quotes = []; }
              try { document.getElementById('manage-order-details-title').textContent = `Đơn hàng: ${order.spo_number || '(Chưa có số đơn hàng)'}`; } catch (e) { /* ignore */ }
              try { document.getElementById('manage-order-details-subtitle').textContent = `Đơn vị thi công: ${order.address || 'Chưa có'} • Hạn thi công: ${order.due_date || 'Chưa có'}`; } catch (e) { /* ignore */ }
              // Removed Excel export here; keep only PDF generation (Ra Đơn Hàng should no longer export Excel)
              if (typeof exportGenerateOrderPdf === 'function') {
                await exportGenerateOrderPdf();
              }
            } catch (e) {
              console.error('export-generate handler error', e);
            }
            return;
          }
        });
      });


      // Add note buttons
      container.querySelectorAll('button[data-add-note]').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.id;
          const ta = document.getElementById(`note-input-${id}`);
          if (!ta) return;
          const text = ta.value.trim();
          if (!text) return;
          const idx = productionOrders.findIndex(o => String(o.__backendId) === String(id));
          if (idx < 0) return;
          const order = productionOrders[idx];
          const notes = Array.isArray(order.notes) ? order.notes : [];
          const entry = ensureNoteHasAuthor({ text, at: new Date().toISOString() });
          const updated = { ...order, notes: [...notes, entry] };
          productionOrders[idx] = updated;
          if (window.dataSdk && typeof window.dataSdk.update === 'function') {
            try { window.dataSdk.update(updated); } catch (e) { /* ignore */ }
          }
          // Rebuild notes row
          const row = document.getElementById(`manage-notes-${id}`);
          if (row) row.innerHTML = `<td colspan=\"8\" class=\"px-4 pb-4 bg-gray-50\">${buildOrderNotesHTML(updated)}</td>`;
          showToast('Đã thêm ghi chú');
        });
      });
      applyEditingVisual();

      // Selection UI removed (checkbox column was removed)
      updateManageExportButtonState();
      // Normalize per-row export button UI: green background and remove icon
      container.querySelectorAll('button[data-row-action="export-generate-excel"]').forEach(btn => {
        btn.className = 'px-2 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded';
        btn.textContent = 'Xuất Excel';
        btn.title = 'Xuất Excel';
      });
      applyEditingVisual();
    }

    function applyEditingVisual() {
      const container = document.getElementById('production-orders-list');
      if (!container) return;
      const anyEditing = productionOrders.some(o => o.is_editing);
      if (anyEditing) container.classList.add('editing'); else container.classList.remove('editing');
      // Mark editing row
      const editing = productionOrders.find(o => o.is_editing);
      container.querySelectorAll('tbody tr').forEach(tr => tr.classList.remove('is-editing'));
      if (editing) {
        const row = container.querySelector(`tbody tr[data-id="${editing.__backendId}"]`);
        if (row) row.classList.add('is-editing');
      }
    }

    // Toggle details view for a saved production order inline
    window.toggleManageOrderDetails = function(backendId) {
      // Deprecated: replaced by modal view
      openManageOrderDetailsModal(backendId);
    }

    window.toggleManageOrderNotes = function(backendId) {
      const row = document.getElementById(`manage-notes-${backendId}`);
      if (!row) return;
      row.classList.toggle('hidden');
    }

    // Build details HTML similar to "Danh Sách Sản Xuất":
    // Cấp 1: theo sale (sale_type + sale_name)
    // Cấp 2: summary từng outlet
    // Cấp 3: bảng item chi tiết
    function buildOrderDetailsHTML(order) {
      let quotes = [];
      try {
        quotes = JSON.parse(order.items || '[]');
      } catch (e) {
        quotes = [];
      }
      if (!Array.isArray(quotes) || quotes.length === 0) {
        return '<p class="text-gray-500 text-sm">Không có dữ liệu chi tiết</p>';
      }
      // Group by sale
      const groupedBySale = {};
      quotes.forEach(q => {
        const saleType = q.sale_type === 'TBA' ? 'TBA' : 'Sale (SR)';
        const saleName = q.sale_name || 'Không có tên';
        const key = `${saleType} - ${saleName}`;
        if (!groupedBySale[key]) groupedBySale[key] = [];
        groupedBySale[key].push(q);
      });

      let html = '';
      let globalIndex = 0;
      Object.keys(groupedBySale).forEach(saleKey => {
        const list = groupedBySale[saleKey];
        const totalAmount = list.reduce((s, q) => s + (parseMoney(q.total_amount) || 0), 0);
        html += `
          <div class="mb-6">
            <h2 class="text-xl font-bold text-gray-800 mb-3">${saleKey} (${list.length} báo giá - ${formatCurrency(totalAmount)})</h2>
            <div class="space-y-3">
              ${list.map(q => {
                globalIndex++;
                let items = [];
                try { items = JSON.parse(q.items || '[]'); } catch (e) { items = []; }
                return `
                  <div class="border border-gray-200 rounded-lg overflow-hidden">
                    <div class="bg-gray-100 px-3 py-2 flex items-center justify-between text-sm">
                      <div class="flex items-center gap-3 min-w-0">
                        <span class="font-bold text-blue-600">${globalIndex}</span>
                        <span class="font-semibold text-gray-800 truncate max-w-[240px]">${q.outlet_name || '-'}</span>
                        <span class="text-gray-600 whitespace-nowrap">| ${q.outlet_code || '-'}</span>
                        ${q.spo_number ? `<span class="text-gray-700 whitespace-nowrap">| ${q.spo_number}</span>` : ''}
                        ${typeof q.point_order_number !== 'undefined' && q.point_order_number !== '' ? `<span class=\"text-blue-700 whitespace-nowrap text-xs font-semibold\">• Số ĐH của điểm: ${q.point_order_number}</span>` : ''}
                        ${q.address && q.address !== 'Địa chỉ sẽ hiển thị tự động khi nhập' ? `<span class="text-gray-500 truncate max-w-[300px]">| ${q.address}</span>` : ''}
                      </div>
                      <span class="font-bold text-blue-600 whitespace-nowrap">${formatCurrency(parseMoney(q.total_amount) || 0)}</span>
                    </div>
                    <div class="p-3">
                      <table class="w-full text-sm">
                        <thead class="bg-gray-50">
                          <tr>
                            <th class="px-3 py-2 text-left text-xs font-medium text-gray-600">Code</th>
                            <th class="px-3 py-2 text-left text-xs font-medium text-gray-600">Nội dung</th>
                            <th class="px-3 py-2 text-left text-xs font-medium text-gray-600">Brand</th>
                            <th class="px-3 py-2 text-left text-xs font-medium text-gray-600">Kích thước</th>
                            <th class="px-3 py-2 text-left text-xs font-medium text-gray-600">SL</th>
                            <th class="px-3 py-2 text-left text-xs font-medium text-gray-600">ĐVT</th>
                            <th class="px-3 py-2 text-left text-xs font-medium text-gray-600">Đơn giá</th>
                            <th class="px-3 py-2 text-left text-xs font-medium text-gray-600">Thành tiền</th>
                          </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-200">
                          ${items.map(it => `
                            <tr class="hover:bg-gray-50">
                              <td class="px-3 py-2 font-medium text-gray-900">${it.code || ''}</td>
                              <td class="px-3 py-2 text-gray-700">${it.content || ''}</td>
                              <td class="px-3 py-2 text-gray-600">${it.brand || '-'}</td>
                              <td class="px-3 py-2 text-gray-600">${it.width && it.height ? `${it.width}m × ${it.height}m` : '-'}</td>
                              <td class="px-3 py-2 text-gray-900">${it.quantity || ''}</td>
                              <td class="px-3 py-2 text-gray-600">${it.unit || ''}</td>
                              <td class="px-3 py-2 text-gray-900">${formatCurrency(parseMoney(it.price) || 0)}</td>
                              <td class="px-3 py-2 font-semibold text-blue-600">${formatCurrencyExact((parseMoney(it.price) || 0) * (parseNumber(it.quantity) || 0))}</td>
                            </tr>
                          `).join('')}
                        </tbody>
                      </table>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      });
      return html;
    }

    function buildOrderNotesHTML(order) {
      const notes = Array.isArray(order.notes) ? order.notes : [];
      const list = notes.map(n => {
        const author = getNoteAuthorLabel(n);
        const authorHtml = author ? `<div class="text-[11px] text-gray-500 mt-0.5">${escapeHtml(author)}</div>` : '';
        return `<li class="text-gray-700">
          <div><span class="text-gray-500">${new Date(n.at).toLocaleString('vi-VN')}</span>: ${escapeHtml(n.text || '')}</div>
          ${authorHtml}
        </li>`;
      }).join('');
      return `
        <div class="text-sm">
          <div class="font-semibold text-gray-800 mb-2">Ghi chú</div>
          <div class="flex items-start gap-3">
            <div class="flex-1">
              <ul class="space-y-1">${list || '<li class=\"text-gray-500\">Chưa có ghi chú</li>'}</ul>
            </div>
            <div class="w-1/2">
              <textarea id="note-input-${order.__backendId}" class="w-full px-3 py-2 border border-gray-300 rounded" rows="3" placeholder="+ Thêm ghi chú"></textarea>
              <div class="mt-2 flex justify-end"><button class="px-3 py-1 text-xs bg-gray-800 text-white rounded" data-add-note id="add-note-${order.__backendId}" data-id="${order.__backendId}">Thêm ghi chú</button></div>
            </div>
          </div>
        </div>
      `;
    }

    function buildOrderHistoryHTML(order) {
      const history = Array.isArray(order.edit_history) ? [...order.edit_history].reverse() : [];
      if (!history.length) return '<div class="text-sm text-gray-500">Chưa có lịch sử chỉnh sửa</div>';
      const labels = { spo_number: 'Số đơn hàng', due_date: 'Hạn thi công', address: 'Đơn vị thi công' };
      return `
        <div class="text-sm">
          <div class="font-semibold text-gray-800 mb-2">Lịch sử chỉnh sửa</div>
          <ul class="space-y-1">
            ${history.map(h => {
              const label = labels[h.field] || h.field;
              return `<li class="text-gray-700"><span class="text-gray-500">${new Date(h.at).toLocaleString('vi-VN')}</span>: <b>${label}</b> đổi từ "${h.oldValue || ''}" → "${h.newValue || ''}"</li>`;
            }).join('')}
          </ul>
        </div>
      `;
    }

    function updateManageExportButtonState() {
      const btn = document.getElementById('manage-export-btn');
      if (!btn) return;
      const cbOrder = document.getElementById('ex-type-order');
      const cbProduction = document.getElementById('ex-type-production');
      const cbContractor = document.getElementById('ex-type-contractor');
      const anyType = (cbOrder && cbOrder.checked) || (cbProduction && cbProduction.checked) || (cbContractor && cbContractor.checked);
      btn.disabled = selectedManageOrders.size === 0 || !anyType;
    }

    function setOrderEditing(backendId, editing) {
      const idx = productionOrders.findIndex(o => String(o.__backendId) === String(backendId));
      if (idx < 0) return;
      productionOrders[idx] = { ...productionOrders[idx], is_editing: !!editing };
      renderProductionOrdersList(productionOrders);
    }

    function setOrderConfirmed(backendId, confirmed) {
      const idx = productionOrders.findIndex(o => String(o.__backendId) === String(backendId));
      if (idx < 0) return;
      productionOrders[idx] = { ...productionOrders[idx], is_confirmed: !!confirmed, last_confirmed_at: new Date().toISOString() };
      // Best-effort remote persist
      if (window.dataSdk && typeof window.dataSdk.update === 'function') {
        try { window.dataSdk.update(productionOrders[idx]); } catch (e) { /* ignore */ }
      }
      renderProductionOrdersList(productionOrders);
    }

    function revertRowValues(backendId) {
      const row = document.querySelector(`#production-orders-list tr[data-id="${backendId}"]`);
      if (!row) return;
      row.querySelectorAll('input.inline-edit').forEach(input => {
        const original = input.getAttribute('data-original') || '';
        input.value = original;
      });
    }

    function collectRowValues(backendId) {
      const row = document.querySelector(`#production-orders-list tr[data-id="${backendId}"]`);
      if (!row) return {};
      const getVal = (field) => {
        const el = row.querySelector(`input.inline-edit[data-field="${field}"]`);
        return el ? el.value.trim() : '';
      };

      const normalizeResponsibles = (creatorUsername, raw) => {
        let arr = [];
        try {
          arr = JSON.parse(raw || '[]');
          if (!Array.isArray(arr)) arr = [];
        } catch (e) {
          arr = [];
        }
        arr = arr.map(x => String(x || '').trim()).filter(Boolean);
        const creator = creatorUsername ? String(creatorUsername).trim() : '';
        if (creator) {
          arr = arr.filter(u => String(u) !== String(creator));
          arr.unshift(creator);
        }
        return JSON.stringify(Array.from(new Set(arr)));
      };

      const responsiblesRaw = getVal('responsibles');
      const idx = productionOrders.findIndex(o => String(o.__backendId) === String(backendId));
      const current = idx >= 0 ? productionOrders[idx] : null;
      let inferredCreator = current && current.created_by ? String(current.created_by).trim() : '';
      if (!inferredCreator) {
        try {
          const arr = JSON.parse(responsiblesRaw || '[]');
          if (Array.isArray(arr) && arr.length) inferredCreator = String(arr[0] || '').trim();
        } catch (e) { /* ignore */ }
      }
      const responsibles = normalizeResponsibles(inferredCreator, responsiblesRaw);
      return {
        spo_number: getVal('spo_number') || 'Chưa nhập số đơn hàng',
        due_date: getVal('due_date') || 'Chưa nhập hạn thi công',
        address: getVal('address') || 'Chưa nhập đơn vị thi công',
        responsibles
      };
    }

    async function saveRowFields(backendId, updates, options = {}) {
      const idx = productionOrders.findIndex(o => String(o.__backendId) === String(backendId));
      if (idx < 0) return;
      const current = productionOrders[idx];
      const oldValues = { spo_number: current.spo_number, due_date: current.due_date, address: current.address };

      // Build edit history entries only for changed fields
      const changes = [];
      for (const k of ['spo_number', 'due_date', 'address']) {
        if (!(k in updates)) continue;
        const before = String(oldValues[k] || '');
        const after = String(updates[k] || '');
        if (before !== after) {
          changes.push({ field: k, oldValue: oldValues[k] || '', newValue: updates[k] || '', at: new Date().toISOString() });
        }
      }

      const existingHistory = Array.isArray(current.edit_history) ? current.edit_history : [];
      const extraUpdates = (options && typeof options.extraUpdates === 'object' && options.extraUpdates) ? options.extraUpdates : null;
      const updated = extraUpdates
        ? { ...current, ...updates, ...extraUpdates, edit_history: [...existingHistory, ...changes] }
        : { ...current, ...updates, edit_history: [...existingHistory, ...changes] };

      let ok = false;
      const backgroundPersist = !!options.backgroundPersist;

      // Optimistic local update first (so UI can render immediately)
      productionOrders[idx] = updated;
      try { if (typeof __qcagMarkProductionOrdersDirty === 'function') __qcagMarkProductionOrdersDirty(); } catch (e) {}
      ok = true;

      const __profile = (() => {
        try { return String(localStorage.getItem('QCAG_PROFILE_MANAGE_PRODUCTION_CONFIRM') || '') === '1'; } catch (_) { return false; }
      })();

      const persist = async () => {
        if (!(window.dataSdk && typeof window.dataSdk.update === 'function')) return true;
        const p0 = __profile && typeof performance !== 'undefined' ? performance.now() : 0;
        try {
          const res = await window.dataSdk.update(updated);
          const okRemote = !!(res && (res.isOk || res.ok));
          const p1 = __profile && typeof performance !== 'undefined' ? performance.now() : 0;
          if (__profile) console.log('[QCAG] manage-production dataSdk.update timing', { updateMs: Math.round(p1 - p0), ok: okRemote });
          return okRemote;
        } catch (e) {
          const p1 = __profile && typeof performance !== 'undefined' ? performance.now() : 0;
          if (__profile) console.log('[QCAG] manage-production dataSdk.update timing', { updateMs: Math.round(p1 - p0), ok: false, error: String(e && e.message ? e.message : e) });
          return false;
        }
      };

      if (backgroundPersist) {
        // Fire-and-forget sync; only notify on failure.
        persist().then((okRemote) => {
          if (!okRemote) showToast('Đồng bộ thất bại');
        });
      } else {
        const okRemote = await persist();
        ok = okRemote || ok;
      }

      // Propagate order number effects if changed
      if ('spo_number' in updates) {
        const value = updates.spo_number;
        const baseNo = parseInt(value, 10);
        try {
          let quotes = [];
          try { quotes = JSON.parse(updated.items || '[]'); } catch (e) { quotes = []; }
          const newItems = quotes.map((q, i) => {
            const pointNo = Number.isFinite(baseNo) ? (baseNo + i + 1) : '';
            return { ...q, point_order_number: pointNo };
          });
          productionOrders[idx] = { ...productionOrders[idx], items: JSON.stringify(newItems) };
          if (Array.isArray(quotes) && quotes.length) {
            const matchSet = new Set(quotes.map(q => `${q.outlet_code || ''}__${q.sale_name || ''}`));
            currentQuotes = currentQuotes.map(q => {
              const key = `${q.outlet_code || ''}__${q.sale_name || ''}`;
              if (matchSet.has(key)) {
                return { ...q, qcag_status: value ? (q.qcag_status === 'Hủy' || q.qcag_status === 'Ra lại đơn hàng' ? q.qcag_status : 'Đã ra đơn') : (q.qcag_status || ''), qcag_order_number: value || '' };
              }
              return q;
            });
          }
        } catch (e) { /* ignore */ }
      }

      if (!options.skipRender) renderProductionOrdersList(productionOrders);
      if (!options.skipUpdateMainList && typeof updateMainList === 'function') updateMainList();
      showToast(ok ? 'Đã lưu thay đổi' : 'Lưu thất bại');
    }

    async function handleInlineSave(backendId, field, value) {
      const idx = productionOrders.findIndex(o => String(o.__backendId) === String(backendId));
      if (idx < 0) return;
      const current = productionOrders[idx];
      const updated = { ...current, [field]: value };
      let ok = false;
      if (window.dataSdk && typeof window.dataSdk.update === 'function') {
        try {
          const res = await window.dataSdk.update(updated);
          ok = !!res?.isOk;
        } catch (e) {
          ok = false;
        }
      }
      if (!ok) {
        // Local fallback
        productionOrders[idx] = updated;
        ok = true;
      }
      // If editing Số Đơn Hàng, propagate to QCAG status and per-point numbers
      if (field === 'spo_number') {
        const baseNo = parseInt(value, 10);
        // Update QCAG display on main quotes
        try {
          let quotes = [];
          try { quotes = JSON.parse(updated.items || '[]'); } catch (e) { quotes = []; }
          // Compute per-point order numbers and store back into items
          const newItems = quotes.map((q, i) => {
            const pointNo = Number.isFinite(baseNo) ? (baseNo + i + 1) : '';
            return { ...q, point_order_number: pointNo };
          });
          // Save back to productionOrders structure
          productionOrders[idx] = { ...productionOrders[idx], spo_number: value || 'Chưa nhập số đơn hàng', items: JSON.stringify(newItems) };
          // Also update currentQuotes qcag_status to reflect the order number
          if (Array.isArray(quotes) && quotes.length) {
            const matchSet = new Set(quotes.map(q => `${q.outlet_code || ''}__${q.sale_name || ''}`));
            currentQuotes = currentQuotes.map(q => {
              const key = `${q.outlet_code || ''}__${q.sale_name || ''}`;
              if (matchSet.has(key)) {
                return { ...q, qcag_status: value ? (q.qcag_status === 'Hủy' || q.qcag_status === 'Ra lại đơn hàng' ? q.qcag_status : 'Đã ra đơn') : (q.qcag_status || ''), qcag_order_number: value || '' };
              }
              return q;
            });
          }
        } catch (e) {
          console.warn('Failed to propagate order number to QCAG/points', e);
        }
      }
      renderProductionOrdersList(productionOrders);
      // Refresh main list so QCAG column shows order number
      if (typeof updateMainList === 'function') updateMainList();
      showToast(ok ? 'Đã lưu thay đổi' : 'Lưu thất bại');
    }

    // Append edit history entry
    async function appendEditHistory(backendId, field, oldValue, newValue) {
      const idx = productionOrders.findIndex(o => String(o.__backendId) === String(backendId));
      if (idx < 0) return;
      const order = productionOrders[idx];
      const entry = { field, oldValue, newValue, at: new Date().toISOString() };
      const history = Array.isArray(order.edit_history) ? order.edit_history : [];
      const updated = { ...order, edit_history: [...history, entry] };
      productionOrders[idx] = updated;
      // Try remote persist best-effort
      if (window.dataSdk && typeof window.dataSdk.update === 'function') {
        try { await window.dataSdk.update(updated); } catch (e) { /* silent */ }
      }
    }

    // Generate a unique order number
    function generateOrderNumber() {
      const timestamp = Date.now();
      return `DH-${new Date(timestamp).toISOString().slice(0, 10).replace(/-/g, '')}-${String(timestamp).slice(-3)}`;
    }

    // Save production list to management
    async function saveToManagement() {
      // Check if we have production data to save
      if (!currentProductionData || currentProductionData.length === 0) {
        showToast('Không có dữ liệu để lưu. Vui lòng tạo danh sách sản xuất trước.');
        return;
      }

      // Show loading state
      const saveBtn = document.getElementById('save-to-management');
      const originalText = saveBtn.textContent;
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<div class="loading-spinner mr-2"></div> Đang lưu...';

      try {
        // Count construction points (number of quotes in current production data)
        const constructionPointsCount = currentProductionData.length;
        const timestamp = Date.now();
        
        // Calculate total amount safely
        let totalAmount = 0;
        for (const quote of currentProductionData) {
          const amount = parseMoney(quote.total_amount);
          if (!isNaN(amount) && isFinite(amount)) {
            totalAmount += amount;
          }
        }
        
        // Ensure totalAmount is a valid number
        if (isNaN(totalAmount) || !isFinite(totalAmount)) {
          totalAmount = 0;
        }
        
        // CRITICAL FIX: Create clean production data for storage
        // Only keep essential fields and ensure no nested objects with __backendId
        const cleanProductionData = currentProductionData.map(quote => {
          // Parse items to clean them
          let cleanItems = [];
          try {
            const items = JSON.parse(quote.items || '[]');
            cleanItems = items.map(item => ({
              code: item.code || '',
              content: item.content || '',
              brand: item.brand || '',
              width: item.width || '',
              height: item.height || '',
              quantity: item.quantity || '',
              unit: item.unit || '',
              price: item.price || '',
              total: item.total || ''
            }));
          } catch (e) {
            console.warn('Error parsing items for quote:', quote.id);
            cleanItems = [];
          }
          
          // Return clean quote data without __backendId
          return {
            outlet_code: quote.outlet_code || '',
            outlet_name: quote.outlet_name || '',
            area: quote.area || '',
            sale_type: quote.sale_type || '',
            sale_name: quote.sale_name || '',
            sale_phone: quote.sale_phone || '',
            outlet_phone: quote.outlet_phone || '',
            address: quote.address || '',
            spo_number: quote.spo_number || '',
            spo_status: quote.spo_status || '',
            total_amount: parseMoney(quote.total_amount) || 0,
            // Preserve quote metadata; acceptance images must start empty on new production orders
            quote_code: quote.quote_code || quote.quoteCode || '',
            images: '[]',
            quote_key: (typeof getQuoteKey === 'function' ? getQuoteKey(quote) : (quote.__backendId || quote.id || '')),
            quote_id: quote.__backendId || quote.id || null,
            items: JSON.stringify(cleanItems)
          };
        });
        
        // Create production order data with all required schema fields
        const generatedOrderNo = generateOrderNumber();

        // Creator metadata (local auth)
        const authUser = (typeof window !== 'undefined' && window.__qcagAuthUser) ? window.__qcagAuthUser : null;
        const creatorUsername = authUser && authUser.username ? String(authUser.username).trim() : '';
        const creatorName = authUser && (authUser.name || authUser.full_name) ? String(authUser.name || authUser.full_name).trim() : creatorUsername;
        const productionOrderData = {
          id: `production_${timestamp}`,
          outlet_code: `PROD_${timestamp}`,
          outlet_name: `Đơn hàng sản xuất ${new Date().toLocaleDateString('vi-VN')}`,
          address: 'Chưa nhập đơn vị thi công', // Đơn vị thi công - sẽ được nhập sau
          phone: constructionPointsCount.toString(), // Số lượng điểm thi công
          sale_name: 'Đơn hàng sản xuất',
          area: 'PRODUCTION',
          items: JSON.stringify(cleanProductionData), // Store as JSON string
          // Add quick lookup keys and metadata for acceptance/gallery
          quote_keys: JSON.stringify(cleanProductionData.map(q => q.quote_key).filter(Boolean)),
          total_amount: totalAmount,
          created_at: new Date().toISOString(),
          spo_number: '', // Mặc định trống khi tạo đơn (không tự sinh số SPO)
          // spo_status: 'Đơn hàng sản xuất', // Removed to prevent spo_status change on order creation
          due_date: 'Chưa nhập hạn thi công', // Hạn thi công - sẽ được nhập sau

          // Người phụ trách
          created_by: creatorUsername,
          created_by_name: creatorName,
          responsibles: JSON.stringify(creatorUsername ? [creatorUsername] : [])
        };

        // Validate all required fields
  const requiredFields = ['id', 'outlet_code', 'outlet_name', 'address', 'phone', 'sale_name', 'area', 'items', 'total_amount', 'created_at', 'spo_number'];
        
        for (const field of requiredFields) {
          if (!(field in productionOrderData)) {
            throw new Error(`Missing required field: ${field}`);
          }
          
          const value = productionOrderData[field];
          
          // Check for null/undefined
          if (value === null || value === undefined) {
            throw new Error(`Field ${field} cannot be null or undefined`);
          }
          
          // Check data types - must be primitives only
          const valueType = typeof value;
          if (valueType === 'object') {
            throw new Error(`Field ${field} must be a primitive value, got object`);
          }
          
          // Validate numbers
          if (field === 'total_amount' && (typeof value !== 'number' || !isFinite(value) || isNaN(value))) {
            throw new Error(`Field ${field} must be a valid finite number`);
          }
          
          // Validate strings are not empty for critical fields
          if (['id', 'outlet_code', 'outlet_name', 'sale_name', 'area', 'items', 'created_at', 'spo_status'].includes(field)) {
            if (typeof value === 'string' && value.trim() === '') {
              throw new Error(`Field ${field} cannot be empty`);
            }
          }
        }

        // Final validation: ensure items is valid JSON
        try {
          const parsedItems = JSON.parse(productionOrderData.items);
          if (!Array.isArray(parsedItems)) {
            throw new Error('Items must be an array when parsed');
          }
        } catch (e) {
          throw new Error(`Invalid items JSON: ${e.message}`);
        }

        // Debug logging
        console.log('=== SAVING PRODUCTION ORDER ===');
        console.log('Construction points:', constructionPointsCount);
        console.log('Total amount:', totalAmount);
        console.log('Clean data length:', cleanProductionData.length);
        console.log('Final data keys:', Object.keys(productionOrderData));
        console.log('Items string length:', productionOrderData.items.length);

        // Save to database with graceful fallback when SDK is unavailable
        let result = { isOk: false };
        const canRemoteCreate = window.dataSdk && typeof window.dataSdk.create === 'function';
        if (canRemoteCreate) {
          result = await window.dataSdk.create(productionOrderData);
        } else {
          // Local fallback: insert into in-memory list with synthetic __backendId
          const localOrder = { ...productionOrderData, __backendId: productionOrderData.id };
          productionOrders.unshift(localOrder);
          renderProductionOrdersList(productionOrders);
          result.isOk = true;
        }
        
        if (result.isOk) {
          // determine created order number (remote may return a value)
          const createdOrder = (result && result.data) ? result.data : null;
          const finalOrderNumber = (createdOrder && createdOrder.spo_number) ? createdOrder.spo_number : productionOrderData.spo_number;

          // If remote create returned the created order, ensure it appears immediately in local list
          try {
          if (createdOrder) {
              const createdId = createdOrder.__backendId || createdOrder.id || createdOrder._id || createdOrder.id;
              const exists = productionOrders.some(o => String(o.__backendId || o.id || '') === String(createdId));
              if (!exists) {
                // Merge server response over the client-side productionOrderData so
                // any missing fields returned by the server are filled from the
                // locally constructed object (created_at, outlet_name, items, etc.).
                const base = Object.assign({}, productionOrderData || {});
                const merged = Object.assign({}, base, (createdOrder && typeof createdOrder === 'object') ? createdOrder : {});
                // Ensure __backendId is set to server id when available, otherwise keep local id
                merged.__backendId = createdOrder && (createdOrder.__backendId || createdOrder.id) ? (createdOrder.__backendId || createdOrder.id) : productionOrderData.id;
                // Guarantee items is a JSON string
                try { merged.items = typeof merged.items === 'string' ? merged.items : JSON.stringify(merged.items || []); } catch (e) { merged.items = productionOrderData.items; }
                // Ensure created_at exists
                if (!merged.created_at) merged.created_at = productionOrderData.created_at || new Date().toISOString();
                productionOrders.unshift(merged);
                renderProductionOrdersList(productionOrders);
              }
            }
          } catch (e) { /* ignore */ }

          // Mark all involved quotes as moved to production so they won't appear for selection again
          try {
            const canRemoteUpdate = window.dataSdk && typeof window.dataSdk.update === 'function';
            if (canRemoteUpdate) {
              // FIX: Use parallel updates instead of sequential for better performance
              // Group quotes by their order to batch updates efficiently
              const updatePromises = currentProductionData.map(quote => {
                // propagate order number and update QCAG status
                const updated = { ...quote, qcag_status: 'Đã ra đơn', order_number: finalOrderNumber };
                // ensure transient recreate flag removed
                if (updated.__recreateRequested) delete updated.__recreateRequested;
                // Best effort update; ignore individual failures
                return window.dataSdk.update(updated).catch(() => {});
              });
              // Wait for all updates in parallel (much faster than sequential)
              await Promise.all(updatePromises);
            } else {
              // Local fallback: update currentQuotes in-memory using stable key matcher
              const selKeys = new Set(currentProductionData.map(q => (typeof getQuoteKey === 'function' ? getQuoteKey(q) : (q.__backendId || q.id || q.spo_number || q.outlet_code))));
              currentQuotes = currentQuotes.map(q => {
                const key = (typeof getQuoteKey === 'function' ? getQuoteKey(q) : (q.__backendId || q.id || q.spo_number || q.outlet_code));
                if (selKeys.has(String(key))) {
                  const updated = { ...q, qcag_status: 'Đã ra đơn', order_number: finalOrderNumber };
                  if (updated.__recreateRequested) delete updated.__recreateRequested;
                  return updated;
                }
                return q;
              });
              // Refresh main list UI
              if (typeof updateMainList === 'function') updateMainList();
            }
          } catch (e) {
            console.warn('Warning: failed to update some quotes as produced', e);
          }

          showToast('✅ Đã lưu đơn hàng sản xuất thành công!');
          // Automatically load quotes into Xin Phép modal when production order is created
          try { 
            if (typeof window.renderXinphepList === 'function') {
              window.renderXinphepList(cleanProductionData || []); 
            }
          } catch(e) { 
            console.error('Failed to render xinphep list', e); 
          }
          closeProductionListModal();
          // Also refresh main list if not refreshed above
          if (typeof updateMainList === 'function') updateMainList();
          // If the production selection modal is open, refresh its visible list
          try {
            const productionModalEl = document.getElementById('production-order-modal');
            if (productionModalEl && !productionModalEl.classList.contains('hidden') && typeof renderProductionQuotes === 'function') {
              renderProductionQuotes(currentQuotes);
              if (typeof updateSelectedCount === 'function') updateSelectedCount();
              if (typeof updateSelectedSummary === 'function') updateSelectedSummary();
            }
          } catch (e) { console.warn('Failed to refresh production selection after save', e); }
          // Refresh QC Signage modal if it's open so new items appear immediately
          try { const qm = document.getElementById('qc-signage-modal'); if (qm && !qm.classList.contains('hidden') && typeof renderQcSignageModal === 'function') renderQcSignageModal(); } catch(e) {}

          // Refresh Acceptance modal if it's open so thumbnails & filters reflect the newly created order
          try {
            const accModal = document.getElementById('acceptance-image-modal');
            if (accModal && !accModal.classList.contains('hidden')) {
              try { if (typeof window.__renderAcceptanceProductionOrders === 'function') window.__renderAcceptanceProductionOrders(); } catch(e) {}
              // Reset acceptance-order selection so default grid shows all orders
              try { window.__filteredAcceptanceOrders = null; } catch(e) {}
              try { window.__acceptanceSelectedOrderId = null; } catch(e) {}
              try { renderAcceptanceImages(); } catch(e) {}
            }
          } catch (e) { console.warn('Failed to refresh acceptance modal after save', e); }

          // Clear current production data
          currentProductionData = [];
        } else {
          console.error('❌ Error saving production order:', result.error);
          const errorMsg = result.error?.message || result.error?.toString() || 'Lỗi không xác định';
          showToast(`❌ Lỗi khi lưu: ${errorMsg}`);
        }
      } catch (error) {
        console.error('❌ Exception saving production order:', error);
        showToast(`❌ Lỗi: ${error.message}`);
      } finally {
        // Restore button state
        saveBtn.disabled = false;
        saveBtn.innerHTML = originalText;
      }
    }

    // Renderer for Xin Phép Quảng Cáo list (generate rows from array of quote-like objects)
    window.renderXinphepList = function(quotesArray) {
      try {
        window.__lastXinphepList = Array.isArray(quotesArray) ? quotesArray : [];
        const tbody = document.getElementById('xinphep-list-tbody');
        if (!tbody) return;
        tbody.innerHTML = '';
        if (!Array.isArray(quotesArray) || quotesArray.length === 0) {
          tbody.innerHTML = '<tr><td colspan="7" class="p-4 text-center text-gray-500">Không có Outlet trong đơn hàng</td></tr>';
          return;
        }
        const esc = (s) => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"})[c]);
        let rowsAdded = 0;

        // active filters (window.__xinphepFilters) expected to be a Set of group keys: 'camau','cantho','angiang'
        const active = (window.__xinphepFilters && window.__xinphepFilters.size) ? Array.from(window.__xinphepFilters) : [];
        const camauCodes = new Set(['S5','S19']);
        const canthoCodes = new Set(['S4']);

        for (const q of quotesArray) {
          const areaRaw = (q.area || '').toString().trim();
          const area = areaRaw.toUpperCase();

          // If filters active, include only matching groups
          if (active.length > 0) {
            let include = false;
            for (const g of active) {
              if (g === 'camau' && camauCodes.has(area)) { include = true; break; }
              if (g === 'cantho' && canthoCodes.has(area)) { include = true; break; }
              if (g === 'angiang' && !camauCodes.has(area) && !canthoCodes.has(area)) { include = true; break; }
            }
            if (!include) continue;
          }

          let items = [];
          try { items = Array.isArray(q.items) ? q.items : JSON.parse(q.items || '[]'); } catch (_) { items = []; }
          // Prefer master quote data (latest) when available so edited fields reflect across modals
          let masterQ = null;
          try { masterQ = (typeof findQuoteByKey === 'function') ? findQuoteByKey(resolveQuoteKey(q) || q.quote_key || q.quote_code) : null; } catch (e) { masterQ = null; }
          const code = esc((masterQ && (masterQ.quote_code || masterQ.quoteCode)) || q.quote_code || q.quoteCode || '');
          const name = esc((masterQ && masterQ.outlet_name) || q.outlet_name || q.outletName || '');
          const areaDisp = esc((masterQ && masterQ.area) || q.area || '');
          const address = esc((masterQ && masterQ.address) || q.address || [q.house_number, q.street, q.ward, q.district, q.province].filter(Boolean).join(', '));
          // Group items by brand (only branded items considered) and collect sizes + positions
          const brandItems = new Map();
          for (const it of (Array.isArray(items) ? items : [])) {
            const b = (it && it.brand) ? String(it.brand).trim() : '';
            if (!b) continue; // only consider branded items
            const rawW = it && (it.width != null) ? String(it.width).trim().replace(/m$/i, '').trim() : '';
            const rawH = it && (it.height != null) ? String(it.height).trim().replace(/m$/i, '').trim() : '';
            const wNum = (rawW !== '') && !Number.isNaN(parseFloat(rawW)) ? parseFloat(rawW) : null;
            const hNum = (rawH !== '') && !Number.isNaN(parseFloat(rawH)) ? parseFloat(rawH) : null;
            let sizeStr = '';
            if (wNum != null && hNum != null) {
              sizeStr = `${rawW}m x ${rawH}m`;
            } else {
              sizeStr = (it && (it.content || it.code)) ? String(it.content || it.code).trim() : 'Không kích thước';
            }
            if (!brandItems.has(b)) brandItems.set(b, []);
            brandItems.get(b).push({ size: sizeStr, wNum, hNum });
          }
          if (brandItems.size > 0) {
            for (const [brand, entries] of brandItems.entries()) {
              const tr = document.createElement('tr');
              const sizesHtml = entries.map(e => esc(e.size)).join('<br>');
              const positionsHtml = entries.map(e => {
                if (e.wNum != null && e.hNum != null) {
                  if (e.wNum > e.hNum) return 'Mặt tiền quán';
                  if (e.wNum < e.hNum) return 'Áp sát trụ phi cách mép đường 15m';
                  return 'Không xác định';
                }
                return '-';
              }).join('<br>');
              tr.innerHTML = `\n                <td class="p-2 border-b">${code}</td>\n                <td class="p-2 border-b">${areaDisp}</td>\n                <td class="p-2 border-b">${esc(brand)}</td>\n                <td class="p-2 border-b">${name}</td>\n                <td class="p-2 border-b">${address}</td>\n                <td class="p-2 border-b">${sizesHtml}</td>\n                <td class="p-2 border-b">${positionsHtml}</td>\n              `;
              tbody.appendChild(tr);
              rowsAdded++;
            }
          }
        }
        if (rowsAdded === 0) {
          tbody.innerHTML = '<tr><td colspan="7" class="p-4 text-center text-gray-500">Không có Outlet có hạng mục brand</td></tr>';
        }
      } catch (e) { console.error('renderXinphepList error', e); }
    };

    // Edit Production Order Number
    window.editProductionOrderNumber = function(backendId) {
      const order = productionOrders.find(o => o.__backendId === backendId);
      if (!order) return;

      const currentValue = (order.spo_number && order.spo_number !== 'Chưa nhập số đơn hàng') ? order.spo_number : '';

      const modal = document.createElement('div');
      modal.className = 'fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center';
      modal.innerHTML = `
        <div class="bg-white rounded-lg p-6 w-96">
          <h3 class="text-lg font-semibold mb-4">Nhập Số Đơn Hàng</h3>
          <input type="text" id="production-order-number-input" value="${currentValue}" 
                 class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500" 
                 placeholder="Nhập số đơn hàng...">
          <div class="flex justify-end space-x-3 mt-4">
            <button id="cancel-order-number" class="px-4 py-2 bg-gray-300 hover:bg-gray-400 text-gray-800 rounded">Hủy</button>
            <button id="save-order-number" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded">Lưu</button>
          </div>
        </div>
      `;
      
      document.body.appendChild(modal);
      document.getElementById('production-order-number-input').focus();

      document.getElementById('cancel-order-number').addEventListener('click', () => modal.remove());
      
      document.getElementById('save-order-number').addEventListener('click', async () => {
        const orderNumber = document.getElementById('production-order-number-input').value.trim();
        const updatedOrder = { ...order, spo_number: orderNumber || 'Chưa nhập số đơn hàng' };
        let ok = false;
        if (window.dataSdk && typeof window.dataSdk.update === 'function') {
          const result = await window.dataSdk.update(updatedOrder);
          ok = !!result?.isOk;
        } else {
          const idx = productionOrders.findIndex(o => o.__backendId === backendId);
          if (idx >= 0) {
            productionOrders[idx] = { ...productionOrders[idx], spo_number: updatedOrder.spo_number };
            ok = true;
          }
        }
        renderProductionOrdersList(productionOrders);
        window.__renderAcceptanceProductionOrders && window.__renderAcceptanceProductionOrders();
        showToast(ok ? 'Đã cập nhật số đơn hàng' : 'Lỗi khi cập nhật số đơn hàng');
        
        modal.remove();
      });
    };

    // Edit Construction Unit
    window.editConstructionUnit = function(backendId) {
      const order = productionOrders.find(o => o.__backendId === backendId);
      if (!order) return;

      const currentValue = (order.address && order.address !== 'Chưa nhập đơn vị thi công') ? order.address : '';

      const modal = document.createElement('div');
      modal.className = 'fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center';
      modal.innerHTML = `
        <div class="bg-white rounded-lg p-6 w-96">
          <h3 class="text-lg font-semibold mb-4">Nhập Đơn Vị Thi Công</h3>
          <input type="text" id="construction-unit-input" value="${currentValue}" 
                 class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500" 
                 placeholder="Nhập đơn vị thi công...">
          <div class="flex justify-end space-x-3 mt-4">
            <button id="cancel-construction-unit" class="px-4 py-2 bg-gray-300 hover:bg-gray-400 text-gray-800 rounded">Hủy</button>
            <button id="save-construction-unit" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded">Lưu</button>
          </div>
        </div>
      `;
      
      document.body.appendChild(modal);
      document.getElementById('construction-unit-input').focus();

      document.getElementById('cancel-construction-unit').addEventListener('click', () => modal.remove());
      
      document.getElementById('save-construction-unit').addEventListener('click', async () => {
        const constructionUnit = document.getElementById('construction-unit-input').value.trim();
        const updatedOrder = { ...order, address: constructionUnit || 'Chưa nhập đơn vị thi công' };
        let ok = false;
        if (window.dataSdk && typeof window.dataSdk.update === 'function') {
          const result = await window.dataSdk.update(updatedOrder);
          ok = !!result?.isOk;
        } else {
          const idx = productionOrders.findIndex(o => o.__backendId === backendId);
          if (idx >= 0) {
            productionOrders[idx] = { ...productionOrders[idx], address: updatedOrder.address };
            ok = true;
          }
        }
        renderProductionOrdersList(productionOrders);
        window.__renderAcceptanceProductionOrders && window.__renderAcceptanceProductionOrders();
        showToast(ok ? 'Đã cập nhật đơn vị thi công' : 'Lỗi khi cập nhật đơn vị thi công');
        
        modal.remove();
      });
    };

    // Edit Construction Deadline (Hạn thi công)
    window.editConstructionDeadline = function(backendId) {
      const order = productionOrders.find(o => o.__backendId === backendId);
      if (!order) return;

      const currentValue = (order.due_date && order.due_date !== 'Chưa nhập hạn thi công') ? order.due_date : '';

      const modal = document.createElement('div');
      modal.className = 'fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center';
      modal.innerHTML = `
        <div class="bg-white rounded-lg p-6 w-96">
          <h3 class="text-lg font-semibold mb-4">Nhập Hạn Thi Công</h3>
          <input type="date" id="construction-deadline-input" value="${currentValue}" 
                 class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500">
          <div class="flex justify-end space-x-3 mt-4">
            <button id="cancel-construction-deadline" class="px-4 py-2 bg-gray-300 hover:bg-gray-400 text-gray-800 rounded">Hủy</button>
            <button id="save-construction-deadline" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded">Lưu</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
      document.getElementById('construction-deadline-input').focus();

      document.getElementById('cancel-construction-deadline').addEventListener('click', () => modal.remove());

      document.getElementById('save-construction-deadline').addEventListener('click', async () => {
        const due = document.getElementById('construction-deadline-input').value.trim();
        const updatedOrder = { ...order, due_date: due || 'Chưa nhập hạn thi công' };

        let ok = false;
        if (window.dataSdk && typeof window.dataSdk.update === 'function') {
          const result = await window.dataSdk.update(updatedOrder);
          ok = !!result?.isOk;
        } else {
          // Fallback: update in-memory and refresh list
          const idx = productionOrders.findIndex(o => o.__backendId === backendId);
          if (idx >= 0) {
            productionOrders[idx] = { ...productionOrders[idx], due_date: updatedOrder.due_date };
            ok = true;
          }
        }
        renderProductionOrdersList(productionOrders);
        window.__renderAcceptanceProductionOrders && window.__renderAcceptanceProductionOrders();
        showToast(ok ? 'Đã cập nhật hạn thi công' : 'Lỗi khi cập nhật hạn thi công');
        modal.remove();
      });
    };

    // Toggle Production Order Details
    window.toggleProductionOrderDetails = function(backendId) {
      const detailsRow = document.getElementById(`production-details-${backendId}`);
      if (detailsRow.classList.contains('hidden')) {
        // Hide all other details first
        document.querySelectorAll('[id^="production-details-"]').forEach(row => {
          row.classList.add('hidden');
        });
        // Show this one
        detailsRow.classList.remove('hidden');
      } else {
        detailsRow.classList.add('hidden');
      }
    };

    // Delete Production Order
    window.deleteProductionOrder = async function(backendId) {
      const order = productionOrders.find(o => o.__backendId === backendId);
      if (!order) return;

      const confirmDiv = document.createElement('div');
      confirmDiv.className = 'fixed bottom-4 right-4 bg-white rounded-lg shadow-xl p-4 border-2 border-red-500 z-50';
      confirmDiv.innerHTML = `
        <p class="text-gray-800 mb-3">Xác nhận xóa đơn hàng sản xuất này?</p>
        <div class="flex space-x-2">
          <button id="confirm-delete-order" class="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded" title="Xóa"> <svg xmlns=\"http://www.w3.org/2000/svg\" class=\"w-4 h-4 inline-block\" fill=\"none\" viewBox=\"0 0 24 24\" stroke=\"currentColor\"><path stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\" d=\"M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7h6\"/></svg></button>
          <button id="cancel-delete-order" class="bg-gray-300 hover:bg-gray-400 text-gray-800 px-4 py-2 rounded">Hủy</button>
        </div>
      `;
      document.body.appendChild(confirmDiv);

      document.getElementById('confirm-delete-order').addEventListener('click', async function() {
        this.disabled = true;
        this.innerHTML = '<div class="loading-spinner"></div>';
        
        let ok = false;
        if (window.dataSdk && typeof window.dataSdk.delete === 'function') {
          const result = await window.dataSdk.delete(order);
          ok = !!result?.isOk;
        } else {
          const idx = productionOrders.findIndex(o => o.__backendId === backendId);
          if (idx >= 0) {
            productionOrders.splice(idx, 1);
            ok = true;
          }
        }
        renderProductionOrdersList(productionOrders);
        showToast(ok ? 'Đã xóa đơn hàng sản xuất' : 'Lỗi khi xóa đơn hàng sản xuất');
        
        confirmDiv.remove();
      });

      document.getElementById('cancel-delete-order').addEventListener('click', function() {
        confirmDiv.remove();
      });
    };

    // Initialize SDKs
    async function initializeApp() {
      // Show a global loading overlay for initial boot until dataHandler receives data.
      try {
        if (!window.__qcInitialLoadToken && window.QcLoading && typeof window.QcLoading.show === 'function') {
          window.__qcInitialLoadToken = window.QcLoading.show('Đang tải dữ liệu...');
        }
      } catch (e) {}
      
      // Setup realtime listener for pending orders updates from other clients
      try {
        setupPendingOrdersRealtimeListener();
      } catch (e) {
        console.warn('Failed to setup pending orders realtime listener:', e);
      }
      
      // Load pending orders from backend (or fallback to localStorage)
      try {
        await loadPendingOrdersFromStorage();
      } catch (e) {
        console.warn('Failed to load pending orders from storage:', e);
      }
      
      const dataSdkResult = await window.dataSdk.init(dataHandler);
      if (!dataSdkResult.isOk) {
        console.error("Failed to initialize data SDK");
        // If init failed, stop the loading overlay to avoid blocking the UI forever.
        try {
          if (window.__qcInitialLoadToken && window.QcLoading && typeof window.QcLoading.hide === 'function') {
            window.QcLoading.hide(window.__qcInitialLoadToken);
            window.__qcInitialLoadToken = null;
          }
        } catch (e) {}
      }

      if (window.elementSdk) {
        window.elementSdk.init({
          defaultConfig,
          onConfigChange: async (config) => {
            const baseFont = config.font_family || defaultConfig.font_family;
            const baseFontStack = 'Segoe UI, Tahoma, Geneva, Verdana, sans-serif';
            const baseSize = config.font_size || defaultConfig.font_size;
            
            document.body.style.fontFamily = `${baseFont}, ${baseFontStack}`;
            document.getElementById('app-title').textContent = config.app_title || defaultConfig.app_title;
            document.getElementById('app-title').style.fontSize = `${baseSize * 1.875}px`;
            document.getElementById('app-title').style.color = config.text_color || defaultConfig.text_color;
            
            const createBtn = document.getElementById('create-quote-btn');
            createBtn.textContent = config.button_text || defaultConfig.button_text;
            createBtn.style.backgroundColor = config.primary_color || defaultConfig.primary_color;
            createBtn.style.fontSize = `${baseSize}px`;
            
            document.querySelectorAll('label').forEach(label => {
              label.style.fontSize = `${baseSize * 0.875}px`;
              label.style.color = config.text_color || defaultConfig.text_color;
            });
            
            document.querySelectorAll('input, select').forEach(input => {
              input.style.fontSize = `${baseSize}px`;
            });
          },
          mapToCapabilities: (config) => ({
            recolorables: [
              {
                get: () => config.primary_color || defaultConfig.primary_color,
                set: (value) => {
                  config.primary_color = value;
                  window.elementSdk.setConfig({ primary_color: value });
                }
              },
              {
                get: () => config.secondary_color || defaultConfig.secondary_color,
                set: (value) => {
                  config.secondary_color = value;
                  window.elementSdk.setConfig({ secondary_color: value });
                }
              },
              {
                get: () => config.text_color || defaultConfig.text_color,
                set: (value) => {
                  config.text_color = value;
                  window.elementSdk.setConfig({ text_color: value });
                }
              },
              {
                get: () => config.accent_color || defaultConfig.accent_color,
                set: (value) => {
                  config.accent_color = value;
                  window.elementSdk.setConfig({ accent_color: value });
                }
              },
              {
                get: () => config.surface_color || defaultConfig.surface_color,
                set: (value) => {
                  config.surface_color = value;
                  window.elementSdk.setConfig({ surface_color: value });
                }
              }
            ],
            borderables: [],
            fontEditable: {
              get: () => config.font_family || defaultConfig.font_family,
              set: (value) => {
                config.font_family = value;
                window.elementSdk.setConfig({ font_family: value });
              }
            },
            fontSizeable: {
              get: () => config.font_size || defaultConfig.font_size,
              set: (value) => {
                config.font_size = value;
                window.elementSdk.setConfig({ font_size: value });
              }
            }
          }),
          mapToEditPanelValues: (config) => new Map([
            ["app_title", config.app_title || defaultConfig.app_title],
            ["button_text", config.button_text || defaultConfig.button_text]
          ])
        });
      }
    }

    // Excel Upload Handler
    document.getElementById('excel-upload').addEventListener('change', function(e) {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = function(e) {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
          const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
          
          excelData = jsonData.slice(1).map(row => ({
            code: row[0] ? String(row[0]).trim() : '',
            content: row[1] ? String(row[1]).trim() : '',
            price: row[2] ? parseFloat(row[2]) : 0,
            unit: row[3] ? String(row[3]).trim() : ''
          })).filter(item => item.code && item.code !== '');
          excelLoadedFromFile = true;

          document.getElementById('excel-status').textContent = `Đã tải ${excelData.length} mục từ Excel`;
          document.getElementById('excel-status').classList.add('text-green-600');
          document.getElementById('load-data-btn').classList.remove('hidden');
        } catch (error) {
          document.getElementById('excel-status').textContent = 'Lỗi khi đọc file Excel';
          document.getElementById('excel-status').classList.add('text-red-600');
        }
      };
      reader.readAsArrayBuffer(file);
    });

    // Load Data Button
    document.getElementById('load-data-btn').addEventListener('click', function() {
      document.getElementById('create-quote-btn').disabled = false;
      document.getElementById('load-data-btn').classList.add('hidden');
      showToast('Dữ liệu đã được nạp thành công!');
    });

    function closeModal() {
      closeItemContentDropdown();
      document.getElementById('quote-modal').classList.add('hidden');
      ensureScrollLock();
    }

    function updateSaleTypeUI() {
      const toggle = document.getElementById('sale-type-toggle');
      const knob = document.getElementById('sale-type-knob');
      const display = document.getElementById('sale-type-display');
      const ssNameInput = document.getElementById('ss-name');
      const ssPill = document.getElementById('ss-pill');
      if (!toggle || !knob || !display || !ssNameInput) return;
      const current = window.saleType || 'Sale (SR)';
      if (current === 'TBA') {
        toggle.classList.remove('bg-gray-300');
        toggle.classList.add('bg-orange-400');
        knob.style.transform = 'translateX(24px)';
        display.textContent = 'TBA';
        display.className = 'text-xs font-semibold text-orange-600';
        ssNameInput.disabled = true;
        ssNameInput.value = '';
        if (ssPill) ssPill.classList.add('tba-mode');
      } else {
        toggle.classList.remove('bg-orange-400');
        toggle.classList.add('bg-blue-500');
        knob.style.transform = 'translateX(0px)';
        display.textContent = 'Sale (SR)';
        display.className = 'text-xs font-semibold text-blue-600';
        ssNameInput.disabled = false;
        if (ssPill) ssPill.classList.remove('tba-mode');
      }
    }


    // ==== BỔ SUNG: Khôi phục chức năng thêm hạng mục & ghép địa chỉ tự động ====
    let quoteModalHandlersInitialized = false;

    let activeItemContentWrapper = null;
    let dropdownViewportListenerBound = false;
    let dropdownScrollListenerBound = false;

    const handleDropdownViewportChange = () => {
      if (activeItemContentWrapper) {
        positionItemContentMenu(activeItemContentWrapper);
      }
    };

    function ensureDropdownEnvironment() {
      if (!dropdownViewportListenerBound) {
        window.addEventListener('resize', handleDropdownViewportChange);
        dropdownViewportListenerBound = true;
      }
      if (!dropdownScrollListenerBound) {
        const modalBody = document.querySelector('#quote-modal .modal-body');
        if (modalBody) {
          modalBody.addEventListener('scroll', () => {
            if (activeItemContentWrapper) {
              closeItemContentDropdown();
            }
          }, { passive: true });
          dropdownScrollListenerBound = true;
        }
      }
      const itemsScroll = document.querySelector('#quote-modal .items-scroll-container');
      if (itemsScroll && !itemsScroll.dataset.dropdownScrollBound) {
        itemsScroll.addEventListener('scroll', () => {
          if (activeItemContentWrapper) {
            closeItemContentDropdown();
          }
        }, { passive: true });
        itemsScroll.dataset.dropdownScrollBound = 'true';
      }
    }

    function positionItemContentMenu(wrapper) {
      if (!wrapper) return;
      const menu = wrapper.querySelector('.item-content-menu');
      const input = wrapper.querySelector('.item-content');
      if (!menu || !input || menu.classList.contains('hidden')) return;
      const rect = input.getBoundingClientRect();
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
      const gap = 6;
      const computed = window.getComputedStyle(menu);
      const maxHeight = parseFloat(computed.maxHeight) || 220;
      const menuHeight = Math.min(menu.scrollHeight || maxHeight, maxHeight);
      const spaceBelow = viewportHeight - rect.bottom - gap;
      let openUpwards = false;
      if (spaceBelow < menuHeight && rect.top > menuHeight) {
        openUpwards = true;
      }
      const maxLeft = viewportWidth - rect.width - 8;
      const left = Math.max(8, Math.min(rect.left, maxLeft));
      menu.style.width = `${rect.width}px`;
      menu.style.left = `${left}px`;
      if (openUpwards) {
        const top = Math.max(8, rect.top - gap);
        menu.style.top = `${top}px`;
        menu.style.transform = 'translateY(-100%)';
      } else {
        const top = Math.max(8, rect.bottom + gap);
        menu.style.top = `${top}px`;
        menu.style.transform = 'translateY(0)';
      }
      menu.classList.toggle('open-up', openUpwards);
    }

    function populateItemContentMenu(menu, searchTerm = '') {
      if (!menu) return;
      const normalized = searchTerm.trim().toLowerCase();
      const matches = itemContentOptionValues.filter(option =>
        !normalized || option.toLowerCase().includes(normalized)
      );
      menu.innerHTML = '';
      if (!matches.length) {
        const emptyState = document.createElement('div');
        emptyState.className = 'px-3 py-2 text-sm text-gray-400';
        emptyState.textContent = 'Không có gợi ý phù hợp';
        menu.appendChild(emptyState);
        return;
      }
      matches.forEach(option => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'item-content-option';
        btn.dataset.value = option;
        btn.textContent = option;
        menu.appendChild(btn);
      });
    }

    function closeItemContentDropdown(wrapper = null) {
      const target = wrapper || activeItemContentWrapper;
      if (!target) return;
      const menu = target.querySelector('.item-content-menu');
      const input = target.querySelector('.item-content');
      if (menu) {
        menu.classList.add('hidden');
        menu.classList.remove('open-up');
        menu.style.left = '';
        menu.style.top = '';
        menu.style.width = '';
        menu.style.transform = '';
      }
      target.classList.remove('open');
      if (input) input.dataset.dropdownOpen = 'false';
      if (!wrapper || target === wrapper) {
        activeItemContentWrapper = null;
      }
    }

    function openItemContentDropdown(wrapper, resetValue = false) {
      if (!wrapper) return;
      ensureDropdownEnvironment();
      const menu = wrapper.querySelector('.item-content-menu');
      const input = wrapper.querySelector('.item-content');
      if (!menu || !input) return;
      if (resetValue) {
        input.value = '';
        input.dataset.dropdownSelected = 'false';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      populateItemContentMenu(menu);
      menu.classList.remove('hidden');
      wrapper.classList.add('open');
      input.dataset.dropdownOpen = 'true';
      positionItemContentMenu(wrapper);
      input.focus();
      activeItemContentWrapper = wrapper;
    }

    function enhanceItemContentField(wrapper) {
      if (!wrapper || wrapper.dataset.dropdownReady === 'true') return;
      const input = wrapper.querySelector('.item-content');
      const toggle = wrapper.querySelector('.item-content-toggle');
      const menu = wrapper.querySelector('.item-content-menu');
      if (!input || !toggle || !menu) return;
      wrapper.dataset.dropdownReady = 'true';

      toggle.addEventListener('click', (event) => {
        event.preventDefault();
        const opening = menu.classList.contains('hidden');
        const shouldReset = input.dataset.dropdownSelected === 'true';
        if (opening) {
          closeItemContentDropdown();
          openItemContentDropdown(wrapper, shouldReset);
        } else {
          closeItemContentDropdown(wrapper);
        }
      });

      input.addEventListener('input', () => {
        const value = input.value.trim();
        input.dataset.dropdownSelected = 'false';
        if (input.dataset.dropdownOpen === 'true') {
          populateItemContentMenu(menu, value);
          positionItemContentMenu(wrapper);
        }
      });

      input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && input.dataset.dropdownOpen === 'true') {
          event.preventDefault();
          closeItemContentDropdown(wrapper);
        }
      });

      menu.addEventListener('click', (event) => {
        const optionBtn = event.target.closest('.item-content-option');
        if (!optionBtn) return;
        const value = optionBtn.dataset.value || '';
        input.value = value;
        input.dataset.dropdownSelected = 'true';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        closeItemContentDropdown(wrapper);
      });
    }

    document.addEventListener('click', (event) => {
      if (!activeItemContentWrapper) return;
      if (!activeItemContentWrapper.contains(event.target)) {
        closeItemContentDropdown();
      }
    });

    function buildFullAddress() {
      const house = document.getElementById('house-number')?.value.trim() || '';
      const street = document.getElementById('street-name')?.value.trim() || '';
      const hamlet = document.getElementById('ward-hamlet')?.value.trim() || '';
      const commune = document.getElementById('commune-ward')?.value.trim() || '';
      const province = document.getElementById('province-city')?.value.trim() || '';

      let first = '';
      if (house && street) first = `${house} ${street}`; else first = house || street;
      const parts = [first, hamlet, commune, province].filter(p => p && p.length);
      const full = parts.join(', ');
      const fullEl = document.getElementById('full-address');
      if (fullEl) fullEl.textContent = full;
    }

    function attachAddressAutoBuild() {
      ['house-number','street-name','ward-hamlet','commune-ward','province-city'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', buildFullAddress);
      });
    }

    function addItemRow() {
      const container = document.getElementById('items-container');
      if (!container) return;
      itemCounter++;
      const itemDiv = document.createElement('div');
      itemDiv.className = 'border border-gray-300 rounded-lg p-3 bg-white shadow-sm';
      itemDiv.dataset.itemId = itemCounter;
      itemDiv.innerHTML = `
        <div class="flex items-center gap-2 flex-wrap md:flex-nowrap">
          <div class="item-number w-8 text-center font-semibold">${itemCounter}</div>
          <input type="text" class="item-code w-24 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" placeholder="Code">
          <div class="item-content-wrapper">
            <input type="text" class="item-content w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-gray-500" placeholder="Nội dung" autocomplete="off">
            <button type="button" class="item-content-toggle" title="Chọn nội dung có sẵn" aria-label="Chọn nội dung có sẵn">
              <svg xmlns="http://www.w3.org/2000/svg" class="icon-caret" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 9l6 6 6-6" />
              </svg>
              <svg xmlns="http://www.w3.org/2000/svg" class="icon-minus" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 12h12" />
              </svg>
            </button>
            <div class="item-content-menu hidden"></div>
          </div>
          <select class="item-brand w-32 px-2 py-1 border border-gray-300 rounded text-sm bg-gray-100" disabled>
            ${defaultBrandSelectOptions}
          </select>
          <input type="number" step="any" class="item-width w-24 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" placeholder="Ngang">
          <input type="number" step="any" class="item-height w-24 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" placeholder="Cao">
          <input type="number" step="any" class="item-quantity w-24 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" placeholder="SL" required>
          <input type="text" class="item-unit w-24 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" placeholder="ĐVT">
          <input type="text" step="any" class="item-price w-28 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" placeholder="Đơn giá">
          <input type="text" class="item-total w-32 px-2 py-1 border border-gray-300 rounded text-sm bg-gray-100" placeholder="Thành tiền" readonly>
          <button type="button" class="remove-item-btn shrink-0 bg-red-500 hover:bg-red-600 text-white py-1 px-3 rounded text-sm" title="Xóa"><svg xmlns=\"http://www.w3.org/2000/svg\" class=\"w-4 h-4 inline-block\" fill=\"none\" viewBox=\"0 0 24 24\" stroke=\"currentColor\"><path stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\" d=\"M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7h6\"/></svg></button>
        </div>
      `;
      container.appendChild(itemDiv);
      setupItemListeners(itemDiv);
      // Update visible item numbers after adding
      updateItemNumbers();
      // Scroll the items container so the newly added row is visible (prioritize newest rows)
      setTimeout(() => {
        const scrollWrap = document.querySelector('.items-scroll-container');
        if (scrollWrap) {
          try {
            scrollWrap.scrollTo({ top: scrollWrap.scrollHeight, behavior: 'smooth' });
          } catch (e) {
            scrollWrap.scrollTop = scrollWrap.scrollHeight;
          }
        }
        try { itemDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) {}
      }, 60);
      // Recompute locked height based on 4 rows
      computeAndLockItemsContainerHeight();
    }

    function updateItemNumbers() {
      const container = document.getElementById('items-container');
      if (!container) return;
      const rows = Array.from(container.querySelectorAll('[data-item-id]'));
      rows.forEach((row, idx) => {
        const numEl = row.querySelector('.item-number');
        if (numEl) numEl.textContent = String(idx + 1);
        row.dataset.itemId = idx + 1;
      });
      // keep global counter sensible
      itemCounter = Math.max(rows.length, itemCounter);
      // Update items count display in modal header
      try {
        const countEl = document.getElementById('items-count');
        if (countEl) countEl.textContent = String(rows.length);
      } catch (e) {}
    }

    function computeAndLockItemsContainerHeight() {
      try {
        const scrollWrap = document.querySelector('.items-scroll-container');
        if (!scrollWrap) return;
        const header = scrollWrap.querySelector('.items-header');
        const firstRow = scrollWrap.querySelector('[data-item-id]');
        const cs = window.getComputedStyle(scrollWrap);
        const paddingTop = parseFloat(cs.paddingTop || '0') || 0;
        const paddingBottom = parseFloat(cs.paddingBottom || '0') || 0;
        const headerH = header ? header.offsetHeight : 36;
        const rowH = firstRow ? firstRow.offsetHeight : 56; // fallback
        // Desired: header + 4 rows + paddings
        const desired = Math.round(headerH + (rowH * 4) + paddingTop + paddingBottom);
        scrollWrap.style.maxHeight = desired + 'px';
        scrollWrap.style.height = desired + 'px';
        // Ensure the add button sits right after the container without jumping
        const addBtnWrap = document.querySelector('#add-item-btn')?.parentElement;
        if (addBtnWrap) addBtnWrap.style.marginTop = '0.75rem';
      } catch (e) {
        // silent
      }
    }

    function resetQuoteForm() {
      try {
        document.getElementById('quote-form').reset();
      } catch (e) { /* ignore */ }
      currentEditingQuoteKey = null;
      maquetteUploadQuoteCode = null; // Clear maquette upload code
      // Pre-generate quote code for new quotes so maquette images use correct folder name
      try {
        newQuoteCodePreGenerated = generateQuoteCode();
      } catch (e) {
        newQuoteCodePreGenerated = null;
      }
      setQuoteModalMode('create');
      ['sale-code','sale-name','sale-phone','ss-name','outlet-code','outlet-name','spo-name','house-number','street-name','ward-hamlet','commune-ward','province-city'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      window.saleType = 'Sale (SR)';
      updateSaleTypeUI();
      const itemsContainer = document.getElementById('items-container');
      if (itemsContainer) itemsContainer.innerHTML = '';
      itemCounter = 0;
      addItemRow();
      updateTotal();
      buildFullAddress();
      updateRecentQuotesPreview();
      try { computeAndLockItemsContainerHeight(); } catch (e) {}
      // Reset images
      window.currentQuoteImages = [];
      const grid = document.getElementById('quote-images-grid');
      const empty = document.getElementById('quote-images-empty');
      const clearBtn = document.getElementById('clear-images-btn');
      const dropzone = document.getElementById('quote-image-stage');
      const mainImageWrap = document.getElementById('quote-image-main');
      const mainImage = document.getElementById('quote-main-image');
      if (grid) { grid.innerHTML = ''; grid.classList.add('hidden'); }
      if (empty) empty.classList.remove('hidden');
      if (clearBtn) clearBtn.classList.add('hidden');
      if (dropzone) dropzone.classList.remove('filled');
      if (mainImageWrap) mainImageWrap.classList.add('hidden');
      if (mainImage) {
        mainImage.removeAttribute('src');
        mainImage.removeAttribute('alt');
        mainImage.removeAttribute('data-src');
        mainImage.removeAttribute('data-name');
      }
    }

    function setupQuoteModalHandlersOnce() {
      if (quoteModalHandlersInitialized) return;
      const addBtn = document.getElementById('add-item-btn');
      if (addBtn) {
        addBtn.addEventListener('click', () => addItemRow());
      }
      const cancelBtn = document.getElementById('cancel-btn');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
          currentEditingQuoteKey = null;
          setQuoteModalMode('create');
          closeModal();
        });
      }
      const previewBtn = document.getElementById('preview-quote-btn');
      if (previewBtn) {
        previewBtn.addEventListener('click', openQuotePreviewModal);
      }
      const closePreviewBtn = document.getElementById('close-preview-modal');
      if (closePreviewBtn && !closePreviewBtn._bound) {
        closePreviewBtn._bound = true;
        closePreviewBtn.addEventListener('click', closeQuotePreviewModal);
      }
      const previewBackdrop = document.getElementById('quote-preview-modal');
      if (previewBackdrop && !previewBackdrop._bound) {
        previewBackdrop._bound = true;
        previewBackdrop.addEventListener('click', (event) => {
          if (event.target === previewBackdrop) {
            closeQuotePreviewModal();
          }
        });
      }
      // Sale type toggle switch
      const saleToggle = document.getElementById('sale-type-toggle');
      if (saleToggle) {
        window.saleType = 'Sale (SR)';
        saleToggle.addEventListener('click', () => {
          window.saleType = window.saleType === 'TBA' ? 'Sale (SR)' : 'TBA';
          updateSaleTypeUI();
        });
        updateSaleTypeUI();
      }

      // Sale code / sale name suggestion dropdown
      (function setupSaleSuggestions() {
        const saleCodeInput = document.getElementById('sale-code');
        const saleNameInput = document.getElementById('sale-name');
        const salePhoneInput = document.getElementById('sale-phone');
        const ssNameInput = document.getElementById('ss-name');
        if (!saleCodeInput || !saleNameInput) return;

        const normalizeText = (value) => {
          const raw = String(value || '').trim().toLowerCase();
          try {
            // remove Vietnamese diacritics for easier matching
            return raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          } catch (e) {
            return raw;
          }
        };

        const buildSaleDirectory = () => {
          const mapByCode = new Map();
          const mapByName = new Map();
          (currentQuotes || []).forEach((q) => {
            if (!q) return;
            const code = String(q.sale_code || q.saleCode || '').trim();
            const name = String(q.sale_name || q.saleName || '').trim();
            const phone = String(q.sale_phone || q.salePhone || '').trim();
            if (!code && !name) return;
            const ts = (() => {
              const t = new Date(q.updated_at || q.created_at || 0).getTime();
              return Number.isFinite(t) ? t : 0;
            })();
            const entry = { code, name, phone, _ts: ts };

            if (code) {
              const prev = mapByCode.get(code);
              if (!prev || ts >= prev._ts) {
                mapByCode.set(code, entry);
              }
            }
            if (name) {
              const key = normalizeText(name);
              const prev = mapByName.get(key);
              if (!prev || ts >= prev._ts) {
                mapByName.set(key, entry);
              }
            }
          });
          const byCode = Array.from(mapByCode.values()).sort((a, b) => String(a.code || '').localeCompare(String(b.code || ''), 'vi'));
          const byName = Array.from(mapByName.values()).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'vi'));
          return { byCode, byName };
        };

        const buildSsDirectory = () => {
          const mapByName = new Map();
          (currentQuotes || []).forEach((q) => {
            if (!q) return;
            const name = String(q.ss_name || q.ssName || '').trim();
            if (!name) return;
            const ts = (() => {
              const t = new Date(q.updated_at || q.created_at || 0).getTime();
              return Number.isFinite(t) ? t : 0;
            })();
            const key = normalizeText(name);
            const prev = mapByName.get(key);
            if (!prev || ts >= prev._ts) {
              mapByName.set(key, { name, _ts: ts });
            }
          });
          return Array.from(mapByName.values()).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'vi'));
        };

        const ensureDropdown = () => {
          let el = document.getElementById('sale-suggest-dropdown');
          if (el) return el;
          el = document.createElement('div');
          el.id = 'sale-suggest-dropdown';
          el.className = 'hidden bg-white border border-gray-200 rounded-lg overflow-auto';
          el.style.position = 'fixed';
          el.style.zIndex = '99999';
          el.style.maxHeight = '240px';
          el.style.minWidth = '200px';
          document.body.appendChild(el);
          // prevent blur from immediately closing before click
          el.addEventListener('mousedown', (e) => {
            e.preventDefault();
          });
          return el;
        };

        const hideDropdown = () => {
          const dd = document.getElementById('sale-suggest-dropdown');
          if (!dd) return;
          dd.classList.add('hidden');
          dd.innerHTML = '';
          dd.dataset.for = '';
        };

        const renderDropdown = (inputEl, mode, matches) => {
          const dd = ensureDropdown();
          dd.dataset.for = mode;
          if (!matches.length) {
            hideDropdown();
            return;
          }
          const rect = inputEl.getBoundingClientRect();
          dd.style.left = Math.round(rect.left) + 'px';
          dd.style.top = Math.round(rect.bottom + 6) + 'px';
          dd.style.width = Math.round(rect.width) + 'px';

          dd.innerHTML = matches.map((m, idx) => {
            const code = String(m.code || '').trim();
            const name = String(m.name || '').trim();
            const ssName = String(m.name || '').trim();

            const line1 = mode === 'code'
              ? `<div class=\"font-semibold text-gray-800\">${code || '-'}</div>`
              : mode === 'name'
                ? `<div class=\"font-semibold text-gray-800\">${name || '-'}</div>`
                : `<div class=\"font-semibold text-gray-800\">${ssName || '-'}</div>`;

            const line2 = mode === 'code'
              ? `<div class=\"text-xs text-gray-500\">${name || ''}</div>`
              : mode === 'name'
                ? `<div class=\"text-xs text-gray-500\">${code ? `Mã: ${code}` : ''}</div>`
                : `<div class=\"text-xs text-gray-500\">SS</div>`;
            return `
              <button type="button" data-idx="${idx}" class="w-full text-left px-3 py-2 hover:bg-gray-50">
                ${line1}
                ${line2}
              </button>
            `;
          }).join('');

          dd.querySelectorAll('button[data-idx]').forEach((btn) => {
            btn.addEventListener('click', () => {
              const i = parseInt(btn.dataset.idx || '0', 10);
              const picked = matches[i];
              if (!picked) return;
              if (mode === 'ss') {
                if (ssNameInput && picked.name) ssNameInput.value = picked.name;
              } else {
                if (picked.code) saleCodeInput.value = picked.code;
                if (picked.name) saleNameInput.value = picked.name;
                if (salePhoneInput && picked.phone) salePhoneInput.value = picked.phone;
              }
              hideDropdown();
            });
          });
          dd.classList.remove('hidden');
        };

        const getMatches = (mode, query) => {
          const q = normalizeText(query);
          if (!q) return [];
          if (mode === 'ss') {
            const list = buildSsDirectory();
            return list
              .filter((m) => normalizeText(m && m.name).includes(q))
              .slice(0, 10);
          }
          const dir = buildSaleDirectory();
          const list = mode === 'code' ? dir.byCode : dir.byName;
          const field = mode === 'code' ? 'code' : 'name';
          return list
            .filter((m) => normalizeText(m && m[field]).includes(q))
            .slice(0, 10);
        };

        const showForInput = (mode, inputEl) => {
          const matches = getMatches(mode, inputEl.value);
          renderDropdown(inputEl, mode, matches);
        };

        const onDocMouseDown = (e) => {
          const dd = document.getElementById('sale-suggest-dropdown');
          if (!dd || dd.classList.contains('hidden')) return;
          if (e.target === dd || dd.contains(e.target)) return;
          if (e.target === saleCodeInput || e.target === saleNameInput || e.target === ssNameInput) return;
          hideDropdown();
        };

        if (!document._saleSuggestBound) {
          document._saleSuggestBound = true;
          document.addEventListener('mousedown', onDocMouseDown);
          // Don't close dropdown when user scrolls INSIDE the dropdown itself
          window.addEventListener('scroll', (ev) => {
            const dd = document.getElementById('sale-suggest-dropdown');
            if (!dd || dd.classList.contains('hidden')) return;
            const t = ev && ev.target ? ev.target : null;
            if (t && (t === dd || dd.contains(t))) return;
            hideDropdown();
          }, true);
          window.addEventListener('resize', () => hideDropdown());
        }

        const bindInput = (mode, inputEl) => {
          if (inputEl._saleSuggestBound) return;
          inputEl._saleSuggestBound = true;
          inputEl.addEventListener('input', () => showForInput(mode, inputEl));
          inputEl.addEventListener('focus', () => showForInput(mode, inputEl));
          inputEl.addEventListener('blur', () => setTimeout(() => hideDropdown(), 120));
          inputEl.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape') {
              hideDropdown();
            }
          });
        };

        bindInput('code', saleCodeInput);
        bindInput('name', saleNameInput);
        if (ssNameInput) bindInput('ss', ssNameInput);
      })();

      // Image upload handlers
      const imgInput = document.getElementById('quote-images-input');
      const addImgBtn = document.getElementById('add-image-btn');
      const grid = document.getElementById('quote-images-grid');
      const empty = document.getElementById('quote-images-empty');
      const clearBtn = document.getElementById('clear-images-btn');
      const dropzone = document.getElementById('quote-image-stage');
      const mainImageWrap = document.getElementById('quote-image-main');
      const mainImage = document.getElementById('quote-main-image');
      let primaryImageIndex = 0;
      window.currentQuoteImages = window.currentQuoteImages || [];
      // Tracks whether images were added/updated during this edit/create session
      window.quoteImagesUpdatedDuringEdit = window.quoteImagesUpdatedDuringEdit || false;

      const setPrimaryImage = (idx = 0) => {
        if (!mainImageWrap || !mainImage) return;
        const image = window.currentQuoteImages[idx];
        if (!image) return;
        primaryImageIndex = idx;
        mainImageWrap.classList.remove('hidden');
        mainImage.src = image.data;
        mainImage.alt = image.name || `Hình ${idx + 1}`;
        mainImage.dataset.src = image.data;
        mainImage.dataset.name = image.name || '';
        if (dropzone) dropzone.classList.add('filled');
      };

      // Helper: process file list for quote images. If replace=true, replace all existing images.
      function processQuoteImageFiles(fileList, replace = false) {
        const files = Array.from(fileList || []);
        if (!files.length) return;
        // Maquette only allows 1 image - always replace
        const MAX_FILES = 1;
        const useFiles = files.slice(0, MAX_FILES);
        
        // Get old image URL to delete from bucket if exists
        const oldImageUrl = (window.currentQuoteImages && window.currentQuoteImages.length > 0) 
          ? window.currentQuoteImages[0].data 
          : null;
        
        // Always replace for maquette (only 1 image allowed)
        window.currentQuoteImages = [];
        
        // For new quotes: use pre-generated quote code for proper folder naming
        // For editing existing quotes: use currentEditingQuoteKey
        // IMPORTANT: Store the quote code used for upload to ensure consistency when saving
        let quoteKey = currentEditingQuoteKey || newQuoteCodePreGenerated || `temp_${Date.now()}`;
        
        // Save the quote code for later use when submitting the form
        if (!currentEditingQuoteKey) {
          maquetteUploadQuoteCode = quoteKey;
        }
        
        useFiles.forEach(file => {
          if (!file.type.startsWith('image/')) return;
          const reader = new FileReader();
          reader.onload = (ev) => {
            const dataUrl = ev && ev.target ? ev.target.result : null;
            const entry = { name: 'maquette', data: dataUrl };
            window.currentQuoteImages.push(entry);
            // mark that images were updated this session
            window.quoteImagesUpdatedDuringEdit = true;
            refreshImageUI();

            // Delete old image from bucket before uploading new one
            if (oldImageUrl && oldImageUrl.startsWith('http') && typeof qcagDeleteImage === 'function') {
              qcagDeleteImage(oldImageUrl).catch(() => {});
            }

            // Upload to maquette/ folder in Cloud Storage with quoteKey for proper organization
            try {
              window.maquetteUploadInProgress = true;
              qcagUploadImageDataUrl(String(dataUrl || ''), entry.name, {
                folder: 'maquette',
                quoteKey: String(quoteKey)
              }).then((url) => {
                if (url) {
                  entry.data = url;
                  refreshImageUI();
                }
                window.maquetteUploadInProgress = false;
              }).catch(() => {
                window.maquetteUploadInProgress = false;
              });
            } catch (e) {
              window.maquetteUploadInProgress = false;
            }
          };
          reader.readAsDataURL(file);
        });
      }

      if (dropzone) {
        dropzone.addEventListener('click', () => {
          if (window.currentQuoteImages.length === 0) {
            if (addImgBtn) addImgBtn.click();
          } else if (mainImage && mainImage.dataset.src) {
            openImageViewer(mainImage.dataset.src, mainImage.dataset.name || 'Hình ảnh');
          }
        });
        dropzone.addEventListener('dragover', (e) => {
          e.preventDefault();
          dropzone.classList.add('dragover');
        });
        dropzone.addEventListener('dragleave', (e) => {
          dropzone.classList.remove('dragover');
        });
        dropzone.addEventListener('drop', (e) => {
          e.preventDefault();
          dropzone.classList.remove('dragover');
          const files = e.dataTransfer ? e.dataTransfer.files : null;
          if (!files) return;
          // Replace existing images with newly dropped ones
          processQuoteImageFiles(files, true);
        });
      }

      if (mainImageWrap) {
        mainImageWrap.addEventListener('click', (e) => {
          e.stopPropagation();
          const current = window.currentQuoteImages[primaryImageIndex];
          if (current) {
            openImageViewer(current.data, current.name || `Hình ${primaryImageIndex + 1}`);
          }
        });
      }

      function refreshImageUI() {
        if (!grid || !empty) return;
        if (window.currentQuoteImages.length === 0) {
          grid.classList.add('hidden');
          empty.classList.remove('hidden');
          if (clearBtn) clearBtn.classList.add('hidden');
          if (dropzone) dropzone.classList.remove('filled');
          if (mainImageWrap) mainImageWrap.classList.add('hidden');
          if (mainImage) {
            mainImage.removeAttribute('src');
            mainImage.removeAttribute('alt');
            delete mainImage.dataset.src;
            delete mainImage.dataset.name;
          }
          primaryImageIndex = 0;
          return;
        }
        empty.classList.add('hidden');
        if (clearBtn) clearBtn.classList.remove('hidden');
        if (primaryImageIndex >= window.currentQuoteImages.length) {
          primaryImageIndex = 0;
        }
        setPrimaryImage(primaryImageIndex);
        grid.innerHTML = window.currentQuoteImages.map((img, idx) => `
          <div class="quote-image-item ${idx === primaryImageIndex ? 'active' : ''}" data-idx="${idx}">
            <img src="${img.data}" alt="${img.name}" data-src="${img.data}" data-name="${img.name}">
            <button type="button" class="remove-image-btn" data-idx="${idx}" title="Xóa hình">×</button>
          </div>
        `).join('');
        grid.classList.remove('hidden');
        grid.querySelectorAll('.remove-image-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const i = parseInt(btn.dataset.idx, 10);
            if (Number.isNaN(i)) return;
            window.currentQuoteImages.splice(i,1);
            if (primaryImageIndex >= window.currentQuoteImages.length) {
              primaryImageIndex = 0;
            }
            // Update productionOrders (target the specific order if provided)
            const found = findQuoteInProductionOrders(acceptanceDetailState.quoteKey);
            if (found) {
              const { order, orderIndex, quoteIndex } = found;
              let quotes = [];
              try { quotes = JSON.parse(order.items || '[]'); } catch (e) { quotes = []; }
              if (Array.isArray(quotes) && quotes[quoteIndex]) {
                quotes[quoteIndex].images = JSON.stringify(window.currentQuoteImages);
                const updatedOrder = {...order, items: JSON.stringify(quotes) };
                productionOrders[orderIndex] = updatedOrder;
                // persist if available
                if (window.dataSdk && typeof window.dataSdk.update === 'function') {
                  try { window.dataSdk.update(updatedOrder); } catch (e) { console.warn('Không thể lưu xóa ảnh vào order:', e); }
                }
                window.__renderAcceptanceProductionOrders && window.__renderAcceptanceProductionOrders();
              }
            }
            refreshImageUI();
          });
        });
        grid.querySelectorAll('.quote-image-item').forEach(item => {
          item.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(item.dataset.idx || '0', 10);
            if (Number.isNaN(idx)) return;
            primaryImageIndex = idx;
            refreshImageUI();
          });
        });
      }
      if (addImgBtn && imgInput) {
        addImgBtn.addEventListener('click', () => imgInput.click());
        imgInput.addEventListener('change', (e) => {
          const files = e.target.files || [];
          // When user chooses new images, replace existing ones
          processQuoteImageFiles(files, true);
          e.target.value = '';
        });
      }
      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          window.currentQuoteImages = [];
          refreshImageUI();
        });
      }
      // Expose for edit-mode preload
      window.refreshQuoteImagesUI = refreshImageUI;
      refreshImageUI();
      attachAddressAutoBuild();

      // Duplicate outlet warning (quotes within last 1 year)
      const ensureOutletDuplicateWarningModal = () => {
        let modal = document.getElementById('outlet-duplicate-warning');
        if (modal) return modal;
        modal = document.createElement('div');
        modal.id = 'outlet-duplicate-warning';
        modal.className = 'hidden';
        modal.style.position = 'fixed';
        modal.style.inset = '0';
        modal.style.zIndex = '100000';
        modal.innerHTML = `
          <div class="w-full h-full flex items-center justify-center px-4" style="background: rgba(0,0,0,0.35)">
            <div class="bg-white rounded-xl shadow-xl border border-gray-200 w-full max-w-md">
              <div class="px-5 pt-5">
                <div class="text-base font-semibold text-gray-800">Outlet này đã có báo giá trong 1 năm</div>
                <div class="mt-2 text-sm text-gray-600">Nếu đây là báo giá hạng mục mới hãy bấm Ok để tạo tiếp tục.</div>
                <div id="outlet-duplicate-warning-meta" class="mt-3 text-xs text-gray-500"></div>
              </div>
              <div class="px-5 pb-5 pt-4 flex items-center justify-end gap-2">
                <button type="button" id="outlet-dup-old" class="px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50">Báo giá cũ</button>
                <button type="button" id="outlet-dup-ok" class="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700">Ok</button>
              </div>
            </div>
          </div>
        `;
        document.body.appendChild(modal);
        // Add close X button
        try { ensureModalHasCloseX(modal); } catch (e) {}
        // Click outside closes
        modal.addEventListener('click', (e) => {
          if (e.target === modal) {
            modal.classList.add('hidden');
            ensureScrollLock();
          }
        });
        return modal;
      };

      const findRecentQuoteForOutlet = (outletCode) => {
        const code = String(outletCode || '').trim();
        if (!code) return null;
        const cutoff = Date.now() - (365 * 24 * 60 * 60 * 1000);
        const norm = code.toLowerCase();
        const valid = (q) => {
          if (!q) return false;
          if (q.area === 'PRODUCTION') return false;
          if (q.sale_name === 'Đơn hàng sản xuất') return false;
          const oc = String(q.outlet_code || '').trim().toLowerCase();
          if (!oc || oc !== norm) return false;
          const ts = new Date(q.created_at || q.updated_at || 0).getTime();
          if (!Number.isFinite(ts) || ts <= 0) return false;
          return ts >= cutoff;
        };
        const matches = (currentQuotes || []).filter(valid);
        if (!matches.length) return null;
        matches.sort((a, b) => new Date(b.created_at || b.updated_at || 0) - new Date(a.created_at || a.updated_at || 0));
        return matches[0] || null;
      };

      const showOutletDuplicateWarning = (outletCode, foundQuote) => {
        const modal = ensureOutletDuplicateWarningModal();
        if (!modal) return;
        const meta = modal.querySelector('#outlet-duplicate-warning-meta');
        try {
          const code = foundQuote ? (formatQuoteCode(foundQuote) || foundQuote.spo_number || foundQuote.id || '') : '';
          const when = foundQuote && (foundQuote.created_at || foundQuote.updated_at)
            ? new Date(foundQuote.created_at || foundQuote.updated_at).toLocaleDateString('vi-VN')
            : '';
          const sale = foundQuote ? (foundQuote.sale_name || '') : '';
          if (meta) {
            meta.textContent = [code ? `Mã: ${code}` : '', when ? `Ngày: ${when}` : '', sale ? `Sale: ${sale}` : '']
              .filter(Boolean)
              .join(' • ');
          }
        } catch (e) {
          if (meta) meta.textContent = '';
        }

        const state = window._qcOutletDupWarnState = window._qcOutletDupWarnState || { lastShown: '', timer: null };
        state.lastShown = String(outletCode || '').trim().toLowerCase();

        const oldBtn = modal.querySelector('#outlet-dup-old');
        const okBtn = modal.querySelector('#outlet-dup-ok');
        if (oldBtn && !oldBtn._bound) {
          oldBtn._bound = true;
          oldBtn.addEventListener('click', () => {
            modal.classList.add('hidden');
            ensureScrollLock();
            if (!foundQuote) return;
            // suppress warning during programmatic populate
            window._suppressOutletDuplicateWarn = true;
            try {
              setupQuoteModalHandlersOnce();
              populateQuoteForm(foundQuote);
              document.getElementById('quote-modal')?.classList.remove('hidden');
              ensureScrollLock();
              const focusEl = document.getElementById('outlet-name');
              if (focusEl) setTimeout(() => focusEl.focus(), 50);
            } catch (e) {}
            setTimeout(() => { window._suppressOutletDuplicateWarn = false; }, 600);
          });
        }
        if (okBtn && !okBtn._bound) {
          okBtn._bound = true;
          okBtn.addEventListener('click', () => {
            modal.classList.add('hidden');
            ensureScrollLock();
          });
        }

        modal.classList.remove('hidden');
        ensureScrollLock();
      };

      const outletCodeInput = document.getElementById('outlet-code');
      if (outletCodeInput) outletCodeInput.addEventListener('input', () => {
        updateRecentQuotesPreview();
        // Only warn when creating a NEW quote
        if (window._suppressOutletDuplicateWarn) return;
        if (currentEditingQuoteKey) return;
        const code = outletCodeInput.value ? outletCodeInput.value.trim() : '';
        const state = window._qcOutletDupWarnState = window._qcOutletDupWarnState || { lastShown: '', timer: null };
        if (!code) {
          state.lastShown = '';
          if (state.timer) { clearTimeout(state.timer); state.timer = null; }
          const m = document.getElementById('outlet-duplicate-warning');
          if (m) m.classList.add('hidden');
          return;
        }
        const norm = code.toLowerCase();
        if (state.timer) clearTimeout(state.timer);
        state.timer = setTimeout(() => {
          state.timer = null;
          if (window._suppressOutletDuplicateWarn) return;
          if (currentEditingQuoteKey) return;
          if (norm === (state.lastShown || '')) return;
          const found = findRecentQuoteForOutlet(code);
          if (!found) return;
          showOutletDuplicateWarning(code, found);
        }, 250);
      });
      updateRecentQuotesPreview();
      quoteModalHandlersInitialized = true;
    }
    // ==== HẾT PHẦN BỔ SUNG ====

    function setupItemListeners(itemDiv) {
      const codeInput = itemDiv.querySelector('.item-code');
      const contentInput = itemDiv.querySelector('.item-content');
      const contentWrapper = itemDiv.querySelector('.item-content-wrapper');
      const priceInput = itemDiv.querySelector('.item-price');
      const unitInput = itemDiv.querySelector('.item-unit');
      const brandSelect = itemDiv.querySelector('.item-brand');
      const widthInput = itemDiv.querySelector('.item-width');
      const heightInput = itemDiv.querySelector('.item-height');
      const quantityInput = itemDiv.querySelector('.item-quantity');
      const totalInput = itemDiv.querySelector('.item-total');
      const removeBtn = itemDiv.querySelector('.remove-item-btn');

      enhanceItemContentField(contentWrapper);

      const brandableCodes = ['1.1', '1.2', '1.3', '1.4', '2.1', '2.2', '9.2', '9.3', 'LG1', 'LG2'];

      const formatUnitDisplay = (unitValue = '') => {
        if (!unitValue) return '';
        return unitValue.toLowerCase() === 'm2' ? 'm²' : unitValue;
      };

      function handleCatalogSelection(label, preferredBrand = null) {
        if (!label) return false;
        const entries = getCatalogEntriesByName(label);
        if (!entries.length) return false;
        const isHiflex1Mat = normalizeContentLabel(label) === 'bảng hiệu hiflex 1 mặt';
        let brandToUse = null;
        if (!isHiflex1Mat) {
          brandToUse = applyBrandOptionsToSelect(brandSelect, entries, preferredBrand || brandSelect?.value || null);
        } else {
          // For 'Bảng hiệu hiflex 1 mặt', show placeholder, do not auto-select any brand
          applyBrandOptionsToSelect(brandSelect, entries, '');
        }
        const entry = pickCatalogEntry(entries, brandToUse || brandSelect?.value || null);
        if (!entry) return false;
        // Special-case for Logo items: Logo Indoor / Logo Outdoor
        const normalizedEntryName = normalizeContentLabel(entry.name || '');
        const isLogoEntry = normalizedEntryName.startsWith('logo');
        const isBrandableEntry = brandableCodes.includes(entry.code);
        const normalizedEntryBrand = normalizeBrandLabel(entry.brand || '').toLowerCase();
        if (normalizedEntryBrand === 'shopname') {
          resetBrandSelectElement(brandSelect, { lockedValue: 'Shopname' });
        } else if (isBrandableEntry) {
          const previousValue = brandSelect.value;
          resetBrandSelectElement(brandSelect, { keepEnabled: true });
          if (previousValue && !isHiflex1Mat) {
            brandSelect.value = previousValue;
          }
          // For 'Bảng hiệu hiflex 1 mặt', do not auto-select any brand (leave placeholder)
        } else {
          resetBrandSelectElement(brandSelect);
        }
        // Only auto-select brand if not 'Bảng hiệu hiflex 1 mặt'
        if (isBrandableEntry && normalizedEntryBrand !== 'shopname' && !isHiflex1Mat) {
          const resolvedBrandLabel = normalizeBrandLabel(brandToUse || entry.brand || '').trim();
          if (resolvedBrandLabel) {
            brandSelect.value = resolvedBrandLabel;
          }
        }
        contentInput.value = entry.name;
        // For Logo items do NOT auto-fill the Code
        if (!isLogoEntry) {
          codeInput.value = entry.code || '';
        } else {
          try { itemDiv.dataset.logoItem = '1'; } catch (e) {}
          codeInput.value = '';
        }
        unitInput.value = formatUnitDisplay(entry.unit || '');
        priceInput.value = entry.price || '';
        itemDiv.dataset.catalogNameKey = normalizeContentLabel(entry.name);
        if (isLogoEntry) {
          try {
            const forbidden = ['bivina', 'bivina export'];
            if (brandSelect) {
              Array.from(brandSelect.options || []).forEach(opt => {
                const v = normalizeBrandLabel(opt.value || '')?.toLowerCase() || '';
                if (forbidden.includes(v)) opt.disabled = true;
              });
              if (forbidden.includes(normalizeBrandLabel(brandSelect.value || '').toLowerCase())) {
                brandSelect.value = '';
              }
            }
            if (quantityInput) quantityInput.value = 1;
          } catch (e) {}
        } else {
          try { delete itemDiv.dataset.logoItem; } catch (e) {}
        }
        calculateItemTotal();
        return true;
      }

      resetBrandSelectElement(brandSelect);

      if (brandSelect) {
        brandSelect.addEventListener('change', () => {
          const isLogo = itemDiv && itemDiv.dataset && itemDiv.dataset.logoItem === '1';
          const selectedBrandNorm = normalizeBrandLabel(brandSelect.value || '').toLowerCase();
          const forbidden = ['bivina', 'bivina export'];
          if (isLogo && forbidden.includes(selectedBrandNorm)) {
            try { brandSelect.value = ''; } catch (e) {}
            return;
          }
          const key = itemDiv.dataset.catalogNameKey;
          if (!key) return;
          const entries = getCatalogEntriesByNameKey(key);
          if (!entries.length) return;
          const entry = pickCatalogEntry(entries, brandSelect.value);
          if (!entry) return;
          if (!isLogo) {
            codeInput.value = entry.code || '';
          } else {
            try { codeInput.value = ''; } catch (e) {}
          }
          unitInput.value = entry.unit || '';
          priceInput.value = entry.price || '';
          calculateItemTotal();
        });
      }

      contentInput.addEventListener('change', () => {
        const value = contentInput.value.trim();
        if (!value) {
          delete itemDiv.dataset.catalogNameKey;
          resetBrandSelectElement(brandSelect, { keepEnabled: true });
          return;
        }
        // Preserve existing brand choice: do not auto-fill Brand when selecting content
        const prevBrand = brandSelect ? brandSelect.value : '';
        const filled = handleCatalogSelection(value, brandSelect?.value || null);
        if (!filled) {
          delete itemDiv.dataset.catalogNameKey;
          resetBrandSelectElement(brandSelect, { keepEnabled: true });
        } else {
          try {
            if (brandSelect) {
              if (prevBrand) brandSelect.value = prevBrand;
              else resetBrandSelectElement(brandSelect, { keepEnabled: true });
            }
          } catch (e) { /* ignore */ }
        }
      });

      codeInput.addEventListener('input', function() {
        const code = this.value.trim();
        if (!code) {
          contentInput.value = '';
          priceInput.value = '';
          unitInput.value = '';
          delete itemDiv.dataset.catalogNameKey;
          resetBrandSelectElement(brandSelect, { keepEnabled: true });
          this.style.borderColor = '#d1d5db';
          this.style.backgroundColor = '#ffffff';
          calculateItemTotal();
          return;
        }

        const excelItem = excelData.find(item => String(item.code).trim() === code);
        let filledByCatalog = false;

        if (!excelLoadedFromFile) {
          const byCodeEntries = getCatalogEntriesByCode(code);
          if (byCodeEntries.length) {
            const preferredBrand = (code === '1.3' || code === '1.4') ? 'Shopname' : brandSelect?.value || null;
            filledByCatalog = handleCatalogSelection(byCodeEntries[0].name, preferredBrand);
          }
        }

        if (!filledByCatalog && excelItem) {
          contentInput.value = excelItem.content;
          priceInput.value = excelItem.price;
          unitInput.value = formatUnitDisplay(excelItem.unit);
          delete itemDiv.dataset.catalogNameKey;
          if (brandableCodes.includes(code)) {
            if (code === '1.3' || code === '1.4') {
              resetBrandSelectElement(brandSelect, { lockedValue: 'Shopname' });
            } else {
              resetBrandSelectElement(brandSelect, { keepEnabled: true });
            }
          } else {
            resetBrandSelectElement(brandSelect);
          }
        }

        if (!filledByCatalog && !excelItem) {
          contentInput.value = '';
          priceInput.value = '';
          unitInput.value = '';
          delete itemDiv.dataset.catalogNameKey;
          resetBrandSelectElement(brandSelect, { keepEnabled: true });
        }

        const hasMatch = filledByCatalog || !!excelItem;
        this.style.borderColor = hasMatch ? '#10b981' : '#d1d5db';
        this.style.backgroundColor = hasMatch ? '#f0fdf4' : '#ffffff';
        calculateItemTotal();
      });

      // Auto-calculate quantity from width x height
      // helper: round and trim trailing zeros
      function formatDecimal(value, decimals) {
        decimals = typeof decimals === 'number' ? decimals : 2;
        if (!Number.isFinite(value)) return '0';
        var pow = Math.pow(10, decimals);
        var fixed = (Math.round(value * pow) / pow).toFixed(decimals);
        return fixed.replace(/\.0+$|(?<=\.[0-9]*?)0+$/,'').replace(/\.$/, '');
      }
      // Format a number as a VND currency string with no decimals (integer VND)
      function formatCurrencyExact(value) {
        var num = Number(value) || 0;
        var rounded = Math.round(num + Number.EPSILON);
        return new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(rounded) + ' đ';
      }
      function countInputDecimals(str) {
        if (str == null) return 0;
        var s = String(str);
        var idx = s.indexOf('.');
        if (idx === -1) return 0;
        return s.length - idx - 1;
      }
      function updateQuantity() {
        const width = parseFloat(widthInput.value) || 0;
        const height = parseFloat(heightInput.value) || 0;
        // If this row is a Logo item and brand is not Larue, do not auto-calculate quantity
        const isLogo = itemDiv && itemDiv.dataset && itemDiv.dataset.logoItem === '1';
        const brandName = normalizeBrandLabel(brandSelect ? brandSelect.value : '') || '';
        if (isLogo && String(brandName).toLowerCase() !== 'larue') {
          return;
        }
        if (width > 0 && height > 0) {
          var wDec = countInputDecimals(widthInput.value);
          var hDec = countInputDecimals(heightInput.value);
          var decimals = Math.min(wDec + hDec, 6);
          quantityInput.value = formatDecimal(width * height, decimals);
          calculateItemTotal();
          
          // auto-add feature removed per request
        }
      }

      // checkAndAddCode917 removed — auto-add behaviour disabled

      widthInput.addEventListener('input', updateQuantity);
      heightInput.addEventListener('input', updateQuantity);
      quantityInput.addEventListener('input', calculateItemTotal);
      priceInput.addEventListener('input', () => { formatNumericInput(priceInput); calculateItemTotal(); });

      function calculateItemTotal() {
        const quantity = parseFloat(quantityInput.value) || 0;
        const price = parseNumber(priceInput.value) || 0;
        const total = quantity * price;
        totalInput.value = formatCurrencyExact(total);
        updateTotal();
      }

      removeBtn.addEventListener('click', function() {
        if (activeItemContentWrapper && itemDiv.contains(activeItemContentWrapper)) {
          closeItemContentDropdown();
        }
        itemDiv.remove();
        updateTotal();
        updateItemNumbers();
      });
    }

    // addAutoCode removed — auto-add behaviour disabled

    function updateTotal() {
      const container = document.getElementById('items-container');
      const items = container.querySelectorAll('[data-item-id]');
      let total = 0;

      items.forEach(item => {
        var quantity = parseFloat(item.querySelector('.item-quantity').value) || 0;
        var price = parseNumber(item.querySelector('.item-price').value) || 0;
        // round each line total to nearest integer VND to avoid fractional đồng
        var line = Math.round(quantity * price + Number.EPSILON);
        total += line;
      });

      // final rounding to integer VND
      total = Math.round(total + Number.EPSILON);
      document.getElementById('total-amount').textContent = formatCurrencyExact(total);
    }

    function formatRecentQuoteRow(quote) {
      if (!quote) {
        return `<div class="flex items-center justify-between gap-3 rounded-xl border border-dashed border-gray-200 px-3 py-2 text-sm text-gray-400 italic">
          Chưa có báo giá của outlet này
        </div>`;
      }
      const date = quote.created_at ? new Date(quote.created_at).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '---';
      const amount = formatCurrency(Number(quote.total_amount) || 0);
      const code = quote.spo_number || quote.id || '---';
      const sale = quote.sale_name || '---';
      return `
        <div class="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2">
          <div class="flex flex-col">
            <span class="text-sm font-semibold text-gray-800">${code}</span>
            <span class="text-xs text-gray-500">${sale}</span>
          </div>
          <div class="text-right">
            <div class="text-sm font-semibold text-blue-600">${amount}</div>
            <div class="text-xs text-gray-500">${date}</div>
          </div>
        </div>`;
    }

    function updateRecentQuotesPreview() {
      const target = document.getElementById('recent-quotes');
      const outletCode = document.getElementById('outlet-code')?.value.trim();
      if (!target) return;
      if (!outletCode) {
        target.innerHTML = '<div class="text-sm text-gray-400 italic">Nhập Outlet Code để xem lịch sử báo giá.</div>';
        return;
      }

      const filtered = currentQuotes
        .filter(q => (q.outlet_code || '').trim().toLowerCase() === outletCode.toLowerCase())
        .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
        .slice(0, 3);

      const rows = [0,1,2].map(idx => formatRecentQuoteRow(filtered[idx] || null));
      target.innerHTML = rows.join('');
    }

    function formatCurrency(amount) {
      return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
    }
    function parseNumber(value) {
      if (value == null) return 0;
      const num = parseFloat(String(value).replace(/[^\d.-]/g, ''));
      return Number.isFinite(num) ? num : 0;
    }

    // Robust money parser: handles thousand separators ('.' or ',') and decimal separators
    function parseMoney(value) {
      if (value == null) return 0;
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      let s = String(value || '').trim();
      if (!s) return 0;
      s = s.replace(/[^0-9.,\-]/g, '');
      if (!s) return 0;
      const commaCount = (s.match(/,/g) || []).length;
      const dotCount = (s.match(/\./g) || []).length;
      if (dotCount > 0 && commaCount > 0) {
        const tmp = s.replace(/\./g, '').replace(/,/g, '.');
        const n = parseFloat(tmp);
        return Number.isFinite(n) ? n : 0;
      }
      if (commaCount > 0 && dotCount === 0) {
        // Heuristic: if single comma and the group after comma has exactly 3 digits,
        // treat comma as thousands separator (e.g., 852,000 -> 852000). Otherwise
        // treat comma as decimal separator (e.g., 852,5 -> 852.5).
        if (commaCount > 1) return parseFloat(s.replace(/,/g, '')) || 0;
        const parts = s.split(',');
        const last = parts[parts.length - 1] || '';
        if (last.length === 3) {
          return parseFloat(s.replace(/,/g, '')) || 0;
        }
        return parseFloat(s.replace(/,/g, '.')) || 0;
      }
      if (dotCount > 0 && commaCount === 0) {
        if (dotCount > 1) return parseFloat(s.replace(/\./g, '')) || 0;
        return parseFloat(s) || 0;
      }
      return parseFloat(s.replace(/[^0-9\-]/g, '')) || 0;
    }

    function formatNumericInput(el) {
      if (!el) return;
      const raw = String(el.value || '');
      const caret = typeof el.selectionStart === 'number' ? el.selectionStart : raw.length;
      const digitsBefore = (raw.slice(0, caret).match(/\d/g) || []).length;
      const normalized = raw.replace(/[^\d.]/g, '');
      const parts = normalized.split('.');
      const intPart = parts.shift() || '';
      const decPart = parts.join('');
      const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      const formatted = decPart ? (intFormatted + '.' + decPart) : intFormatted;
      el.value = formatted;
      let pos = 0, digitsSeen = 0;
      for (; pos < formatted.length; pos++) {
        if (/\d/.test(formatted[pos])) digitsSeen++;
        if (digitsSeen >= digitsBefore) { pos++; break; }
      }
      if (pos > formatted.length) pos = formatted.length;
      try { el.setSelectionRange(pos, pos); } catch (e) {}
    }

    function collectPreviewItems() {
      const container = document.getElementById('items-container');
      if (!container) return [];
      const rows = Array.from(container.querySelectorAll('[data-item-id]'));
      return rows.map((row, idx) => {
        const pick = (selector) => {
          const el = row.querySelector(selector);
          return el ? el.value : '';
        };
        return {
          idx: idx + 1,
          code: pick('.item-code'),
          content: pick('.item-content'),
          brand: pick('.item-brand'),
          width: pick('.item-width'),
          height: pick('.item-height'),
          quantity: pick('.item-quantity'),
          unit: pick('.item-unit'),
          price: pick('.item-price')
        };
      }).filter(item => item.code || item.content || item.quantity || item.price);
    }

    function buildQuotePreviewData() {
      const isEditing = !!currentEditingQuoteKey;
      const existingQuote = isEditing ? findQuoteByKey(currentEditingQuoteKey) : null;
      const items = collectPreviewItems();
      const images = Array.isArray(window.currentQuoteImages) ? window.currentQuoteImages : [];
      const totalAmount = items.reduce((sum, item) => {
        const qty = parseNumber(item.quantity);
        const price = parseNumber(item.price);
        return sum + Math.round(qty * price + Number.EPSILON);
      }, 0);
      const previewQuoteCode = existingQuote
        ? formatQuoteCode(existingQuote)
        : 'Sẽ cấp sau khi lưu';

      return {
        quoteCode: previewQuoteCode,
        outletCode: document.getElementById('outlet-code')?.value || '',
        outletName: document.getElementById('outlet-name')?.value || '',
        area: document.getElementById('area')?.value || '',
        outletPhone: document.getElementById('outlet-phone')?.value.trim() || '',
        saleName: document.getElementById('sale-name')?.value || '',
        saleCode: document.getElementById('sale-code')?.value || '',
        salePhone: document.getElementById('sale-phone')?.value || '',
        saleType: window.saleType || 'Sale (SR)',
        ssName: document.getElementById('ss-name')?.value || '',
        address: document.getElementById('full-address')?.textContent || '',
        spoName: document.getElementById('spo-name')?.value || '',
        totalAmount,
        items,
        primaryImage: images[0] || null,
        brandFooter: 'Quảng cáo An Giang báo giá',
        brandApproval: 'Heineken Việt Nam duyệt',
        createdAt: existingQuote?.created_at || null,
        updatedAt: existingQuote?.updated_at || null
      };
    }

    function buildQuotePreviewHtml(data, options = {}) {
      const includeQcagSign = options && typeof options === 'object' ? (options.includeQcagSign !== false) : true;
      const formatDateTime = (isoString) => {
        try {
          const date = new Date(isoString);
          if (Number.isNaN(date.getTime())) return '---';
          return date.toLocaleString('vi-VN', {
            hour12: false,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
          });
        } catch (_) {
          return '---';
        }
      };

      const hasQuoteCode = data.quoteCode && !['Sẽ cấp sau khi lưu', '---'].includes(data.quoteCode);
      const quoteCodeLine = hasQuoteCode
        ? `Mã báo giá: ${data.quoteCode}`
        : '<em>Mã Báo Giá: Chưa có Mã</em>';

      const createdLabel = data.createdAt ? formatDateTime(data.createdAt) : 'Chưa lưu';
      const updatedIsDifferent = (() => {
        if (!data.updatedAt) return false;
        if (!data.createdAt) return true;
        const created = new Date(data.createdAt);
        const updated = new Date(data.updatedAt);
        if (Number.isNaN(created.getTime()) || Number.isNaN(updated.getTime())) return false;
        return Math.abs(updated.getTime() - created.getTime()) > 2000;
      })();
      const updatedLabel = data.updatedAt && updatedIsDifferent
        ? formatDateTime(data.updatedAt)
        : 'Chưa có cập nhật mới';

      const imageSection = data.primaryImage
        ? `<img src="${data.primaryImage.data}" alt="${data.primaryImage.name || 'Hình báo giá'}">`
        : `<div class="quote-preview-image-placeholder">Non Image</div>`;

      const itemRows = data.items.length ? data.items.map(item => {
        const lineTotal = formatCurrency(Math.round(parseNumber(item.quantity) * parseNumber(item.price) + Number.EPSILON));
        return `
          <div class="quote-preview-row">
            <span class="col code">${item.code || ''}</span>
            <span class="col content">${item.content || ''}</span>
            <span class="col brand">${item.brand || ''}</span>
            <span class="col width">${item.width || '-'}</span>
            <span class="col height">${item.height || '-'}</span>
            <span class="col qty">${item.quantity || '-'}</span>
            <span class="col unit">${item.unit || '-'}</span>
            <span class="col price">${formatCurrency(parseNumber(item.price))}</span>
            <span class="col total">${lineTotal}</span>
          </div>
        `;
      }).join('') : `<div class="quote-preview-row empty">Chưa có hạng mục nào</div>`;

      const infoBlank = '<div class="quote-preview-card quote-preview-blank"></div>';

      const html = `
        <div class="quote-preview-page">
          <div class="quote-preview-left">
            <div class="quote-preview-header">
              <div class="quote-preview-title-block">
                <div class="quote-preview-hvn-logo-wrap">
                  <img src="assets/hvn-logo.svg" class="quote-preview-hvn-logo" alt="HVN logo" />
                </div>
                <div class="quote-preview-title">Báo giá bảng hiệu</div>
                <div class="quote-preview-meta-row">
                  <span>Mã Outlet: ${data.outletCode || '---'}</span>
                  <span>Outlet: ${data.outletName || '---'}</span>
                  <span>Khu vực: ${data.area || '---'}</span>
                </div>
                <div class="quote-preview-meta-row address-row">
                  <span>Địa chỉ: ${data.address || 'Chưa có địa chỉ'} • SĐT: ${data.outletPhone || '---'}</span>
                  ${data.spoName ? `<span class="spo-name"><strong>Tên Outlet trên SPO: ${data.spoName}</strong></span>` : ''}
                </div>
              </div>
              <div class="quote-preview-code-block">
                <div class="quote-preview-code">${quoteCodeLine}</div>
                <div class="quote-preview-dates">
                  <div class="quote-preview-date-row">Ngày tạo: ${createdLabel}</div>
                  <div class="quote-preview-date-row">Cập nhật gần nhất: ${updatedLabel}</div>
                </div>
              </div>
            </div>
            <div class="quote-preview-image-frame">${imageSection}</div>
            <div class="quote-preview-items">
              <div class="quote-preview-items-title">Chi tiết báo giá</div>
              <div class="quote-preview-head">
                <span class="col code">Code</span>
                <span class="col content">Nội dung</span>
                <span class="col brand">Brand</span>
                <span class="col width">Ngang</span>
                <span class="col height">Cao</span>
                <span class="col qty">SL</span>
                <span class="col unit">ĐVT</span>
                <span class="col price">Đơn giá</span>
                <span class="col total">Thành tiền</span>
              </div>
              <div class="quote-preview-line-items">
                ${itemRows}
                <div class="quote-preview-total">Tổng cộng: ${formatCurrency(data.totalAmount)}</div>
              </div>
            </div>
          </div>
          <div class="quote-preview-right">
            <div class="quote-preview-card logo">
              <img class="quote-preview-logo-img" src="assets/qcag-logo.svg" alt="QCAG" />
            </div>
            <div class="quote-preview-card">
              <div class="quote-preview-card-title">Thông tin Sale</div>
              <div class="quote-preview-card-row"><span>Loại</span><span>${data.saleType || '---'}</span></div>
              <div class="quote-preview-card-row"><span>Mã</span><span>${data.saleCode || '---'}</span></div>
              <div class="quote-preview-card-row"><span>Tên</span><span>${data.saleName || '---'}</span></div>
              <div class="quote-preview-card-row"><span>SĐT</span><span>${data.salePhone || '---'}</span></div>
              <div class="quote-preview-card-row"><span>Tên SS</span><span>${data.ssName || '---'}</span></div>
            </div>
            <div class="quote-preview-sign">
              <span class="quote-preview-tag">${data.brandFooter}</span>
              <div class="quote-preview-sign-box">
                ${includeQcagSign ? '<img class="qcag-sign-img" src="assets/qcag-1.0.png" alt="QCAG" />' : ''}
              </div>
            </div>
            <div class="quote-preview-sign">
              <span class="quote-preview-tag">${data.brandApproval}</span>
              <div class="quote-preview-sign-box"></div>
            </div>
          </div>
        </div>
      `;
  return html;
}

function renderQuotePreviewPage(data) {
  const container = document.getElementById('quote-preview-content');
  // Requirement: Preview must NOT show QCAG signature image
  if (container) container.innerHTML = buildQuotePreviewHtml(data, { includeQcagSign: false });
    }

    function buildQuotePreviewDataFromQuote(quote) {
      if (!quote) return null;
      const parseItems = () => {
        try {
          const arr = JSON.parse(quote.items || '[]');
          return Array.isArray(arr) ? arr : [];
        } catch (_) {
          return [];
        }
      };
      const parsedItems = parseItems();
      const images = (() => {
        try {
          const arr = JSON.parse(quote.images || '[]');
          if (!Array.isArray(arr)) return [];
          // Normalize image objects: ensure `.data` contains the usable URL/data (fallback to url/src)
          return arr.map(img => {
            try {
              if (!img || typeof img !== 'object') return img;
              const normalized = { ...img };
              if (!normalized.data) normalized.data = normalized.url || normalized.src || '';
              return normalized;
            } catch (e) { return img; }
          });
        } catch (_) {
          return [];
        }
      })();
      const totalAmount = quote.total_amount || parsedItems.reduce((sum, item) => {
        const qty = parseNumber(item.quantity);
        const price = parseNumber(item.price);
        return sum + Math.round(qty * price + Number.EPSILON);
      }, 0);

      return {
        quoteCode: formatQuoteCode(quote) || '---',
        outletCode: quote.outlet_code || '',
        outletName: quote.outlet_name || '',
        area: quote.area || '',
        outletPhone: quote.outlet_phone || '',
        saleName: quote.sale_name || '',
        saleCode: quote.sale_code || '',
        salePhone: quote.sale_phone || '',
        saleType: quote.sale_type || 'Sale (SR)',
        ssName: quote.ss_name || '',
        address: quote.address || '',
        spoName: quote.spo_name || quote.spoName || '',
        totalAmount,
        items: parsedItems,
        primaryImage: images[0] || null,
        brandFooter: 'Quảng cáo An Giang báo giá',
        brandApproval: 'Heineken Việt Nam duyệt',
        createdAt: quote.created_at || null,
        updatedAt: quote.updated_at || null
      };
    }

    function openQuotePreviewForQuote(quote) {
      const data = buildQuotePreviewDataFromQuote(quote);
      if (!data) {
        showToast('Không tìm thấy dữ liệu báo giá để xem trước');
        return;
      }
      renderQuotePreviewPage(data);
      const modal = document.getElementById('quote-preview-modal');
      if (modal) {
        modal.classList.remove('hidden');
        try { modal.style.zIndex = '99999'; } catch (e) {}
        ensureScrollLock();
      }
    }

    // ==== QUOTE IMAGES GALLERY ====
    function collectQuoteImagesForGallery() {
      const entries = [];
      const parseImages = (imagesField) => {
        try {
          const arr = JSON.parse(imagesField || '[]');
          if (!Array.isArray(arr)) return [];
          return arr.map(img => {
            try {
              if (!img || typeof img !== 'object') return null;
              const normalized = { ...img };
              if (!normalized.data) normalized.data = normalized.url || normalized.src || '';
              return normalized;
            } catch (e) { return null; }
          }).filter(Boolean).filter(img => img.data);
        } catch (_) {
          return [];
        }
      };
      (currentQuotes || []).forEach((quote) => {
        const imgs = parseImages(quote.images);
        const code = formatQuoteCode(quote) || '---';
        const createdAt = quote.created_at || quote.updated_at || null;
        const quoteKey = getQuoteKey(quote);
        const baseId = quoteKey || code || 'Q';

        if (!imgs.length) {
          entries.push({
            id: `${baseId}::noimg`,
            hasImage: false,
            src: '',
            name: 'Non Image',
            quoteCode: code,
            outletName: quote.outlet_name || '',
            outletCode: quote.outlet_code || '',
            saleName: quote.sale_name || '',
            ssName: quote.ss_name || '',
            area: quote.area || '',
            spoNumber: quote.spo_number || '',
            isPrimary: true,
            createdAt,
            quoteKey
          });
          return;
        }

        imgs.forEach((img, idx) => {
          const srcVal = img.data || img.url || img.src || '';
          entries.push({
            id: `${baseId}::${idx}`,
            hasImage: !!srcVal,
            src: srcVal,
            name: img.name || `Hình ${idx + 1}`,
            quoteCode: code,
            outletName: quote.outlet_name || '',
            outletCode: quote.outlet_code || '',
            saleName: quote.sale_name || '',
            ssName: quote.ss_name || '',
            area: quote.area || '',
            spoNumber: quote.spo_number || '',
            isPrimary: idx === 0,
            createdAt,
            quoteKey
          });
        });
      });
      return entries.sort((a, b) => {
        const ad = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bd = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bd - ad;
      });
    }

    function renderQuoteImagesGallery(term = '') {
      const grid = document.getElementById('quote-gallery-grid');
      const empty = document.getElementById('quote-gallery-empty');
      const counter = document.getElementById('quote-images-count');
      if (!grid || !empty) return;
      const entries = collectQuoteImagesForGallery();
      const search = term.trim().toLowerCase();
      let filtered = search
        ? entries.filter((e) => {
            const haystack = [
              e.quoteCode,
              e.outletName,
              e.saleName,
              e.ssName,
              e.area,
              e.spoNumber,
              e.outletCode
            ].join(' | ').toLowerCase();
            return haystack.includes(search);
          })
        : entries;

      // Filter by date range
      const fromDateEl = document.getElementById('quote-images-from-date');
      const toDateEl = document.getElementById('quote-images-to-date');
      const fromDate = fromDateEl && fromDateEl.value ? new Date(fromDateEl.value) : null;
      const toDate = toDateEl && toDateEl.value ? new Date(toDateEl.value + 'T23:59:59') : null; // End of day
      if (fromDate || toDate) {
        filtered = filtered.filter((e) => {
          const dateStr = quoteGalleryDateMode === 'updated' ? (e.updatedAt || e.createdAt) : e.createdAt;
          if (!dateStr) return false;
          const entryDate = new Date(dateStr);
          if (fromDate && entryDate < fromDate) return false;
          if (toDate && entryDate > toDate) return false;
          return true;
        });
      }

      // Filter by selected area (single-select). 'all' means no filter
      if (quoteGallerySelectedArea && quoteGallerySelectedArea !== 'all') {
        filtered = filtered.filter(e => (e.area || '') === quoteGallerySelectedArea);
      }

      // Pagination: compute pages and slice entries for current page
      const total = filtered.length;
      const pageSize = Number(quoteGalleryPageSize) || 24;
      const pageCount = Math.max(1, Math.ceil(total / pageSize));
      if (quoteGalleryPage > pageCount) quoteGalleryPage = pageCount;
      if (quoteGalleryPage < 1) quoteGalleryPage = 1;
      const startIndex = (quoteGalleryPage - 1) * pageSize;
      const pageItems = filtered.slice(startIndex, startIndex + pageSize);

      if (!filtered.length) {
        grid.classList.add('hidden');
        empty.classList.remove('hidden');
        if (counter) counter.textContent = '0 hình';
        grid.innerHTML = '';
        updateQuoteGallerySelectionUI();
        return;
      }

      // Populate area filters (ensure area buttons reflect available areas)
      try {
        renderAreaFilters();
      } catch (e) { /* ignore area render errors */ }

      empty.classList.add('hidden');
      grid.classList.remove('hidden');
      if (counter) counter.textContent = `${total} hình`;
      // Update page info and prev/next button states
      try {
        const pageInfoEl = document.getElementById('quote-gallery-page-info');
        const prevBtn = document.getElementById('quote-gallery-prev-page');
        const nextBtn = document.getElementById('quote-gallery-next-page');
        if (pageInfoEl) pageInfoEl.textContent = `Trang ${quoteGalleryPage}/${pageCount} • ${total} hình`;
        if (prevBtn) prevBtn.disabled = quoteGalleryPage <= 1;
        if (nextBtn) nextBtn.disabled = quoteGalleryPage >= pageCount;
      } catch (e) { }

      grid.innerHTML = pageItems.map((e) => {
        const selected = selectedQuoteGalleryIds && selectedQuoteGalleryIds.has(e.id);
        return `
          <div class="quote-gallery-card ${selected ? 'selected' : ''}" data-entry-id="${e.id}" data-src="${e.src || ''}" data-name="${e.name || ''}" data-quote-key="${e.quoteKey || ''}" data-has-image="${e.hasImage ? '1' : '0'}" title="${e.quoteCode} - ${e.outletName}">
            <div class="quote-gallery-thumb ${e.hasImage ? '' : 'quote-gallery-thumb--empty'}" data-role="thumb">
              ${e.hasImage ? `<img src="${e.src}" alt="${e.name}">` : '<div class="quote-gallery-placeholder">Non Image</div>'}
            </div>
            <div class="quote-gallery-meta selectable" data-role="info">
              <div class="quote-gallery-code">${e.quoteCode}</div>
              <div class="quote-gallery-sub">Outlet: ${e.outletName || '---'}</div>
              <div class="quote-gallery-sub">Mã Outlet: ${e.outletCode || '---'}</div>
              <div class="quote-gallery-sub">Sale: ${e.saleName || '---'}</div>
              <div class="quote-gallery-sub">SS: ${e.ssName || '---'}</div>
              <div class="quote-gallery-sub">Khu vực: ${e.area || '---'}</div>
              <div class="quote-gallery-sub">SPO: ${e.spoNumber || '---'}</div>
              <div class="quote-gallery-select-badge">${selected ? '✓' : '+'}</div>
            </div>
          </div>
        `;
      }).join('');

      const updateCardSelection = (card, id, selected) => {
        if (!card) return;
        card.classList.toggle('selected', !!selected);
        const badge = card.querySelector('.quote-gallery-select-badge');
        if (badge) badge.textContent = selected ? '✓' : '+';
      };

      grid.querySelectorAll('.quote-gallery-card').forEach((card) => {
        const id = card.dataset.entryId;
        const thumb = card.querySelector('[data-role="thumb"]');
        const info = card.querySelector('[data-role="info"]');
        const hasImage = card.dataset.hasImage === '1';

        if (thumb) {
          thumb.addEventListener('click', () => {
            if (!hasImage) {
              showToast('Báo giá này chưa có hình (Non Image)');
              return;
            }
            const key = card.dataset.quoteKey;
            const quote = key ? findQuoteByKey(key) : null;
            if (quote) {
              // Open preview on top without closing the gallery modal
              openQuotePreviewForQuote(quote);
            } else {
              const src = card.dataset.src;
              const name = card.dataset.name || 'Hình báo giá';
              if (src) openImageViewer(src, name);
            }
          });
        }

        if (info) {
          info.addEventListener('click', (ev) => {
            ev.stopPropagation();
            if (!id) return;
            const nowSelected = toggleQuoteGallerySelection(id);
            updateCardSelection(card, id, nowSelected);
            updateQuoteGallerySelectionUI();
          });
        }
      });

      updateQuoteGallerySelectionUI();
    }

    function toggleQuoteGallerySelection(id) {
      if (!id) return false;
      if (!selectedQuoteGalleryIds) selectedQuoteGalleryIds = new Set();
      if (selectedQuoteGalleryIds.has(id)) {
        selectedQuoteGalleryIds.delete(id);
        return false;
      }
      selectedQuoteGalleryIds.add(id);
      return true;
    }

    // Render area filter buttons statically for specific areas
    function renderAreaFilters() {
      const container = document.getElementById('quote-images-area-buttons');
      if (!container) return;
      // Fixed list of areas and 'all'
      const areaList = ['S4', 'S5', 'S16', 'S17', 'S19', 'S24', 'Modern On Trade 8'];
      const allList = [...areaList, 'all'];
      const prevSelected = typeof quoteGallerySelectedArea !== 'undefined' ? quoteGallerySelectedArea : 'all';
      container.innerHTML = allList.map((a) => {
        const label = a === 'all' ? 'Tất cả' : a;
        const isSelected = a === prevSelected;
        const baseCls = 'px-2 py-1 text-sm font-medium rounded-md whitespace-nowrap';
        const selectedCls = isSelected ? 'text-gray-900 bg-white border border-blue-500 shadow-sm' : 'text-gray-500 bg-gray-100';
        // Make 'all' and 'Modern On Trade 8' span full width (3 cols) so they appear as a single horizontal row
        const spanCls = (a === 'all' || a === 'Modern On Trade 8') ? ' col-span-3' : '';
        return `<button type="button" data-area="${a}" class="area-filter-btn ${baseCls} ${selectedCls}${spanCls}">${label}</button>`;
      }).join('');

      // Bind handlers
      container.querySelectorAll('.area-filter-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const area = btn.getAttribute('data-area');
          if (!area) return;
          // single-select behaviour
          quoteGallerySelectedArea = area;
          updateAreaFilterUI();
          // Reset to page 1 when changing filters
          quoteGalleryPage = 1;
          const searchEl = document.getElementById('quote-images-search');
          const term = searchEl ? searchEl.value : '';
          renderQuoteImagesGallery(term);
        });
      });
    }

    function updateAreaFilterUI() {
      const container = document.getElementById('quote-images-area-buttons');
      if (!container) return;
      container.querySelectorAll('.area-filter-btn').forEach((btn) => {
        const a = btn.getAttribute('data-area');
        const selected = a === (quoteGallerySelectedArea || 'all');
        if (selected) {
          btn.classList.remove('text-gray-500','bg-gray-100');
          btn.classList.add('text-gray-900','bg-white','border','border-blue-500','shadow-sm');
          btn.setAttribute('aria-pressed','true');
        } else {
          btn.classList.remove('text-gray-900','bg-white','border','border-blue-500','shadow-sm');
          btn.classList.add('text-gray-500','bg-gray-100');
          btn.setAttribute('aria-pressed','false');
        }
      });
    }

    function getQuoteGallerySelectionCount() {
      return selectedQuoteGalleryIds ? selectedQuoteGalleryIds.size : 0;
    }

    function updateQuoteGallerySelectionUI() {
      // Keep export buttons in sync with selection count
      const count = getQuoteGallerySelectionCount();
      const jpgBtn = document.getElementById('quote-images-export-btn');
      if (jpgBtn) {
        jpgBtn.textContent = count > 0 ? `Xuất JPG (${count})` : 'Xuất JPG';
        jpgBtn.disabled = count === 0;
      }
      const pdfBtn = document.getElementById('quote-images-export-pdf-btn');
      if (pdfBtn) {
        pdfBtn.textContent = count > 0 ? `Xuất PDF (${count})` : 'Xuất PDF';
        pdfBtn.disabled = count === 0;
      }
    }

    function sanitizeFilenameForDownload(name) {
      const cleaned = String(name || 'Hinh').replace(/[\\/:*?"<>|]+/g, '-').trim();
      return cleaned || 'Hinh';
    }

    function triggerDataUrlDownload(dataUrl, filename) {
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }

    function loadImageElement(src) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = (err) => reject(err);
        img.src = src;
      });
    }

    // Lightweight fetch wrapper with retries/backoff for 429s to reduce rate-limit failures
    async function qcagFetchWithRetries(url, opts) {
      const MAX_RETRIES = 4;
      const BASE_DELAY = 400; // ms
      let attempt = 0;
      while (true) {
        try {
          const res = await fetch(url, opts);
          if (res && (res.status === 429 || res.status === 503) && attempt < MAX_RETRIES) {
            // exponential backoff
            const wait = BASE_DELAY * Math.pow(2, attempt);
            await new Promise(r => setTimeout(r, wait));
            attempt++;
            continue;
          }
          return res;
        } catch (e) {
          if (attempt >= MAX_RETRIES) throw e;
          const wait = BASE_DELAY * Math.pow(2, attempt);
          await new Promise(r => setTimeout(r, wait));
          attempt++;
        }
      }
    }

    async function loadImageWithFallback(src) {
      try {
        return await loadImageElement(src);
      } catch (_) {
        // For SVGs or file:// contexts, fetch and inline as data URL to avoid CORS/file issues
        try {
          const res = await qcagFetchWithRetries(src);
          const blob = await res.blob();
          const reader = new FileReader();
          const dataUrl = await new Promise((resolve, reject) => {
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          return await loadImageElement(dataUrl);
        } catch (err) {
          throw err;
        }
      }
    }

    async function convertSrcToJpegDataUrl(src) {
      const img = await loadImageElement(src);
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width || 1200;
      canvas.height = img.naturalHeight || img.height || 900;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.9);
    }

    async function generatePlaceholderJpeg(code, outlet) {
      const canvas = document.createElement('canvas');
      canvas.width = 1200;
      canvas.height = 900;
      const ctx = canvas.getContext('2d');
      const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      gradient.addColorStop(0, '#0f172a');
      gradient.addColorStop(1, '#1e293b');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 88px Segoe UI';
      ctx.textAlign = 'center';
      ctx.fillText('Non Image', canvas.width / 2, canvas.height / 2 - 40);
      ctx.font = '600 36px Segoe UI';
      const line1 = code ? `Mã: ${code}` : 'Mã: ---';
      const line2 = outlet ? `Outlet: ${outlet}` : 'Outlet: ---';
      ctx.fillText(line1, canvas.width / 2, canvas.height / 2 + 30);
      ctx.fillText(line2, canvas.width / 2, canvas.height / 2 + 90);
      return canvas.toDataURL('image/jpeg', 0.9);
    }

    function getOrCreatePreviewExportSandbox() {
      let host = document.getElementById('quote-preview-export-sandbox');
      if (!host) {
        host = document.createElement('div');
        host.id = 'quote-preview-export-sandbox';
        host.style.position = 'fixed';
        host.style.left = '-99999px';
        host.style.top = '0';
        host.style.width = '1123px';
        host.style.height = '794px';
        host.style.background = '#fff';
        host.style.zIndex = '0';
        document.body.appendChild(host);
      }
      host.innerHTML = '';
      return host;
    }

    function clonePreviewForExport(source) {
      const rect = source.getBoundingClientRect();
      const clone = source.cloneNode(true);
      clone.id = 'quote-preview-export-clone';
      clone.style.position = 'fixed';
      clone.style.left = '-99999px';
      clone.style.top = '0';
      clone.style.width = `${Math.round(rect.width || 1123)}px`;
      clone.style.height = `${Math.round(rect.height || 794)}px`;
      clone.style.overflow = 'hidden';
      clone.style.background = '#ffffff';
      clone.style.margin = '0';
      clone.style.padding = '0';

      document.body.appendChild(clone);

      // Ensure cloned images set CORS so html2canvas can load them without tainting (server must allow CORS)
      const clonedImgs = Array.from(clone.querySelectorAll('img'));
      clonedImgs.forEach((ci) => {
        try {
          // Only set crossorigin for absolute/relative URLs (data: URIs are fine)
          if (ci.src && !ci.src.startsWith('data:') && !ci.src.startsWith('blob:')) {
            ci.crossOrigin = 'anonymous';
            ci.referrerPolicy = 'no-referrer';
          }
        } catch (e) { /* ignore */ }
      });

      const selectors = [
        '.quote-preview-code',
        '.quote-preview-date-row',
        '.quote-preview-head',
        '.quote-preview-row',
        '.quote-preview-head .col',
        '.quote-preview-row .col',
        '.quote-preview-card-row',
        '.quote-preview-tag',
        '.quote-preview-items-title',
        '.quote-preview-title',
        '.quote-preview-meta-row',
        '.quote-preview-total',
        '.quote-preview-card-title'
      ];

      selectors.forEach((selector) => {
        const originals = source.querySelectorAll(selector);
        const clones = clone.querySelectorAll(selector);
        originals.forEach((originalNode, index) => {
          const cloneNode = clones[index];
          if (!cloneNode) return;
          const computed = window.getComputedStyle(originalNode);
          cloneNode.style.fontFamily = computed.fontFamily;
          cloneNode.style.fontSize = computed.fontSize;
          cloneNode.style.fontWeight = computed.fontWeight;
          cloneNode.style.lineHeight = computed.lineHeight;
          cloneNode.style.display = computed.display;
          cloneNode.style.alignItems = computed.alignItems;
          cloneNode.style.justifyContent = computed.justifyContent;
          cloneNode.style.height = computed.height;
          cloneNode.style.paddingTop = computed.paddingTop;
          cloneNode.style.paddingBottom = computed.paddingBottom;
          cloneNode.style.paddingLeft = computed.paddingLeft;
          cloneNode.style.paddingRight = computed.paddingRight;
          cloneNode.style.marginTop = computed.marginTop;
          cloneNode.style.marginBottom = computed.marginBottom;
        });
      });

      return clone;
    }

    async function waitForFontsReady() {
      if (document.fonts && document.fonts.ready) {
        try {
          await document.fonts.ready;
        } catch (_) {
          /* ignore font readiness errors */
        }
      }
    }

    async function waitForImagesToLoad(root) {
      const imgs = Array.from(root.querySelectorAll('img'));
      if (!imgs.length) return;
      await Promise.all(imgs.map((img) => {
        if (img.complete && img.naturalWidth) return Promise.resolve();
        return new Promise((resolve) => {
          img.onload = () => resolve();
          img.onerror = () => resolve();
        });
      }));
    }

    // --- SVG text overlay helpers for precise export (no layout changes, DOM text preserved) ---
    function _canvasContextForFontStyle(style) {
      const c = document.createElement('canvas');
      const ctx = c.getContext('2d');
      // Build a best-effort font shorthand for measurement
      const fontStyle = style.fontStyle || '';
      const fontWeight = style.fontWeight || '';
      const fontSize = style.fontSize || '12px';
      const fontFamily = style.fontFamily || 'sans-serif';
      ctx.font = `${fontStyle} ${fontWeight} ${fontSize} ${fontFamily}`.trim();
      return ctx;
    }

    function _wrapTextToLines(text, ctx, maxWidth) {
      const words = text.replace(/\s+/g, ' ').trim().split(' ');
      if (!words.length) return [''];
      const lines = [];
      let line = '';
      for (let i = 0; i < words.length; i++) {
        const word = words[i];
        const test = line ? line + ' ' + word : word;
        const w = ctx.measureText(test).width;
        if (w <= maxWidth || !line) {
          line = test;
        } else {
          lines.push(line);
          line = word;
        }
      }
      if (line) lines.push(line);
      return lines;
    }

    function createSvgTextOverlayForExport(root) {
      // root: element to export (should already be in DOM, positioned and sized)
      const containerRect = root.getBoundingClientRect();
      const svgNS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(svgNS, 'svg');

      svg.setAttribute('xmlns', svgNS);
      svg.setAttribute('width', String(Math.round(containerRect.width)));
      svg.setAttribute('height', String(Math.round(containerRect.height)));
      svg.setAttribute('viewBox', `0 0 ${Math.round(containerRect.width)} ${Math.round(containerRect.height)}`);

      // Absolute overlay wrapper
      const wrapper = document.createElement('div');
      wrapper.style.position = 'absolute';
      wrapper.style.left = '0px';
      wrapper.style.top = '0px';
      wrapper.style.width = `${Math.round(containerRect.width)}px`;
      wrapper.style.height = `${Math.round(containerRect.height)}px`;
      wrapper.style.pointerEvents = 'none';
      wrapper.style.zIndex = '9999';
      wrapper.appendChild(svg);

      // Walk text nodes to capture visual lines
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          // Reject nodes inside script/style
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const pTag = parent.tagName && parent.tagName.toLowerCase();
          if (pTag === 'script' || pTag === 'style') return NodeFilter.FILTER_REJECT;
          const cs = window.getComputedStyle(parent);
          if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }, false);

      const modifiedParents = new Map();
      const ctxCache = new Map();

      while (walker.nextNode()) {
        const tnode = walker.currentNode;
        const range = document.createRange();
        range.selectNodeContents(tnode);
        const clientRects = Array.from(range.getClientRects()).filter(r => r.width > 0 && r.height > 0);
        if (!clientRects.length) continue;

        const parent = tnode.parentElement;
        const cs = window.getComputedStyle(parent);
        const textColor = cs.color || '#000';
        const textAlign = cs.textAlign || 'left';
        const fontSize = parseFloat(cs.fontSize) || 12;
        const lineHeight = (() => {
          const lh = cs.lineHeight;
          if (lh === 'normal' || lh === 'initial' || !lh) return Math.round(fontSize * 1.15);
          return parseFloat(lh);
        })();

        // set parent text transparent (keeps layout)
        if (!modifiedParents.has(parent)) {
          modifiedParents.set(parent, parent.style.color || '');
          parent.style.color = 'transparent';
        }

        // prepare canvas context for measurement
        const fontKey = `${cs.fontStyle}|${cs.fontWeight}|${cs.fontSize}|${cs.fontFamily}`;
        if (!ctxCache.has(fontKey)) {
          const cctx = _canvasContextForFontStyle(cs);
          ctxCache.set(fontKey, cctx);
        }
        const measureCtx = ctxCache.get(fontKey);

        // wrap text into lines matching each clientRect width
        // We will approximate wrapping per block by slicing with each rect.width
        const rawText = tnode.nodeValue.replace(/\s+/g, ' ').trim();
        // If the text node maps to multiple rects (wrapped lines), compute lines for full available width
        // We'll produce lines using each rect's width in order. Use a char-fit fallback and ensure last-rect leftover is kept
        let remainingText = rawText;
        for (let i = 0; i < clientRects.length; i++) {
          const r = clientRects[i];
          const maxW = Math.max(1, Math.floor(r.width));
          // compute lines from remainingText that fit into maxW
          const lines = _wrapTextToLines(remainingText, measureCtx, maxW);
          // take the first line for this rect if available
          let line = lines.length ? lines[0] : '';

          // Fallback: if no word-wrapped line, fit by characters so we don't drop small trailing bits
          if (!line && remainingText) {
            line = remainingText;
            while (measureCtx.measureText(line).width > maxW && line.length > 1) {
              line = line.slice(0, -1);
            }
          }

          // If this is the last rect for this text node, include any remaining text to avoid accidental truncation
          if (i === clientRects.length - 1 && remainingText) {
            // prefer to keep full remaining text (safer than dropping chars); if it's too wide it will simply overflow visually
            line = remainingText;
            remainingText = '';
          } else if (line.length > 0) {
            // drop used part from remainingText
            const regex = new RegExp('^' + line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*');
            remainingText = remainingText.replace(regex, '');
          }

          // position
          const x = Math.round(r.left - containerRect.left + (textAlign === 'center' ? 0 : 0));
          // nudge text down ~1px to better vertically center across fonts/browsers
          const y = Math.round(r.top - containerRect.top) + 1;

          // create <text> element
          const textEl = document.createElementNS(svgNS, 'text');
          const tx = textAlign === 'center' ? Math.round(r.left - containerRect.left + r.width / 2) : x;
          textEl.setAttribute('x', String(tx));
          textEl.setAttribute('y', String(y));
          textEl.setAttribute('fill', textColor);
          textEl.setAttribute('font-family', cs.fontFamily || 'sans-serif');
          textEl.setAttribute('font-size', `${fontSize}px`);
          textEl.setAttribute('font-weight', cs.fontWeight || 'normal');
          textEl.setAttribute('dominant-baseline', 'hanging');
          textEl.setAttribute('text-anchor', textAlign === 'center' ? 'middle' : 'start');

          const tspan = document.createElementNS(svgNS, 'tspan');
          tspan.setAttribute('x', textEl.getAttribute('x'));
          tspan.setAttribute('dy', '0');
          tspan.setAttribute('xml:space', 'preserve');
          tspan.textContent = line;
          textEl.appendChild(tspan);

          // If there is additional wrapped content for this node beyond this rect (unlikely), append subsequent tspans
          // (We don't attempt to perfectly match exotic wrapping; this approach reduces line-shift differences.)
          svg.appendChild(textEl);
        }
      }

      // Attach overlay to root without changing layout (ensure root is positioned container)
      const prevPosition = root.style.position || '';
      const computedRootPos = window.getComputedStyle(root).position;
      if (computedRootPos === 'static') {
        root.style.position = 'relative';
      }

      root.appendChild(wrapper);

      return {
        async cleanup() {
          // restore parent colors
          for (const [el, prev] of modifiedParents.entries()) {
            try { el.style.color = prev; } catch (e) { /* ignore */ }
          }
          // remove overlay
          if (wrapper && wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
          // restore root position
          if (computedRootPos === 'static') root.style.position = prevPosition || '';
        }
      };
    }

    async function renderPreviewToJpegDataUrl(data, options = {}) {
      // Prefer DOM/html2canvas-based renderer so JPG matches the on-screen preview exactly.
      // Fallback to canvas renderer for environments without html2canvas or if legacy render fails.
      const hasHtml2Canvas = (typeof window !== 'undefined' && typeof window.html2canvas === 'function') || (typeof html2canvas !== 'undefined');
      if (hasHtml2Canvas) {
        try {
          return await renderPreviewToJpegDataUrlLegacy(data, options);
        } catch (err) {
          console.warn('Legacy preview-to-JPG failed, falling back to canvas renderer:', err);
          try { showToast && showToast('Lỗi khi render HTML preview — sử dụng phương án dự phòng.'); } catch (e) {}
        }
      }
      try {
        return await renderPreviewToJpegDataUrlCanvas(data, options);
      } catch (err) {
        console.error('Canvas renderer failed:', err);
        try { showToast && showToast('Lỗi khi xuất ảnh (canvas): ' + (err && err.message ? err.message : String(err))); } catch (e) {}
        throw err;
      }
    }

    async function renderPreviewToJpegDataUrlCanvas(data, options = {}) {
      try {
      const includeQcagSign = options && typeof options === 'object' ? (options.includeQcagSign !== false) : true;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      // Set canvas size (A4-like dimensions at 2x scale for quality)
      const scale = 2;
      const width = 1123;
      const height = 794;
      canvas.width = width * scale;
      canvas.height = height * scale;

      // Scale context for crisp rendering
      ctx.scale(scale, scale);

      // White background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);

      // Set font family to match CSS
      const fontFamily = "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif";

      // Helper functions
      const formatDateTime = (isoString) => {
        try {
          const date = new Date(isoString);
          if (Number.isNaN(date.getTime())) return '---';
          return date.toLocaleString('vi-VN', {
            hour12: false,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
          });
        } catch (_) {
          return '---';
        }
      };

      // Page layout with proper spacing (14px padding, 12px gap)
      const pagePadding = 14;
      const sectionGap = 12;
      const leftWidth = Math.floor(width * 4 / 5) - pagePadding - sectionGap / 2; // flex: 4
      const rightWidth = Math.floor(width * 1 / 5) - pagePadding - sectionGap / 2; // flex: 1
      const leftX = pagePadding;
      const rightX = leftX + leftWidth + sectionGap;

      // Left side layout
      let leftY = pagePadding + sectionGap;

      // Preload small assets used in canvas renderer (logos + QCAG sign)
      let hvnLogoImg = null;
      let qcagLogoImg = null;
      let qcagSignImg = null;
      try { hvnLogoImg = await loadImageWithFallback('assets/hvn-logo.svg'); } catch (e) { hvnLogoImg = null; }
      try { qcagLogoImg = await loadImageWithFallback('assets/qcag-logo.svg'); } catch (e) { qcagLogoImg = null; }
      if (includeQcagSign) {
        try { qcagSignImg = await loadImageWithFallback('assets/qcag-1.0.png'); } catch (e) { qcagSignImg = null; }
      }

      // Title (20px, font-weight: 700, color: #111827)
      ctx.fillStyle = '#111827';
      ctx.font = `700 20px ${fontFamily}`;
      ctx.textAlign = 'left';
      // If HVN logo loaded, draw it above the title and push content down
      if (hvnLogoImg) {
        const logoMaxW = Math.min(272, leftWidth - sectionGap * 2); // reduced from 320 to 272 (~15%)
        const logoAspect = hvnLogoImg.width / (hvnLogoImg.height || 1);
        const logoW = logoMaxW;
        const logoH = Math.round(logoW / logoAspect);
        const logoX = leftX + sectionGap;
        // Align top of logo with top of code block: codeBlockY = pagePadding + sectionGap + 8
        const logoY = pagePadding + sectionGap + 8;
        try { ctx.drawImage(hvnLogoImg, logoX, logoY, logoW, logoH); } catch (e) { /* ignore */ }
        leftY = logoY + logoH + 8; // push content below logo
      }
      ctx.fillText('Báo giá bảng hiệu', leftX + sectionGap, leftY);
      leftY += 30;

      // Meta rows (12px, color: #475569)
      ctx.font = `12px ${fontFamily}`;
      ctx.fillStyle = '#475569';
      const metaY = leftY;
      ctx.fillText(`Mã: ${data.outletCode || '---'}`, leftX + sectionGap, metaY);
      ctx.fillText(`Outlet: ${data.outletName || '---'}`, leftX + sectionGap + 200, metaY);
      ctx.fillText(`Khu vực: ${data.area || '---'}`, leftX + sectionGap + 400, metaY);
      leftY += 20;

      // Address row (12px, color: #475569)
      ctx.fillText(`Địa chỉ: ${data.address || 'Chưa có địa chỉ'}`, leftX + sectionGap, leftY);
      leftY += 25;

      // Quote code block (13px, font-weight: 700, color: #0f172a, width: 240px)
      const codeBlockX = leftX + leftWidth - 240 - sectionGap;
      const codeBlockY = pagePadding + sectionGap + 8;

      // Draw code background
      ctx.fillStyle = '#e7f0ff';
      ctx.fillRect(codeBlockX, codeBlockY, 240, 44);

      // Draw code border
      ctx.strokeStyle = '#93c5fd';
      ctx.lineWidth = 1;
      ctx.strokeRect(codeBlockX, codeBlockY, 240, 44);

      // Quote code text
      ctx.fillStyle = '#0f172a';
      ctx.font = `700 13px ${fontFamily}`;
      ctx.textAlign = 'center';
      const hasQuoteCode = data.quoteCode && !['Sẽ cấp sau khi lưu', '---'].includes(data.quoteCode);
      const quoteCodeText = hasQuoteCode ? `Mã báo giá: ${data.quoteCode}` : 'Mã Báo Giá: Chưa có Mã';
      ctx.fillText(quoteCodeText, codeBlockX + 120, codeBlockY + 28);

      // Dates block (11px, color: #334155, width: 240px)
      const datesY = codeBlockY + 44 + 6;
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(codeBlockX, datesY, 240, 80);

      ctx.strokeStyle = '#cbd5e1';
      ctx.strokeRect(codeBlockX, datesY, 240, 80);

      ctx.fillStyle = '#334155';
      ctx.font = `11px ${fontFamily}`;
      ctx.textAlign = 'center';

      const createdLabel = data.createdAt ? formatDateTime(data.createdAt) : 'Chưa lưu';
      const updatedIsDifferent = (() => {
        if (!data.updatedAt) return false;
        if (!data.createdAt) return true;
        const created = new Date(data.createdAt);
        const updated = new Date(data.updatedAt);
        if (Number.isNaN(created.getTime()) || Number.isNaN(updated.getTime())) return false;
        return Math.abs(updated.getTime() - created.getTime()) > 2000;
      })();
      const updatedLabel = data.updatedAt && updatedIsDifferent ? formatDateTime(data.updatedAt) : 'Chưa có cập nhật mới';

      ctx.fillText(`Ngày tạo: ${createdLabel}`, codeBlockX + 120, datesY + 22);
      ctx.fillText(`Cập nhật gần nhất: ${updatedLabel}`, codeBlockX + 120, datesY + 58);

      // Image section (height: 340px)
      const imageY = Math.max(leftY, datesY + 80 + sectionGap);
      const imageHeight = 340;

      if (data.primaryImage && data.primaryImage.data) {
        try {
          const img = new Image();
          const bustToken = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
          const srcToUse = _appendCacheBust(data.primaryImage.data, bustToken);
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = srcToUse;
          });

          // Draw image frame border
          ctx.strokeStyle = '#cbd5e1';
          ctx.lineWidth = 2;
          ctx.strokeRect(leftX + sectionGap, imageY, leftWidth - sectionGap * 2, imageHeight);

          // Calculate image dimensions to fit within frame while preserving aspect ratio
          const frameWidth = leftWidth - sectionGap * 2 - 4; // account for border
          const frameHeight = imageHeight - 4;
          const imgAspect = img.width / img.height;
          const frameAspect = frameWidth / frameHeight;

          let drawWidth, drawHeight, drawX, drawY;
          if (imgAspect > frameAspect) {
            // Image is wider than frame
            drawWidth = frameWidth;
            drawHeight = frameWidth / imgAspect;
            drawX = leftX + sectionGap + 2;
            drawY = imageY + 2 + (frameHeight - drawHeight) / 2;
          } else {
            // Image is taller than frame
            drawHeight = frameHeight;
            drawWidth = frameHeight * imgAspect;
            drawX = leftX + sectionGap + 2 + (frameWidth - drawWidth) / 2;
            drawY = imageY + 2;
          }

          ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
        } catch (e) {
          // Draw placeholder
          ctx.fillStyle = '#e5e7eb';
          ctx.fillRect(leftX + sectionGap, imageY, leftWidth - sectionGap * 2, imageHeight);

          ctx.strokeStyle = '#cbd5e1';
          ctx.lineWidth = 2;
          ctx.strokeRect(leftX + sectionGap, imageY, leftWidth - sectionGap * 2, imageHeight);

          ctx.fillStyle = '#374151';
          ctx.font = `700 16px ${fontFamily}`;
          ctx.textAlign = 'center';
          ctx.fillText('Non Image', leftX + sectionGap + (leftWidth - sectionGap * 2) / 2, imageY + imageHeight / 2);
        }
      } else {
        // Draw placeholder
        ctx.fillStyle = '#e5e7eb';
        ctx.fillRect(leftX + sectionGap, imageY, leftWidth - sectionGap * 2, imageHeight);

        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 2;
        ctx.strokeRect(leftX + sectionGap, imageY, leftWidth - sectionGap * 2, imageHeight);

        ctx.fillStyle = '#374151';
        ctx.font = `700 16px ${fontFamily}`;
        ctx.textAlign = 'center';
        ctx.fillText('Non Image', leftX + sectionGap + (leftWidth - sectionGap * 2) / 2, imageY + imageHeight / 2);
      }

      // Items table
      let tableY = imageY + imageHeight + sectionGap;

      // Items title (15px, font-weight: 700, color: #0f172a)
      ctx.fillStyle = '#0f172a';
      ctx.font = `700 15px ${fontFamily}`;
      ctx.textAlign = 'left';
      ctx.fillText('Chi tiết báo giá', leftX + sectionGap + 10, tableY + 20);
      tableY += 30;

      // Table headers (10.3px, font-weight: 800, color: #0f172a)
      ctx.font = `800 10.3px ${fontFamily}`;
      ctx.fillStyle = '#0f172a';
      ctx.textAlign = 'left';

      // Column widths from CSS: code 42px, content 130px+, brand 64px, width/height 58px, qty/unit 52px, price 72px, total 90px
      const colWidths = [42, 130, 64, 58, 58, 52, 52, 72, 90];
      const headers = ['Code', 'Nội dung', 'Brand', 'Ngang', 'Cao', 'SL', 'ĐVT', 'Đơn giá', 'Thành tiền'];

      let tableX = leftX + sectionGap + 10;
      headers.forEach((header, i) => {
        ctx.fillText(header, tableX, tableY + 20);
        tableX += colWidths[i];
      });

      // Header separator line
      ctx.strokeStyle = '#d1d5db';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(leftX + sectionGap + 10, tableY + 25);
      ctx.lineTo(tableX - colWidths[colWidths.length - 1], tableY + 25);
      ctx.stroke();

      tableY += 35;

      // Table rows (10.5px, color: #0f172a)
      ctx.font = `10.5px ${fontFamily}`;
      ctx.fillStyle = '#0f172a';

      if (data.items && data.items.length) {
        data.items.forEach(item => {
          tableX = leftX + sectionGap + 10;
          const values = [
            item.code || '',
            item.content || '',
            item.brand || '',
            item.width || '-',
            item.height || '-',
            item.quantity || '-',
            item.unit || '-',
            formatCurrency(parseNumber(item.price)),
            formatCurrency(parseNumber(item.quantity) * parseNumber(item.price))
          ];

          values.forEach((value, i) => {
            ctx.fillText(value, tableX, tableY + 20);
            tableX += colWidths[i];
          });

          // Row separator line
          ctx.strokeStyle = '#d1d5db';
          ctx.beginPath();
          ctx.moveTo(leftX + sectionGap + 10, tableY + 25);
          ctx.lineTo(tableX - colWidths[colWidths.length - 1], tableY + 25);
          ctx.stroke();

          tableY += 25;
        });
      } else {
        ctx.fillStyle = '#94a3b8';
        ctx.font = `italic 10.5px ${fontFamily}`;
        ctx.fillText('Chưa có hạng mục nào', leftX + sectionGap + 10, tableY + 20);
        tableY += 25;
      }

      // Total (font-weight: 800, color: #1d4ed8)
      tableY += 10;
      ctx.fillStyle = '#1d4ed8';
      ctx.font = `800 12px ${fontFamily}`;
      ctx.textAlign = 'right';
      ctx.fillText(`Tổng cộng: ${formatCurrency(data.totalAmount)}`, leftX + leftWidth - sectionGap - 10, tableY + 20);

      // Right side layout
      let rightY = pagePadding + sectionGap;

      // Logo card (background: #f8fafc, border: #cbd5e1) with QCAG logo image
      const logoCardHeight = 80;
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(rightX, rightY, rightWidth, logoCardHeight);

      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1;
      ctx.strokeRect(rightX, rightY, rightWidth, logoCardHeight);

      if (qcagLogoImg) {
        try {
          const margin = 10;
          const maxW = rightWidth - margin * 2;
          const maxH = logoCardHeight - margin * 2;
          const aspect = qcagLogoImg.width / (qcagLogoImg.height || 1);
          let drawW = maxW;
          let drawH = Math.round(drawW / aspect);
          if (drawH > maxH) {
            drawH = maxH;
            drawW = Math.round(drawH * aspect);
          }
          const drawX = rightX + Math.round((rightWidth - drawW) / 2);
          const drawY = rightY + Math.round((logoCardHeight - drawH) / 2);
          ctx.drawImage(qcagLogoImg, drawX, drawY, drawW, drawH);
        } catch (e) { /* ignore draw errors */ }
      } else {
        ctx.fillStyle = '#111827';
        ctx.font = `800 13px ${fontFamily}`;
        ctx.textAlign = 'center';
        ctx.fillText('Logo công ty', rightX + rightWidth / 2, rightY + 35);
      }

      rightY += logoCardHeight + 10;

      // Sale info card
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(rightX, rightY, rightWidth, 120);

      ctx.strokeStyle = '#cbd5e1';
      ctx.strokeRect(rightX, rightY, rightWidth, 120);

      // Sale info title (13px, font-weight: 800, color: #0f172a)
      ctx.fillStyle = '#0f172a';
      ctx.font = `800 13px ${fontFamily}`;
      ctx.textAlign = 'left';
      ctx.fillText('Thông tin Sale', rightX + 10, rightY + 20);

      // Sale info rows (12px, color: #1f2937, space-between layout)
      ctx.fillStyle = '#1f2937';
      ctx.font = `12px ${fontFamily}`;

      const saleInfoRows = [
        { label: 'Loại', value: data.saleType || '---' },
        { label: 'Mã', value: data.saleCode || '---' },
        { label: 'Tên', value: data.saleName || '---' },
        { label: 'SĐT', value: data.salePhone || '---' },
        { label: 'Tên SS', value: data.ssName || '---' }
      ];

      saleInfoRows.forEach((row, i) => {
        const rowY = rightY + 40 + (i * 16);
        
        // Draw dashed line (except last row)
        if (i < saleInfoRows.length - 1) {
          ctx.strokeStyle = '#cbd5e1';
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.moveTo(rightX + 10, rowY + 12);
          ctx.lineTo(rightX + rightWidth - 10, rowY + 12);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Label (left)
        ctx.textAlign = 'left';
        ctx.fillText(row.label, rightX + 10, rowY + 10);

        // Value (right)
        ctx.textAlign = 'right';
        ctx.fillText(row.value, rightX + rightWidth - 10, rowY + 10);
      });

      rightY += 120 + 10;

      // Sign boxes
      const tagHeight = 28;
      const signGap = 6;
      const remainingHeight = height - pagePadding - rightY;

      if (remainingHeight >= (tagHeight + signGap + 160) * 2 + 10) {
        // Brand footer sign
        if (data.brandFooter) {
          // Tag (background: #334155, color: #f8fafc, 10px, weight: 700)
          ctx.fillStyle = '#334155';
          ctx.fillRect(rightX, rightY, rightWidth, tagHeight);

          ctx.strokeStyle = '#cbd5e1';
          ctx.strokeRect(rightX, rightY, rightWidth, tagHeight);

          ctx.fillStyle = '#f8fafc';
          ctx.font = `700 10px ${fontFamily}`;
          ctx.textAlign = 'center';
          ctx.fillText(data.brandFooter, rightX + rightWidth / 2, rightY + 18);

          rightY += tagHeight + signGap;

          // Sign box (height: 160px, border: 1px dashed #94a3b8, background: #f8fafc)
          ctx.fillStyle = '#f8fafc';
          ctx.fillRect(rightX, rightY, rightWidth, 160);

          ctx.strokeStyle = '#94a3b8';
          ctx.setLineDash([5, 5]);
          ctx.strokeRect(rightX, rightY, rightWidth, 160);
          ctx.setLineDash([]);

          // If qcag sign image preloaded, draw it centered inside the sign box
          if (typeof qcagSignImg !== 'undefined' && qcagSignImg) {
            try {
              const margin = 8;
              const maxW = rightWidth - margin * 2;
              const maxH = 160 - margin * 2;
              const imgAspect = qcagSignImg.width / (qcagSignImg.height || 1);
              let drawW = maxW;
              let drawH = Math.round(drawW / imgAspect);
              if (drawH > maxH) {
                drawH = maxH;
                drawW = Math.round(drawH * imgAspect);
              }
              const drawX = rightX + Math.round((rightWidth - drawW) / 2);
              const drawY = rightY + Math.round((160 - drawH) / 2);
              ctx.drawImage(qcagSignImg, drawX, drawY, drawW, drawH);
            } catch (e) { /* ignore drawing failure */ }
          }

          rightY += 160 + 10;
        }

        // Brand approval sign
        if (data.brandApproval && remainingHeight >= (tagHeight + signGap + 160)) {
          // Tag
          ctx.fillStyle = '#334155';
          ctx.fillRect(rightX, rightY, rightWidth, tagHeight);

          ctx.strokeStyle = '#cbd5e1';
          ctx.strokeRect(rightX, rightY, rightWidth, tagHeight);

          ctx.fillStyle = '#f8fafc';
          ctx.font = `700 10px ${fontFamily}`;
          ctx.textAlign = 'center';
          ctx.fillText(data.brandApproval, rightX + rightWidth / 2, rightY + 18);

          rightY += tagHeight + signGap;

          // Sign box
          ctx.fillStyle = '#f8fafc';
          ctx.fillRect(rightX, rightY, rightWidth, 160);

          ctx.strokeStyle = '#94a3b8';
          ctx.setLineDash([5, 5]);
          ctx.strokeRect(rightX, rightY, rightWidth, 160);
          ctx.setLineDash([]);
        }
      }

      return canvas.toDataURL('image/jpeg', 0.92);
      } catch (err) {
        console.error('renderPreviewToJpegDataUrlCanvas unexpected error:', err);
        throw err;
      }
    }

    // Legacy function kept for compatibility
    async function renderPreviewToJpegDataUrlLegacy(data, options = {}) {
      const includeQcagSign = options && typeof options === 'object' ? (options.includeQcagSign !== false) : true;
      // Always build a fresh sandbox from the provided data to avoid leaking the last viewed preview
      const target = getOrCreatePreviewExportSandbox();
      target.innerHTML = buildQuotePreviewHtml(data, { includeQcagSign });
      const cleanup = false;

      // Remove QCAG signature image for JPG export when requested (does not change UI)
      if (!includeQcagSign && target) {
        try { Array.from(target.querySelectorAll('img.qcag-sign-img')).forEach(n => n.remove()); } catch (e) { /* ignore */ }
      }

      // Ensure images in the target request CORS and inline SVGs as data URIs so html2canvas can capture them.
      try {
        const bustToken = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        const imgs = Array.from(target.querySelectorAll('img'));
        const svgPromises = imgs.map((img) => {
          try {
            if (!img) return Promise.resolve();
            const src = img.getAttribute('src') || img.src || '';
            if (!src) return Promise.resolve();
            if (src.startsWith('data:') || src.startsWith('blob:')) return Promise.resolve();
            // Set CORS hints
            try { img.crossOrigin = 'anonymous'; } catch (e) {}
            try { img.referrerPolicy = 'no-referrer'; } catch (e) {}
            // If SVG, fetch and inline it as a data URI to avoid external rendering issues
            const isSvg = /\.svg(\?|$)/i.test(src);
            if (isSvg) {
              return fetch(src).then(r => r.text()).then((text) => {
                try {
                  const data = 'data:image/svg+xml;utf8,' + encodeURIComponent(text);
                  img.src = data;
                } catch (e) { /* ignore */ }
              }).catch(() => {});
            }
            // For non-SVG images, reload to apply crossorigin
            try { img.removeAttribute('src'); } catch (e) {}
            try { img.src = _appendCacheBust(src, bustToken); } catch (e) {}
            return Promise.resolve();
          } catch (e) { return Promise.resolve(); }
        });
        await Promise.all(svgPromises);
      } catch (e) { /* ignore image preparation errors */ }

      await waitForFontsReady();
      await waitForImagesToLoad(target);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const rect = target.getBoundingClientRect();
      const exportWidth = Math.round(rect.width || 1123);
      const exportHeight = Math.round(rect.height || 794);
      // Create SVG overlay that draws text precisely (keeps layout and images intact), then capture
      let svgOverlayHandle = null;
      try {
        svgOverlayHandle = createSvgTextOverlayForExport(target);
      } catch (err) {
        // If overlay creation fails, continue with default capture
        console.warn('SVG text overlay creation failed:', err);
      }

      // Give browser a moment to lay out the overlay
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      const canvas = await window.html2canvas(target, {
        backgroundColor: '#ffffff',
        useCORS: true,
        scale: 2,
        width: exportWidth,
        height: exportHeight,
        windowWidth: exportWidth,
        windowHeight: exportHeight,
        scrollX: 0,
        scrollY: 0,
        letterRendering: true
      });

      // Cleanup overlay and restore DOM text
      if (svgOverlayHandle && typeof svgOverlayHandle.cleanup === 'function') {
        try { await svgOverlayHandle.cleanup(); } catch (e) { /* ignore */ }
      }

      if (cleanup && target && target.parentNode) {
        target.parentNode.removeChild(target);
      } else if (target && target.id === 'quote-preview-export-sandbox') {
        target.innerHTML = '';
      }

      return canvas.toDataURL('image/jpeg', 0.92);
    }

    // exportSelectedQuoteImages removed: functionality intentionally cleared.

    function openQuoteImagesModal() {
      const modal = document.getElementById('quote-images-modal');
      const searchInput = document.getElementById('quote-images-search');
      const fromDateEl = document.getElementById('quote-images-from-date');
      const toDateEl = document.getElementById('quote-images-to-date');
      const createdBtn = document.getElementById('quote-images-date-mode-created');
      const updatedBtn = document.getElementById('quote-images-date-mode-updated');
      if (!modal) return;
      renderQuoteImagesGallery('');
      updateQuoteGallerySelectionUI();
      if (fromDateEl) {
        fromDateEl.value = '';
        fromDateEl.min = '';
        fromDateEl.max = '';
      }
      if (toDateEl) {
        toDateEl.value = '';
        toDateEl.min = '';
        toDateEl.max = '';
      }
      // reflect current mode visually
      if (typeof quoteGalleryDateMode !== 'undefined') {
        try { if (typeof updateDateModeUI === 'function') updateDateModeUI(); } catch (e) { /* ignore */ }
      }
      if (searchInput) {
        searchInput.value = '';
        searchInput.oninput = (e) => { quoteGalleryPage = 1; renderQuoteImagesGallery(e.target.value || ''); };
        setTimeout(() => searchInput.focus(), 50);
      }
      // Reset to first page on open and bind pagination controls
      quoteGalleryPage = 1;
      const prevBtn = document.getElementById('quote-gallery-prev-page');
      const nextBtn = document.getElementById('quote-gallery-next-page');
      if (prevBtn) prevBtn.onclick = () => { quoteGalleryPage = Math.max(1, quoteGalleryPage - 1); const term = searchInput ? (searchInput.value || '') : ''; renderQuoteImagesGallery(term); };
      if (nextBtn) nextBtn.onclick = () => { quoteGalleryPage = quoteGalleryPage + 1; const term = searchInput ? (searchInput.value || '') : ''; renderQuoteImagesGallery(term); };
      const pageSizeEl = document.getElementById('quote-gallery-page-size');
      if (pageSizeEl) {
        pageSizeEl.value = String(quoteGalleryPageSize || 24);
        pageSizeEl.onchange = (e) => { quoteGalleryPageSize = Number(e.target.value) || 24; quoteGalleryPage = 1; const term = searchInput ? (searchInput.value || '') : ''; renderQuoteImagesGallery(term); };
      }
      // Bind select all button
      const selectAllBtn = document.getElementById('quote-images-select-all-btn');
      if (selectAllBtn) {
        selectAllBtn.onclick = () => {
          const grid = document.getElementById('quote-gallery-grid');
          if (!grid) return;
          const cards = grid.querySelectorAll('.quote-gallery-card');
          cards.forEach(card => {
            const id = card.dataset.entryId;
            if (id) selectedQuoteGalleryIds.add(id);
          });
          // Update UI
          updateQuoteGallerySelectionUI();
          // Update card badges
          cards.forEach(card => {
            const badge = card.querySelector('.quote-gallery-select-badge');
            if (badge) badge.textContent = '✓';
            card.classList.add('selected');
          });
        };
      }
      // Bind deselect button (clear all selections)
      const deselectBtn = document.getElementById('quote-images-deselect-btn');
      if (deselectBtn) {
        deselectBtn.addEventListener('click', (ev) => {
          ev && ev.stopPropagation();
          try {
            console.log('quote-images-deselect-btn clicked');
            if (selectedQuoteGalleryIds) selectedQuoteGalleryIds.clear();
            // Update UI: badges, selected class, export buttons
            const grid = document.getElementById('quote-gallery-grid');
            if (grid) {
              const cards = grid.querySelectorAll('.quote-gallery-card');
              cards.forEach(card => {
                card.classList.remove('selected');
                const badge = card.querySelector('.quote-gallery-select-badge');
                if (badge) badge.textContent = '+';
              });
            }
            updateQuoteGallerySelectionUI();
          } catch (e) { console.warn('Failed to clear gallery selection', e); }
        });
      }
      modal.classList.remove('hidden');
      ensureScrollLock();
    }

    function closeQuoteImagesModal() {
      const modal = document.getElementById('quote-images-modal');
      if (!modal) return;
      modal.classList.add('hidden');
      ensureScrollLock();
    }

    function openQuotePreviewModal() {
      renderQuotePreviewPage(buildQuotePreviewData());
      const modal = document.getElementById('quote-preview-modal');
      if (modal) {
        modal.classList.remove('hidden');
        try { modal.style.zIndex = '99999'; } catch (e) {}
        ensureScrollLock();
      }
    }

    function closeQuotePreviewModal() {
      const modal = document.getElementById('quote-preview-modal');
      if (modal) {
        modal.classList.add('hidden');
        try { modal.style.zIndex = ''; } catch (e) {}
        ensureScrollLock();
      }
    }

    // ==== IMAGE VIEWER FUNCTIONS ====
    const IMAGE_VIEWER_MAX_SCALE = 3;

    const imageViewerState = {
      scale: 1,
      translateX: 0,
      translateY: 0,
      minScale: 0.5,
      maxScale: IMAGE_VIEWER_MAX_SCALE,
      isDragging: false,
      initialTranslateX: 0,
      initialTranslateY: 0,
      dragStartX: 0,
      dragStartY: 0
    };

    function isImageViewerActive() {
      const overlay = document.getElementById('image-viewer');
      return !!(overlay && !overlay.classList.contains('hidden'));
    }

    function updateImageViewerTransform() {
      const imgEl = document.getElementById('image-viewer-img');
      if (!imgEl) return;
      imgEl.style.transform = `translate(${imageViewerState.translateX}px, ${imageViewerState.translateY}px) scale(${imageViewerState.scale})`;
    }

    function updateImageViewerButtonsState() {
      const zoomOutBtn = document.getElementById('image-viewer-zoom-out');
      const zoomInBtn = document.getElementById('image-viewer-zoom-in');
      const zoomResetBtn = document.getElementById('image-viewer-zoom-reset');
      const stageEl = document.getElementById('image-viewer-stage');
      const percentLabel = Math.round(imageViewerState.scale * 100);
      if (zoomResetBtn) {
        zoomResetBtn.textContent = `${percentLabel}%`;
        const nearOriginal = Math.abs(imageViewerState.scale - 1) < 0.01 && Math.abs(imageViewerState.translateX) < 1 && Math.abs(imageViewerState.translateY) < 1;
        zoomResetBtn.disabled = nearOriginal;
      }
      if (zoomOutBtn) {
        zoomOutBtn.disabled = imageViewerState.scale <= imageViewerState.minScale + 0.01;
      }
      if (zoomInBtn) {
        zoomInBtn.disabled = imageViewerState.scale >= imageViewerState.maxScale - 0.01;
      }
      if (stageEl) {
        stageEl.classList.toggle('zoomed', imageViewerState.scale > 1.02);
      }
    }

    function updateImageViewerScaleBounds() {
      const overlay = document.getElementById('image-viewer');
      const imgEl = document.getElementById('image-viewer-img');
      const stageEl = document.getElementById('image-viewer-stage');
      if (!imgEl || !stageEl) return;
      if (overlay && overlay.classList.contains('hidden')) return;
      if (!imgEl.complete || !imgEl.naturalWidth || !imgEl.naturalHeight) return;

      const stageRect = stageEl.getBoundingClientRect();
      if (!stageRect.width || !stageRect.height) return;

      const currentScale = imageViewerState.scale || 1;
      const baseWidth = imgEl.getBoundingClientRect().width / currentScale;
      const baseHeight = imgEl.getBoundingClientRect().height / currentScale;
      if (!baseWidth || !baseHeight) return;

      const widthRatio = stageRect.width / baseWidth;
      const heightRatio = stageRect.height / baseHeight;
      const fitScale = Math.max(1, Math.min(widthRatio, heightRatio));
      const targetMax = Math.max(fitScale, IMAGE_VIEWER_MAX_SCALE);

      imageViewerState.maxScale = Math.min(Math.max(imageViewerState.minScale, targetMax), IMAGE_VIEWER_MAX_SCALE);

      if (imageViewerState.scale > imageViewerState.maxScale) {
        setImageViewerScale(imageViewerState.maxScale);
      } else {
        updateImageViewerButtonsState();
      }
    }

    function resetImageViewerTransform() {
      imageViewerState.scale = 1;
      imageViewerState.translateX = 0;
      imageViewerState.translateY = 0;
      imageViewerState.isDragging = false;
      imageViewerState.initialTranslateX = 0;
      imageViewerState.initialTranslateY = 0;
      imageViewerState.dragStartX = 0;
      imageViewerState.dragStartY = 0;
      const stageEl = document.getElementById('image-viewer-stage');
      if (stageEl) {
        stageEl.classList.remove('dragging');
      }
      updateImageViewerTransform();
      updateImageViewerButtonsState();
    }

    function setImageViewerScale(nextScale) {
      const clamped = Math.min(imageViewerState.maxScale, Math.max(imageViewerState.minScale, nextScale));
      if (clamped === imageViewerState.scale) {
        updateImageViewerButtonsState();
        return;
      }
      imageViewerState.scale = clamped;
      if (imageViewerState.scale <= 1) {
        imageViewerState.translateX = 0;
        imageViewerState.translateY = 0;
      }
      updateImageViewerTransform();
      updateImageViewerButtonsState();
    }

    function adjustImageViewerScale(multiplier) {
      if (!isImageViewerActive()) return;
      setImageViewerScale(imageViewerState.scale * multiplier);
    }

    function openImageViewer(src, name) {
      const overlay = document.getElementById('image-viewer');
      const imgEl = document.getElementById('image-viewer-img');
      const nameEl = document.getElementById('image-viewer-filename');
      if (!overlay || !imgEl) return;
      resetImageViewerTransform();
      imgEl.src = src;
      if (nameEl) nameEl.textContent = name || '';
      updateFullscreenButtonLabel();
      overlay.classList.remove('hidden');
      document.documentElement.classList.add('no-scroll');
      document.body.classList.add('no-scroll');
      requestAnimationFrame(() => updateImageViewerScaleBounds());
      updateImageViewerButtonsState();
    }

    function closeImageViewer() {
      const overlay = document.getElementById('image-viewer');
      if (!overlay) return;
      const isFullscreen = document.fullscreenElement === overlay;
      if (isFullscreen && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
      overlay.classList.add('hidden');
      document.documentElement.classList.remove('no-scroll');
      document.body.classList.remove('no-scroll');
      resetImageViewerTransform();
      updateFullscreenButtonLabel();
    }

    function handleImageViewerPointerDown(event) {
      const stageEl = document.getElementById('image-viewer-stage');
      if (!stageEl) return;
      if (typeof event.button === 'number' && event.button !== 0) return;
      event.preventDefault();
      if (imageViewerState.scale <= 1) {
        imageViewerState.translateX = 0;
        imageViewerState.translateY = 0;
        updateImageViewerTransform();
        updateImageViewerButtonsState();
        return;
      }
      imageViewerState.isDragging = true;
      imageViewerState.initialTranslateX = imageViewerState.translateX;
      imageViewerState.initialTranslateY = imageViewerState.translateY;
      imageViewerState.dragStartX = event.clientX;
      imageViewerState.dragStartY = event.clientY;
      stageEl.classList.add('dragging');
      try {
        stageEl.setPointerCapture(event.pointerId);
      } catch (err) {
        // Ignore pointer capture errors
      }
    }

    function handleImageViewerPointerMove(event) {
      if (!imageViewerState.isDragging) return;
      event.preventDefault();
      const deltaX = event.clientX - imageViewerState.dragStartX;
      const deltaY = event.clientY - imageViewerState.dragStartY;
      imageViewerState.translateX = imageViewerState.initialTranslateX + deltaX;
      imageViewerState.translateY = imageViewerState.initialTranslateY + deltaY;
      updateImageViewerTransform();
    }

    function handleImageViewerPointerUp(event) {
      if (!imageViewerState.isDragging) return;
      imageViewerState.isDragging = false;
      const stageEl = document.getElementById('image-viewer-stage');
      if (stageEl) {
        stageEl.classList.remove('dragging');
        try {
          stageEl.releasePointerCapture(event.pointerId);
        } catch (err) {
          // Ignore pointer release errors
        }
      }
      updateImageViewerButtonsState();
    }

    function handleImageViewerWheel(event) {
      event.preventDefault();
      if (!isImageViewerActive()) return;
      const direction = event.deltaY > 0 ? -1 : 1;
      const multiplier = direction > 0 ? 1.15 : 0.85;
      setImageViewerScale(imageViewerState.scale * multiplier);
    }

    function toggleImageViewerFullscreen() {
      const overlay = document.getElementById('image-viewer');
      if (!overlay) return;
      const isFullscreen = document.fullscreenElement === overlay;
      if (!isFullscreen && overlay.requestFullscreen) {
        overlay.requestFullscreen().catch(() => {});
      } else if (isFullscreen && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    }

    function updateFullscreenButtonLabel() {
      const overlay = document.getElementById('image-viewer');
      const fullscreenBtn = document.getElementById('image-viewer-fullscreen');
      if (!fullscreenBtn) return;
      const isFullscreen = document.fullscreenElement === overlay;
      fullscreenBtn.textContent = isFullscreen ? 'Exit' : 'Full';
      fullscreenBtn.title = isFullscreen ? 'Thoát toàn màn hình' : 'Toàn màn hình';
    }

    document.addEventListener('keydown', (e) => {
      const viewerActive = isImageViewerActive();
      if (!viewerActive) return;
      if (e.key === 'Escape') {
        // Keep Escape scoped to the image viewer so stacked modals (e.g. library) stay open
        e.preventDefault();
        e.stopImmediatePropagation();
        closeImageViewer();
        return;
      }
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        adjustImageViewerScale(1.15);
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        adjustImageViewerScale(0.85);
      } else if (e.key === '0') {
        e.preventDefault();
        resetImageViewerTransform();
      }
    });

    document.addEventListener('fullscreenchange', () => {
      updateFullscreenButtonLabel();
      if (isImageViewerActive()) {
        requestAnimationFrame(() => updateImageViewerScaleBounds());
      }
    });

    // Ensure every modal has a top-right "X" close button
    document.addEventListener('DOMContentLoaded', () => {
      try { installModalCloseXObserverOnce(); } catch (e) {}
      try { ensureAllModalsHaveCloseX(); } catch (e) {}
    });

    document.addEventListener('DOMContentLoaded', () => {
      const overlay = document.getElementById('image-viewer');
      const closeBtn = document.getElementById('image-viewer-close');
      const zoomInBtn = document.getElementById('image-viewer-zoom-in');
      const zoomOutBtn = document.getElementById('image-viewer-zoom-out');
      const zoomResetBtn = document.getElementById('image-viewer-zoom-reset');
      const fullscreenBtn = document.getElementById('image-viewer-fullscreen');
      const stageEl = document.getElementById('image-viewer-stage');
      const imgEl = document.getElementById('image-viewer-img');
      if (overlay) {
        overlay.addEventListener('click', (event) => {
          if (event.target === overlay) closeImageViewer();
        });
      }
      if (closeBtn) closeBtn.addEventListener('click', closeImageViewer);
      if (zoomInBtn) zoomInBtn.addEventListener('click', () => setImageViewerScale(imageViewerState.scale * 1.2));
      if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => setImageViewerScale(imageViewerState.scale * 0.8));
      if (zoomResetBtn) zoomResetBtn.addEventListener('click', resetImageViewerTransform);
      if (fullscreenBtn) fullscreenBtn.addEventListener('click', toggleImageViewerFullscreen);
      if (stageEl) {
        stageEl.addEventListener('pointerdown', handleImageViewerPointerDown);
        stageEl.addEventListener('pointermove', handleImageViewerPointerMove);
        stageEl.addEventListener('pointerup', handleImageViewerPointerUp);
        stageEl.addEventListener('pointercancel', handleImageViewerPointerUp);
        stageEl.addEventListener('pointerleave', handleImageViewerPointerUp);
        stageEl.addEventListener('wheel', handleImageViewerWheel, { passive: false });
      }
      if (imgEl) {
        imgEl.addEventListener('load', () => {
          requestAnimationFrame(() => updateImageViewerScaleBounds());
        });
      }
      window.addEventListener('resize', () => {
        if (isImageViewerActive()) {
          requestAnimationFrame(() => updateImageViewerScaleBounds());
        }
      });
      updateImageViewerButtonsState();
      updateFullscreenButtonLabel();
    });

    document.addEventListener('DOMContentLoaded', () => {
      const noCodeBtn = document.getElementById('outlet-code-no-code-btn');
      if (noCodeBtn) {
        noCodeBtn.addEventListener('click', (e) => {
          e.preventDefault();
          setOutletCodePlaceholder();
        });
      }
    });
    // ==== END IMAGE VIEWER FUNCTIONS ====

    // Helper function to update quote data across all modals and cached locations
    function updateQuoteInAllModals(quoteKey, updatedQuoteData) {
      if (!quoteKey || !updatedQuoteData) return;
      
      try {
        // 1. Update in Production Orders
        const found = findQuoteInProductionOrders(quoteKey);
        if (found) {
          const { order, orderIndex, quoteIndex } = found;
          let quotes = [];
          try { quotes = JSON.parse(order.items || '[]'); } catch (e) { quotes = []; }
          
          if (Array.isArray(quotes) && quotes[quoteIndex]) {
            // Merge updated data into production order quote
            quotes[quoteIndex] = { 
              ...quotes[quoteIndex], 
              ...updatedQuoteData,
              // Clear pending flags
              __updatedSinceQc: undefined,
              __itemsChanged: undefined,
              __imagesChanged: undefined,
              added_items_notes: undefined,
              qcag_override_status: null,
              qcag_note: null,
              qcag_at: null,
              __overrideClearing: true
            };
            
            // Clean undefined fields
            Object.keys(quotes[quoteIndex]).forEach(k => {
              if (quotes[quoteIndex][k] === undefined) delete quotes[quoteIndex][k];
            });
            
            const updatedOrder = { ...order, items: JSON.stringify(quotes) };
            productionOrders[orderIndex] = updatedOrder;
            
            // Save to backend
            if (window.dataSdk && typeof window.dataSdk.update === 'function') {
              window.dataSdk.update(updatedOrder).catch(() => {});
            }
          }
        }
        
        // 2. Update in Xin Phép modal if it has the quote
        if (window.__lastXinphepList && Array.isArray(window.__lastXinphepList)) {
          const xinphepIndex = window.__lastXinphepList.findIndex(q => {
            const qk = q.quote_key || q.quote_code || q.quoteCode || '';
            return String(qk) === String(quoteKey);
          });
          
          if (xinphepIndex >= 0) {
            // Parse items for clean format
            let cleanItems = [];
            try {
              const items = JSON.parse(updatedQuoteData.items || '[]');
              cleanItems = items.map(it => ({
                code: it.code || '',
                content: it.content || '',
                brand: it.brand || '',
                width: it.width || '',
                height: it.height || '',
                quantity: it.quantity || '',
                unit: it.unit || '',
                price: it.price || '',
                total: it.total || ''
              }));
            } catch (e) { cleanItems = []; }
            
            // Update xinphep list entry
            window.__lastXinphepList[xinphepIndex] = {
              ...window.__lastXinphepList[xinphepIndex],
              outlet_code: updatedQuoteData.outlet_code || '',
              outlet_name: updatedQuoteData.outlet_name || '',
              area: updatedQuoteData.area || '',
              sale_type: updatedQuoteData.sale_type || '',
              sale_name: updatedQuoteData.sale_name || '',
              sale_phone: updatedQuoteData.sale_phone || '',
              outlet_phone: updatedQuoteData.outlet_phone || '',
              address: updatedQuoteData.address || '',
              spo_number: updatedQuoteData.spo_number || '',
              items: JSON.stringify(cleanItems),
              quote_code: updatedQuoteData.quote_code || ''
            };
            
            // Re-render xinphep modal if it's visible
            const xinphepModal = document.getElementById('xinphep-modal');
            if (xinphepModal && !xinphepModal.classList.contains('hidden')) {
              if (typeof window.renderXinphepList === 'function') {
                window.renderXinphepList(window.__lastXinphepList);
              }
            }
          }
        }
        
        // 3. Refresh Acceptance modal if it's open
        try {
          const adm = document.getElementById('acceptance-detail-modal');
          if (adm && !adm.classList.contains('hidden')) {
            try { renderAcceptanceDetailModal(); } catch (e) {}
            try { renderAcceptanceImages(); } catch (e) {}
            try { 
              if (window.__renderAcceptanceProductionOrders) {
                window.__renderAcceptanceProductionOrders(); 
              }
            } catch (e) {}
          }
        } catch (e) {}
        
        // 4. Refresh Manage Production Orders modal if it's open
        try {
          const manageModal = document.getElementById('manage-production-orders-modal');
          if (manageModal && !manageModal.classList.contains('hidden')) {
            renderProductionOrdersList(productionOrders);
          }
        } catch (e) {}
        
        // 5. Refresh QC Signage modal if it's open
        try {
          const qcModal = document.getElementById('qc-signage-modal');
          if (qcModal && !qcModal.classList.contains('hidden') && typeof renderQcSignageModal === 'function') {
            renderQcSignageModal();
          }
        } catch (e) {}
        
        // 6. Clear pending flags everywhere
        try { 
          if (typeof clearPendingFlagsEverywhere === 'function') {
            clearPendingFlagsEverywhere(String(quoteKey || '')); 
          }
        } catch (_) {}
        
        console.log('[UPDATE] Updated quote in all modals:', quoteKey);
      } catch (error) {
        console.error('[UPDATE] Error updating quote in all modals:', error);
      }
    }

    // Form Submit
    document.getElementById('quote-form').addEventListener('submit', async function(e) {
      e.preventDefault();
      const isEditing = !!currentEditingQuoteKey;
      let globalLoadingToken = null;
      try {
        if (window.QcLoading && typeof window.QcLoading.show === 'function') {
          globalLoadingToken = window.QcLoading.show('Đang lưu...');
        }
      } catch (e) {}
      
      // Wait for maquette upload to complete before proceeding
      if (window.maquetteUploadInProgress) {
        try {
          if (window.QcLoading && typeof window.QcLoading.show === 'function') {
            if (globalLoadingToken) window.QcLoading.hide(globalLoadingToken);
            globalLoadingToken = window.QcLoading.show('Đang tải ảnh lên...');
          }
        } catch (e) {}
        // Poll every 200ms for max 30 seconds
        let waitCount = 0;
        while (window.maquetteUploadInProgress && waitCount < 150) {
          await new Promise(resolve => setTimeout(resolve, 200));
          waitCount++;
        }
        try {
          if (window.QcLoading && typeof window.QcLoading.show === 'function') {
            if (globalLoadingToken) window.QcLoading.hide(globalLoadingToken);
            globalLoadingToken = window.QcLoading.show('Đang lưu...');
          }
        } catch (e) {}
      }
      if (!isEditing && currentQuotes.length >= 999) {
        showToast('Đã đạt giới hạn 999 báo giá. Vui lòng xóa bớt báo giá cũ.');
        try { if (globalLoadingToken && window.QcLoading) window.QcLoading.hide(globalLoadingToken); } catch (e) {}
        return;
      }

      const submitBtn = document.getElementById('submit-btn');
      const submitText = document.getElementById('submit-text');
      const submitSpinner = document.getElementById('submit-spinner');
      submitBtn.disabled = true;
      submitSpinner.classList.remove('hidden');
      submitText.textContent = 'Đang lưu...';

      const container = document.getElementById('items-container');
      const itemElements = container.querySelectorAll('[data-item-id]');
      const items = Array.from(itemElements).map(item => ({
        code: item.querySelector('.item-code').value,
        content: item.querySelector('.item-content').value,
        brand: item.querySelector('.item-brand').value,
        width: item.querySelector('.item-width').value,
        height: item.querySelector('.item-height').value,
        quantity: item.querySelector('.item-quantity').value,
        unit: item.querySelector('.item-unit').value,
        price: item.querySelector('.item-price').value,
        total: item.querySelector('.item-total').value
      }));

      if (items.length === 0) {
        showToast('Vui lòng thêm ít nhất một hạng mục.');
        submitBtn.disabled = false;
        submitSpinner.classList.add('hidden');
        submitText.textContent = isEditing ? 'Lưu thay đổi' : 'Xác Nhận';
        try { if (globalLoadingToken && window.QcLoading) window.QcLoading.hide(globalLoadingToken); } catch (e) {}
        return;
      }

      const totalAmount = parseFloat(document.getElementById('total-amount').textContent.replace(/[^\d]/g, ''));
      const existingQuote = isEditing ? findQuoteByKey(currentEditingQuoteKey) : null;
      let quoteCode;
      try {
        // Priority: existing quote code > maquette upload code > pre-generated code > generate new
        // This ensures folder name consistency with uploaded maquette images
        quoteCode = existingQuote?.quote_code || maquetteUploadQuoteCode || newQuoteCodePreGenerated || generateQuoteCode();
      } catch (err) {
        showToast(err?.message || 'Không thể tạo mã báo giá mới');
        submitBtn.disabled = false;
        submitSpinner.classList.add('hidden');
        submitText.textContent = isEditing ? 'Lưu thay đổi' : 'Xác Nhận';
        try { if (globalLoadingToken && window.QcLoading) window.QcLoading.hide(globalLoadingToken); } catch (e) {}
        return;
      }
      const quoteId = existingQuote?.id || Date.now().toString();
      const createdAt = existingQuote?.created_at || new Date().toISOString();
      const spoNumber = existingQuote?.spo_number || '';
      const spoStatus = existingQuote?.spo_status || (spoNumber ? 'Chưa cập nhật trạng thái' : 'Chưa có SPO');

      const outletInput = document.getElementById('outlet-code');
      const normalizedOutletCode = normalizeOutletCode(outletInput ? outletInput.value : '');
      if (outletInput) outletInput.value = normalizedOutletCode;

      const quoteData = {
        ...(existingQuote || {}),
        __backendId: existingQuote?.__backendId,
        id: quoteId,
        quote_code: quoteCode,
        outlet_code: normalizedOutletCode,
        outlet_name: document.getElementById('outlet-name').value,
        spo_name: document.getElementById('spo-name').value.trim(),
        area: document.getElementById('area').value,
        outlet_phone: document.getElementById('outlet-phone').value.trim(),
        sale_type: window.saleType === 'TBA' ? 'TBA' : 'Sale (SR)',
        sale_code: document.getElementById('sale-code').value,
        sale_name: document.getElementById('sale-name').value,
        sale_phone: document.getElementById('sale-phone').value.trim(),
        ss_name: document.getElementById('ss-name').value,
        house_number: document.getElementById('house-number')?.value.trim() || '',
        street: document.getElementById('street-name')?.value.trim() || '',
        ward: document.getElementById('ward-hamlet')?.value.trim() || '',
        district: document.getElementById('commune-ward')?.value.trim() || '',
        province: document.getElementById('province-city')?.value.trim() || '',
        address: document.getElementById('full-address').textContent,
        items: JSON.stringify(items),
        images: JSON.stringify(window.currentQuoteImages || []),
        total_amount: totalAmount,
        created_at: createdAt,
        updated_at: new Date().toISOString(),
        spo_number: spoNumber,
        spo_status: spoStatus
      };

      // When user updates/saves the quote, clear the QCAG "needs update" overlay flags
      // (overlay is set by Acceptance Detail cancel/add actions and should disappear after quote is updated)
      try {
        delete quoteData.__updatedSinceQc;
        delete quoteData.__itemsChanged;
        delete quoteData.__imagesChanged;
        // If user submitted the quote, any "added_items_notes" were incorporated
        // into the saved quote content and should no longer signal a pending update.
        if (quoteData && quoteData.added_items_notes) delete quoteData.added_items_notes;
        // Persistently clear QCAG override when saving the quote
        quoteData.qcag_override_status = null;
        quoteData.qcag_note = null;
        quoteData.qcag_at = null;
        quoteData.__overrideClearing = true; // suppress UI flicker while backend clears
      } catch (e) {}
      // Also clear flags on the in-memory currentQuotes entry (so main list UI updates)
      try {
        const qKey = getQuoteKey && typeof getQuoteKey === 'function' ? getQuoteKey(quoteData) : (quoteData && (quoteData.quote_code || quoteData.id || quoteData.__backendId));
        if (qKey && Array.isArray(currentQuotes)) {
          const idx = currentQuotes.findIndex(q => (typeof getQuoteKey === 'function' ? getQuoteKey(q) : '') === String(qKey));
          if (idx >= 0) {
            delete currentQuotes[idx].__updatedSinceQc;
            delete currentQuotes[idx].__itemsChanged;
            delete currentQuotes[idx].__imagesChanged;
            if (currentQuotes[idx].added_items_notes) delete currentQuotes[idx].added_items_notes;
            currentQuotes[idx].qcag_override_status = null;
            currentQuotes[idx].qcag_note = null;
            currentQuotes[idx].qcag_at = null;
            currentQuotes[idx].__overrideClearing = true;
            try { updateMainList(); } catch (e) {}
              // If Acceptance Detail modal is open, re-render it so overlays update immediately
              try {
                const adm = document.getElementById && document.getElementById('acceptance-detail-modal');
                if (adm && !adm.classList.contains('hidden')) {
                  try { renderAcceptanceDetailModal(); } catch (e) {}
                  try { renderAcceptanceImages(); } catch (e) {}
                  try { window.__renderAcceptanceProductionOrders && window.__renderAcceptanceProductionOrders(); } catch (e) {}
                }
              } catch (e) {}
          }
        }
        // Clear any other cached copies (productionOrders, acceptance refs)
        try { clearPendingFlagsEverywhere(String(qKey || '')); } catch (_) {}
      } catch (e) {}
      try {
        console.log('[SUBMIT] cleared pending flags for', (typeof getQuoteKey === 'function' ? getQuoteKey(quoteData) : '<no-key>'), quoteData && {__updatedSinceQc: quoteData.__updatedSinceQc, __itemsChanged: quoteData.__itemsChanged, __imagesChanged: quoteData.__imagesChanged});
      } catch (e) {}
      cacheQuoteCode(getQuoteIdentityKey(quoteData), quoteCode);

      // If images were updated during this edit/create session, append a maquette update note
      try {
        if (window.quoteImagesUpdatedDuringEdit) {
          let notes = [];
          try { notes = JSON.parse(quoteData.added_items_notes || '[]') || []; } catch (e) { notes = []; }
          notes.push('Vừa update Maquette mới.');
          quoteData.added_items_notes = JSON.stringify(notes);
          // mark images changed so UI/overlays can react
          quoteData.__imagesChanged = true;
        }
      } catch (e) {}
      // reset session flag
      window.quoteImagesUpdatedDuringEdit = false;

      const pushQuoteToTop = (quote) => {
        if (!quote) return;
        ensureQuoteCodeForQuote(quote);
        const key = getQuoteKey(quote);
        const existingIdx = currentQuotes.findIndex(q => getQuoteKey(q) === key);
        if (existingIdx >= 0) {
          currentQuotes.splice(existingIdx, 1);
        }
        currentQuotes.unshift(quote);
        pendingJumpToFirstPage = true;
        listPage = 1;
        outletPage = 1;
        viewMode = 'list';
        updateMainList();
      };

      const buildEditSummary = (prev, next) => {
        if (!prev || !next) return '';
        const changes = [];
        const diff = (label, a, b) => {
          if ((a || '') !== (b || '')) changes.push(`${label}: '${a || '-'}' → '${b || '-'}'`);
        };

        diff('Outlet', prev.outlet_name, next.outlet_name);
        diff('Outlet code', prev.outlet_code, next.outlet_code);
        diff('Khu vực', prev.area, next.area);
        diff('Sale', prev.sale_name, next.sale_name);
        diff('Loại sale', prev.sale_type, next.sale_type);
        diff('Điện thoại outlet', prev.outlet_phone, next.outlet_phone);
        diff('Địa chỉ', prev.address, next.address);

        const parseItems = (q) => {
          try { const arr = JSON.parse(q.items || '[]'); return Array.isArray(arr) ? arr : []; } catch (_) { return []; }
        };
        const oldItems = parseItems(prev);
        const newItems = parseItems(next);
        const keyOf = (it) => `${it.code || ''}__${(it.content || '').toLowerCase()}`;
        const mapOld = new Map(oldItems.map(it => [keyOf(it), it]));
        const mapNew = new Map(newItems.map(it => [keyOf(it), it]));

        const added = [];
        const removed = [];
        mapNew.forEach((it, key) => { if (!mapOld.has(key)) added.push(it); });
        mapOld.forEach((it, key) => { if (!mapNew.has(key)) removed.push(it); });

        if (added.length) changes.push(`Thêm hạng mục: ${added.map(it => it.content || it.code || 'Không tên').join(', ')}`);
        if (removed.length) changes.push(`Xóa hạng mục: ${removed.map(it => it.content || it.code || 'Không tên').join(', ')}`);

        const oldTotalNum = parseFloat(prev.total_amount) || 0;
        const newTotalNum = parseFloat(next.total_amount) || 0;
        if (oldTotalNum !== newTotalNum) {
          changes.push(`Tổng tiền: ${formatCurrency(oldTotalNum)} → ${formatCurrency(newTotalNum)}`);
        }

        // If no explicit changes but same count, still log item count to give context
        if (!added.length && !removed.length && oldItems.length !== newItems.length) {
          changes.push(`Số hạng mục: ${oldItems.length} → ${newItems.length}`);
        }

        return changes.length ? `Chỉnh sửa báo giá:\n- ${changes.join('\n- ')}` : 'Chỉnh sửa báo giá (không thay đổi nội dung)';
      };

      try {
        if (!isEditing) {
          const createPromise = (window.dataSdk && typeof window.dataSdk.create === 'function')
            ? window.dataSdk.create(quoteData)
            : Promise.resolve({ isOk: false, error: new Error('Data SDK không khả dụng') });
          const timeout = new Promise(resolve => setTimeout(() => resolve({ isOk: false, error: new Error('Quá thời gian chờ lưu dữ liệu') }), 15000));
          const result = await Promise.race([createPromise, timeout]);

          if (result && result.isOk) {
            showToast('Đã tạo báo giá thành công!');
            // If backend returned the created quote, merge and push it so UI updates immediately
            try {
              const created = result.data || null;
              if (created) {
                const merged = Object.assign({}, quoteData || {}, (typeof created === 'object' ? created : {}));
                try { pushQuoteToTop(merged); } catch (e) { /* ignore push errors */ }
              }
            } catch (e) { /* ignore merge errors */ }

            newQuoteCodePreGenerated = null; // Clear after successful creation
            maquetteUploadQuoteCode = null; // Clear maquette upload code
            // Đóng modal NGAY LẬP TỨC để UI phản hồi nhanh
            closeModal();
            
            // Lưu images ở background (không block UI)
            // Persist any maquette images that were uploaded during create session
            try {
              const finalQuoteCode = (result && result.data && result.data.quote_code) ? result.data.quote_code : quoteCode;
              if (finalQuoteCode && Array.isArray(window.currentQuoteImages) && window.currentQuoteImages.length) {
                // Fire and forget - không await để tránh block
                saveQuoteImages(finalQuoteCode, window.currentQuoteImages, { render: false }).catch(e => { /* ignore save errors */ });
              }
            } catch (e) { /* ignore */ }
          } else {
            if (!window.dataSdk || typeof window.dataSdk.create !== 'function') {
              pushQuoteToTop({ ...quoteData });
              showToast('Đã lưu tạm vào bộ nhớ. Kết nối dữ liệu chưa sẵn sàng.');
              closeModal();
            } else {
              const msg = result && result.error ? (result.error.message || String(result.error)) : 'Lỗi không xác định';
              showToast(`Lỗi khi tạo báo giá: ${msg}`);
            }
          }
        } else {
          const updatePromise = (window.dataSdk && typeof window.dataSdk.update === 'function')
            ? window.dataSdk.update(quoteData)
            : Promise.resolve({ isOk: true, localOnly: true });
          const result = await updatePromise;
          const success = result && (result.isOk === true || result.isOk === undefined || result === true);
          if (!success && window.dataSdk && typeof window.dataSdk.update === 'function') {
            showToast('Lỗi khi cập nhật báo giá');
          } else {
            pushQuoteToTop({ ...quoteData });

            // Update quote in all modals and cached locations
            try {
              const qKey = getQuoteKey(quoteData);
              updateQuoteInAllModals(qKey, quoteData);
            } catch (e) {
              console.error('Error updating quote in all modals:', e);
            }

            const summary = buildEditSummary(existingQuote, quoteData);
            addSystemNoteForQuote(getQuoteKey(quoteData), summary);
            showToast(window.dataSdk && typeof window.dataSdk.update === 'function' ? 'Đã cập nhật báo giá' : 'Đã cập nhật (local)');
            closeModal();
            currentEditingQuoteKey = null;
            maquetteUploadQuoteCode = null; // Clear maquette upload code
            setQuoteModalMode('create');
          }
        }
      } catch (err) {
        console.error('Submit quote error:', err);
        showToast(`Lỗi khi lưu báo giá: ${err && err.message ? err.message : 'Không xác định'}`);
      } finally {
        submitBtn.disabled = false;
        submitSpinner.classList.add('hidden');
        submitText.textContent = isEditing ? 'Lưu thay đổi' : 'Xác Nhận';
        try { if (globalLoadingToken && window.QcLoading) window.QcLoading.hide(globalLoadingToken); } catch (e) {}
      }
    });

    // Backward-compatible wrapper; keep signature but use new renderers
    function renderQuotesList(/* quotes (unused) */) { updateMainList(); }

    // Prep collapsible rows lazily to avoid rendering cost up-front
    function prepareCollapsibleRow(row) {
      if (!row || row.dataset.collapseReady === '1') return;
      row.dataset.collapseReady = '1';
      row.classList.remove('hidden');
      row.classList.add('collapsible-row');
      if (!row.dataset.collapseGroup) {
        const id = row.id || '';
        if (id.startsWith('details-')) {
          row.dataset.collapseGroup = 'quote-details';
        } else if (id.startsWith('outlet_')) {
          row.dataset.collapseGroup = 'outlet';
        }
      }
      const cell = row.querySelector('td');
      if (!cell) return;
      const wrapper = document.createElement('div');
      wrapper.className = 'collapsible';
      while (cell.firstChild) {
        wrapper.appendChild(cell.firstChild);
      }
      cell.appendChild(wrapper);
      wrapper.style.maxHeight = '0px';
    }

    function __qcagBuildQuoteDetailsHtml(quote, rowKey) {
      if (!quote) {
        return '<div class="text-sm text-gray-500">Không tìm thấy dữ liệu chi tiết</div>';
      }
      let items = [];
      try {
        if (typeof __qcagSafeParseJsonArray === 'function') items = __qcagSafeParseJsonArray(quote.items);
        else items = JSON.parse(quote.items || '[]');
      } catch (e) { items = []; }
      if (!Array.isArray(items)) items = [];

      let imgs = [];
      try {
        if (typeof __qcagSafeParseJsonArray === 'function') imgs = __qcagSafeParseJsonArray(quote.images);
        else imgs = JSON.parse(quote.images || '[]');
      } catch (e) { imgs = []; }
      if (!Array.isArray(imgs)) imgs = [];

      const saleBadgeClass = quote.sale_type === 'TBA' ? 'bg-orange-100 text-orange-800' : 'bg-blue-100 text-blue-800';
      const created = quote.created_at ? new Date(quote.created_at).toLocaleDateString('vi-VN') : '';
      const addressHtml = (quote.address && quote.address !== 'Địa chỉ sẽ hiển thị tự động khi nhập')
        ? `<div><span class=\"font-medium text-gray-700\">Địa chỉ:</span> <span class=\"text-gray-600\">${quote.address}</span></div>`
        : '';

      const imagesHtml = (!imgs.length)
        ? '<div class="text-xs text-gray-400">Không có hình</div>'
        : `<div class="w-64 flex-shrink-0"><h4 class="font-semibold text-gray-800 mb-2 text-sm">Hình ảnh (${imgs.length})</h4><div class="grid grid-cols-2 gap-2">${imgs.map(im => {
            const data = (im && im.data) ? im.data : '';
            const name = (im && im.name) ? String(im.name) : '';
            const safeName = name.replace(/'/g, '&#39;');
            return `<div class=\"border rounded bg-white overflow-hidden cursor-pointer\" onclick=\"event.stopPropagation(); openImageViewer('${data}','${safeName}')\"><img src='${data}' alt='${safeName}' class=\"w-full h-24 object-cover\"></div>`;
          }).join('')}</div></div>`;

      const notesPreview = (typeof renderNotesPreviewHTML === 'function') ? renderNotesPreviewHTML(quote) : '';

      return `
        <div class="flex gap-3">
          <!-- Cột trái 75%: Chi tiết báo giá -->
          <div class="flex-[3] space-y-4">
            <div class="flex justify-between items-start gap-6">
              <div class="text-sm space-y-2">
                <div class="flex flex-wrap gap-4">
                  <div>
                    <span class="font-medium text-gray-700">Chức vụ:</span>
                    <span class="px-2 py-1 text-xs font-medium rounded ml-1 ${saleBadgeClass}">${quote.sale_type || 'Sale (SR)'}</span>
                  </div>
                  ${quote.sale_code ? `<div><span class=\"font-medium text-gray-700\">Mã Sale:</span> <span class=\"text-gray-600\">${quote.sale_code}</span></div>` : ''}
                  ${quote.sale_name ? `<div><span class=\"font-medium text-gray-700\">Tên Sale:</span> <span class=\"text-gray-600\">${quote.sale_name}</span></div>` : ''}
                  ${quote.ss_name ? `<div><span class=\"font-medium text-gray-700\">Tên SS:</span> <span class=\"text-gray-600\">${quote.ss_name}</span></div>` : ''}
                </div>
                <div class="flex flex-wrap gap-4 mt-2">
                  <div>
                    <span class="font-medium text-gray-700">Ngày tạo:</span>
                    <span class="text-gray-600">${created}</span>
                  </div>
                  ${quote.spo_number ? `<div><span class=\"font-medium text-gray-700\">Số SPO:</span> <span class=\"text-blue-600 font-medium\">${quote.spo_number}</span></div>` : ''}
                  ${addressHtml}
                </div>
              </div>
              ${imagesHtml}
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
                    ${items.map(item => {
                      const size = (item.width && item.height) ? `${item.width}m × ${item.height}m` : '-';
                      return `
                        <tr class="hover:bg-gray-50">
                          <td class="px-3 py-2 text-gray-900 font-medium">${item.code || ''}</td>
                          <td class="px-3 py-2 text-gray-700">${item.content || ''}</td>
                          <td class="px-3 py-2 text-gray-600">${item.brand || '-'}</td>
                          <td class="px-3 py-2 text-gray-600">${size}</td>
                          <td class="px-3 py-2 text-gray-900">${item.quantity || ''}</td>
                          <td class="px-3 py-2 text-gray-600">${item.unit || ''}</td>
                          <td class="px-3 py-2 text-gray-900">${formatCurrency(parseMoney(item.price) || 0)}</td>
                          <td class="px-3 py-2 text-blue-600 font-semibold">${formatCurrencyExact((parseMoney(item.price) || 0) * (parseNumber(item.quantity) || 0))}</td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              </div>
              <div class="flex justify-end">
                <span class="text-lg font-bold text-blue-600">Tổng cộng: ${formatCurrency(parseMoney(quote.total_amount)||0)}</span>
              </div>
            </div>
          </div>
          <!-- Cột phải 25%: Xem nhanh ghi chú -->
          <div class="flex-1 notes-preview" data-notes-preview="${rowKey}">${notesPreview}</div>
        </div>
      `;
    }

    function __qcagEnsureQuoteDetailsLoaded(detailRow, key) {
      if (!detailRow || !key) return;
      if (detailRow.dataset.detailsLoaded === '1') return;
      let quote = null;
      try {
        quote = currentQuotes.find(q => (typeof getQuoteKey === 'function') ? getQuoteKey(q) === key : false) || null;
      } catch (e) { quote = null; }

      const html = __qcagBuildQuoteDetailsHtml(quote, key);
      const panel = detailRow.querySelector('.collapsible');
      const td = detailRow.querySelector('td');
      if (panel) {
        panel.innerHTML = html;
      } else if (td) {
        td.innerHTML = html;
      }
      detailRow.dataset.detailsLoaded = '1';
    }

    const nextFrame = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb) => setTimeout(cb, 16);

    function getScrollContainer(el) {
      if (!el || typeof window === 'undefined') {
        return document.scrollingElement || document.documentElement || document.body;
      }
      let node = el.parentElement;
      while (node && node !== document.body) {
        const style = window.getComputedStyle(node);
        const overflowY = style.overflowY || style.overflow;
        if (/(auto|scroll)/i.test(overflowY) && node.scrollHeight > node.clientHeight + 2) {
          return node;
        }
        node = node.parentElement;
      }
      return document.scrollingElement || document.documentElement || document.body;
    }

    function measureRowOffset(row, container) {
      if (!row) return 0;
      const isRoot = container === document.body || container === document.documentElement || container === document.scrollingElement;
      const containerRect = isRoot ? null : container.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      return rowRect.top - (containerRect ? containerRect.top : 0);
    }

    function pinRowDuringAnimation(row, panel) {
      if (!row || !panel) return () => {};
      const scrollEl = getScrollContainer(row);
      const baseTop = measureRowOffset(row, scrollEl);
      let running = true;

      const tick = () => {
        if (!running) return;
        const currentTop = measureRowOffset(row, scrollEl);
        const delta = currentTop - baseTop;
        if (Math.abs(delta) > 0.25) {
          scrollEl.scrollTop += delta;
        }
        nextFrame(tick);
      };
      nextFrame(tick);

      const stop = () => { running = false; };
      const onEnd = (evt) => {
        if (evt && (evt.target !== panel || (evt.propertyName && evt.propertyName !== 'max-height'))) return;
        stop();
        panel.removeEventListener('transitionend', onEnd);
      };
      panel.addEventListener('transitionend', onEnd);
      setTimeout(stop, 900);
      return stop;
    }

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