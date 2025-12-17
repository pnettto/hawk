# Hawk — Chrome Extension

Simple minimal dark new-tab page with hourly checklist. Notes and checked state are saved per date in `localStorage`.

Install locally in Chrome/Edge:

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the folder containing this extension (the folder with `manifest.json`).
4. Open a new tab to see the page.

Note:
- Data is stored in the extension's page `localStorage`

## Backlog
- Add search: type a word to go to day (maybe you want to restore notes from that day, for example)
- Report: mood stats in period, finished tasks in period, etc
- Tabbed/Vertical switch: two ways of seeing the content (tabs on a sidebar?)
- Save settings automatically for the next load
- Migrate to Web Components
- Save data in cloud storage (multi-device)
- Auth
- Auto backup
- Export function: to markdown, csv?
- Settings page: customize time window, theme, etc?
- General notes: simple view to add notes independent of calendar
- Publish on Google Chrome extension directory
- Have the Shortcuts class handle all shortcut creation/destruction
- Notifications
- Sync with Calendar
- Ability to use localStorage for browsing/testing