import { Command, Config, Status } from '../../server/types';
import { CommandHandler } from '../CommandHandler';
import { GameInstance } from '../../server/core/GameInstance';
import { getDate } from '../../utils/TimeUtils';
import { readFullDate, readTaskProgress } from '../../utils/FieldExtractor';

type RuneStatus = NonNullable<Status['rune']>;
type RuneConfig = NonNullable<Config['rune']>;

type RuneResponse =
    | { type: 'available'; taskId: number; limit: number }
    | { type: 'current'; taskId: number; limit: number; gathered: number; maked: number; finishTime?: Date }
    | { type: 'claimAvailable' }
    | { type: 'accepted' }
    | { type: 'actionDone'; dailyLimit: boolean }
    | { type: 'claimed' }
    | { type: 'unmatched' };

type RuneEffect =
    | { type: 'patchStatus'; status: RuneStatus }
    | { type: 'scheduleCommand'; command: Command }
    | { type: 'registerScheduler' };

const RUNE_COMMAND = {
    status: '制符任务',
    accept: '接制符任务',
    gather: '收集制符材料',
    make: '绘制灵符',
    claim: '领制符任务奖励',
} as const;

export default class RuneHandler implements CommandHandler {
    readonly category = 'rune';
    readonly COMMAND_TYPE = new Map([
        [RUNE_COMMAND.status, 'rune'],
        [RUNE_COMMAND.accept, 'rune_accept'],
        [RUNE_COMMAND.gather, 'rune_gather'],
        [RUNE_COMMAND.make, 'rune_make'],
        [RUNE_COMMAND.claim, 'rune_claim'],
    ]);
    readonly RESPONSE_PATTERN = new Map([
        ['rune', /制符任务如下/],
        ['rune_accept', /已接制符任务/],
        ['rune_gather', /正在收集制符材料|每天最多收集或者绘制/],
        ['rune_make', /开始绘制|每天最多收集或者绘制/],
        ['rune_claim', /领取成功/],
    ])
    readonly RUNE_LIMIT_PATTERN = /每天最多收集或者绘制/;
    readonly RUNE_FINISHED_PATTERN = /可领取奖励/;

    async handleResponse(command: Command, response: string, instance: GameInstance) {
        instance.account.status.rune = instance.account.status.rune || {};
        const config = instance.account.config.rune!;
        const runeResponse = this.parseResponse(command, response);
        const effects = this.transition(runeResponse, config);
        for (const effect of effects)
            await this.applyEffect(effect, instance);
    }

    async handleError(command: Command, error: Error, instance: GameInstance) {
        command = { ...command, type: 'rune', body: RUNE_COMMAND.status, retries: (command.retries || 0) + 1 };
        return command.retries! < 3 ? command : undefined;
    }

    registerScheduler(instance: GameInstance): void {
        const config = instance.account.config.rune!;
        const status = instance.account.status.rune;
        if (!config.enabled)
            return;
        instance.scheduleCommand({ type: 'rune', body: RUNE_COMMAND.status, date: status?.finishTime ?? getDate({ ...config.time, dayOffset: status?.finished ? 1 : 0 }) });
    }

    private parseResponse(command: Command, response: string): RuneResponse {
        if (command.type === 'rune') {
            const task = readTaskProgress(response);
            const gatherProgress = task?.counts[0];
            const makeProgress = task?.counts[1];
            if (task?.state === '未接' && gatherProgress)
                return { type: 'available', taskId: task.taskId, limit: gatherProgress.limit };
            if (task?.state === '进行中' && gatherProgress && makeProgress)
                return {
                    type: 'current',
                    taskId: task.taskId,
                    limit: gatherProgress.limit,
                    gathered: gatherProgress.current,
                    maked: makeProgress.current,
                    finishTime: readFullDate(response),
                };
            if (this.RUNE_FINISHED_PATTERN.test(response))
                return { type: 'claimAvailable' };
            return { type: 'unmatched' };
        }
        if (command.type === 'rune_accept')
            return { type: 'accepted' };
        if (command.type === 'rune_gather' || command.type === 'rune_make')
            return { type: 'actionDone', dailyLimit: this.RUNE_LIMIT_PATTERN.test(response) };
        if (command.type === 'rune_claim')
            return { type: 'claimed' };
        return { type: 'unmatched' };
    }

    private transition(response: RuneResponse, config: RuneConfig): RuneEffect[] {
        if (!config.enabled)
            return [];
        switch (response.type) {
            case 'available':
                return [
                    { type: 'patchStatus', status: { runeTaskId: response.taskId, runeTaskLimit: response.limit, runeGathered: 0, runeMaked: 0, finished: false } },
                    { type: 'scheduleCommand', command: { type: 'rune_accept', body: `${RUNE_COMMAND.accept} ${response.taskId}` } },
                ];
            case 'current': {
                const effects: RuneEffect[] = [
                    { type: 'patchStatus', status: { runeTaskId: response.taskId, runeTaskLimit: response.limit, runeGathered: response.gathered, runeMaked: response.maked, finishTime: response.finishTime, finished: false } },
                ];
                if (response.finishTime)
                    effects.push({ type: 'scheduleCommand', command: { type: 'rune', body: RUNE_COMMAND.status, date: response.finishTime } });
                else if (response.gathered < response.limit)
                    effects.push({ type: 'scheduleCommand', command: { type: 'rune_gather', body: `${RUNE_COMMAND.gather} ${response.gathered + 1}` } });
                else if (response.maked < response.limit)
                    effects.push({ type: 'scheduleCommand', command: { type: 'rune_make', body: RUNE_COMMAND.make } });
                return effects;
            }
            case 'claimAvailable':
                return [{ type: 'scheduleCommand', command: { type: 'rune_claim', body: RUNE_COMMAND.claim } }];
            case 'accepted':
                return [{ type: 'scheduleCommand', command: { type: 'rune_gather', body: `${RUNE_COMMAND.gather} 1` } }];
            case 'actionDone': {
                const effects: RuneEffect[] = [];
                if (response.dailyLimit)
                    effects.push({ type: 'patchStatus', status: { finished: true } });
                effects.push({ type: 'registerScheduler' });
                return effects;
            }
            case 'claimed':
                return [{ type: 'scheduleCommand', command: { type: 'rune', body: RUNE_COMMAND.status } }];
            case 'unmatched':
                return [];
        }
    }

    private async applyEffect(effect: RuneEffect, instance: GameInstance) {
        switch (effect.type) {
            case 'patchStatus':
                await instance.updateStatus({ rune: effect.status });
                break;
            case 'scheduleCommand':
                await instance.scheduleCommand(effect.command);
                break;
            case 'registerScheduler':
                this.registerScheduler(instance);
                break;
        }
    }
}
