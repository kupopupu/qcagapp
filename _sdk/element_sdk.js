(function() {
    'use strict';

    var STORAGE_KEY = 'qcag_element_config_v1';
    var _config = {};
    var _defaultConfig = {};
    var _onConfigChange = null;

    function safeJsonParse(text) {
        try {
            return JSON.parse(text);
        } catch (e) {
            return null;
        }
    }

    function readStoredConfig() {
        try {
            var raw = window.localStorage ? window.localStorage.getItem(STORAGE_KEY) : null;
            if (!raw) return null;
            var parsed = safeJsonParse(raw);
            return parsed && typeof parsed === 'object' ? parsed : null;
        } catch (e) {
            return null;
        }
    }

    function writeStoredConfig(cfg) {
        try {
            if (!window.localStorage) return;
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg || {}));
        } catch (e) {
            // ignore
        }
    }

    function merge(a, b) {
        var out = {};
        if (a && typeof a === 'object') {
            for (var k in a) out[k] = a[k];
        }
        if (b && typeof b === 'object') {
            for (var k2 in b) out[k2] = b[k2];
        }
        return out;
    }

    async function emitChange() {
        try {
            if (typeof _onConfigChange === 'function') {
                await _onConfigChange(_config);
            }
        } catch (e) {
            console.warn('elementSdk onConfigChange error:', e);
        }
    }

    var elementSdk = {
        init: function(opts) {
            opts = opts || {};
            _defaultConfig = opts.defaultConfig && typeof opts.defaultConfig === 'object' ? opts.defaultConfig : {};
            _onConfigChange = typeof opts.onConfigChange === 'function' ? opts.onConfigChange : null;

            var stored = readStoredConfig();
            _config = merge(_defaultConfig, stored || {});

            // Immediately apply config to UI.
            emitChange();

            return { isOk: true, config: _config };
        },

        setConfig: function(partial) {
            if (!partial || typeof partial !== 'object') return Promise.resolve({ isOk: true });
            _config = merge(_config, partial);
            writeStoredConfig(_config);
            return emitChange().then(function() {
                return { isOk: true, config: _config };
            });
        }
    };

    window.elementSdk = elementSdk;
})();