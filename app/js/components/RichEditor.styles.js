/**
 * Styles for the RichEditor component
 */
export const style = /* css */ `
:host {
    display: block;
    font-family: var(--font-sans);
    outline: none !important;
    box-shadow: none !important;
}

.tiptap {
    min-height: 100px;
    padding-bottom: 20vh;
    outline: none !important;
    border: none !important;
    box-shadow: none !important;
    font-size: var(--body);
    line-height: var(--lh);
    color: var(--text);
    white-space: pre-wrap;
}

.tiptap:focus, 
.tiptap.ProseMirror-focused,
.element:focus,
*:focus {
    outline: none !important;
    border: none !important;
    box-shadow: none !important;
}

.tiptap a {
    color: var(--accent) !important;
    text-decoration: underline;
    cursor: pointer;
}

/* Tiptap Element Styles */
.tiptap p { margin: 0.5rem 0; }

.tiptap img {
    display: block;
    max-width: 100%;
    height: auto;
    border-radius: 12px;
    margin: 1.5rem auto;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
}

.tiptap iframe {
    display: block;
    width: 100%;
    max-width: 800px;
    aspect-ratio: 16 / 9;
    border-radius: 12px;
    border: none;
    margin: 1.5rem auto;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
}

.tiptap h1 { 
    font-size: var(--h1); 
    font-weight: 800; 
    margin: 1.5rem 0 0.8rem 0; 
    line-height: 1.2;
}

.tiptap h2 { 
    font-size: var(--h2); 
    font-weight: 700; 
    margin: 1.2rem 0 0.6rem 0; 
    line-height: 1.3;
}

.tiptap h3 { 
    font-size: var(--h3); 
    font-weight: 600; 
    margin: 1rem 0 0.5rem 0; 
}

.tiptap ul, .tiptap ol {
    padding-left: 1.5rem;
    margin: 0.5rem 0;
}

.tiptap blockquote {
    border-left: 3px solid var(--accent);
    margin: 1rem 0;
    padding-left: 1rem;
    font-style: italic;
    color: var(--muted);
}

.tiptap code {
    background: rgba(255,255,255,0.1);
    padding: 0.2rem 0.4rem;
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 0.85em;
}

.tiptap pre {
    background: #0d1117;
    padding: 1rem;
    border-radius: 8px;
    font-family: var(--font-mono);
    color: #e6edf3;
    overflow-x: auto;
}

.tiptap pre code {
    background: none;
    padding: 0;
    color: inherit;
}

/* Placeholder */
.tiptap p.is-editor-empty:first-child::before {
  color: var(--muted);
  content: attr(data-placeholder);
  float: left;
  height: 0;
  pointer-events: none;
  opacity: 0.5;
}
`;
