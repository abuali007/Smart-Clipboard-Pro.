import { ANALYTICS } from './constants.js';

export function minutesFromCharacters(characters = 0) {
    if (!characters || characters <= 0) return 0;
    return Math.round(characters / ANALYTICS.AVERAGE_CHARS_PER_MINUTE);
}

export function formatTimeSaved(minutes = 0) {
    if (!minutes) return '0m';
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (hours === 0) {
        return `${remainingMinutes}m`;
    }
    if (remainingMinutes === 0) {
        return `${hours}h`;
    }
    return `${hours}h ${remainingMinutes}m`;
}
