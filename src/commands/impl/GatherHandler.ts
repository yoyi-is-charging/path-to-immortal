// src/commands/impl/GatherHandler.ts

import { Command } from '../../server/types';
import { CommandHandler } from '../CommandHandler';
import { GameInstance } from '../../server/core/GameInstance';
import { getDate, parseFullDate } from '../../utils/TimeUtils';

export default class GatherHandler implements CommandHandler {
    readonly category = 'gather';
    readonly COMMAND_TYPE = new Map([
        ['采集任务', 'gather'],
        ['接采集任务', 'gather_accept'],
        ['进入洞口', 'gather_enter'],
        ['采集阴阳花', 'gather_collect'],
        ['领采集任务奖励', 'gather_claim'],
    ]);
    readonly RESPONSE_PATTERN = new Map([
        ['gather', /采集任务如下/],
        ['gather_accept', /已接采集任务/],
        ['gather_enter', /预计找到日期/],
        ['gather_collect', /采集完毕/],
        ['gather_claim', /领取成功/],
    ])
    readonly GATHER_AVAILABLE_PATTERN = /任务序号:(?<gatherTaskId>\d+)\n任务名称:.*?\n任务状态:未接\(0\/(?<gatherTaskLimit>\d+)\)/;
    readonly GATHER_CURRENT_PATTERN = /任务序号:(?<gatherTaskId>\d+)\n任务名称:.*?\n任务状态:进行中\((?<gatherTaskProgress>\d+)\/(?<gatherTaskLimit>\d+)\)/;
    readonly GATHER_AVAILABLE_HOLE_PATTERN = /今日可进入的洞口:(?<nextHoleId>\d+)/;
    readonly GATHER_COLLECT_PATTERN = /已找到阴阳花/;
    readonly GATHER_FINISHED_PATTERN = /可领取奖励/;
    async handleResponse(command: Command, response: string, instance: GameInstance) {
        instance.account.status.gather = instance.account.status.gather || {};
        const config = instance.account.config.gather!;
        if (!config.enabled)
            return;
        if (command.type === 'gather') {
            if (response.match(this.GATHER_AVAILABLE_PATTERN)) {
                const { gatherTaskId, gatherTaskLimit } = response.match(this.GATHER_AVAILABLE_PATTERN)!.groups!;
                instance.updateStatus({ gather: { gatherTaskId: parseInt(gatherTaskId), gatherTaskLimit: parseInt(gatherTaskLimit), gatherTaskProgress: 0, finishTime: undefined } });
                instance.scheduleCommand({ type: 'gather_accept', body: `接采集任务 ${gatherTaskId}` });
            }
            else if (response.match(this.GATHER_CURRENT_PATTERN)) {
                const { gatherTaskId, gatherTaskLimit, gatherTaskProgress } = response.match(this.GATHER_CURRENT_PATTERN)!.groups!;
                const finishTime = parseFullDate(response);
                instance.updateStatus({ gather: { gatherTaskId: parseInt(gatherTaskId), gatherTaskLimit: parseInt(gatherTaskLimit), gatherTaskProgress: parseInt(gatherTaskProgress), finishTime } });
                if (finishTime)
                    instance.scheduleCommand({ type: 'gather_collect', body: `采集阴阳花`, date: finishTime });
                else if (response.match(this.GATHER_AVAILABLE_HOLE_PATTERN)) {
                    const { nextHoleId } = response.match(this.GATHER_AVAILABLE_HOLE_PATTERN)!.groups!;
                    instance.scheduleCommand({ type: 'gather_enter', body: `进入洞口 ${nextHoleId}` });
                }
                else if (response.match(this.GATHER_COLLECT_PATTERN))
                    instance.scheduleCommand({ type: 'gather_collect', body: `采集阴阳花` });
                else {
                    instance.updateStatus({ gather: { finished: true } });
                    this.registerScheduler(instance);
                }
            }
            else if (response.match(this.GATHER_FINISHED_PATTERN))
                instance.scheduleCommand({ type: 'gather_claim', body: '领采集任务奖励' });
        }
        else instance.scheduleCommand({ type: 'gather', body: '采集任务' });
    }

    async handleError(command: Command, error: Error, instance: GameInstance) {
        command = { ...command, type: 'gather', body: '采集任务', retries: (command.retries || 0) + 1 };
        return command.retries! < 3 ? command : undefined;
    }

    registerScheduler(instance: GameInstance): void {
        const config = instance.account.config.gather!;
        const status = instance.account.status.gather;
        if (!config.enabled)
            return;
        instance.scheduleCommand({ type: 'gather', body: '采集任务', date: getDate({ ...config.time, dayOffset: status?.finished ? 1 : 0 }) });
    }
}