// src/commands/impl/FishingHandler.ts

import { Command } from '../../server/types';
import { CommandHandler } from '../CommandHandler';
import { GameInstance } from '../../server/core/GameInstance';
import { parseDate, getDate } from '../../utils/TimeUtils';


export default class Fishing implements CommandHandler {
    readonly category = 'fishing';
    readonly COMMAND_TYPE = new Map([
        ['进入鱼塘', 'fishing'],
        ['重新进入鱼塘', 'fishing'],
        ['甩杆', 'fishing'],
        ['拉杆', 'fishing'],
        ['离开鱼塘', 'fishing'],
    ]);
    readonly RESPONSE_PATTERN = /无法进入鱼塘|预计[上咬]钩时间|鱼情好|离开鱼塘/;
    readonly POSITION_PATTERN = /位置(?<position>\d+):鱼情好/;
    readonly PULL_TIME_PATTERN = /(?<hours>\d+)时(?<minutes>\d+)分(?<seconds>\d+)秒/;
    readonly LEAVE_PATTERN = /发送指令:离开鱼塘/;
    readonly FINISHED_PATTERN = /已离开鱼塘/;
    readonly BAIT_PATTERN = /饵料:-1\((?<bait>\d+)/;

    async handleResponse(command: Command, response: string, instance: GameInstance) {
        instance.account.status.fishing = instance.account.status.fishing || {};
        if (this.POSITION_PATTERN.test(response)) {
            const position = parseInt(response.match(this.POSITION_PATTERN)!.groups!.position);
            instance.updateStatus({ fishing: { inProgress: true, position, pullTime: undefined } });
            instance.scheduleCommand({ type: 'fishing', body: `甩杆 ${position}` });
        } else if (this.PULL_TIME_PATTERN.test(response)) {
            const pullTime = parseDate(response, this.PULL_TIME_PATTERN);
            const bait = response.match(this.BAIT_PATTERN)?.groups?.bait;
            instance.updateStatus({ fishing: { inProgress: true, bait: bait ? parseInt(bait) : instance.account.status.fishing.bait, position: undefined, pullTime } });
            instance.scheduleCommand({ type: 'fishing', body: '拉杆', date: pullTime });
        } else if (this.LEAVE_PATTERN.test(response)) {
            instance.updateStatus({ fishing: { inProgress: true, bait: 0, position: undefined, pullTime: undefined } });
            instance.scheduleCommand({ type: 'fishing', body: '离开鱼塘' });
        } else if (this.FINISHED_PATTERN.test(response)) {
            instance.updateStatus({ fishing: { inProgress: false, finishedCount: (instance.account.status.fishing.finishedCount || 0) + 1, bait: undefined, position: undefined, pullTime: undefined } });
            this.registerScheduler(instance);
        }
    }

    async handleError(command: Command, error: Error, instance: GameInstance) {
        const body = (instance.account.status.fishing?.inProgress || command.body.toString().includes('进入鱼塘')) ? (command.body === '拉杆' ? '甩杆' : '拉杆') : command.body;
        command = { ...command, body, retries: (command.retries || 0) + 1 };
        return command.retries! < 3 ? command : undefined;
    }

    registerScheduler(instance: GameInstance): void {
        const config = instance.account.config.fishing!;
        const status = instance.account.status.fishing;
        if (!config.enabled)
            return;
        if (status?.inProgress) {
            if (status.pullTime)
                instance.scheduleCommand({ type: 'fishing', body: '拉杆', date: status.pullTime });
            else
                instance.scheduleCommand({ type: 'fishing', body: '甩杆' });
        }
        else if (!status?.finishedCount)
            instance.scheduleCommand({ type: 'fishing', body: `进入鱼塘 ${config.levels![0]}`, date: getDate({ ...config.time!, dayOffset: 0 }) });
        else if (status?.finishedCount === 1 && config.levels!.length >= 2)
            instance.scheduleCommand({ type: 'fishing', body: `重新进入鱼塘 ${config.levels![1]}`, date: getDate({ ...config.time!, dayOffset: 0 }) });
        else
            instance.scheduleCommand({ type: 'fishing', body: `进入鱼塘 ${config.levels![0]}`, date: getDate({ ...config.time!, dayOffset: 1 }) });
    }
}