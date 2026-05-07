/**
 * Styles for the MainApp component
 */
export const style = /* css */ `
:host {
    display: block;
    width: 100%;
    margin: 0 auto;
    padding: 2rem;
    box-sizing: border-box;
}

@media (max-width: 600px) {
    :host { padding: 1rem; }
}

.container {
    display: flex;
    flex-direction: column;
    max-width: 800px;
    margin: 0 auto;
    width: 100%;
    position: relative;
}

.app-header {
    margin-bottom: 2rem;
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 1.5rem;
    border-bottom: 1px solid var(--line);
    padding-bottom: 0.5rem;
}

@media (max-width: 600px) {
    .app-header {
        flex-direction: column;
        align-items: flex-start;
        gap: 1rem;
    }
}

.header-left {
    display: flex;
    align-items: center;
    gap: 1.5rem;
}

@media (max-width: 480px) {
    .header-left {
        gap: 1rem;
        width: 100%;
        justify-content: space-between;
    }
}

.page-content {
    animation: pageEnter var(--dur-base) var(--ease-out);
}

@keyframes pageEnter {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
}

.hidden { display: none !important; }

.boot-screen {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg);
    z-index: 9999;
}

.boot-screen .logo-pulse {
    width: 2.4rem;
    height: auto;
    opacity: 0.8;
    animation: bootPulse 1.4s ease-in-out infinite;
}

@keyframes bootPulse {
    0%, 100% { opacity: 0.4; transform: scale(0.96); }
    50%      { opacity: 1;   transform: scale(1.04); }
}

nav {
    display: flex;
    gap: 1rem;
    margin-bottom: 2rem;
}

@media (max-width: 600px) {
    nav {
        gap: 0.5rem;
        overflow-x: auto;
        padding-bottom: 0.5rem;
        scrollbar-width: none;
    }
    nav::-webkit-scrollbar { display: none; }
}

nav button {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    font-family: inherit;
    font-size: 0.8rem;
    padding: 0.5rem;
    white-space: nowrap;
}

nav button.active {
    color: var(--accent);
    font-weight: bold;
}

.journal-tabs {
    display: flex;
    gap: 1.5rem;
}

@media (max-width: 600px) {
    .journal-tabs {
        gap: 1rem;
        width: 100%;
        justify-content: flex-start;
    }
}

.journal-tabs button {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    font-family: inherit;
    font-size: 0.8rem;
    padding: 0;
    text-transform: uppercase;
    letter-spacing: 0.05rem;
}

.journal-tabs button.active { color: var(--accent); }
`;
