function scheduleToMarkdown(data = {}, options = {}) {
  const { dateLocale = 'en-US', includeIsoDate = true, sortDescending = true } = options;
  const fmt = new Intl.DateTimeFormat(dateLocale, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

  const dateKeys = Object.keys(data).sort((a, b) => {
    const diff = new Date(a) - new Date(b);
    return sortDescending ? -diff : diff;
  });

  const parts = [];

  for (const dateKey of dateKeys) {
    const day = data[dateKey] || {};
    const pretty = fmt.format(new Date(dateKey));
    const mood = day.mood ? ` — ${day.mood}` : '';
    const iso = includeIsoDate ? ` — ${dateKey}` : '';
    parts.push(`## ${pretty}${iso}${mood}`);

    // collect hour keys (numeric strings or hyphenated minute strings like "6-30") and sort ascending
    const hourKeys = Object.keys(day)
      .filter(k => !['notes', 'notesMarkdown', 'mood'].includes(k))
      .filter(k => /^\d{1,2}(?:-\d{1,2})?$/.test(k))
      .sort((a, b) => {
        const parseKey = s => {
          const [h, m = '0'] = s.split('-');
          return Number(h) * 60 + Number(m);
        };
        return parseKey(a) - parseKey(b);
      });

    if (hourKeys.length === 0) {
      parts.push('_No scheduled items._');
    } else {
      for (const h of hourKeys) {
        const item = day[h] || {};
        const checked = item.checked ? 'x' : ' ';
        // support keys like "6" -> "06:00" and "6-30" -> "06:30"
        let hourPart = h;
        let minutePart = '00';
        if (h.includes('-')) {
          const [hh, mm] = h.split('-');
          hourPart = hh;
          minutePart = mm;
        }
        const timeLabel = `${String(Number(hourPart)).padStart(2, '0')}:${String(Number(minutePart)).padStart(2, '0')}`;
        const text = (item.text || '').replace(/\r/g, '');
        parts.push(`- [${checked}] **${timeLabel}** ${text}`);
      }
    }

    // Notes: prefer notesMarkdown if provided, otherwise plain notes quoted
    if (day.notesMarkdown && String(day.notesMarkdown).trim()) {
      parts.push('');
      parts.push('**Notes**:');
      parts.push('');
      parts.push(String(day.notesMarkdown).trim());
    } else if (day.notes && String(day.notes).trim()) {
      parts.push('');
      parts.push('**Notes**:');
      parts.push('');
      const lines = String(day.notes).trim().split('\n').map(l => `> ${l}`);
      parts.push(lines.join('\n'));
    }

    parts.push(''); // blank line between days
  }

  return parts.join('\n').trim() + '\n';
}


// eslint-disable-next-line no-console
console.log(scheduleToMarkdown(temp1));
