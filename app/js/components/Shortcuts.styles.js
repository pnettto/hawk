/**
 * Styles for the ShortcutsModal component
 */
export const style = /* css */ `
.shortcuts-modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 20px;
    min-width: 300px;
    box-shadow: 0 8px 40px rgba(2, 6, 8, 0.8);
    z-index: 1000;
}

.shortcuts-trigger {
    position: fixed;
    right: 0.5rem;
    bottom: 0.5rem;
    padding: 0.5rem;
    color: var(--accent);
    cursor: pointer;
    z-index: 900;
}

.modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0,0,0,0.5);
    z-index: 999;
}

table {
    width: 100%;
    border-collapse: collapse;
}

th, td {
    text-align: left;
    padding: 0.5rem;
    border-bottom: 1px solid var(--line);
}

.hidden { display: none !important; }
`;
