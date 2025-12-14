import { loadForDate, saveForDate } from '../utils/storage.js';
import { formatDate as formatDate } from '../utils/date.js';
import { debounce } from '../utils/dom.js';

class Notes {
    constructor () {
        this.listenersInitiated = false;
        this.currentDate = null;
         this.notesMarkdown = '';
        this.debouncedSave = debounce(() => {
            if (this.currentDate) {
                this.saveCurrentState();
            }
        }, 500);
    }

    getElements () {
        return {
            notesInput: document.getElementById('notesInput'),
        }
    }

    async saveCurrentState() {
        const savedData = await loadForDate(formatDate(this.currentDate));
        const { notesInput } = this.getElements();

        this.updateNotesMarkdown()
        const data = {
            notes: notesInput?.innerHTML || '',
            notesMarkdown: this.notesMarkdown
        };

        const mergedData = {...savedData, ...data}

        saveForDate(formatDate(this.currentDate), mergedData);
    }

    updateNotesMarkdown () {
        // Extract text preserving line breaks
        this.notesMarkdown = notesInput.innerHTML
            .replace(/<div>/g, "\n")   // opening div becomes newline
            .replace(/<\/div>/g, "")   // closing div removed
            .replace(/<br\s*\/?>/g, "\n") // br becomes newline
            .replace(/<div>/gi, '')
            .replace(/<[^>]*>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .trim();
    }
    
    setupListeners () {
        if (this.listenersInitiated) return;
        
        const { notesInput } = this.getElements();

        notesInput.addEventListener('click', (e) => {
            const a = e.target.closest('a');
            if (!a) return;

            if (e.metaKey || e.ctrlKey) {
                e.preventDefault();
                window.open(a.href, "_blank");
            }
        });

        notesInput.addEventListener('input', () => {
            this.debouncedSave();
        });

        // Focus: show markdown
        notesInput.addEventListener('focus', () => {
            // Convert HTML back to markdown for editing
            const markdown = this.notesMarkdown;
            notesInput.innerHTML = '';

            // Insert text with preserved line breaks
            const lines = markdown.split('\n');
            lines.forEach((line, index) => {
                notesInput.appendChild(document.createTextNode(line));
                if (index < lines.length - 1) {
                    notesInput.appendChild(document.createElement('br'));
                }
            });

            // Place cursor at end
            const range = document.createRange();
            const sel = window.getSelection();
            range.selectNodeContents(notesInput);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
        });

        // Blur: parse and show HTML
        notesInput.addEventListener('blur', () => {
            this.updateNotesMarkdown()
            notesInput.innerHTML = marked.parse(this.notesMarkdown);
            this.saveCurrentState();
            if (window.Prism) {
                Prism.highlightAllUnder(notesInput);
            }
        });

        // Paste: convert image URLs to markdown format
        notesInput.addEventListener('paste', (e) => {
            e.preventDefault();
            const text = e.clipboardData.getData('text/plain');

            // Check if it's an image URL
            const imageUrlPattern = /^https?:\/\/.+\.(jpg|jpeg|png|gif|bmp|webp|svg)(\?.*)?$/i;

            let textToInsert = text;
            if (imageUrlPattern.test(text.trim())) {
                // Convert to markdown image
                textToInsert = `![](${text.trim()})`;
            }

            // Insert text at cursor position
            const selection = window.getSelection();
            if (selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                range.deleteContents();
                const textNode = document.createTextNode(textToInsert);
                range.insertNode(textNode);
                range.setStartAfter(textNode);
                range.setEndAfter(textNode);
                selection.removeAllRanges();
                selection.addRange(range);
            }
        });

        document.addEventListener('keydown', (e) => {
            const { notesInput } = this.getElements();
            const isEnter = e.key.toLocaleLowerCase() == 'enter';
            const isCtrl = e.ctrlKey || e.metaKey;
            const isSKey = e.key.toLowerCase() == 's';
            const isNotesInputFocused = notesInput == document.activeElement;
            
            if (isNotesInputFocused && isCtrl && isSKey) {
                e.preventDefault();
                notesInput.blur();
            }
        })

        notesInput.addEventListener('mousedown', (e) => {
            const a = e.target.closest('a');
            if (!a) return;

            if (e.metaKey || e.ctrlKey) {
                e.preventDefault();   // Block focus
            }
        });

        document.addEventListener("keydown", (event) => {
            const active = document.activeElement;

            const isSomeInputInFocus =
                active.classList.contains("hour-input") ||
                active.closest(".notes-input") !== null;

            if (isSomeInputInFocus) return;

            if (event.key === "n") {
                event.preventDefault();
                notesInput.focus();
            }
        });

        document.addEventListener('newDateSelected', (e) => {
            this.currentDate = e.detail.date
            this.render(e.detail.date);
        });

        this.listenersInitiated = true;
    }

    render (date) {
        this.currentDate = date;
        const { notesInput } = this.getElements();
        loadForDate(formatDate(date))
            .then(savedData => {
                this.notesMarkdown = savedData.notesMarkdown || '';
                notesInput.innerHTML = this.notesMarkdown ? marked.parse(this.notesMarkdown) : '';
            })
        this.setupListeners();
    }
    
}

const notes = new Notes()

export function init() {
    notes.render(window.selectedDate);
}