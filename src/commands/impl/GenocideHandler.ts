// src/commands/impl/GenocideHandler.ts

import { Command, Config, Status } from '../../server/types';
import { CommandHandler } from '../CommandHandler';
import { runEffects } from '../EffectRunner';
import { GameInstance } from '../../server/core/GameInstance';
import { getDate } from '../../utils/TimeUtils';
import { readFullDate, readTaskProgress } from '../../utils/FieldExtractor';

type GenocideStatus = NonNullable<Status['genocide']>;
type GenocideConfig = NonNullable<Config['genocide']>;

type GenocideResponse =
    | { type: 'available'; taskId: number; elderLimit: number; kaidonLimit: number; monkLimit: number }
    | { type: 'current'; taskId: number; elderLimit: number; kaidonLimit: number; monkLimit: number; elderCount: number; kaidonCount: number; monkCount: number; finishTime?: Date }
    | { type: 'claimAvailable' }
    | { type: 'accepted' }
    | { type: 'ambushDone'; dailyLimit: boolean }
    | { type: 'claimed' }
    | { type: 'unmatched' };

type GenocideEffect =
    | { type: 'patchStatus'; status: GenocideStatus }
    | { type: 'scheduleCommand'; command: Command }
    | { type: 'registerScheduler' };

const GENOCIDE_COMMAND = {
    status: '屠宗任务',
    accept: '接屠宗任务',
    ambush: '伏击宗门主力',
    claim: '领屠宗任务奖励',
} as const;

export default class GenocideHandler implements CommandHandler {
    readonly category = 'genocide';
    readonly COMMAND_TYPE = new Map([
        [GENOCIDE_COMMAND.status, 'genocide'],
        [GENOCIDE_COMMAND.accept, 'genocide_accept'],
        [GENOCIDE_COMMAND.ambush, 'genocide_ambush'],
        [GENOCIDE_COMMAND.claim, 'genocide_claim'],
    ]);
    readonly RESPONSE_PATTERN = new Map([
        ['genocide', /屠宗任务如下/],
        ['genocide_accept', /已接屠宗任务/],
        ['genocide_ambush', /伏击到|每天最多伏击/],
        ['genocide_claim', /领取成功/],
    ])
    readonly GENOCIDE_LIMIT_PATTERN = /每天最多伏击/;
    readonly GENOCIDE_FINISHED_PATTERN = /可领取奖励/;

    async handleResponse(command: Command, response: string, instance: GameInstance) {
        instance.account.status.genocide = instance.account.status.genocide || {};
        const config = instance.account.config.genocide!;
        const genocideResponse = this.parseResponse(command, response);
        const effects = this.transition(genocideResponse, config);
        await runEffects(effects, { instance, statusKey: 'genocide', handler: this });
    }

    async handleError(command: Command, error: Error, instance: GameInstance) {
        command = { ...command, type: 'genocide', body: GENOCIDE_COMMAND.status, retries: (command.retries || 0) + 1 };
        return command.retries! < 3 ? command : undefined;
    }

    registerScheduler(instance: GameInstance): void {
        const config = instance.account.config.genocide!;
        const status = instance.account.status.genocide;
        if (!config.enabled)
            return;
        instance.scheduleCommand({ type: 'genocide', body: GENOCIDE_COMMAND.status, date: status?.finishTime ?? getDate({ ...config.time, dayOffset: status?.finished ? 1 : 0 }) });
    }

    private parseResponse(command: Command, response: string): GenocideResponse {
        if (command.type === 'genocide') {
            const task = readTaskProgress(response);
            const elder = task?.counts[0];
            const kaidon = task?.counts[1];
            const monk = task?.counts[2];
            if (task?.state === '未接' && elder && kaidon && monk)
                return { type: 'available', taskId: task.taskId, elderLimit: elder.limit, kaidonLimit: kaidon.limit, monkLimit: monk.limit };
            if (task?.state === '进行中' && elder && kaidon && monk)
                return {
                    type: 'current',
                    taskId: task.taskId,
                    elderLimit: elder.limit,
                    kaidonLimit: kaidon.limit,
                    monkLimit: monk.limit,
                    elderCount: elder.current,
                    kaidonCount: kaidon.current,
                    monkCount: monk.current,
                    finishTime: readFullDate(response),
                };
            if (this.GENOCIDE_FINISHED_PATTERN.test(response))
                return { type: 'claimAvailable' };
            return { type: 'unmatched' };
        }
        if (command.type === 'genocide_accept')
            return { type: 'accepted' };
        if (command.type === 'genocide_ambush')
            return { type: 'ambushDone', dailyLimit: this.GENOCIDE_LIMIT_PATTERN.test(response) };
        if (command.type === 'genocide_claim')
            return { type: 'claimed' };
        return { type: 'unmatched' };
    }

    private transition(response: GenocideResponse, config: GenocideConfig): GenocideEffect[] {
        if (!config.enabled)
            return [];
        switch (response.type) {
            case 'available':
                return [
                    { type: 'patchStatus', status: { genocideTaskId: response.taskId, elderLimit: response.elderLimit, kaidonLimit: response.kaidonLimit, monkLimit: response.monkLimit, elderCount: 0, kaidonCount: 0, monkCount: 0, finished: false } },
                    { type: 'scheduleCommand', command: { type: 'genocide_accept', body: `${GENOCIDE_COMMAND.accept} ${response.taskId}` } },
                ];
            case 'current': {
                const effects: GenocideEffect[] = [
                    { type: 'patchStatus', status: { genocideTaskId: response.taskId, elderLimit: response.elderLimit, kaidonLimit: response.kaidonLimit, monkLimit: response.monkLimit, elderCount: response.elderCount, kaidonCount: response.kaidonCount, monkCount: response.monkCount, finishTime: response.finishTime, finished: false } },
                ];
                if (response.finishTime)
                    effects.push({ type: 'scheduleCommand', command: { type: 'genocide', body: GENOCIDE_COMMAND.status, date: response.finishTime } });
                else if (response.elderCount < response.elderLimit)
                    effects.push({ type: 'scheduleCommand', command: { type: 'genocide_ambush', body: `${GENOCIDE_COMMAND.ambush} 1` } });
                else if (response.kaidonCount < response.kaidonLimit)
                    effects.push({ type: 'scheduleCommand', command: { type: 'genocide_ambush', body: `${GENOCIDE_COMMAND.ambush} 2` } });
                else if (response.monkCount < response.monkLimit)
                    effects.push({ type: 'scheduleCommand', command: { type: 'genocide_ambush', body: `${GENOCIDE_COMMAND.ambush} 3` } });
                return effects;
            }
            case 'claimAvailable':
                return [{ type: 'scheduleCommand', command: { type: 'genocide_claim', body: GENOCIDE_COMMAND.claim } }];
            case 'accepted':
                return [{ type: 'scheduleCommand', command: { type: 'genocide_ambush', body: `${GENOCIDE_COMMAND.ambush} 1` } }];
            case 'ambushDone': {
                const effects: GenocideEffect[] = [];
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
