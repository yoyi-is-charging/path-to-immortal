// src/utils/TimeUtils.ts
export function min(a: Date, b: Date): Date {
    return a.getTime() < b.getTime() ? a : b;
}
export function parseDate(input: string, pattern: RegExp): Date | undefined {
    const match = input.match(pattern);
    if (!match) return undefined;
    const { hours, minutes = '0', seconds = '0' } = match.groups || {};
    if (hours)
        return getDate({ hours: parseInt(hours), minutes: parseInt(minutes), seconds: parseInt(seconds) });
    else
        return new Date(Date.now() + 60 * 1000 * parseInt(minutes));
}
export function getDate({ hours = 0, minutes = 0, seconds = 0, ms = 999, dayOffset = undefined }: { hours?: number; minutes?: number; seconds?: number; ms?: number; dayOffset?: number }): Date {
    const now = new Date();
    const offset = 1 * 60 * 60 * 1000; // 1 hour in milliseconds
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, seconds, ms);
    if (typeof dayOffset === 'number')
        date.setDate(date.getDate() + dayOffset);
    else if (date.getTime() < now.getTime() - offset)
        date.setDate(date.getDate() + 1);
    return date;
}
// parse YYYY-MM-DD HH:mm:ss
export function parseFullDate(input: string): Date | undefined {
    const pattern = /(?<year>\d{4})-(?<month>\d{1,2})-(?<day>\d{1,2})\s(?<hours>\d{1,2}):(?<minutes>\d{1,2}):(?<seconds>\d{1,2})/;
    const match = input.match(pattern);
    if (!match) return undefined;
    const { year, month, day, hours, minutes, seconds } = match.groups || {};
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hours), parseInt(minutes), parseInt(seconds));
}