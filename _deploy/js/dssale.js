(function () {
  function byId(id) { return document.getElementById(id); }

  function openDssaleModal() {
    const modal = byId('dssale-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    try { if (typeof ensureScrollLock === 'function') ensureScrollLock(); } catch (_) {}
  }

  function closeDssaleModal() {
    const modal = byId('dssale-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    try { if (typeof ensureScrollLock === 'function') ensureScrollLock(); } catch (_) {}
  }

  function bindOnce() {
    const openBtn = byId('dssale-btn');
    if (openBtn && !openBtn._bound) {
      openBtn._bound = true;
      openBtn.addEventListener('click', openDssaleModal);
    }
    const closeBtn = byId('close-dssale-modal');
    if (closeBtn && !closeBtn._bound) {
      closeBtn._bound = true;
      closeBtn.addEventListener('click', closeDssaleModal);
    }
  }

  window.openDssaleModal = openDssaleModal;
  window.closeDssaleModal = closeDssaleModal;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindOnce, { once: true });
  } else {
    bindOnce();
  }
})();
