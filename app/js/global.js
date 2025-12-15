// const hoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
// const hoursFromNow = new Date(Date.now() + 2 * 60 * 60 * 1000);

// const earliest = new Date();
// earliest.setHours(1, 0, 0, 0);

// const latest = new Date();
// latest.setHours(23, 0, 0, 0);

// const hoursBegin = hoursAgo > earliest ? hoursAgo : earliest;
// const hoursEnd = hoursFromNow < latest ? hoursFromNow : latest;

// export let HOURS_START = hoursBegin.getHours();
// export let HOURS_END = hoursEnd.getHours();

export let HOURS_START = 9;
export let HOURS_END = 16;

export const LOCALSTORAGE_KEY = 'hawk:data';
