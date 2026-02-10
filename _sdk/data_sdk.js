(function() {
    'use strict';

    var DEFAULT_TIMEOUT_MS = 15000;
    var CACHE_KEY = 'qcag_cached_quotations_v1';
    var _lastKnownRows = [];

    function getListLimit() {
        try {
            var limit = Number(window && window.QCAG_QUOTATION_LIMIT != null ? window.QCAG_QUOTATION_LIMIT : 5000);
            if (!Number.isFinite(limit) || limit <= 0) limit = 5000;
            return Math.min(10000, Math.floor(limit));
        } catch (e) {
            return 5000;
        }
    }

    function getPageSize(limit) {
        try {
            var size = Number(window && window.QCAG_QUOTATION_PAGE_SIZE != null ? window.QCAG_QUOTATION_PAGE_SIZE : 100);
            if (!Number.isFinite(size) || size <= 0) size = 100;
            size = Math.min(200, Math.floor(size));
            if (limit && size > limit) size = limit;
            return size;
        } catch (e) {
            return Math.min(200, limit || 100);
        }
    }

    function getListQuery() {
        var limit = getListLimit();
        return '?limit=' + encodeURIComponent(String(limit));
    }

    function readCachedQuotations() {
        try {
            if (typeof localStorage === 'undefined') return [];
            var raw = localStorage.getItem(CACHE_KEY);
            if (!raw) return [];
            var parsed = safeJsonParse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            return [];
        }
    }

    function writeCachedQuotations(rows) {
        try {
            if (typeof localStorage === 'undefined') return;
            var arr = Array.isArray(rows) ? rows : [];
            // Store a lightweight summary in localStorage to avoid huge payloads in storage
            var light = arr.map(function(r) {
                try {
                    var imgs = 0;
                    try {
                        imgs = Array.isArray(r && r.images ? (typeof r.images === 'string' ? JSON.parse(r.images) : r.images) : []) ? (typeof r.images === 'string' ? JSON.parse(r.images).length : (r.images || []).length) : 0;
                    } catch (e) { imgs = 0; }
                    return {
                        id: r && (r.id != null ? r.id : r.__backendId != null ? r.__backendId : null),
                        quote_code: r && r.quote_code || null,
                        outlet_name: r && r.outlet_name || null,
                        area: r && r.area || null,
                        sale_name: r && r.sale_name || null,
                        created_at: r && r.created_at || null,
                        updated_at: r && r.updated_at || null,
                        qcag_status: r && r.qcag_status || null,
                        images_count: imgs
                    };
                } catch (e) {
                    return null;
                }
            }).filter(function(x){ return x != null; });
            localStorage.setItem(CACHE_KEY, JSON.stringify(light));
        } catch (e) {}
    }

    function getApiBaseUrl() {
        try {
            var base = (typeof window !== 'undefined' && window.API_BASE_URL) ? String(window.API_BASE_URL) : '';
            return base.replace(/\/+$/, '');
        } catch (e) {
            return '';
        }
    }

    function getWsUrl() {
        try {
            var base = getApiBaseUrl();
            if (!base) return '';
            // Convert http(s)://host[:port] -> ws(s)://host[:port]/ws
            var wsBase = base;
            if (wsBase.indexOf('https://') === 0) wsBase = 'wss://' + wsBase.slice('https://'.length);
            else if (wsBase.indexOf('http://') === 0) wsBase = 'ws://' + wsBase.slice('http://'.length);
            else if (wsBase.indexOf('wss://') !== 0 && wsBase.indexOf('ws://') !== 0) return '';
            return wsBase.replace(/\/+$/, '') + '/ws';
        } catch (e) {
            return '';
        }
    }

    function getSseUrl() {
        try {
            var base = getApiBaseUrl();
            if (!base) return '';
            return base.replace(/\/+$/, '') + '/events';
        } catch (e) {
            return '';
        }
    }

    function withTimeout(promise, ms) {
        var timeout = new Promise(function(resolve) {
            setTimeout(function() {
                resolve({ __timeout: true });
            }, ms);
        });
        return Promise.race([promise, timeout]);
    }

    function safeJsonParse(text) {
        try {
            return JSON.parse(text);
        } catch (e) {
            return null;
        }
    }

    function normalizeQuotationRow(row) {
        if (!row || typeof row !== 'object') return row;
        var out = {};
        for (var k in row) out[k] = row[k];

        // App uses __backendId heavily for lookups
        if (out.__backendId == null && out.id != null) out.__backendId = out.id;

        // IMPORTANT: keep acceptance image (qcag_image_url) separate from quotation images.

        return out;
    }

    function patchLocalQuotationFromResponse(resp) {
        try {
            if (!resp || typeof resp !== 'object') return false;
            var id = resp.id != null ? resp.id : (resp.__backendId != null ? resp.__backendId : null);
            if (id == null) return false;
            var found = false;
            for (var i = 0; i < _lastKnownRows.length; i++) {
                var r = _lastKnownRows[i];
                var rid = r && (r.__backendId != null ? r.__backendId : (r.id != null ? r.id : null));
                if (rid == null) continue;
                if (String(rid) === String(id)) {
                    // Merge all fields from response into local row
                    try {
                        for (var key in resp) {
                            if (resp.hasOwnProperty(key)) {
                                r[key] = resp[key];
                            }
                        }
                    } catch (e) {}
                    _lastKnownRows[i] = r;
                    found = true;
                    break;
                }
            }
            if (found) {
                try { writeCachedQuotations(_lastKnownRows); } catch (e) {}
                try { notifyDataChanged(_lastKnownRows); } catch (e) {}
            }
            return found;
        } catch (e) { return false; }
    }

    function fetchJson(path, options) {
        var base = getApiBaseUrl();
        if (!base) {
            return Promise.reject(new Error('API_BASE_URL is not set'));
        }

        var url = base + path;
        var opts = options || {};
        if (!opts.headers) opts.headers = {};

        // Default JSON handling
        if (opts.body != null && !opts.headers['Content-Type']) {
            opts.headers['Content-Type'] = 'application/json';
        }

        return fetch(url, opts).then(function(res) {
            if (!res.ok) {
                var err = new Error('HTTP ' + res.status + ' ' + res.statusText);
                err.status = res.status;
                throw err;
            }
            return res.text().then(function(t) {
                var parsed = safeJsonParse(t);
                return parsed != null ? parsed : t;
            });
        });
    }

    var _handler = null;

    var _ws = null;
    var _wsRetryMs = 500;
    var _wsRetryTimer = null;
    var _refreshTimer = null;
    var _lastInvalidateAt = 0;

    var _es = null;
    var _esRetryMs = 500;
    var _esRetryTimer = null;

    function clearEsRetry() {
        try {
            if (_esRetryTimer) clearTimeout(_esRetryTimer);
        } catch (e) {}
        _esRetryTimer = null;
    }

    function scheduleEsReconnect() {
        clearEsRetry();
        var ms = _esRetryMs;
        _esRetryMs = Math.min(15000, Math.floor(_esRetryMs * 1.7));
        _esRetryTimer = setTimeout(function() {
            _esRetryTimer = null;
            tryOpenSse();
        }, ms);
    }

    function handleInvalidateMessage(msg) {
        try {
            if (!msg || typeof msg !== 'object') return;
            
            // Handle pending_orders invalidation - forward to app handler
            if (msg.type === 'invalidate' && msg.resource === 'pending_orders') {
                try {
                    if (typeof window !== 'undefined' && typeof window.__qcagOnInvalidate === 'function') {
                        window.__qcagOnInvalidate(msg);
                    }
                } catch (e) {}
                return;
            }
            
            if (msg.type === 'invalidate' && msg.resource === 'quotations') {
                // Do NOT trigger full refresh here. Patch local cache when payload available.
                try {
                    var now = Date.now();
                    // Reduce debounce from 80ms to 20ms for faster realtime updates
                    if (now - _lastInvalidateAt < 20) return;
                    _lastInvalidateAt = now;
                    
                    // If backend provided id with delete action, remove locally
                    var deleteActions = ['delete', 'deleted'];
                    if (msg.id && msg.action && deleteActions.indexOf(String(msg.action).toLowerCase()) >= 0) {
                        try {
                            for (var i = 0; i < _lastKnownRows.length; i++) {
                                var rid = _lastKnownRows[i] && (_lastKnownRows[i].__backendId != null ? _lastKnownRows[i].__backendId : _lastKnownRows[i].id);
                                if (String(rid) === String(msg.id)) { _lastKnownRows.splice(i,1); break; }
                            }
                            try { writeCachedQuotations(_lastKnownRows); } catch (e) {}
                            try { notifyDataChanged(_lastKnownRows); } catch (e) {}
                        } catch (e) {}
                        return;
                    }
                    
                    // For create action with data - ADD new row to cache
                    if (msg.action === 'create' && msg.data) {
                        try {
                            var newRow = normalizeQuotationRow(msg.data);
                            // Check if not already in cache (avoid duplicates)
                            var exists = false;
                            var newId = newRow && (newRow.__backendId || newRow.id) || msg.id;
                            for (var i = 0; i < _lastKnownRows.length; i++) {
                                var rid = _lastKnownRows[i] && (_lastKnownRows[i].__backendId != null ? _lastKnownRows[i].__backendId : _lastKnownRows[i].id);
                                if (String(rid) === String(newId)) { exists = true; break; }
                            }
                            if (!exists && newRow) {
                                _lastKnownRows.unshift(newRow);
                                try { writeCachedQuotations(_lastKnownRows); } catch (e) {}
                                try { notifyDataChanged(_lastKnownRows); } catch (e) {}
                            }
                        } catch (e) {}
                        return;
                    }
                    
                    // For update action with data - patch existing row
                    if (msg.action === 'update' && msg.data) {
                        try { 
                            var patched = patchLocalQuotationFromResponse(msg.data);
                            // notifyDataChanged is called inside patchLocalQuotationFromResponse if found
                            if (!patched) {
                                // Row not found locally, might be new - add it
                                var newRow = normalizeQuotationRow(msg.data);
                                if (newRow && (newRow.__backendId || newRow.id)) {
                                    _lastKnownRows.unshift(newRow);
                                    try { writeCachedQuotations(_lastKnownRows); } catch (e) {}
                                    try { notifyDataChanged(_lastKnownRows); } catch (e) {}
                                }
                            }
                        } catch (e) {}
                        return;
                    }
                    
                    // If backend provided row data without action, try patch first then add
                    if (msg.data) {
                        try { 
                            var patched = patchLocalQuotationFromResponse(msg.data); 
                            if (!patched) {
                                // Not found - add as new row
                                var newRow = normalizeQuotationRow(msg.data);
                                if (newRow && (newRow.__backendId || newRow.id)) {
                                    _lastKnownRows.unshift(newRow);
                                    try { writeCachedQuotations(_lastKnownRows); } catch (e) {}
                                    try { notifyDataChanged(_lastKnownRows); } catch (e) {}
                                }
                            }
                        } catch (e) {}
                        return;
                    }
                    
                    // For create/update without data payload, trigger refresh
                    if (msg.action === 'create' || msg.action === 'update') {
                        scheduleRefreshQuotations(100);
                    }
                } catch (e) {}
            }
        } catch (e) {}
    }

    function scheduleRefreshQuotations(delayMs) {
        try {
            var ms = Number(delayMs);
            if (!(ms >= 0)) ms = 200;
            if (_refreshTimer) clearTimeout(_refreshTimer);
            _refreshTimer = setTimeout(function() {
                _refreshTimer = null;
                loadQuotationsAndNotify().catch(function() {});
            }, ms);
        } catch (e) {}
    }

    function clearWsRetry() {
        try {
            if (_wsRetryTimer) clearTimeout(_wsRetryTimer);
        } catch (e) {}
        _wsRetryTimer = null;
    }

    function scheduleWsReconnect() {
        clearWsRetry();
        var ms = _wsRetryMs;
        _wsRetryMs = Math.min(15000, Math.floor(_wsRetryMs * 1.7));
        _wsRetryTimer = setTimeout(function() {
            _wsRetryTimer = null;
            tryOpenWs();
        }, ms);
    }

    function tryOpenWs() {
        try {
            if (typeof window === 'undefined') return;
            if (typeof WebSocket === 'undefined') return;
            if (_ws && (_ws.readyState === 0 || _ws.readyState === 1)) return;

            var url = getWsUrl();
            if (!url) return;

            _ws = new WebSocket(url);

            _ws.onopen = function() {
                _wsRetryMs = 500;
                try { console.log('[data_sdk] WebSocket opened', url); } catch (e) {}
            };

            _ws.onmessage = function(ev) {
                try {
                    var raw = ev && ev.data != null ? String(ev.data) : '';
                    try { console.debug('[data_sdk] WS message', raw); } catch (e) {}
                    var msg = safeJsonParse(raw);
                    handleInvalidateMessage(msg);
                } catch (e) { try { console.warn('[data_sdk] WS message parse error', e); } catch (_) {} }
            };

            _ws.onclose = function(ev) {
                try { console.log('[data_sdk] WebSocket closed', ev && ev.code); } catch (e) {}
                scheduleWsReconnect();
            };

            _ws.onerror = function(err) {
                try { console.warn('[data_sdk] WebSocket error', err); } catch (e) {}
                // close will usually follow; ensure reconnect anyway.
                try { _ws && _ws.close(); } catch (e) {}
            };
        } catch (e) {
            scheduleWsReconnect();
        }
    }

    function tryOpenSse() {
        try {
            if (typeof window === 'undefined') return;
            if (typeof EventSource === 'undefined') return;
            if (_es) return;

            var url = getSseUrl();
            if (!url) return;

            _es = new EventSource(url);

            _es.onopen = function() {
                _esRetryMs = 500;
            };

            // We emit named event "invalidate" from the backend.
            _es.addEventListener('invalidate', function(ev) {
                try {
                    var msg = safeJsonParse(ev && ev.data != null ? String(ev.data) : '');
                    handleInvalidateMessage(msg);
                } catch (e) {}
            });

            _es.onerror = function() {
                try { _es && _es.close(); } catch (e) {}
                _es = null;
                scheduleEsReconnect();
            };
        } catch (e) {
            try { _es && _es.close(); } catch (_) {}
            _es = null;
            scheduleEsReconnect();
        }
    }

    function notifyDataChanged(rows) {
        try {
            if (_handler && typeof _handler.onDataChanged === 'function') {
                _handler.onDataChanged(rows);
            }
        } catch (e) {
            // ignore
        }
    }

    async function fetchAllQuotations(limit) {
        var pageSize = getPageSize(limit);
        var collected = [];
        var beforeId = null;
        var beforeCreatedAt = null;
        var guard = 0;
        var guardMax = Math.min(200, Math.ceil(limit / pageSize) + 5);

        while (collected.length < limit && guard < guardMax) {
            var remaining = limit - collected.length;
            var fetchSize = Math.min(pageSize, remaining);
            var query = '?limit=' + encodeURIComponent(String(fetchSize));
            if (beforeCreatedAt) {
                query += '&before_created_at=' + encodeURIComponent(String(beforeCreatedAt));
            }
            if (beforeId != null) {
                query += '&before_id=' + encodeURIComponent(String(beforeId));
            }
            var page = await fetchJson('/quotations' + query, { method: 'GET' });
            var arr = Array.isArray(page) ? page : [];
            if (!arr.length) break;
            collected = collected.concat(arr);

            var last = arr[arr.length - 1];
            var lastId = last && (last.id != null ? last.id : last.__backendId);
            var lastCreated = last && last.created_at ? last.created_at : null;
            if (!lastId && !lastCreated) break;
            if (lastId === beforeId && lastCreated === beforeCreatedAt) break;
            beforeId = lastId != null ? lastId : beforeId;
            beforeCreatedAt = lastCreated != null ? lastCreated : beforeCreatedAt;

            if (arr.length < fetchSize) break;
            guard++;
        }

        return collected;
    }

    async function loadQuotationsAndNotify() {
        try {
            var limit = getListLimit();
            var data = await fetchAllQuotations(limit);
            var normalized = (Array.isArray(data) ? data : []).map(normalizeQuotationRow);
            _lastKnownRows = normalized;
            writeCachedQuotations(normalized);
            notifyDataChanged(normalized);
            return normalized;
        } catch (err) {
            var cached = readCachedQuotations();
            var fallback = (Array.isArray(cached) && cached.length) ? cached : _lastKnownRows;
            notifyDataChanged(fallback);
            return fallback;
        }
    }

    async function tryJsonMethod(path, method, bodyObj) {
        try {
            var result = await withTimeout(fetchJson(path, {
                method: method,
                body: bodyObj != null ? JSON.stringify(bodyObj) : undefined
            }), DEFAULT_TIMEOUT_MS);

            if (result && result.__timeout) {
                var to = new Error('Request timeout');
                to.code = 'TIMEOUT';
                throw to;
            }

            return { ok: true, data: result };
        } catch (err) {
            return { ok: false, error: err };
        }
    }

    var dataSdk = {
        init: async function(handler) {
            _handler = handler || null;
            try {
                await loadQuotationsAndNotify();
                tryOpenWs();
                // SSE fallback for environments where WS upgrade is blocked.
                tryOpenSse();
                return { isOk: true };
            } catch (err) {
                console.error('dataSdk.init failed:', err);
                return { isOk: false, error: err };
            }
        },

        create: async function(obj) {
            // Backend at minimum supports POST /quotations to create a row and return { ok, id, quote_code }.
            // Some deployments may ignore the body; still send it for forward-compatibility.
            var payload = obj && typeof obj === 'object' ? obj : {};
            var res = await tryJsonMethod('/quotations', 'POST', payload);
            if (res.ok) {
                    try {
                        if (res.data) {
                            // For create, we need to ADD the new row to cache, not just patch
                            var newRow = normalizeQuotationRow(res.data);
                            if (newRow && newRow.id != null) {
                                // Check if not already exists (avoid duplicates)
                                var exists = false;
                                var newId = newRow.__backendId || newRow.id;
                                for (var i = 0; i < _lastKnownRows.length; i++) {
                                    var rid = _lastKnownRows[i] && (_lastKnownRows[i].__backendId != null ? _lastKnownRows[i].__backendId : _lastKnownRows[i].id);
                                    if (String(rid) === String(newId)) { exists = true; break; }
                                }
                                if (!exists) {
                                    _lastKnownRows.unshift(newRow);
                                    try { writeCachedQuotations(_lastKnownRows); } catch (e) {}
                                    try { notifyDataChanged(_lastKnownRows); } catch (e) {}
                                }
                            }
                        }
                    } catch (e) {}
                    return { isOk: true, data: res.data };
            }
            return { isOk: false, error: res.error };
        },

        update: async function(obj) {
            // Try a few common update patterns (some backends support them). If none exist, fall back to local-only.
            var id = null;
            try {
                if (obj && typeof obj === 'object') {
                    if (obj.__backendId != null) id = obj.__backendId;
                    else if (obj.id != null) id = obj.id;
                }
            } catch (e) {}

            // QCAG-only submit support (known deployed route)
            // Accept either explicit {quote_ids,status,note} or derive from {id,qcag_override_status,qcag_note}
            if (obj && typeof obj === 'object') {
                if (Array.isArray(obj.quote_ids) && obj.status) {
                    var resSubmit = await tryJsonMethod('/qcag/submit', 'POST', {
                        quote_ids: obj.quote_ids,
                        status: obj.status,
                        note: obj.note || null
                    });
                    if (resSubmit.ok) {
                        try {
                            if (resSubmit.data) {
                                if (Array.isArray(resSubmit.data)) resSubmit.data.forEach(function(d){ try { patchLocalQuotationFromResponse(d);}catch(e){} });
                                else patchLocalQuotationFromResponse(resSubmit.data);
                            }
                        } catch (e) {}
                        return { isOk: true, data: resSubmit.data };
                    }
                }
                // Only use /qcag/submit when we have a non-empty status.
                // IMPORTANT: When clearing qcag_override_status (null/''), do NOT call /qcag/submit (it requires status).
                // Let the generic PATCH /quotations/:id handle clearing fields.
                if (id != null) {
                    var desiredStatus = null;
                    try {
                        // IMPORTANT:
                        // - Only derive QCAG override submit status from qcag_override_status.
                        // - Do NOT fall back to obj.status here because many quote objects may carry
                        //   a generic/status UI field that is unrelated to QCAG override.
                        // This avoids accidentally re-submitting an override when the caller is
                        // trying to clear qcag_override_status (null/''), which would then appear
                        // again after refresh.
                        if (obj.qcag_override_status != null) desiredStatus = String(obj.qcag_override_status).trim();
                    } catch (e) { desiredStatus = null; }

                    if (desiredStatus) {
                        var resSubmit2 = await tryJsonMethod('/qcag/submit', 'POST', {
                            quote_ids: [id],
                            status: desiredStatus,
                            note: obj.qcag_note || obj.note || null
                        });
                        if (resSubmit2.ok) {
                            try {
                                if (resSubmit2.data) {
                                    if (Array.isArray(resSubmit2.data)) resSubmit2.data.forEach(function(d){ try { patchLocalQuotationFromResponse(d);}catch(e){} });
                                    else patchLocalQuotationFromResponse(resSubmit2.data);
                                }
                            } catch (e) {}
                            return { isOk: true, data: resSubmit2.data };
                        }
                    }
                }
            }

            // Generic update attempts
            var clean = obj;
            if (obj && typeof obj === 'object') {
                clean = {};
                for (var k in obj) {
                    if (k === '__backendId') continue;
                    clean[k] = obj[k];
                }
            }

            if (id != null) {
                var candidates = [
                    { path: '/quotations/' + encodeURIComponent(String(id)), method: 'PATCH' },
                    { path: '/quotations/' + encodeURIComponent(String(id)), method: 'PUT' },
                    { path: '/quotations', method: 'PATCH' },
                    { path: '/quotations', method: 'PUT' }
                ];

                for (var i = 0; i < candidates.length; i++) {
                    var c = candidates[i];
                    var r = await tryJsonMethod(c.path, c.method, clean);
                    if (r.ok) {
                        try {
                            if (r.data) {
                                if (Array.isArray(r.data)) r.data.forEach(function(d){ try { patchLocalQuotationFromResponse(d);}catch(e){} });
                                else patchLocalQuotationFromResponse(r.data);
                            }
                        } catch (e) {}
                        return { isOk: true, data: r.data };
                    }
                    // If not found, keep trying other patterns; otherwise break only on non-404?
                    if (r.error && r.error.status && r.error.status !== 404) {
                        // non-route error (e.g., 400/500) -> return it
                        return { isOk: false, error: r.error };
                    }
                }
            }

            return { isOk: true, localOnly: true };
        },

        delete: async function(obj) {
            var id = null;
            try {
                if (obj && typeof obj === 'object') {
                    if (obj.__backendId != null) id = obj.__backendId;
                    else if (obj.id != null) id = obj.id;
                }
            } catch (e) {}

            if (id == null) return { isOk: true, localOnly: true };

            var r1 = await tryJsonMethod('/quotations/' + encodeURIComponent(String(id)), 'DELETE');
            if (r1.ok) {
                try {
                    // remove from local cache by id
                    for (var i = 0; i < _lastKnownRows.length; i++) {
                        var rid = _lastKnownRows[i] && (_lastKnownRows[i].__backendId != null ? _lastKnownRows[i].__backendId : _lastKnownRows[i].id);
                        if (String(rid) === String(id)) { _lastKnownRows.splice(i,1); break; }
                    }
                    try { writeCachedQuotations(_lastKnownRows); } catch (e) {}
                    try { notifyDataChanged(_lastKnownRows); } catch (e) {}
                } catch (e) {}
                return { isOk: true, data: r1.data };
            }

            // Some backends support DELETE /quotations?id=...
            var r2 = await tryJsonMethod('/quotations?id=' + encodeURIComponent(String(id)), 'DELETE');
            if (r2.ok) {
                try {
                    for (var j = 0; j < _lastKnownRows.length; j++) {
                        var rid2 = _lastKnownRows[j] && (_lastKnownRows[j].__backendId != null ? _lastKnownRows[j].__backendId : _lastKnownRows[j].id);
                        if (String(rid2) === String(id)) { _lastKnownRows.splice(j,1); break; }
                    }
                    try { writeCachedQuotations(_lastKnownRows); } catch (e) {}
                    try { notifyDataChanged(_lastKnownRows); } catch (e) {}
                } catch (e) {}
                return { isOk: true, data: r2.data };
            }

            // If delete isn't supported, keep UI unblocked.
            if (r1.error && r1.error.status && r1.error.status !== 404) {
                return { isOk: false, error: r1.error };
            }
            if (r2.error && r2.error.status && r2.error.status !== 404) {
                return { isOk: false, error: r2.error };
            }

            return { isOk: true, localOnly: true };
        }
        ,
        getImages: async function(objOrId) {
            try {
                var id = null;
                if (objOrId == null) return { isOk: false, error: new Error('missing_id') };
                if (typeof objOrId === 'object') {
                    id = objOrId.__backendId != null ? objOrId.__backendId : (objOrId.id != null ? objOrId.id : null);
                } else {
                    id = objOrId;
                }
                if (id == null) return { isOk: false, error: new Error('invalid_id') };
                var path = '/quotations/' + encodeURIComponent(String(id)) + '/images';
                var r = await tryJsonMethod(path, 'GET');
                if (r.ok) {
                    var images = r.data && r.data.images ? r.data.images : [];
                    return { isOk: true, images: Array.isArray(images) ? images : [] };
                }
                return { isOk: false, error: r.error };
            } catch (e) {
                return { isOk: false, error: e };
            }
        }
    };

    window.dataSdk = dataSdk;

    // Debug helper to inspect current WS/SSE state from browser console
    try {
        window.__qcagDataSdkStatus = function() {
            try {
                return {
                    hasHandler: !!_handler,
                    lastKnownRows: Array.isArray(_lastKnownRows) ? _lastKnownRows.length : 0,
                    wsState: (_ws ? (_ws.readyState != null ? _ws.readyState : null) : null),
                    esActive: !!_es,
                    lastInvalidateAt: _lastInvalidateAt || 0,
                    wsRetryMs: _wsRetryMs || 0,
                    esRetryMs: _esRetryMs || 0
                };
            } catch (e) { return { error: String(e) }; }
        };
    } catch (e) {}

})();