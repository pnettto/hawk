/**
 * Styles for the DatePicker component
 */
export const style = /* css */ `
.date-control {
    display: flex;
    align-items: center;
    gap: 12px;
}

.date-container {
    position: relative;
    min-width: 9rem;
}

.date-display {
    background: transparent;
    border: none;
    color: var(--accent);
    width: 100%;
    padding: 10px 18px;
    border-radius: 10px;
    cursor: pointer;
    font-weight: normal;
    font-family: inherit;
    font-size: 1rem;
}

.calendar-modal {
    position: absolute;
    top: 0;
    left: 50%;
    margin-top: 8px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 20px;
    min-width: 300px;
    box-shadow: 0 8px 40px rgba(2, 6, 8, 0.8);
    z-index: 1000;
    transform-origin: top center;
    opacity: 0;
    transform: translateX(-50%) translateY(-4px) scale(0.98);
    pointer-events: none;
    transition: opacity var(--dur-base) var(--ease-out),
                transform var(--dur-base) var(--ease-spring);
}

.calendar-modal.open {
    opacity: 1;
    transform: translateX(-50%) translateY(0) scale(1);
    pointer-events: auto;
}

.calendar-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.cal-month {
    font-size: 1rem;
    color: var(--accent);
    flex: 1;
    text-align: center;
}

.cal-arrow {
    appearance: none;
    border: 0;
    background: transparent;
    color: var(--accent);
    font-size: 1.25rem;
    padding: 8px 10px;
    border-radius: 8px;
    cursor: pointer;
}

.cal-days {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 4px;
}

.cal-day {
    appearance: none;
    border: 0;
    background: transparent;
    color: var(--accent);
    padding: 8px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.875rem;
    font-variant-numeric: tabular-nums;
    transition: background-color var(--dur-fast) var(--ease-out);
}

.cal-day:hover { background-color: var(--glass); }

.cal-day.other-month {
    color: var(--muted);
    opacity: 0.4;
}

.cal-day.selected {
    background: linear-gradient(180deg, var(--accent), #fff076);
    color: #000;
    border: 0;
    font-weight: bold;
}

.cal-today {
    font-size: 1rem;
    color: var(--accent);
    flex: 1;
    text-align: center;
    cursor: pointer;
    margin: 0.5rem 0;
}

.modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.18);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    z-index: 999;
    animation: overlayIn var(--dur-base) var(--ease-out);
}

@keyframes overlayIn {
    from { opacity: 0; }
    to   { opacity: 1; }
}

.date-display {
    font-variant-numeric: tabular-nums;
}

.hidden { display: none !important; }
`;
