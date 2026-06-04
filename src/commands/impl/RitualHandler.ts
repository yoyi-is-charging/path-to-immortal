// src/commands/impl/RitualHandler.ts

import { Command, Config, Status } from '../../server/types';
import { CommandHandler } from '../CommandHandler';
import { runEffects } from '../EffectRunner';
import { GameInstance } from '../../server/core/GameInstance';
import { getDate } from '../../utils/TimeUtils';
import { readFullDate, readTaskProgress } from '../../utils/FieldExtractor';

type RitualStatus = NonNullable<Status['ritual']>;
type RitualConfig = NonNullable<Config['ritual']>;

type RitualResponse =
    | { type: 'available'; taskId: number; eastLimit: number; westLimit: number }
    | { type: 'current'; taskId: number; eastLimit: number; westLimit: number; eastCount: number; westCount: number; finishTime?: Date }
    | { type: 'claimAvailable' }
    | { type: 'accepted' }
    | { type: 'actionDone'; dailyLimit: boolean }
    | { type: 'claimed' }
    | { type: 'unmatched' };

type RitualEffect =
    | { type: 'patchStatus'; status: RitualStatus }
    | { type: 'scheduleCommand'; command: Command }
    | { type: 'registerScheduler' };

const RITUAL_COMMAND = {
    status: '法器任务',
    accept: '接法器任务',
    east: '逛东市',
    west: '逛西市',
    claim: '领法器任务奖励',
} as const;

export default class RitualHandler implements CommandHandler {
    readonly category = 'ritual';
    readonly COMMAND_TYPE = new Map([
        [RITUAL_COMMAND.status, 'ritual'],
        [RITUAL_COMMAND.accept, 'ritual_accept'],
        [RITUAL_COMMAND.east, 'ritual_east'],
        [RITUAL_COMMAND.west, 'ritual_west'],
        [RITUAL_COMMAND.claim, 'ritual_claim'],
    ]);
    readonly RESPONSE_PATTERN = new Map([
        ['ritual', /法器任务如下/],
        ['ritual_accept', /已接法器任务/],
        ['ritual_east', /逛东市|每天最多逛/],
        ['ritual_west', /逛西市|每天最多逛/],
        ['ritual_claim', /领取成功/],
    ])
    readonly RITUAL_LIMIT_PATTERN = /每天最多逛/;
    readonly RITUAL_FINISHED_PATTERN = /可领取奖励/;

    async handleResponse(command: Command, response: string, instance: GameInstance) {
        instance.account.status.ritual = instance.account.status.ritual || {};
        const config = instance.account.config.ritual!;
        const ritualResponse = this.parseResponse(command, response);
        const effects = this.transition(ritualResponse, config);
        await runEffects(effects, { instance, statusKey: 'ritual', handler: this });
    }

    async handleError(command: Command, error: Error, instance: GameInstance) {
        command = { ...command, type: 'ritual', body: RITUAL_COMMAND.status, retries: (command.retries || 0) + 1 };
        return command.retries! < 3 ? command : undefined;
    }

    registerScheduler(instance: GameInstance): void {
        const config = instance.account.config.ritual!;
        const status = instance.account.status.ritual;
        if (!config.enabled)
            return;
        instance.scheduleCommand({ type: 'ritual', body: RITUAL_COMMAND.status, date: status?.finishTime ?? getDate({ ...config.time, dayOffset: status?.finished ? 1 : 0 }) });
    }

    private parseResponse(command: Command, response: string): RitualResponse {
        if (command.type === 'ritual') {
            const task = readTaskProgress(response);
            const east = task?.counts[0];
            const west = task?.counts[1];
            if (task?.state === '未接' && east && west)
                return { type: 'available', taskId: task.taskId, eastLimit: east.limit, westLimit: west.limit };
            if (task?.state === '进行中' && east && west)
                return {
                    type: 'current',
                    taskId: task.taskId,
                    eastLimit: east.limit,
                    westLimit: west.limit,
                    eastCount: east.current,
                    westCount: west.current,
                    finishTime: readFullDate(response),
                };
            if (this.RITUAL_FINISHED_PATTERN.test(response))
                return { type: 'claimAvailable' };
            return { type: 'unmatched' };
        }
        if (command.type === 'ritual_accept')
            return { type: 'accepted' };
        if (command.type === 'ritual_east' || command.type === 'ritual_west')
            return { type: 'actionDone', dailyLimit: this.RITUAL_LIMIT_PATTERN.test(response) };
        if (command.type === 'ritual_claim')
            return { type: 'claimed' };
        return { type: 'unmatched' };
    }

    private transition(response: RitualResponse, config: RitualConfig): RitualEffect[] {
        if (!config.enabled)
            return [];
        switch (response.type) {
            case 'available':
                return [
                    { type: 'patchStatus', status: { ritualTaskId: response.taskId, ritualEastLimit: response.eastLimit, ritualWestLimit: response.westLimit, ritualEastCount: 0, ritualWestCount: 0, finished: false } },
                    { type: 'scheduleCommand', command: { type: 'ritual_accept', body: `${RITUAL_COMMAND.accept} ${response.taskId}` } },
                ];
            case 'current': {
                const effects: RitualEffect[] = [
                    { type: 'patchStatus', status: { ritualTaskId: response.taskId, ritualEastLimit: response.eastLimit, ritualWestLimit: response.westLimit, ritualEastCount: response.eastCount, ritualWestCount: response.westCount, finishTime: response.finishTime, finished: false } },
                ];
                if (response.finishTime)
                    effects.push({ type: 'scheduleCommand', command: { type: 'ritual', body: RITUAL_COMMAND.status, date: response.finishTime } });
                else if (response.eastCount < response.eastLimit)
                    effects.push({ type: 'scheduleCommand', command: { type: 'ritual_east', body: RITUAL_COMMAND.east } });
                else if (response.westCount < response.westLimit)
                    effects.push({ type: 'scheduleCommand', command: { type: 'ritual_west', body: RITUAL_COMMAND.west } });
                return effects;
            }
            case 'claimAvailable':
                return [{ type: 'scheduleCommand', command: { type: 'ritual_claim', body: RITUAL_COMMAND.claim } }];
            case 'accepted':
                return [{ type: 'scheduleCommand', command: { type: 'ritual_east', body: RITUAL_COMMAND.east } }];
            case 'actionDone': {
                const effects: RitualEffect[] = [];
                if (response.dailyLimit)
                    effects.push({ type: 'patchStatus', status: { finished: true, finishTime: undefined } });
                effects.push({ type: 'registerScheduler' });
                return effects;
            }
            case 'claimed':
                return [
                    { type: 'patchStatus', status: { finished: true, finishTime: undefined } },
                    { type: 'registerScheduler' },
                ];
            case 'unmatched':
                return [];
        }
    }

}
