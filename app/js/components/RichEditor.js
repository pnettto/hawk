import { Component } from "./Base.js";
import { style } from "./RichEditor.styles.js";

// Tiptap is loaded via a local bundle in index.html and exposed on window.Tiptap

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
      autofocus: this.hasAttribute("autofocus") ? "start" : false,
      extensions: [
        StarterKit,
        Placeholder.configure({
          placeholder: this.getAttribute("placeholder") || "Write here...",
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
    const next = content || "";
    if (!this.editor) {
      this.valueStr = next;
      return;
    }
    const currentMd = this.editor.storage.markdown.getMarkdown() || "";
    // Skip re-parsing when the editor already shows this content. Re-parsing
    // replaces the doc, drops cursor/selection, and visibly re-flows the
    // markdown when round-trip serialization isn't byte-identical.
    if (currentMd === next) {
      this.valueStr = next;
      return;
    }
    // Tolerate trailing-whitespace drift between source and round-tripped form.
    if (currentMd.replace(/\s+$/, "") === next.replace(/\s+$/, "")) {
      this.valueStr = next;
      return;
    }
    this.editor.commands.setContent(next);
    this.valueStr = next;
  }

  getMarkdown() {
    if (!this.editor) return this.valueStr;
    return this.editor.storage.markdown.getMarkdown() || "";
  }
}

customElements.define("rich-editor", RichEditor);
