/**
 * Styles for the NotesApp component
 */
export const style = /* css */ `
:host {
    display: block;
    color: var(--text);
    font-family: var(--font-mono);
    position: relative;
    font-size: var(--body);
}

/* Sidebar */
.sidebar {
    width: 260px;
    display: flex;
    flex-direction: column;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    position: absolute;
    right: calc(100% + 4rem);
    top: 0;
    z-index: 10;
}

:host(.maximized) .sidebar {
    width: 0;
    opacity: 0;
    pointer-events: none;
}

.panel-section {
    padding: 1.25rem 1rem;
}

.panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.15rem;
    color: var(--muted);
    margin-bottom: 0.75rem;
}

.item-list {
    flex: 1;
    overflow-y: auto;
    font-size: var(--body);
}

.list-item {
    cursor: pointer;
    border-radius: 8px;
    margin-bottom: 2px;
    transition: all 0.2s;
    display: flex;
    justify-content: space-between;
    align-items: center;
    color: var(--muted);
}

.list-item:hover { color: var(--text); }
.list-item.active { color: var(--accent); }

/* Editor */
.editor-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 1rem 0;
    max-width: 800px;
    margin: 0 auto;
    width: 100%;
}

rich-editor { display: block; }

.editor-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1.5rem;
}

#note-title {
    background: none;
    border: none;
    color: var(--text);
    font-size: var(--h1);
    width: 100%;
    outline: none;
    font-weight: 800;
    opacity: 0.95;
    font-family: inherit;
    flex-shrink: 1;
    margin-bottom: 0;
}

/* Share Button & Popover */
.share-btn {
    font-size: 0.8rem;
    padding: 6px 12px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: rgba(255,255,255,0.05);
    color: var(--text);
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

.share-btn:hover {
    background: rgba(255,255,255,0.1);
    border-color: var(--accent);
}

.share-btn.active {
    background: rgba(0, 255, 136, 0.1);
    border-color: #00ff88;
    color: #00ff88;
}

.share-popover {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 0.5rem;
    background: var(--panel);
    border: 1px solid var(--line);
    padding: 1rem;
    border-radius: 8px;
    z-index: 100;
    box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    width: 300px;
    display: none;
}

.share-popover.visible { display: block; }

.share-link-input {
    width: 100%;
    background: rgba(0,0,0,0.2);
    border: 1px solid var(--line);
    padding: 0.5rem;
    color: var(--text);
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 0.8rem;
    margin-bottom: 0.5rem;
}

.share-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
}

/* Buttons */
.btn-icon-tiny {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    font-size: 1.2rem;
    padding: 8px 12px;
    border-radius: 6px;
    transition: all 0.2s;
    line-height: 1;
}

.btn-icon-tiny:hover {
    background: rgba(255,255,255,0.1);
    color: var(--text);
}

.item-list .delete-note-btn {
    opacity: 0;
}

.item-list .list-item:hover .delete-note-btn { opacity: 0.5; }
.item-list .list-item:hover .delete-note-btn:hover { opacity: 1; color: #ff4444; }

.empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: var(--muted);
    font-style: italic;
    opacity: 0.5;
    text-align: center;
    padding: 2rem;
}

/* Modal */
.modal-overlay {
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.6);
    backdrop-filter: blur(4px);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 100;
    animation: fadeIn 0.2s;
}

.modal-content {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 2rem;
    width: min(320px, 90vw);
    box-shadow: 0 10px 40px rgba(0,0,0,0.4);
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
}

.modal-title { font-size: var(--h3); font-weight: bold; color: var(--text); }

.modal-input {
    background: var(--bg);
    border: 1px solid var(--line);
    padding: 0.8rem;
    border-radius: 6px;
    color: var(--text);
    font-size: var(--body);
    outline: none;
}

.modal-input:focus { border-color: var(--accent); }

.modal-actions { display: flex; justify-content: flex-end; gap: 1rem; }

.btn-secondary {
    background: none;
    border: 1px solid var(--line);
    padding: 0.5rem 1rem;
    border-radius: 6px;
    color: var(--text);
    cursor: pointer;
}

.btn-primary {
    background: var(--accent);
    border: none;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    color: #000;
    font-weight: bold;
    cursor: pointer;
}

.btn-danger {
    background: #ff4444;
    border: none;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    color: #fff;
    font-weight: bold;
    cursor: pointer;
}

.inline-create { padding: 0.4rem 0.75rem; margin-bottom: 0.5rem; }

.inline-create input {
    width: 100%;
    background: rgba(255,255,255,0.05);
    border: 1px solid var(--accent);
    border-radius: 6px;
    color: var(--text);
    padding: 0.6rem 0.8rem;
    font-size: 0.9rem;
    font-family: inherit;
    outline: none;
}

/* Undo Toast */
.undo-toast {
    position: fixed;
    bottom: 2rem;
    left: 50%;
    transform: translateX(-50%);
    background: var(--panel);
    border: none;
    padding: 0.75rem 1.5rem;
    border-radius: 12px;
    display: flex;
    align-items: center;
    gap: 1rem;
    z-index: 1000;
    box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    animation: slideUp 0.3s cubic-bezier(0.18, 0.89, 0.32, 1.28);
    width: max-content;
    max-width: 90vw;
}

.undo-toast span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.undo-btn {
    background: var(--accent);
    color: #000;
    border: none;
    padding: 0.4rem 0.8rem;
    border-radius: 6px;
    font-weight: bold;
    cursor: pointer;
    font-size: 0.8rem;
    transition: transform 0.2s;
}

.undo-btn:hover { transform: scale(1.05); }

.confirm-msg { font-size: 0.8rem; color: #ff4444; font-weight: bold; }
.confirm-actions { display: flex; gap: 0.75rem; }

.confirm-btn-text {
    background: none;
    border: none;
    color: var(--text);
    font-size: 0.75rem;
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 4px;
    opacity: 0.8;
}

.confirm-btn-text:hover { opacity: 1; background: rgba(255,255,255,0.1); }
.confirm-btn-text.yes { color: #ff4444; font-weight: 800; }

@keyframes slideUp {
    from { transform: translate(-50%, 100%); opacity: 0; }
    to { transform: translate(-50%, 0); opacity: 1; }
}

/* Dropdown Styles */
.dropdown-nav {
    width: 100%;
    background: rgba(255,255,255,0.05);
    border: 1px solid var(--line);
    color: var(--text);
    padding: 0.6rem 1rem;
    border-radius: 8px;
    font-family: inherit;
    font-size: 0.95rem;
    outline: none;
    cursor: pointer;
    appearance: none;
    background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 6l4 4 4-4'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 0.75rem center;
    background-size: 1rem;
    margin-bottom: 0.5rem;
    transition: border-color 0.2s;
}

.dropdown-nav:focus { border-color: var(--accent); }
.dropdown-nav option { background: var(--panel); color: var(--text); }

.mobile-only { display: none; }

/* Responsiveness */
@media (max-width: 1400px) {
    :host { display: flex; gap: 2rem; }
    .sidebar { position: static; flex-shrink: 0; }
}

@media (max-width: 900px) {
    :host { display: flex; flex-direction: column; gap: 1.5rem; }
    .sidebar {
        width: 100%;
        position: static;
        order: 1;
        opacity: 1 !important;
        pointer-events: auto !important;
        display: flex !important;
    }
    .editor-main { order: 2; width: 100%; max-width: 100%; }
    .mobile-only { display: block; }
    .desktop-only { display: none; }
}

@media (max-width: 600px) {
    #note-title { font-size: 1.8rem; margin-bottom: 1rem; }
    .btn-icon-tiny { padding: 10px 14px; }
}

@media (max-width: 480px) {
    .undo-toast { bottom: 1rem; padding: 0.6rem 1rem; font-size: 0.8rem; }
}
`;
