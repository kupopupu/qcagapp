(function(){
  const STORAGE_KEY = 'qcag_test_mode_enabled';
  const LOCAL_ITEMS_KEY = 'qcag_local_test_mode_items_v1';

  function safeParse(raw, fallback){
    try{const p = JSON.parse(raw); return p==null?fallback:p;}catch(e){return fallback;}
  }

  function createLocalSdk(storageKey){
    const key = storageKey || LOCAL_ITEMS_KEY;
    const loadAll = ()=> safeParse(localStorage.getItem(key), []);
    const saveAll = (items)=>{ try{ localStorage.setItem(key, JSON.stringify(Array.isArray(items)?items:[])); return true;}catch(e){console.warn('saveAll failed',e); return false;} };
    const ensureId = (obj)=>{
      if(!obj||typeof obj!=='object') return obj;
      if(!obj.__backendId) obj.__backendId = `local_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      return obj;
    };
    const findIndexById = (items,obj)=>{
      const backendId = obj && obj.__backendId ? String(obj.__backendId) : '';
      if(backendId) return items.findIndex(it=>it && String(it.__backendId||'')===backendId);
      const id = obj && obj.id ? String(obj.id) : '';
      if(id) return items.findIndex(it=>it && String(it.id||'')===id);
      return -1;
    };
    let handler = null;
    function notify(items){ try{ if(handler && typeof handler.onDataChanged==='function') handler.onDataChanged(Array.isArray(items)?items:[]);}catch(e){} }

    return {
      init: async(h)=>{ handler = h || null; const items = loadAll(); notify(items); return { isOk:true, local:true }; },
      create: async(obj)=>{ if(!obj||typeof obj!=='object') return { isOk:false, error:new Error('Invalid create payload')}; ensureId(obj); const items = loadAll(); const idx = findIndexById(items,obj); const clone = {...obj}; if(idx>=0) items[idx] = {...items[idx],...clone}; else items.push(clone); const ok = saveAll(items); notify(items); return { isOk:ok, local:true, data: clone }; },
      update: async(obj)=>{ if(!obj||typeof obj!=='object') return { isOk:false, error:new Error('Invalid update payload')}; ensureId(obj); const items = loadAll(); const idx = findIndexById(items,obj); const clone = {...obj}; if(idx>=0) items[idx] = {...items[idx],...clone}; else items.push(clone); const ok = saveAll(items); notify(items); return { isOk:ok, local:true, data: clone }; },
      delete: async(obj)=>{ const items = loadAll(); const idx = findIndexById(items,obj||{}); if(idx>=0) items.splice(idx,1); const ok = saveAll(items); notify(items); return { isOk:ok, local:true }; },
      list: async()=>{ const items = loadAll(); return { isOk:true, local:true, data: items }; }
    };
  }

  function showBanner(on){
    try{
      const b = document.getElementById('offline-banner');
      if(!b) return;
      if(on) b.classList.remove('hidden'); else b.classList.add('hidden');
    }catch(e){}
  }

  function setTestMode(on){
    window.__offlineTestMode = !!on;
    try{ localStorage.setItem(STORAGE_KEY, window.__offlineTestMode ? '1' : '0'); }catch(e){}
    showBanner(window.__offlineTestMode);
    const btn = document.getElementById('toggle-test-mode-btn');
    if(btn) btn.textContent = window.__offlineTestMode ? 'TEST: ON' : 'TEST: OFF';

    if(window.__offlineTestMode){
      if(!window.__originalDataSdk) window.__originalDataSdk = window.dataSdk;
      if(!window.__localTestDataSdk) window.__localTestDataSdk = createLocalSdk(LOCAL_ITEMS_KEY);
      try{ window.dataSdk = window.__localTestDataSdk; }catch(e){console.warn('Failed to set local dataSdk',e); }
    } else {
      try{ if(window.__originalDataSdk) window.dataSdk = window.__originalDataSdk; else delete window.dataSdk; }catch(e){console.warn('Failed to restore dataSdk',e); }
      window.__originalDataSdk = null;
    }
  }

  document.addEventListener('DOMContentLoaded', function(){
    const btn = document.getElementById('toggle-test-mode-btn');
    if(btn) btn.addEventListener('click', function(){ setTestMode(!window.__offlineTestMode); });
    try{ const saved = localStorage.getItem(STORAGE_KEY); setTestMode(saved === '1'); }catch(e){ setTestMode(false); }
  });
})();
