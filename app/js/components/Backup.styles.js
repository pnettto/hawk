/**
 * Styles for the BackupToast component
 */
export const style = /* css */ `
.backup-saved {
    position: fixed;
    top: 1rem;
    right: 2rem;
    background: var(--accent);
    color: #000;
    padding: 0.5rem 1rem;
    border-radius: 8px;
    font-weight: bold;
    z-index: 3000;
    animation: fadeInOut 2s forwards;
}

@keyframes fadeInOut {
    0% { opacity: 0; transform: translateY(-10px); }
    10% { opacity: 1; transform: translateY(0); }
    90% { opacity: 1; transform: translateY(0); }
    100% { opacity: 0; transform: translateY(-10px); }
}

.hidden { display: none !important; }
`;
