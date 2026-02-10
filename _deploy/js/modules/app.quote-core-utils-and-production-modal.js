
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
        
