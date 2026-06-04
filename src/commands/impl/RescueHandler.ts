import { Command, Config, Status } from '../../server/types';
import { CommandHandler } from '../CommandHandler';
import { runEffects } from '../EffectRunner';
import { GameInstance } from '../../server/core/GameInstance';
import { getDate } from '../../utils/TimeUtils';
import { readFullDate, readTaskProgress } from '../../utils/FieldExtractor';

type RescueStatus = NonNullable<Status['rescue']>;
type RescueConfig = NonNullable<Config['rescue']>;

type RescueResponse =
    | { type: 'available'; taskId: number; limit: number }
    | { type: 'current'; taskId: number; limit: number; progress: number; arrivalTime?: Date }
    | { type: 'claimAvailable' }
    | { type: 'accepted' }
    | { type: 'flightFinished'; dailyLimit: boolean }
    | { type: 'claimed' }
    | { type: 'unmatched' };

type RescueEffect =
    | { type: 'patchStatus'; status: RescueStatus }
    | { type: 'scheduleCommand'; command: Command }
    | { type: 'registerScheduler' };

const RESCUE_COMMAND = {
    status: '救援任务',
    accept: '接救援任务',
    flyTo: '飞往',
    claim: '领救援任务奖励',
} as const;

export default class RescueHandler implements CommandHandler {
    readonly category = 'rescue';
    readonly COMMAND_TYPE = new Map([
        [RESCUE_COMMAND.status, 'rescue'],
        [RESCUE_COMMAND.accept, 'rescue_accept'],
        [RESCUE_COMMAND.flyTo, 'rescue_flyto'],
        [RESCUE_COMMAND.claim, 'rescue_claim'],
    ]);
    readonly RESPONSE_PATTERN = new Map([
        ['rescue', /救援任务如下/],
        ['rescue_accept', /已接救援任务/],
        ['rescue_flyto', /预计到达日期|每天最多飞/],
        ['rescue_claim', /领取成功/],
    ])
    readonly RESCUE_FINISHED_PATTERN = /可领取奖励/;
    readonly RESCUE_LIMIT_PATTERN = /每天最多飞/;

    async handleResponse(command: Command, response: string, instance: GameInstance) {
        instance.account.status.rescue = instance.account.status.rescue || {};
        const config = instance.account.config.rescue!;
        const rescueResponse = this.parseResponse(command, response);
        const effects = this.transition(rescueResponse, config);
        await runEffects(effects, { instance, statusKey: 'rescue', handler: this });
    }

    async handleError(command: Command, error: Error, instance: GameInstance) {
        command = { ...command, type: 'rescue', body: RESCUE_COMMAND.status, retries: (command.retries || 0) + 1 };
        return command.retries! < 3 ? command : undefined;
    }

    registerScheduler(instance: GameInstance): void {
        const config = instance.account.config.rescue!;
        const status = instance.account.status.rescue;
        if (!config.enabled)
            return;
        instance.scheduleCommand({ type: 'rescue', body: RESCUE_COMMAND.status, date: status?.arrivalTime ?? getDate({ ...config.time, dayOffset: status?.finished ? 1 : 0 }) });
    }

    private parseResponse(command: Command, response: string): RescueResponse {
        if (command.type === 'rescue') {
            const task = readTaskProgress(response);
            const progress = task?.counts[0];
            if (task?.state === '未接' && progress)
                return { type: 'available', taskId: task.taskId, limit: progress.limit };
            if (task?.state === '进行中' && progress)
                return { type: 'current', taskId: task.taskId, limit: progress.limit, progress: progress.current, arrivalTime: readFullDate(response) };
            if (this.RESCUE_FINISHED_PATTERN.test(response))
                return { type: 'claimAvailable' };
            return { type: 'unmatched' };
        }
        if (command.type === 'rescue_accept')
            return { type: 'accepted' };
        if (command.type === 'rescue_flyto')
            return { type: 'flightFinished', dailyLimit: this.RESCUE_LIMIT_PATTERN.test(response) };
        if (command.type === 'rescue_claim')
            return { type: 'claimed' };
        return { type: 'unmatched' };
    }

    private transition(response: RescueResponse, config: RescueConfig): RescueEffect[] {
        if (!config.enabled)
            return [];
        switch (response.type) {
            case 'available':
                return [
                    { type: 'patchStatus', status: { rescueTaskId: response.taskId, rescueTaskLimit: response.limit, rescueTaskProgress: 0, arrivalTime: undefined } },
                    { type: 'scheduleCommand', command: { type: 'rescue_accept', body: `${RESCUE_COMMAND.accept} ${response.taskId}` } },
                ];
            case 'current':
                return [
                    { type: 'patchStatus', status: { rescueTaskId: response.taskId, rescueTaskLimit: response.limit, rescueTaskProgress: response.progress, arrivalTime: response.arrivalTime } },
                    { type: 'scheduleCommand', command: { type: 'rescue_flyto', body: `${RESCUE_COMMAND.flyTo} ${response.progress + 1}`, date: response.arrivalTime } },
                ];
            case 'claimAvailable':
                return [{ type: 'scheduleCommand', command: { type: 'rescue_claim', body: RESCUE_COMMAND.claim } }];
            case 'accepted':
                return [{ type: 'scheduleCommand', command: { type: 'rescue_flyto', body: `${RESCUE_COMMAND.flyTo} 1` } }];
            case 'flightFinished': {
                const effects: RescueEffect[] = [];
                if (response.dailyLimit)
                    effects.push({ type: 'patchStatus', status: { finished: true, arrivalTime: undefined } });
                effects.push({ type: 'registerScheduler' });
                return effects;
            }
            case 'claimed':
                return [
                    { type: 'patchStatus', status: { finished: true, arrivalTime: undefined } },
                    { type: 'registerScheduler' },
                ];
            case 'unmatched':
                return [];
        }
    }

}
