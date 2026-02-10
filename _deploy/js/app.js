(function() {
  'use strict';

  var moduleParts = [
    './modules/app.offline-and-api-helpers.js',
    './modules/app.pending-orders-and-images.js',
    './modules/app.data-sync-and-list-render.js',
    './modules/app.quote-core-utils-and-production-modal.js',
    './modules/app.production-order-workflow.js',
    './modules/app.collapsible-and-ui-bindings.js',
    './modules/app.qc-signage-core.js',
    './modules/app.qc-signage-actions-and-init.js'
  ];

  function loadTextSync(path) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', path, false);
    xhr.send(null);
    if (xhr.status >= 200 && xhr.status < 300) return xhr.responseText;
    if (xhr.status === 0 && xhr.responseText) return xhr.responseText;
    throw new Error('HTTP ' + xhr.status + ' while loading ' + path);
  }

  function runGlobalScript(code, sourcePath) {
    (0, eval)(code + '\n//# sourceURL=' + sourcePath);
  }

  for (var i = 0; i < moduleParts.length; i++) {
    try {
      var source = loadTextSync(moduleParts[i]);
      runGlobalScript(source, moduleParts[i]);
    } catch (err) {
      console.error('[qcag] Failed to load module:', moduleParts[i], err);
      break;
    }
  }
})();
