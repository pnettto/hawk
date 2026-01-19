import { Component } from "./Base.js";
import { appStore } from "../utils/store.js";
import { style } from "./Report.styles.js";

class Report extends Component {
  constructor() {
    super({ style });
    this.addStore(appStore);

    // Default to last 7 days
    const today = new Date();
    const lastWeek = new Date();
    lastWeek.setDate(today.getDate() - 6);

    this.state = {
      startDate: this.formatDateInput(lastWeek),
      endDate: this.formatDateInput(today),
      markdown: "",
    };
  }

  formatDateInput(date) {
    return date.toISOString().split("T")[0];
  }

  async connectedCallback() {
    super.connectedCallback();
    await this.refreshReport();
  }

  async refreshReport() {
    // 1. Ensure data is loaded
    await this.loadDataForRange();

    // 2. Generate
    const markdown = this.generateMarkdown();
    this.state.markdown = markdown;
    this.render();
  }

  async loadDataForRange() {
    const start = this.state.startDate;
    const end = this.state.endDate;
    await appStore.refreshRange(start, end);
  }

  generateMarkdown() {
    const { logs } = this.getState(); // from appStore
    const start = new Date(this.state.startDate);
    const end = new Date(this.state.endDate);
    const dateRange = [];

    // Get all dates in range
    const current = new Date(start);
    while (current <= end) {
      dateRange.push(this.formatDateInput(current));
      current.setDate(current.getDate() + 1);
    }

    return dateRange.map((date) => {
      const dayLog = logs[date];
      if (!dayLog || Object.keys(dayLog).length === 0) return null;

      // Get day of week
      const d = new Date(date + "T12:00:00"); // Use noon to avoid timezone shifts
      const dayName = d.toLocaleDateString("en-US", { weekday: "short" });

      let dayContent = `## ${date} ${dayName}\n\n`;
      let hasContent = false;

      // 1. Mood
      if (dayLog.mood) {
        dayContent += `**Mood:** ${dayLog.mood}\n\n`;
        hasContent = true;
      }

      // 2. Tasks / Hours
      const entries = Object.entries(dayLog)
        .filter(([hour, data]) => {
          // Skip non-hour keys like mood/notes (if any exist in future)
          if (!hour.includes("-") && isNaN(Number(hour))) return false;

          // Skip empty slots
          const hasText = data.text && data.text.trim().length > 0;
          const hasComment = data.comment && data.comment.trim().length > 0;
          return hasText || hasComment;
        })
        .sort((a, b) => {
          const getMins = (t) => {
            const [h, m] = t.split("-").map(Number);
            return h * 60 + (m || 0);
          };
          return getMins(a[0]) - getMins(b[0]);
        })
        .map(([hour, data]) => {
          const time = hour.replace("-30", ":30").replace(/-00|$/, ":00");
          const checkbox = data.checked ? "[x]" : "[ ]";
          let line = `- ${checkbox} **${time}** ${data.text || ""}`;

          if (data.comment) {
            // Indent comment
            const commentLines = data.comment.split("\n").map((l) => `  > ${l}`)
              .join("\n");
            line += `\n${commentLines}`;
          }
          return line;
        });

      if (entries.length > 0) {
        dayContent += entries.join("\n") + "\n\n";
        hasContent = true;
      }

      // 3. Day-bound Notes
      if (dayLog.notesMarkdown && dayLog.notesMarkdown.trim()) {
        dayContent += `### Notes\n${dayLog.notesMarkdown.trim()}\n\n`;
        hasContent = true;
      }

      return hasContent ? dayContent : null;
    }).filter(Boolean).join("\n\n");
  }

  handleInput(e) {
    this.state[e.target.name] = e.target.value;
    this.refreshReport();
  }

  async copyToClipboard() {
    if (!this.state.markdown) return;
    try {
      await navigator.clipboard.writeText(this.state.markdown);
      const btn = this.shadowRoot.getElementById("copy-btn");
      const original = btn.textContent;
      btn.textContent = "Copied!";
      setTimeout(() => btn.textContent = original, 2000);
    } catch (err) {
      console.error("Failed to copy", err);
    }
  }

  render() {
    const { startDate, endDate, markdown } = this.state;

    // Parse Markdown to HTML if available, otherwise fallback to plain text
    const htmlContent = (markdown && globalThis.marked)
      ? marked.parse(markdown)
      : markdown;

    this.display(`
      <div class="report-container">
        <div class="controls">
          <div class="date-group">
            <label>From</label>
            <input type="date" name="startDate" value="${startDate}" id="start-date">
          </div>
          <div class="date-group">
            <label>To</label>
            <input type="date" name="endDate" value="${endDate}" id="end-date">
          </div>
          <div class="actions">
            <button id="refresh-btn" class="secondary">Refresh</button>
            <button id="copy-btn">Copy</button>
          </div>
        </div>

        ${
      markdown
        ? `<div class="report-content">${htmlContent}</div>`
        : `<div class="empty-notice">No logs found for this period</div>`
    }
      </div>
    `);

    // Bind events
    this.shadowRoot.getElementById("start-date").onchange = (e) =>
      this.handleInput(e);
    this.shadowRoot.getElementById("end-date").onchange = (e) =>
      this.handleInput(e);
    this.shadowRoot.getElementById("refresh-btn").onclick = () =>
      this.refreshReport();
    this.shadowRoot.getElementById("copy-btn").onclick = () =>
      this.copyToClipboard();

    const reportContent = this.shadowRoot.querySelector(".report-content");
    if (reportContent) {
      reportContent.onclick = (e) => {
        const h2 = e.target.closest("h2");
        if (h2) {
          const dateStr = h2.textContent.split(" ")[0]; // YYYY-MM-DD
          if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            appStore.setSelectedDate(new Date(dateStr + "T12:00:00"));
            appStore.setCurrentPage("app");
          }
        }
      };
    }
  }
}

customElements.define("report-maker", Report);
