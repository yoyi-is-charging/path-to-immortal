import { Command, Config, Status } from '../../server/types';
import { CommandHandler } from '../CommandHandler';
import { runEffects } from '../EffectRunner';
import { GameInstance } from '../../server/core/GameInstance';
import { getDate, min } from '../../utils/TimeUtils';
import { countOccurrences, readAllMinuteDurations, readClockTime, readFirstCount, readIndexedOptionBeforeLine } from '../../utils/FieldExtractor';

type BountyStatus = NonNullable<Status['bounty']>;
type BountyConfig = NonNullable<Config['bounty']>;

type BountyResponse =
    | { type: 'summary'; accepted: number; limit: number; finished: boolean; updateTime: Date; claimTimes: Date[]; current: number; claimTime?: Date; next?: string }
    | { type: 'refreshed' }
    | { type: 'completed' }
    | { type: 'unmatched' };

type BountyEffect =
    | { type: 'patchStatus'; status: BountyStatus }
    | { type: 'scheduleCommand'; command: Command }
    | { type: 'registerScheduler' };

const BOUNTY_COMMAND = {
    status: '查看宗门悬赏',
    claim: '领宗门悬赏',
    accept: '接宗门悬赏',
    refresh: '刷新宗门悬赏',
    accelerate: '加速完成宗门悬赏',
} as const;

export default class BountyHandler implements CommandHandler {
    readonly category = 'bounty';
    readonly COMMAND_TYPE = new Map([
        [BOUNTY_COMMAND.status, 'bounty'],
        [BOUNTY_COMMAND.claim, 'bounty_claim'],
        [BOUNTY_COMMAND.accept, 'bounty_accept'],
        [BOUNTY_COMMAND.refresh, 'bounty_refresh'],
        [BOUNTY_COMMAND.accelerate, 'bounty_accelerate'],
    ]);
    readonly RESPONSE_PATTERN = new Map([
        ['bounty', /已接任务/],
        ['bounty_claim', /领宗门悬赏成功/],
        ['bounty_accept', /接收悬赏成功/],
        ['bounty_refresh', /刷新成功/],
        ['bounty_accelerate', /已完成加速/],
    ])

    async handleResponse(command: Command, response: string, instance: GameInstance) {
        instance.account.status.bounty = instance.account.status.bounty || {};
        const config = instance.account.config.bounty!;
        const bountyResponse = this.parseResponse(command, response, config);
        const effects = this.transition(instance.account.status.bounty, bountyResponse, config);
        await runEffects(effects, { instance, statusKey: 'bounty', handler: this });
    }

    async handleError(command: Command, error: Error, instance: GameInstance) {
        command = { ...command, type: 'bounty', body: BOUNTY_COMMAND.status, retries: (command.retries || 0) + 1 };
        return command.retries! < 3 ? command : undefined;
    }

    registerScheduler(instance: GameInstance): void {
        const config = instance.account.config.bounty!;
        const status = instance.account.status.bounty;
        if (!config.enabled)
            return;
        instance.scheduleCommand({ type: 'bounty', body: BOUNTY_COMMAND.status, date: status?.updateTime });
    }

    private parseResponse(command: Command, response: string, config: BountyConfig): BountyResponse {
        if (command.type === 'bounty') {
            const acceptedLimit = readFirstCount(response);
            if (!acceptedLimit)
                return { type: 'unmatched' };
            const accepted = acceptedLimit.current;
            const limit = acceptedLimit.limit;
            const finished = accepted === limit;
            const nextDailyUpdate = getDate({ ...config.time!, dayOffset: 1 });
            const parsedUpdateTime = readClockTime(response);
            const updateTime = finished ? nextDailyUpdate : min(parsedUpdateTime ?? nextDailyUpdate, nextDailyUpdate);
            const claimReadyCount = countOccurrences(response, '待领奖励');
            const waitingClaimTimes = readAllMinuteDurations(response, '分钟', '剩余');
            const claimTimes = [...Array.from({ length: claimReadyCount }, () => new Date()), ...waitingClaimTimes];
            const current = claimReadyCount + waitingClaimTimes.length;
            const claimTime = claimTimes.length > 0 ? new Date(Math.min(...claimTimes.map(date => date.getTime()))) : undefined;
            return {
                type: 'summary',
                accepted,
                limit,
                finished,
                updateTime,
                claimTimes,
                current,
                claimTime,
                next: readIndexedOptionBeforeLine(response, config.bountyTypes ?? [], '需要时间'),
            };
        }
        return command.type === 'bounty_refresh' ? { type: 'refreshed' } : { type: 'completed' };
    }

    private transition(status: BountyStatus, response: BountyResponse, config: BountyConfig): BountyEffect[] {
        switch (response.type) {
            case 'summary': {
                const effects: BountyEffect[] = [
                    { type: 'patchStatus', status: { accepted: response.accepted, limit: response.limit, updateTime: response.updateTime, claimTimes: response.claimTimes } },
                ];
                const updateDate = new Date(response.updateTime).setHours(0, 0, 0, 0);
                const currentDate = new Date().setHours(0, 0, 0, 0);
                if (!response.finished && updateDate !== currentDate) {
                    const remaining = response.limit - response.accepted;
                    if (3 - response.current < remaining && remaining <= 3)
                        effects.push({ type: 'scheduleCommand', command: { type: 'bounty_accelerate', body: BOUNTY_COMMAND.accelerate } });
                    else if (response.next)
                        effects.push({ type: 'scheduleCommand', command: { type: 'bounty_accept', body: `${BOUNTY_COMMAND.accept} ${response.next}` } });
                    else if (status.refreshCount! < config.refreshLimit!)
                        effects.push({ type: 'scheduleCommand', command: { type: 'bounty_refresh', body: BOUNTY_COMMAND.refresh } });
                } else if (!response.finished && response.next && response.current < 3) {
                    effects.push({ type: 'scheduleCommand', command: { type: 'bounty_accept', body: `${BOUNTY_COMMAND.accept} ${response.next}` } });
                }
                if (response.claimTime)
                    effects.push({ type: 'scheduleCommand', command: { type: 'bounty_claim', body: BOUNTY_COMMAND.claim, date: response.claimTime } });
                effects.push({ type: 'registerScheduler' });
                return effects;
            }
            case 'refreshed':
                return [
                    { type: 'patchStatus', status: { refreshCount: (status.refreshCount || 0) + 1, updateTime: undefined } },
                    { type: 'registerScheduler' },
                ];
            case 'completed':
                return [
                    { type: 'patchStatus', status: { updateTime: undefined } },
                    { type: 'registerScheduler' },
                ];
            case 'unmatched':
                return [];
        }
    }

}
