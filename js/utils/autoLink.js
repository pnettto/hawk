export function autoLink(notesInput) {
    let html = notesInput.innerHTML;

    let changed = false;

    // -------------------------------------
    // 2. Convert URLs (links + images)
    // -------------------------------------
    
    // Matches http/https and bare domains
    const urlRegex = /(https?:\/\/[^\s<>"']+)/gi;

    html = html.replace(urlRegex, (match) => {
        // Skip if already part of a link or image HTML
        if (
            match.includes("<a ") ||
            match.includes("<img") ||
            match.includes("href=") ||
            match.includes("src=")
        ) {
            return match;
        }

        changed = true;

        // Add protocol if missing
        let url = match;
        if (!/^https?:\/\//i.test(url)) {
            url = "https://" + url;
        }

        // IMAGE URL → <img>
        if (/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(url)) {
            return `<img src="${url}" style="width:100%;height:auto;display:block;" />`;
        }


        // NORMAL LINK → <a>
        return `<a href="${url}" target="_blank">${match}</a>`;
    });

    // -------------------------------------
    // Update HTML only if something changed
    // -------------------------------------
    if (html !== notesInput.innerHTML) {
        notesInput.innerHTML = html;
        this.debouncedSave();
    }
}
