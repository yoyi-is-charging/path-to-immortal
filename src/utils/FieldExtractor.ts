import { getDate } from './TimeUtils';

export type CountPair = {
    current: number;
    limit: number;
};

export type NumberedLine = {
    index: number;
    text: string;
};

export type TaskProgress = {
    taskId: number;
    state: string;
    counts: CountPair[];
};

export type FriendPriceOffer = {
    id: string;
    price: number;
    duration: number;
    reference?: string;
};

export type LineCount = {
    name: string;
    count: number;
};

export type MonsterLayout = {
    hasVerticalMonsters: boolean;
    hasHorizontalKing: boolean;
    hasThirdMonster: boolean;
};

export type SkillOption = {
    index: number;
    name: string;
    type: string;
    strength: number;
};

export type MiningEventFields = {
    shovelLevel: number;
    bagLevel: number;
    stamina: number;
    ticket: number;
    output: number;
    capacity: number;
    shovelUpgradeCost: number;
    bagUpgradeCost: number;
};

export type MiningFields = {
    stamina: number;
    currentCapacity: number;
    capacity: number;
    depth: number;
};

const INTEGER_PATTERN = /\d+/;
const COUNT_PATTERN_GLOBAL = /(\d+)\s*\/\s*(\d+)/g;
const FULL_DATE_PATTERN = /(?<year>\d{4})-(?<month>\d{1,2})-(?<day>\d{1,2})\s(?<hours>\d{1,2}):(?<minutes>\d{1,2}):(?<seconds>\d{1,2})/;
const CLOCK_PATTERN = /(?<hours>\d{1,2}):(?<minutes>\d{1,2}):(?<seconds>\d{1,2})/;
const CHINESE_DURATION_PATTERN = /(?:(?<hours>\d+)时)?(?:(?<minutes>\d+)分)?(?<seconds>\d+)秒|(?:(?<hoursNoSeconds>\d+)时)?(?<minutesNoSeconds>\d+)分|(?<hoursOnly>\d+)时/;
const FRIEND_PRICE_PATTERN_GLOBAL = /(?<id>\d+):(?<price>\d+)\((?<duration>\d+)分后失效\)/g;
const SKILL_PATTERN_GLOBAL = /(?<index>\d+)[:：](?<name>[^(（]*)[（(](?<type>[^+＋]*)[+＋](?<strength>\d+)[%次][)）]/g;
const PACKAGE_CODE_PATTERN_GLOBAL = /礼包码:(?<code>\S+)[\s\S]*?✅[\s\S]*?活动时间:(?<start>\d+-\d+-\d+\s\d+:\d+:\d+)/g;

export function containsAny(input: string, ...needles: string[]): boolean {
    return needles.some(needle => input.includes(needle));
}

export function countOccurrences(input: string, needle: string): number {
    if (!needle)
        return 0;
    let count = 0;
    let position = 0;
    while ((position = input.indexOf(needle, position)) >= 0) {
        count++;
        position += needle.length;
    }
    return count;
}

export function readNumberAfter(input: string, label: string): number | undefined {
    const start = input.indexOf(label);
    if (start < 0)
        return undefined;
    const rest = input.slice(start + label.length);
    return toNumber(rest.match(INTEGER_PATTERN)?.[0]);
}

export function readFirstCount(input: string): CountPair | undefined {
    return readCounts(input)[0];
}

export function readCounts(input: string): CountPair[] {
    return [...input.matchAll(COUNT_PATTERN_GLOBAL)]
        .map(match => ({ current: Number(match[1]), limit: Number(match[2]) }));
}

export function readTaskProgress(input: string): TaskProgress | undefined {
    const taskId = readNumberAfter(input, '任务序号:');
    const stateLine = readLineValue(input, '任务状态:');
    if (taskId === undefined || !stateLine)
        return undefined;
    const state = stateLine.slice(0, stateLine.indexOf('(') >= 0 ? stateLine.indexOf('(') : undefined);
    return {
        taskId,
        state,
        counts: readCounts(stateLine),
    };
}

export function readLineValue(input: string, label: string): string | undefined {
    const line = input.split(/\r?\n/).find(item => item.startsWith(label));
    return line?.slice(label.length).trim();
}

export function readBracketValue(input: string): string | undefined {
    const start = input.indexOf('【');
    const end = input.indexOf('】', start + 1);
    return start >= 0 && end > start ? input.slice(start + 1, end) : undefined;
}

export function readAnswerIndex(input: string, answer: string): number | undefined {
    const pattern = new RegExp(`^(?<index>\\d+)[:：]${escapeRegExp(answer)}$`, 'm');
    const value = input.match(pattern)?.groups?.index;
    return value === undefined ? undefined : Number(value);
}

export function readNumberFromLine(input: string, label: string, predicate: (line: string) => boolean = () => true): number | undefined {
    const line = input.split(/\r?\n/).find(item => item.includes(label) && predicate(item));
    return line ? readNumberAfter(line, label) : undefined;
}

export function readLineCounts(input: string): LineCount[] {
    return input
        .split(/\r?\n/)
        .map(line => {
            const separatorIndex = Math.max(line.lastIndexOf(':'), line.lastIndexOf('：'));
            if (separatorIndex < 0)
                return undefined;
            const name = line.slice(0, separatorIndex).trim();
            const count = toNumber(line.slice(separatorIndex + 1).trim());
            return name && count !== undefined ? { name, count } : undefined;
        })
        .filter((item): item is LineCount => !!item);
}

export function readFullDate(input: string): Date | undefined {
    const match = input.match(FULL_DATE_PATTERN);
    if (!match?.groups)
        return undefined;
    const { year, month, day, hours, minutes, seconds } = match.groups;
    return new Date(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes), Number(seconds));
}

export function readClockTime(input: string): Date | undefined {
    const match = input.match(CLOCK_PATTERN);
    if (!match?.groups)
        return undefined;
    return getDate({
        hours: Number(match.groups.hours),
        minutes: Number(match.groups.minutes),
        seconds: Number(match.groups.seconds),
    });
}

export function readChineseDuration(input: string): Date | undefined {
    const match = input.match(CHINESE_DURATION_PATTERN);
    if (!match?.groups)
        return undefined;
    const hours = Number(match.groups.hours || match.groups.hoursNoSeconds || match.groups.hoursOnly || 0);
    const minutes = Number(match.groups.minutes || match.groups.minutesNoSeconds || 0);
    const seconds = Number(match.groups.seconds || 0);
    if (!hours && !minutes && !seconds)
        return undefined;
    return new Date(Date.now() + ((hours * 60 + minutes) * 60 + seconds) * 1000);
}

export function readMinuteDuration(input: string, marker = '分钟'): Date | undefined {
    const markerIndex = input.indexOf(marker);
    if (markerIndex < 0)
        return undefined;
    const beforeMarker = input.slice(0, markerIndex);
    const reversedDigits = [...beforeMarker].reverse().join('').match(INTEGER_PATTERN)?.[0];
    if (!reversedDigits)
        return undefined;
    const minutes = Number([...reversedDigits].reverse().join(''));
    return new Date(Date.now() + minutes * 60 * 1000);
}

export function readAllMinuteDurations(input: string, marker = '分钟', requiredText = ''): Date[] {
    return input
        .split(/\r?\n/)
        .filter(line => !requiredText || line.includes(requiredText))
        .join('\n')
        .split(marker)
        .slice(0, -1)
        .map(part => readMinuteDuration(`${part}${marker}`, marker))
        .filter((date): date is Date => !!date);
}

export function readTimeHint(input: string): Date | undefined {
    return readFullDate(input) ?? readClockTime(input) ?? readChineseDuration(input) ?? readMinuteDuration(input);
}

export function readNumberedLines(input: string, label: string): NumberedLine[] {
    const prefix = escapeRegExp(label);
    const pattern = new RegExp(`^${prefix}(\\d+)[:：](.*)$`, 'gm');
    return [...input.matchAll(pattern)]
        .map(match => ({ index: Number(match[1]), text: match[2].trim() }));
}

export function readMonsterLayout(input: string): MonsterLayout {
    const monsterLines = input
        .split(/\r?\n/)
        .filter(line => /[^(（]+[（(]\d+[)）]/.test(line));
    const horizontalLine = monsterLines.find(line => (line.match(/[（(]\d+[)）]/g)?.length ?? 0) > 1) ?? monsterLines[0] ?? '';
    return {
        hasVerticalMonsters: monsterLines.length >= 2,
        hasHorizontalKing: horizontalLine.split(/[（(]/)[0].includes('王'),
        hasThirdMonster: monsterLines.length >= 3 || ((horizontalLine.match(/[（(]\d+[)）]/g)?.length ?? 0) >= 3),
    };
}

export function readIndexedOptionBeforeLine(input: string, options: string[], requiredNextLineText: string): string | undefined {
    const lines = input.split(/\r?\n/);
    for (let index = 0; index < lines.length - 1; index++) {
        const line = lines[index];
        const id = line.match(/^(\d+)[:：]/)?.[1];
        if (!id || !lines[index + 1].includes(requiredNextLineText))
            continue;
        if (options.some(option => line.includes(option)))
            return id;
    }
    return undefined;
}

export function readFriendPriceOffers(input: string): FriendPriceOffer[] {
    return [...input.matchAll(FRIEND_PRICE_PATTERN_GLOBAL)].map(match => {
        const { id, price, duration } = match.groups!;
        return {
            id,
            price: Number(price),
            duration: Number(duration),
            reference: readFriendSellReference(input, id),
        };
    });
}

export function readFriendSellReference(input: string, id: string): string | undefined {
    const pattern = new RegExp(`友${escapeRegExp(id)}.*出售给友商 数量 (?<reference>\\d+)0`);
    return input.match(pattern)?.groups?.reference;
}

export function readSkillOptions(input: string): SkillOption[] {
    return [...input.matchAll(SKILL_PATTERN_GLOBAL)].map(match => ({
        index: Number(match.groups!.index),
        name: match.groups!.name.trim(),
        type: match.groups!.type.trim(),
        strength: Number(match.groups!.strength),
    }));
}

export function readStartedPackageCodes(input: string, now = new Date()): string[] {
    return [...input.matchAll(PACKAGE_CODE_PATTERN_GLOBAL)]
        .map(match => ({ code: match.groups!.code, startDate: readFullDate(match.groups!.start) }))
        .filter(item => item.startDate && item.startDate <= now)
        .map(item => item.code);
}

export function readMiningEventFields(input: string): MiningEventFields | undefined {
    const fields = {
        shovelLevel: readNumberAfter(input, '铲子LV'),
        bagLevel: readNumberAfter(input, '背包LV'),
        stamina: readNumberAfter(input, '体力'),
        ticket: readNumberAfter(input, '矿券'),
        output: readNamedNumbers(input, /每次挖(?<output>\d+)0cm/, ['output'] as const)?.output,
        capacity: readNumberAfter(input, '格子'),
        shovelUpgradeCost: readNamedNumbers(input, /铲子.*升级需(?<cost>\d+)/, ['cost'] as const)?.cost,
        bagUpgradeCost: readNamedNumbers(input, /背包.*升级需(?<cost>\d+)/, ['cost'] as const)?.cost,
    };
    return hasUndefined(fields) ? undefined : fields as MiningEventFields;
}

export function readMiningFields(input: string): MiningFields | undefined {
    const capacity = readFirstCount(readLineValue(input, '背包:') ?? '');
    const fields = {
        stamina: readNumberAfter(input, '体力-1/'),
        currentCapacity: capacity?.current,
        capacity: capacity?.limit,
        depth: readNumberAfter(input, '已挖深度:'),
    };
    return hasUndefined(fields) ? undefined : fields as MiningFields;
}

export function readCoordinate(input: string, label: string): { x: number; y: number } | undefined {
    const pattern = new RegExp(`${escapeRegExp(label)}\\((?<x>\\d+),(?<y>\\d+)\\)`);
    const match = input.match(pattern);
    if (!match?.groups)
        return undefined;
    return { x: Number(match.groups.x), y: Number(match.groups.y) };
}

export function readNamedNumbers<T extends string>(input: string, pattern: RegExp, fields: readonly T[]): Record<T, number> | undefined {
    const match = input.match(pattern);
    if (!match?.groups)
        return undefined;
    const result = {} as Record<T, number>;
    for (const field of fields) {
        const value = toNumber(match.groups[field]);
        if (value === undefined)
            return undefined;
        result[field] = value;
    }
    return result;
}

function toNumber(value?: string): number | undefined {
    if (value === undefined)
        return undefined;
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
}

function hasUndefined(input: Record<string, unknown>): boolean {
    return Object.values(input).some(value => value === undefined);
}

function escapeRegExp(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
