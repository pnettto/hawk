import { Component } from "./Base.js";
import { appStore } from "../utils/store.js";

class Report extends Component {
    constructor() {
        super()
        this.addStore(appStore);
    }

    keydownHandler = (e) => {
        const active = document.activeElement;
        if (
            active.tagName === "INPUT" || active.tagName === "TEXTAREA" ||
            active.isContentEditable
        ) return;

        if (e.key.toLowerCase() === "r") {
            this.createReport()
        }
    };

    connectedCallback() {
        super.connectedCallback();
        document.addEventListener("keydown", this.keydownHandler);
    }

    disconnectedCallback() {
        document.removeEventListener("keydown", this.keydownHandler);
    }

    generateMarkdown(data, startDate, endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);

        const isDateInRange = (dateStr) => {
            const d = new Date(dateStr);
            return d >= start && d <= end;
        };

        const sortTimes = (a, b) => {
            const getMinutes = (t) => {
            if (t.includes("-")) {
                const [h, m] = t.split("-").map(Number);
                return h * 60 + m;
            }
            return Number(t) * 60;
            };
            return getMinutes(a) - getMinutes(b);
        };

        let md = `# ${startDate} → ${endDate}\n\n`;

        Object.entries(data)
            .filter(([date]) => isDateInRange(date))
            .sort(([a], [b]) => new Date(a) - new Date(b))
            .forEach(([date, day]) => {
                md += `---\n\n## ${date}\n`;

                if (day.mood) {
                    md += `**Mood:** ${day.mood}\n\n`;
                }

                const entries = Object.entries(day)
                    .filter(
                    ([key, value]) =>
                        key !== "notes" &&
                        key !== "notesMarkdown" &&
                        key !== "mood" &&
                        typeof value === "object" &&
                        value.text
                    )
                    .sort(([a], [b]) => sortTimes(a, b));

                if (entries.length) {
                    md += `### ${entries.some(([, v]) => v.checked === false) ? "Done / Planned" : "Done"}\n`;
                    entries.forEach(([time, item]) => {
                    const checkbox = item.checked === false ? "- [ ]" : "-";
                    md += `${checkbox} **${time}** — ${item.text}\n`;
                    });
                    md += `\n`;
                }

                if (day.notesMarkdown && day.notesMarkdown.trim()) {
                    md += `### Notes\n${day.notesMarkdown.trim()}\n\n`;
                }
            });
        return md.trim();
    }

    async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            console.log("✅ Markdown copied to clipboard");
        } catch (err) {
            console.error("❌ Failed to copy:", err);
        }   
    }

    getCurrentWeekRange() {
        const now = new Date();
        const day = now.getDay(); // 0 = Sunday, 6 = Saturday

        // Start: last Sunday (today if Sunday)
        const start = new Date(now);
        start.setDate(now.getDate() - day);
        start.setHours(0, 0, 0, 0);

        // End: next Saturday (today if Saturday)
        const end = new Date(now);
        end.setDate(now.getDate() + (6 - day));
        end.setHours(23, 59, 59, 999);

        const toLocalISODate = (d) => {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, "0");
            const day = String(d.getDate()).padStart(2, "0");
            return `${y}-${m}-${day}`;
        };

        return {
            start: toLocalISODate(start),
            end: toLocalISODate(end),
        };
    }


    createReport () {
        const { app: { logs } } = this.getState();
        const { start, end } = this.getCurrentWeekRange();
        const markdown = this.generateMarkdown(logs, start, end);
        this.copyToClipboard(markdown);
        console.log(`✅ Copied markdown for week ${start} → ${end}`);
    }
}

customElements.define("report-maker", Report);
