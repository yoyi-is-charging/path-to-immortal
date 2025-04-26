// src/commands/impl/MeditationHandler.ts

import { Command } from '../../server/types';
import { CommandHandler } from '../CommandHandler';
import { GameInstance } from '../../server/core/GameInstance';
import { parseDate } from '../../utils/TimeUtils';


export default class GardenHandler implements CommandHandler {
    readonly category = 'garden';
    readonly COMMAND_TYPE = new Map([
        ['药园', 'garden'],
        ['一键种植', 'garden'],
        ['收获', 'garden'],
        ['一键催熟', 'garden_ripe'],
    ]);
    readonly RESPONSE_PATTERN = new Map([
        ['garden', /目前药园种植情况|一键种植成功|请先购买种子|区域1|分钟后可来收获|暂无种植的区域/],
        ['garden_ripe', /催熟符不足|一键催熟成功|每人每天可催熟30次/],
    ]);
    readonly TIME_LEFT_PATTERN = /(?<minutes>\d+)分钟成熟/;
    readonly RIPE_COUNT_PATTERN = /催熟次数-1\/(?<ripeCount>\d+)/;
    readonly FINISH_TIME_PATTERN = /预计成熟.*?(?<hours>\d+):(?<minutes>\d+):(?<seconds>\d+)/;
    readonly FINISHED_PATTERN = /已成熟/;
    readonly NO_SEEDS_PATTERN = /请先购买种子/;

    async handleResponse(command: Command, response: string, instance: GameInstance) {
        instance.account.status.garden = instance.account.status.garden || {};
        const config = instance.account.config.garden!;
        const status = instance.account.status.garden;
        if (command.type === 'garden_ripe') {
            let ripeCount = 0;
            if (this.RIPE_COUNT_PATTERN.test(response))
                ripeCount = parseInt(response.match(this.RIPE_COUNT_PATTERN)!.groups!.ripeCount);
            instance.updateStatus({ garden: { ripen: { ripeCount } } });
            instance.scheduleCommand({ type: 'garden', body: `一键种植 ${ripeCount > 0 ? config.ripen?.seedType : config.seedType}` });
        }
        if (command.type === 'garden') {
            if (this.FINISHED_PATTERN.test(response)) {
                instance.updateStatus({ garden: { inProgress: true, finishTime: new Date() } });
                instance.scheduleCommand({ type: 'garden', body: '收获' });
                return;
            }
            const finishTime = parseDate(response, this.FINISH_TIME_PATTERN) ?? parseDate(response, this.TIME_LEFT_PATTERN);
            const inProgress = finishTime !== undefined;
            const noSeeds = this.NO_SEEDS_PATTERN.test(response);
            if (config.ripen?.enabled && (status.ripen?.ripeCount === undefined || status.ripen.ripeCount > 0) && inProgress) {
                instance.updateStatus({ garden: { inProgress, finishTime, ripen: { noSeeds } } });
                instance.scheduleCommand({ type: 'garden_ripe', body: '一键催熟' });
                return;
            }
            instance.updateStatus({ garden: { inProgress, finishTime, noSeeds } });
            if (!inProgress && !noSeeds)
                instance.scheduleCommand({ type: 'garden', body: `一键种植 ${config.seedType}` });
            if (inProgress)
                instance.scheduleCommand({ type: 'garden', body: '收获', date: finishTime });
        }
    }

    async handleError(command: Command, error: Error, instance: GameInstance) {
        command = { ...command, type: 'garden', body: '药园', retries: (command.retries || 0) + 1 };
        return command.retries! < 3 ? command : undefined;
    }

    registerScheduler(instance: GameInstance): void {
        const config = instance.account.config.garden!;
        if (!config.enabled)
            return;
        if (instance.account.status.garden?.finishTime)
            instance.scheduleCommand({ type: 'garden', body: '收获', date: instance.account.status.garden.finishTime });
        else
            instance.scheduleCommand({ type: 'garden', body: '药园' });
    }
}