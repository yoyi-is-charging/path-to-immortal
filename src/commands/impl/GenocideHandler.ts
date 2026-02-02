// src/commands/impl/RuneHandler.ts

import { Command } from '../../server/types';
import { CommandHandler } from '../CommandHandler';
import { GameInstance } from '../../server/core/GameInstance';
import { getDate, parseFullDate } from '../../utils/TimeUtils';

export default class GenocideHandler implements CommandHandler {
    readonly category = 'genocide';
    readonly COMMAND_TYPE = new Map([
        ['屠宗任务', 'genocide'],
        ['接屠宗任务', 'genocide_accept'],
        ['伏击宗门主力', 'genocide_ambush'],
        ['领屠宗任务奖励', 'genocide_claim'],
    ]);
    readonly RESPONSE_PATTERN = new Map([
        ['genocide', /屠宗任务如下/],
        ['genocide_accept', /已接屠宗任务/],
        ['genocide_ambush', /伏击到|每天最多伏击/],
        ['genocide_claim', /领取成功/],
    ])
    readonly GENOCIDE_AVAILABLE_PATTERN = /任务序号:(?<genocideTaskId>\d+)\n任务名称:.*?\n任务状态:未接\(0\/(?<elderLimit>\d+)\)\(0\/(?<kaidonLimit>\d+)\)\(0\/(?<monkLimit>\d+)\)/;
    readonly GENOCIDE_CURRENT_PATTERN = /任务序号:(?<genocideTaskId>\d+)\n任务名称:.*?\n任务状态:进行中\((?<elderCount>\d+)\/(?<elderLimit>\d+)\)\((?<kaidonCount>\d+)\/(?<kaidonLimit>\d+)\)\((?<monkCount>\d+)\/(?<monkLimit>\d+)\)/;
    readonly GENOCIDE_LIMIT_PATTERN = /每天最多伏击/;
    readonly GENOCIDE_FINISHED_PATTERN = /可领取奖励/;

    async handleResponse(command: Command, response: string, instance: GameInstance) {
        instance.account.status.genocide = instance.account.status.genocide || {};
        const config = instance.account.config.genocide!;
        if (!config.enabled)
            return;
        if (command.type === 'genocide') {
            if (response.match(this.GENOCIDE_AVAILABLE_PATTERN)) {
                const { genocideTaskId, elderLimit, kaidonLimit, monkLimit } = response.match(this.GENOCIDE_AVAILABLE_PATTERN)!.groups!;
                instance.updateStatus({ genocide: { genocideTaskId: parseInt(genocideTaskId), elderLimit: parseInt(elderLimit), kaidonLimit: parseInt(kaidonLimit), monkLimit: parseInt(monkLimit), elderCount: 0, kaidonCount: 0, monkCount: 0, finished: false } });
                instance.scheduleCommand({ type: 'genocide_accept', body: `接屠宗任务 ${genocideTaskId}` });
            }
            else if (response.match(this.GENOCIDE_CURRENT_PATTERN)) {
                const { genocideTaskId, elderLimit, kaidonLimit, monkLimit, elderCount, kaidonCount, monkCount } = response.match(this.GENOCIDE_CURRENT_PATTERN)!.groups!;
                const finishTime = parseFullDate(response);
                instance.updateStatus({
                    genocide: {
                        genocideTaskId: parseInt(genocideTaskId),
                        elderLimit: parseInt(elderLimit),
                        kaidonLimit: parseInt(kaidonLimit),
                        monkLimit: parseInt(monkLimit),
                        elderCount: parseInt(elderCount),
                        kaidonCount: parseInt(kaidonCount),
                        monkCount: parseInt(monkCount),
                        finishTime,
                        finished: false,
                    }
                });
                if (finishTime)
                    instance.scheduleCommand({ type: 'genocide', body: `屠宗任务`, date: finishTime });
                else if (parseInt(elderCount) < parseInt(elderLimit))
                    instance.scheduleCommand({ type: 'genocide_ambush', body: `伏击宗门主力 1` });
                else if (parseInt(kaidonCount) < parseInt(kaidonLimit))
                    instance.scheduleCommand({ type: 'genocide_ambush', body: `伏击宗门主力 2` });
                else if (parseInt(monkCount) < parseInt(monkLimit))
                    instance.scheduleCommand({ type: 'genocide_ambush', body: `伏击宗门主力 3` });
            } else if (response.match(this.GENOCIDE_FINISHED_PATTERN)) {
                instance.scheduleCommand({ type: 'genocide_claim', body: '领取屠宗任务奖励' });
            }
        }
        if (command.type === 'genocide_accept')
            instance.scheduleCommand({ type: 'genocide_ambush', body: `伏击宗门主力 1` });
        if (command.type === 'genocide_ambush') {
            if (response.match(this.GENOCIDE_LIMIT_PATTERN))
                instance.updateStatus({ genocide: { finished: true } });
            this.registerScheduler(instance);
        }
        if (command.type === 'genocide_claim')
            instance.scheduleCommand({ type: 'genocide', body: '屠宗任务' });
    }

    async handleError(command: Command, error: Error, instance: GameInstance) {
        command = { ...command, type: 'genocide', body: '屠宗任务', retries: (command.retries || 0) + 1 };
        return command.retries! < 3 ? command : undefined;
    }

    registerScheduler(instance: GameInstance): void {
        const config = instance.account.config.genocide!;
        const status = instance.account.status.genocide;
        if (!config.enabled)
            return;
        instance.scheduleCommand({ type: 'genocide', body: '屠宗任务', date: status?.finishTime ?? getDate({ ...config.time, dayOffset: status?.finished ? 1 : 0 }) });
    }
}