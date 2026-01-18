import { Component } from "./Base.js";

// Tiptap is loaded via a local bundle in index.html and exposed on window.Tiptap

// Note: Using esm.sh imports for client-side usage without bundler
// If using build process, standard imports would work.

const style = /* css */ `
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
.tiptap p {
    margin: 0.5rem 0;
}

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

export class RichEditor extends Component {
  constructor() {
    super({ style });
    this.editor = null;
    this.valueStr = "";
  }

  connectedCallback() {
    super.connectedCallback();
    this.display(`<div class="element"></div>`);

    const element = this.shadowRoot.querySelector(".element");
    const {
      Editor,
      StarterKit,
      Placeholder,
      Markdown,
      Link,
      InputRule,
      Image,
      Youtube,
    } = globalThis.Tiptap;

    // Custom InputRule for [text](url) to convert to link mark
    const markdownLinkInputRule = new InputRule({
      find: /\[(.+?)\]\((.+?)\)\s$/,
      handler: ({ state, range, match }) => {
        const [_fullMatch, text, href] = match;
        const { tr } = state;
        const { link } = state.schema.marks;

        if (link && href) {
          const start = range.from;
          const end = range.to;

          tr.replaceWith(
            start,
            end,
            state.schema.text(text, [
              link.create({ href }),
            ]),
          );

          // Add the trailing space back since we consumed it in the regex
          tr.insertText(" ");
          return tr;
        }
      },
    });

    // YouTube InputRule: triggers on youtube URL followed by space
    const youtubeInputRule = new InputRule({
      find:
        /(?:^|\s)(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11}))\s$/,
      handler: ({ state, range, match }) => {
        const [_fullMatch, url, videoId] = match;
        const { tr } = state;

        if (videoId) {
          tr.replaceWith(
            range.from,
            range.to,
            state.schema.nodes.youtube.create({
              src: url,
            }),
          );
          return tr;
        }
      },
    });

    // Image InputRule: triggers on ![alt](url) followed by space
    const imageInputRule = new InputRule({
      find: /!\[(.+?)\]\((.+?)\)\s$/,
      handler: ({ state, range, match }) => {
        const [_fullMatch, alt, src] = match;
        const { tr } = state;

        if (src) {
          tr.replaceWith(
            range.from,
            range.to,
            state.schema.nodes.image.create({
              src,
              alt,
            }),
          );
          return tr;
        }
      },
    });

    this.editor = new Editor({
      element: element,
      autofocus: "start",
      extensions: [
        StarterKit,
        Placeholder.configure({
          placeholder: "Write something amazing...",
        }),
        Markdown,
        Link.configure({
          openOnClick: true,
          autolink: true,
          HTMLAttributes: {
            rel: "noopener noreferrer",
            target: "_blank",
          },
        }),
        Image.configure({
          inline: false,
          allowBase64: true,
        }),
        Youtube.configure({
          controls: true,
          nocookie: true,
          allowFullscreen: true,
        }),
        {
          name: "customInputRules",
          addInputRules() {
            return [markdownLinkInputRule, youtubeInputRule, imageInputRule];
          },
        },
      ],
      content: this.valueStr,
      onUpdate: ({ editor }) => {
        const markdown = editor.storage.markdown.getMarkdown();
        this.dispatchEvent(new CustomEvent("change", { detail: markdown }));
      },
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.editor) {
      this.editor.destroy();
    }
  }

  setValue(content) {
    if (this.editor) {
      // Only update if logically different to avoid cursor jumps?
      // Markdown parsing round-trip might change syntax slightly.
      // Tiptap doesn't have a simple "isSame" for markdown.
      // We typically rely on upstream blocking updates if self-generated.
      // NotesApp `handleNoteUpdate` -> `save` (doesn't push back to editor).
      // Only `selectNote` calls `setValue`.
      // So safe to assume this is a fresh load or switch.

      this.editor.commands.setContent(content);
    }
    this.valueStr = content;
  }
}

customElements.define("rich-editor", RichEditor);
