// src/commands/impl/RuneHandler.ts

import { Command } from '../../server/types';
import { CommandHandler } from '../CommandHandler';
import { GameInstance } from '../../server/core/GameInstance';
import { getDate, parseFullDate } from '../../utils/TimeUtils';

export default class RitualHandler implements CommandHandler {
    readonly category = 'ritual';
    readonly COMMAND_TYPE = new Map([
        ['法器任务', 'ritual'],
        ['接法器任务', 'ritual_accept'],
        ['逛东市', 'ritual_east'],
        ['逛西市', 'ritual_west'],
        ['领法器任务奖励', 'ritual_claim'],
    ]);
    readonly RESPONSE_PATTERN = new Map([
        ['ritual', /法器任务如下/],
        ['ritual_accept', /已接法器任务/],
        ['ritual_east', /逛东市|每天最多逛/],
        ['ritual_west', /逛西市|每天最多逛/],
        ['ritual_claim', /领取成功/],
    ])
    readonly RITUAL_AVAILABLE_PATTERN = /任务序号:(?<ritualTaskId>\d+)\n任务名称:.*?\n任务状态:未接\(0\/(?<ritualEastLimit>\d+)\)\(0\/(?<ritualWestLimit>\d+)\)/;
    readonly RITUAL_CURRENT_PATTERN = /任务序号:(?<ritualTaskId>\d+)\n任务名称:.*?\n任务状态:进行中\((?<ritualEastCount>\d+)\/(?<ritualEastLimit>\d+)\)\((?<ritualWestCount>\d+)\/(?<ritualWestLimit>\d+)\)/;
    readonly RITUAL_LIMIT_PATTERN = /每天最多逛/;
    readonly RITUAL_FINISHED_PATTERN = /可领取奖励/;

    async handleResponse(command: Command, response: string, instance: GameInstance) {
        instance.account.status.ritual = instance.account.status.ritual || {};
        const config = instance.account.config.ritual!;
        if (!config.enabled)
            return;
        if (command.type === 'ritual') {
            if (response.match(this.RITUAL_AVAILABLE_PATTERN)) {
                const { ritualTaskId, ritualEastLimit, ritualWestLimit } = response.match(this.RITUAL_AVAILABLE_PATTERN)!.groups!;
                instance.updateStatus({ ritual: { ritualTaskId: parseInt(ritualTaskId), ritualEastLimit: parseInt(ritualEastLimit), ritualWestLimit: parseInt(ritualWestLimit), ritualEastCount: 0, ritualWestCount: 0, finished: false } });
                instance.scheduleCommand({ type: 'ritual_accept', body: `接法器任务 ${ritualTaskId}` });
            }
            else if (response.match(this.RITUAL_CURRENT_PATTERN)) {
                const { ritualTaskId, ritualEastLimit, ritualWestLimit, ritualEastCount, ritualWestCount } = response.match(this.RITUAL_CURRENT_PATTERN)!.groups!;
                const finishTime = parseFullDate(response);
                instance.updateStatus({
                    ritual: {
                        ritualTaskId: parseInt(ritualTaskId),
                        ritualEastLimit: parseInt(ritualEastLimit),
                        ritualWestLimit: parseInt(ritualWestLimit),
                        ritualEastCount: parseInt(ritualEastCount),
                        ritualWestCount: parseInt(ritualWestCount),
                        finishTime,
                        finished: false,
                    }
                });
                if (finishTime)
                    instance.scheduleCommand({ type: 'ritual', body: `法器任务`, date: finishTime });
                else if (parseInt(ritualEastCount) < parseInt(ritualEastLimit))
                    instance.scheduleCommand({ type: 'ritual_east', body: `逛东市` });
                else if (parseInt(ritualWestCount) < parseInt(ritualWestLimit))
                    instance.scheduleCommand({ type: 'ritual_west', body: `逛西市` });
            } else if (response.match(this.RITUAL_FINISHED_PATTERN)) {
                instance.scheduleCommand({ type: 'ritual_claim', body: '领法器任务奖励' });
            }
        }
        if (command.type === 'ritual_accept')
            instance.scheduleCommand({ type: 'ritual_east', body: `逛东市` });
        if (command.type === 'ritual_east') {
            if (response.match(this.RITUAL_LIMIT_PATTERN))
                instance.updateStatus({ ritual: { finished: true } });
            this.registerScheduler(instance);
        }
        if (command.type === 'ritual_west') {
            if (response.match(this.RITUAL_LIMIT_PATTERN))
                instance.updateStatus({ ritual: { finished: true } });
            this.registerScheduler(instance);
        }
        if (command.type === 'ritual_claim')
            instance.scheduleCommand({ type: 'ritual', body: '法器任务' });
    }

    async handleError(command: Command, error: Error, instance: GameInstance) {
        command = { ...command, type: 'ritual', body: '法器任务', retries: (command.retries || 0) + 1 };
        return command.retries! < 3 ? command : undefined;
    }

    registerScheduler(instance: GameInstance): void {
        const config = instance.account.config.ritual!;
        const status = instance.account.status.ritual;
        if (!config.enabled)
            return;
        instance.scheduleCommand({ type: 'ritual', body: '法器任务', date: status?.finishTime ?? getDate({ ...config.time, dayOffset: status?.finished ? 1 : 0 }) });
    }
}