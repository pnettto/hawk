/**
 * Styles for the DailyLog component
 */
export const style = /* css */ `
.hours {
  display: flex;
  flex-direction: column;
  margin-bottom: 2rem;
  gap: 0.25rem;
}

.hour-row {
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: 0.25rem;
  padding: 0.5rem;
}

@media (max-width: 480px) {
  .hour-row {
      grid-template-columns: auto minmax(0, 1fr);
      padding: 0.4rem 0.2rem;
      gap: 0.1rem;
  }
}

.hour-row.not-empty {
  background-color: var(--glass-dark);
  border-radius: 0.25rem;
}

.hour-time {
  color: var(--muted);
  text-align: right;
  font-size: 0.8rem;
  padding: 0.35rem 0.2rem;
  cursor: pointer;
  user-select: none;
  opacity: 0.5;
}

@media (max-width: 480px) {
    .hour-time {
        font-size: 0.75rem;
        padding: 0.5rem 0.1rem;
    }
}

.hour-row.moving-source .hour-time {
  background-color: var(--accent);
  color: #022;
  border-radius: 4px;
}

.hour-row.moving-target .hour-time { color: var(--accent); }
.hour-row.moving-target .hour-time:hover { text-decoration: underline; }

.hour-row .hour-controls {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr) auto;
  align-items: start;
}

.hour-text-content {
  display: flex;
  flex-direction: column;
}

.hour-comment-switch {
  font-size: 0.8rem;
  background: none;
  padding: 0.4rem;
  border: none;
  cursor: pointer;
  opacity: 0.2;
  padding-top: 0.35rem;
  min-width: 2rem;
  min-height: 2rem;
}

@media (max-width: 480px) {
    .hour-comment-switch { padding: 0.5rem; }
}

.hour-row.is-comment .hour-comment-switch { opacity: 0.6; }

.hour-checkbox-wrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.8rem;
  padding-top: 0.5rem;
  min-width: 2rem;
}

@media (max-width: 480px) {
    .hour-checkbox-wrap { padding: 0.6rem 0.4rem; }
}

.hour-checkbox {
  appearance: none;
  width: 0.75rem;
  height: 0.75rem;
  margin: 0;
  border-radius: 50%;
  background: var(--glass);
  cursor: pointer;
  position: relative;
  transition: all 0.18s ease;
}

@media (max-width: 480px) {
    .hour-checkbox { width: 0.9rem; height: 0.9rem; }
}

.hour-checkbox:checked {
  background: var(--accent);
  border: 0;
}

.hour-input,
.hour-comment {
  border: 0;
  background: transparent;
  padding: 0 0.5rem;
  font-size: 1rem;
  color: inherit;
  line-height: 1.9;
  outline: none;
  cursor: pointer;
}

@media (max-width: 480px) {
    .hour-input { padding: 0 0.25rem; font-size: 0.95rem; }
}

.hour-input:focus, .hour-comment:focus { cursor: text; }

.hour-comment {
  margin-top: 0.5rem;
  font-size: 1rem;
  min-height: 3rem;
  opacity: 0.6;
  white-space: pre-wrap;
}

.hour-comment-clear {
  font-size: 0.5rem;
  background: none;
  padding: 0.4rem;
  border: none;
  cursor: pointer;
  opacity: 0.2;
  min-width: 2rem;
  min-height: 2rem;
}

.hour-comment-clear:hover { opacity: 1; }

.highlighted .hour-time { color: var(--accent); }
.highlighted { color: var(--accent); }
.hidden { display: none !important; }
`;
