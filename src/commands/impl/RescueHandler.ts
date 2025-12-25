// src/commands/impl/RescueHandler.ts

import { Command } from '../../server/types';
import { CommandHandler } from '../CommandHandler';
import { GameInstance } from '../../server/core/GameInstance';
import { getDate, parseFullDate } from '../../utils/TimeUtils';

export default class RescueHandler implements CommandHandler {
    readonly category = 'rescue';
    readonly COMMAND_TYPE = new Map([
        ['救援任务', 'rescue'],
        ['接救援任务', 'rescue_accept'],
        ['飞往', 'rescue_flyto'],
        ['领救援任务奖励', 'rescue_claim'],
    ]);
    readonly RESPONSE_PATTERN = new Map([
        ['rescue', /救援任务如下/],
        ['rescue_accept', /已接救援任务/],
        ['rescue_flyto', /预计到达日期|每天最多飞/],
        ['rescue_claim', /领取成功/],
    ])
    readonly RESCUE_AVAILABLE_PATTERN = /任务序号:(?<rescueTaskId>\d+)\n任务名称:.*?\n任务状态:未接\(0\/(?<rescueTaskLimit>\d+)\)/;
    readonly RESCUE_CURRENT_PATTERN = /任务序号:(?<rescueTaskId>\d+)\n任务名称:.*?\n任务状态:进行中\((?<rescueTaskProgress>\d+)\/(?<rescueTaskLimit>\d+)\)/;
    readonly RESCUE_FINISHED_PATTERN = /可领取奖励/;
    readonly RESCUE_LIMIT_PATTERN = /每天最多飞/;

    async handleResponse(command: Command, response: string, instance: GameInstance) {
        instance.account.status.rescue = instance.account.status.rescue || {};
        const config = instance.account.config.rescue!;
        if (!config.enabled)
            return;
        if (command.type === 'rescue') {
            if (response.match(this.RESCUE_AVAILABLE_PATTERN)) {
                const { rescueTaskId, rescueTaskLimit } = response.match(this.RESCUE_AVAILABLE_PATTERN)!.groups!;
                instance.updateStatus({ rescue: { rescueTaskId: parseInt(rescueTaskId), rescueTaskLimit: parseInt(rescueTaskLimit), rescueTaskProgress: 0, arrivalTime: undefined } });
                instance.scheduleCommand({ type: 'rescue_accept', body: `接救援任务 ${rescueTaskId}` });
            }
            else if (response.match(this.RESCUE_CURRENT_PATTERN)) {
                const { rescueTaskId, rescueTaskLimit, rescueTaskProgress } = response.match(this.RESCUE_CURRENT_PATTERN)!.groups!;
                const arrivalTime = parseFullDate(response);
                instance.updateStatus({ rescue: { rescueTaskId: parseInt(rescueTaskId), rescueTaskLimit: parseInt(rescueTaskLimit), rescueTaskProgress: parseInt(rescueTaskProgress), arrivalTime } });
                instance.scheduleCommand({ type: 'rescue_flyto', body: `飞往 ${parseInt(rescueTaskProgress) + 1}`, date: arrivalTime });
            } else if (response.match(this.RESCUE_FINISHED_PATTERN)) {
                instance.scheduleCommand({ type: 'rescue_claim', body: '领救援任务奖励' });
            }
        }
        if (command.type === 'rescue_accept')
            instance.scheduleCommand({ type: 'rescue_flyto', body: `飞往 1` });
        if (command.type === 'rescue_flyto') {
            instance.updateStatus({ rescue: { finished: true } });
            this.registerScheduler(instance);
        }
        if (command.type === 'rescue_claim')
            instance.scheduleCommand({ type: 'rescue', body: '救援任务' });
    }

    async handleError(command: Command, error: Error, instance: GameInstance) {
        command = { ...command, type: 'rescue', body: '救援任务', retries: (command.retries || 0) + 1 };
        return command.retries! < 3 ? command : undefined;
    }

    registerScheduler(instance: GameInstance): void {
        const config = instance.account.config.rescue!;
        const status = instance.account.status.rescue;
        if (!config.enabled)
            return;
        instance.scheduleCommand({ type: 'rescue', body: '救援任务', date: status?.arrivalTime ?? getDate({ ...config.time, dayOffset: status?.finished ? 1 : 0 }) });
    }
}