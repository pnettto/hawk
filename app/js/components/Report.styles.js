/**
 * Styles for the Report component
 */
export const style = `
.controls {
  display: flex;
  gap: 1rem;
  margin-bottom: 2rem;
  align-items: center;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--line);
  padding-bottom: 1.5rem;
}

.date-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

label {
  font-size: 0.8rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.05rem;
}

input[type="date"] {
  background: var(--bg);
  border: none;
  padding: 0.5rem;
  border-radius: 6px;
  color: var(--text);
  font-family: inherit;
}

.actions {
  margin-left: auto;
  display: flex;
  gap: 1rem;
}

@media (max-width: 600px) {
  .controls {
    flex-direction: column;
    align-items: stretch;
  }
  .actions {
    margin-left: 0;
    width: 100%;
  }
  button { flex: 1; }
}

button {
  background: var(--accent);
  color: #000;
  border: none;
  padding: 0.6rem 1.2rem;
  border-radius: 6px;
  font-weight: bold;
  cursor: pointer;
  opacity: 0.9;
  transition: opacity 0.2s;
}

button:hover { opacity: 1; }

button.secondary {
  background: transparent;
  border: 1px solid var(--line);
  color: var(--text);
}

/* HTML Report Styles */
.report-content {
  line-height: 1.6;
  color: var(--text);
}

.report-content h2 {
  color: var(--accent);
  font-size: 1.5rem;
  margin-top: 2.5rem;
  margin-bottom: 1rem;
  border-bottom: 1px solid var(--line);
  padding-bottom: 0.5rem;
  cursor: pointer;
}

.report-content h2:hover { opacity: 0.8; }
.report-content h2:first-child { margin-top: 0; }

.report-content h3 {
  font-size: 1.1rem;
  color: var(--muted);
  margin-top: 1.5rem;
  margin-bottom: 0.5rem;
  text-transform: uppercase;
  letter-spacing: 0.05rem;
}

.report-content ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.report-content li { margin-bottom: 0.5rem; }

.report-content blockquote {
  margin: 0.5rem 0 0.5rem 0;
  padding-left: 1rem;
  border-left: 2px solid var(--line);
  color: var(--muted);
  font-style: italic;
  font-size: 0.9rem;
}

.report-content strong {
  color: var(--accent);
  font-weight: normal;
}

.empty-notice {
  text-align: center;
  padding: 3rem;
  color: var(--muted);
  font-style: italic;
}
`;
