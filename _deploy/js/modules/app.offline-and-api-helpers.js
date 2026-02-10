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
