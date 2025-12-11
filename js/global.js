const hoursAgo = 2 * 60 * 60 * 1000;
const hoursFromNow = 2 * 60 * 60 * 1000;

export let HOURS_START = new Date(Date.now() - hoursAgo).getHours();
export let HOURS_END = new Date(Date.now() + hoursFromNow).getHours();

export const LOCALSTORAGE_KEY = 'hawk:data';
