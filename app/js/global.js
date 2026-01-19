/**
 * Global configuration constants for the Hawk application
 */

// Default working hours range for daily log
export const HOURS_START = 9;
export const HOURS_END = 16;

// LocalStorage key prefix for data persistence
export const LOCALSTORAGE_KEY = "hawk:data";

export const API_URL = localStorage.getItem("API_URL") ||
  "https://hawk.pnettto.deno.net";
