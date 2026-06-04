import { Command, Config, Status } from '../../server/types';
import { CommandHandler } from '../CommandHandler';
import { runEffects } from '../EffectRunner';
import { GameInstance } from '../../server/core/GameInstance';
import { getDate } from '../../utils/TimeUtils';
import { readFullDate, readNumberAfter, readTaskProgress } from '../../utils/FieldExtractor';

type GatherStatus = NonNullable<Status['gather']>;
type GatherConfig = NonNullable<Config['gather']>;

type GatherResponse =
    | { type: 'available'; taskId: number; limit: number }
    | { type: 'current'; taskId: number; limit: number; progress: number; finishTime?: Date; nextHoleId?: number; canCollect: boolean }
    | { type: 'claimAvailable' }
    | { type: 'claimed' }
    | { type: 'recheck' }
    | { type: 'unmatched' };

type GatherEffect =
    | { type: 'patchStatus'; status: GatherStatus }
    | { type: 'scheduleCommand'; command: Command }
    | { type: 'registerScheduler' };

const GATHER_COMMAND = {
    status: '采集任务',
    accept: '接采集任务',
    enter: '进入洞口',
    collect: '采集阴阳花',
    claim: '领采集任务奖励',
} as const;

export default class GatherHandler implements CommandHandler {
    readonly category = 'gather';
    readonly COMMAND_TYPE = new Map([
        [GATHER_COMMAND.status, 'gather'],
        [GATHER_COMMAND.accept, 'gather_accept'],
        [GATHER_COMMAND.enter, 'gather_enter'],
        [GATHER_COMMAND.collect, 'gather_collect'],
        [GATHER_COMMAND.claim, 'gather_claim'],
    ]);
    readonly RESPONSE_PATTERN = new Map([
        ['gather', /采集任务如下/],
        ['gather_accept', /已接采集任务/],
        ['gather_enter', /预计找到日期/],
        ['gather_collect', /采集完毕/],
        ['gather_claim', /领取成功/],
    ])
    readonly GATHER_COLLECT_PATTERN = /已找到阴阳花/;
    readonly GATHER_FINISHED_PATTERN = /可领取奖励/;
    async handleResponse(command: Command, response: string, instance: GameInstance) {
        instance.account.status.gather = instance.account.status.gather || {};
        const config = instance.account.config.gather!;
        const gatherResponse = this.parseResponse(command, response);
        const effects = this.transition(gatherResponse, config);
        await runEffects(effects, { instance, statusKey: 'gather', handler: this });
    }

    async handleError(command: Command, error: Error, instance: GameInstance) {
        command = { ...command, type: 'gather', body: GATHER_COMMAND.status, retries: (command.retries || 0) + 1 };
        return command.retries! < 3 ? command : undefined;
    }

    registerScheduler(instance: GameInstance): void {
        const config = instance.account.config.gather!;
        const status = instance.account.status.gather;
        if (!config.enabled)
            return;
        instance.scheduleCommand({ type: 'gather', body: GATHER_COMMAND.status, date: getDate({ ...config.time, dayOffset: status?.finished ? 1 : 0 }) });
    }

    private parseResponse(command: Command, response: string): GatherResponse {
        if (command.type === 'gather_claim')
            return { type: 'claimed' };
        if (command.type !== 'gather')
            return { type: 'recheck' };
        const task = readTaskProgress(response);
        const progress = task?.counts[0];
        if (task?.state === '未接' && progress)
            return { type: 'available', taskId: task.taskId, limit: progress.limit };
        if (task?.state === '进行中' && progress) {
            return {
                type: 'current',
                taskId: task.taskId,
                limit: progress.limit,
                progress: progress.current,
                finishTime: readFullDate(response),
                nextHoleId: readNumberAfter(response, '今日可进入的洞口:'),
                canCollect: this.GATHER_COLLECT_PATTERN.test(response),
            };
        }
        if (this.GATHER_FINISHED_PATTERN.test(response))
            return { type: 'claimAvailable' };
        return { type: 'unmatched' };
    }

    private transition(response: GatherResponse, config: GatherConfig): GatherEffect[] {
        if (!config.enabled)
            return [];
        switch (response.type) {
            case 'available':
                return [
                    { type: 'patchStatus', status: { gatherTaskId: response.taskId, gatherTaskLimit: response.limit, gatherTaskProgress: 0, finishTime: undefined } },
                    { type: 'scheduleCommand', command: { type: 'gather_accept', body: `${GATHER_COMMAND.accept} ${response.taskId}` } },
                ];
            case 'current': {
                const effects: GatherEffect[] = [
                    { type: 'patchStatus', status: { gatherTaskId: response.taskId, gatherTaskLimit: response.limit, gatherTaskProgress: response.progress, finishTime: response.finishTime } },
                ];
                if (response.finishTime)
                    effects.push({ type: 'scheduleCommand', command: { type: 'gather_collect', body: GATHER_COMMAND.collect, date: response.finishTime } });
                else if (response.nextHoleId)
                    effects.push({ type: 'scheduleCommand', command: { type: 'gather_enter', body: `${GATHER_COMMAND.enter} ${response.nextHoleId}` } });
                else if (response.canCollect)
                    effects.push({ type: 'scheduleCommand', command: { type: 'gather_collect', body: GATHER_COMMAND.collect } });
                else
                    effects.push({ type: 'patchStatus', status: { finished: true } }, { type: 'registerScheduler' });
                return effects;
            }
            case 'claimAvailable':
                return [{ type: 'scheduleCommand', command: { type: 'gather_claim', body: GATHER_COMMAND.claim } }];
            case 'claimed':
                return [
                    { type: 'patchStatus', status: { finished: true, finishTime: undefined } },
                    { type: 'registerScheduler' },
                ];
            case 'recheck':
                return [{ type: 'scheduleCommand', command: { type: 'gather', body: GATHER_COMMAND.status } }];
            case 'unmatched':
                return [];
        }
    }

}
