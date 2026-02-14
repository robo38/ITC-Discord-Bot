/* ─── ITC Bot Dashboard — Global JS ───────────────────────────────── */

// ─── Dropdown toggle ──────────────────────────────────────────
document.addEventListener('click', function(e) {
    document.querySelectorAll('.dropdown-wrapper.open').forEach(function(el) {
        if (!el.contains(e.target)) el.classList.remove('open');
    });
    var trigger = e.target.closest('.dropdown-trigger');
    if (trigger) {
        e.stopPropagation();
        var wrapper = trigger.closest('.dropdown-wrapper');
        var wasOpen = wrapper.classList.contains('open');
        document.querySelectorAll('.dropdown-wrapper.open').forEach(function(el) { el.classList.remove('open'); });
        if (!wasOpen) wrapper.classList.add('open');
    }
});

// ─── Custom select styling ────────────────────────────────────
document.querySelectorAll('select').forEach(function(sel) {
    sel.style.appearance = 'none';
    sel.style.webkitAppearance = 'none';
    sel.style.backgroundImage = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23a08a8e' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E\")";
    sel.style.backgroundRepeat = 'no-repeat';
    sel.style.backgroundPosition = 'right 14px center';
    sel.style.paddingRight = '38px';
    sel.style.borderRadius = '12px';
    if (!sel.style.height) sel.style.height = '42px';
});

// ─── Global Toast Utility ─────────────────────────────────────
window._toast = function(msg) {
    var t = document.getElementById('globalCopyToast') || document.getElementById('copyToast');
    if (!t) return;
    t.textContent = msg || 'Done';
    t.classList.add('show');
    setTimeout(function() { t.classList.remove('show'); }, 2200);
};

// ─── Global Copy-to-clipboard ─────────────────────────────────
document.addEventListener('click', function(e) {
    var el = e.target.closest('.copy-text');
    if (el) {
        var val = el.dataset.copy || el.textContent.trim();
        navigator.clipboard.writeText(val).then(function() { window._toast('Copied: ' + val); });
    }
});

// ─── Global Snackbar System ───────────────────────────────────
window._snackbar = {
    _el: null,
    _titleEl: null,
    _optsEl: null,
    _callback: null,
    init: function() {
        this._el = document.getElementById('globalSnackbar');
        this._titleEl = document.getElementById('snackbarTitle');
        this._optsEl = document.getElementById('snackbarOptions');
    },
    show: function(title, options, callback) {
        if (!this._el) this.init();
        this._titleEl.textContent = title;
        this._optsEl.innerHTML = '';
        this._callback = callback;
        var self = this;
        options.forEach(function(opt) {
            var btn = document.createElement('button');
            btn.className = 'snackbar-option';
            btn.textContent = opt.label;
            btn.addEventListener('click', function() {
                self._optsEl.querySelectorAll('.snackbar-option').forEach(function(b) { b.classList.remove('selected'); });
                btn.classList.add('selected');
                if (self._callback) self._callback(opt.value);
                setTimeout(function() { self.hide(); }, 400);
            });
            self._optsEl.appendChild(btn);
        });
        this._el.classList.add('show');
    },
    hide: function() {
        if (this._el) this._el.classList.remove('show');
    }
};

// ─── Global Context Menu Engine ───────────────────────────────
window._ctxMenu = {
    _el: null,
    _handlers: {},
    init: function() {
        this._el = document.getElementById('globalCtxMenu');
        var self = this;
        document.addEventListener('click', function() { self.close(); });
        document.addEventListener('scroll', function() { self.close(); }, true);
        document.addEventListener('keydown', function(e) { if (e.key === 'Escape') self.close(); });
    },
    close: function() {
        if (this._el) this._el.classList.remove('open');
    },
    open: function(e, items, context) {
        e.preventDefault();
        e.stopPropagation();
        if (!this._el) this.init();
        this._el.innerHTML = '';
        var self = this;
        items.forEach(function(item) {
            if (item.divider) {
                var d = document.createElement('div');
                d.className = 'ctx-menu-divider';
                self._el.appendChild(d);
                return;
            }
            // Submenu support
            if (item.children && item.children.length) {
                var wrapper = document.createElement('div');
                wrapper.className = 'ctx-menu-item ctx-menu-parent' + (item.danger ? ' danger' : '');
                wrapper.innerHTML = (item.icon || '') + ' ' + item.label + '<span class="ctx-arrow">▸</span>';
                var sub = document.createElement('div');
                sub.className = 'ctx-submenu';
                item.children.forEach(function(child) {
                    if (child.divider) {
                        var cd = document.createElement('div');
                        cd.className = 'ctx-menu-divider';
                        sub.appendChild(cd);
                        return;
                    }
                    var cdiv = document.createElement('div');
                    cdiv.className = 'ctx-menu-item' + (child.danger ? ' danger' : '');
                    cdiv.innerHTML = (child.icon || '') + ' ' + child.label;
                    cdiv.addEventListener('click', function(ev) {
                        ev.stopPropagation();
                        self.close();
                        if (child.action) child.action(context);
                    });
                    sub.appendChild(cdiv);
                });
                wrapper.appendChild(sub);
                self._el.appendChild(wrapper);
                return;
            }
            var div = document.createElement('div');
            div.className = 'ctx-menu-item' + (item.danger ? ' danger' : '');
            div.innerHTML = (item.icon || '') + ' ' + item.label;
            div.addEventListener('click', function(ev) {
                ev.stopPropagation();
                self.close();
                if (item.action) item.action(context);
            });
            self._el.appendChild(div);
        });
        this._el.style.left = e.clientX + 'px';
        this._el.style.top = e.clientY + 'px';
        this._el.classList.add('open');
        var self2 = this;
        setTimeout(function() {
            var rect = self2._el.getBoundingClientRect();
            if (rect.right > window.innerWidth) self2._el.style.left = (e.clientX - rect.width) + 'px';
            if (rect.bottom > window.innerHeight) self2._el.style.top = (e.clientY - rect.height) + 'px';
        }, 0);
    }
};
window._ctxMenu.init();

// ─── SVG icon helpers for context menu ────────────────────────
window._ctxIcons = {
    view: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
    members: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    toggle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    reconnect: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>',
    disconnect: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16.5 12a4.5 4.5 0 0 0-9 0"/><line x1="1" y1="1" x2="23" y2="23"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    trophy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 22V8h4v14"/><path d="M6 2h12v7a6 6 0 0 1-12 0V2z"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>'
};

// ─── Hamburger menu toggle ────────────────────────────────────
document.addEventListener('click', function(e) {
    var hamburger = e.target.closest('.navbar-hamburger');
    if (hamburger) {
        var links = document.querySelector('.navbar-links');
        if (links) links.classList.toggle('open');
    }
});

// ─── Global custom right-click context menu ───────────────────
(function() {
    document.addEventListener('contextmenu', function(e) {
        // Don't override if a page-specific ctx menu handler stopped propagation
        // or if we're inside the ctx menu itself
        if (e.target.closest('#globalCtxMenu')) return;

        // Check if a page handler already handled this via data-ctx attribute
        if (e.target.closest('[data-ctx]')) return;

        e.preventDefault();
        var sel = window.getSelection();
        var hasSelection = sel && sel.toString().trim().length > 0;
        var isInput = e.target.matches('input, textarea, [contenteditable="true"]');
        var copyEl = e.target.closest('.copy-text');

        var items = [];

        // Copy selected text
        if (hasSelection) {
            items.push({
                icon: window._ctxIcons.copy,
                label: 'Copy',
                action: function() {
                    document.execCommand('copy');
                    window._toast('Copied!');
                }
            });
        }

        // Copy value for .copy-text elements
        if (copyEl && copyEl.dataset.copy) {
            items.push({
                icon: window._ctxIcons.copy,
                label: 'Copy Value',
                action: function() {
                    navigator.clipboard.writeText(copyEl.dataset.copy).then(function() {
                        window._toast('Copied!');
                    });
                }
            });
        }

        // Paste (for inputs)
        if (isInput) {
            items.push({
                icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>',
                label: 'Paste',
                action: function() {
                    navigator.clipboard.readText().then(function(text) {
                        if (document.activeElement === e.target) {
                            document.execCommand('insertText', false, text);
                        }
                    }).catch(function() {
                        window._toast('Paste not available');
                    });
                }
            });
        }

        // Select All
        items.push({
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="M3 9h18"/></svg>',
            label: 'Select All',
            action: function() {
                if (isInput) {
                    e.target.select();
                } else {
                    document.execCommand('selectAll');
                }
            }
        });

        if (items.length > 0) {
            window._ctxMenu.open(e, items, {});
        }
    });
})();

// ─── Global Confirm Modal ─────────────────────────────────────
/**
 * showConfirm({
 *   title: "Delete Bot",
 *   message: "This cannot be undone.",
 *   confirmText: "Delete",
 *   cancelText: "Cancel",
 *   type: "danger" | "accent" | "success" | "warning",
 *   icon: "<svg>...</svg>",  // optional custom icon
 *   onConfirm: () => { ... },
 *   onCancel: () => { ... }   // optional
 * })
 */
window.showConfirm = function(opts) {
    var overlay = document.getElementById('globalConfirmOverlay');
    var titleEl = document.getElementById('confirmTitle');
    var bodyEl = document.getElementById('confirmBody');
    var okBtn = document.getElementById('confirmOkBtn');
    var cancelBtn = document.getElementById('confirmCancelBtn');
    var iconEl = document.getElementById('confirmIcon');

    if (!overlay) return;

    var type = opts.type || 'accent';

    titleEl.textContent = opts.title || 'Are you sure?';
    bodyEl.textContent = opts.message || 'This action cannot be undone.';
    okBtn.textContent = opts.confirmText || 'Confirm';
    cancelBtn.textContent = opts.cancelText || 'Cancel';

    // Icon type
    iconEl.className = 'confirm-icon ' + type;
    var defaultIcons = {
        danger: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        accent: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
        success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
        warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
    };
    iconEl.innerHTML = opts.icon || defaultIcons[type] || defaultIcons.accent;

    // Button styling
    okBtn.className = 'btn btn-confirm ' + type;

    function cleanup() {
        overlay.classList.add('closing');
        setTimeout(function() {
            overlay.classList.remove('active', 'closing');
        }, 150);
        okBtn.removeEventListener('click', onConfirm);
        cancelBtn.removeEventListener('click', onCancel);
        overlay.removeEventListener('click', onOverlay);
        document.removeEventListener('keydown', onKey);
    }

    function onConfirm() {
        cleanup();
        if (opts.onConfirm) opts.onConfirm();
    }
    function onCancel() {
        cleanup();
        if (opts.onCancel) opts.onCancel();
    }
    function onOverlay(e) {
        if (e.target === overlay) onCancel();
    }
    function onKey(e) {
        if (e.key === 'Escape') onCancel();
        if (e.key === 'Enter') onConfirm();
    }

    okBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('click', onOverlay);
    document.addEventListener('keydown', onKey);

    overlay.classList.remove('closing');
    overlay.classList.add('active');
    okBtn.focus();
};