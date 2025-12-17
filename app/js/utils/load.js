const apiRoot = 'https://hawk.pnettto.deno.net/';

export async function loadLogs() {
    const apiKey = localStorage.getItem('apiKey');
    const res = await fetch(apiRoot + 'api/logs', {
        headers: {
            Authorization: `Bearer ${apiKey}`,
        },
    });

    if (!res.ok) {
        return {};
    }

    const data = await res.json();
    return data;
}