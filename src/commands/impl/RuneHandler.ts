// src/commands/impl/RuneHandler.ts

import { Command } from '../../server/types';
import { CommandHandler } from '../CommandHandler';
import { GameInstance } from '../../server/core/GameInstance';
import { getDate, parseFullDate } from '../../utils/TimeUtils';

export default class RuneHandler implements CommandHandler {
    readonly category = 'rune';
    readonly COMMAND_TYPE = new Map([
        ['制符任务', 'rune'],
        ['接制符任务', 'rune_accept'],
        ['收集制符材料', 'rune_gather'],
        ['绘制灵符', 'rune_make'],
        ['领制符任务奖励', 'rune_claim'],
    ]);
    readonly RESPONSE_PATTERN = new Map([
        ['rune', /制符任务如下/],
        ['rune_accept', /已接制符任务/],
        ['rune_gather', /正在收集制符材料|每天最多收集或者绘制/],
        ['rune_make', /开始绘制|每天最多收集或者绘制/],
        ['rune_claim', /领取成功/],
    ])
    readonly RUNE_AVAILABLE_PATTERN = /任务序号:(?<runeTaskId>\d+)\n任务名称:.*?\n任务状态:未接\(0\/(?<runeTaskLimit>\d+)\)/;
    readonly RUNE_CURRENT_PATTERN = /任务序号:(?<runeTaskId>\d+)\n任务名称:.*?\n任务状态:进行中\((?<runeGathered>\d+)\/(?<runeTaskLimit>\d+)\)\((?<runeMaked>\d+)\/\d+\)/;
    readonly RUNE_LIMIT_PATTERN = /每天最多收集或者绘制/;
    readonly RUNE_FINISHED_PATTERN = /可领取奖励/;

    async handleResponse(command: Command, response: string, instance: GameInstance) {
        instance.account.status.rune = instance.account.status.rune || {};
        const config = instance.account.config.rune!;
        if (!config.enabled)
            return;
        if (command.type === 'rune') {
            if (response.match(this.RUNE_AVAILABLE_PATTERN)) {
                const { runeTaskId, runeTaskLimit } = response.match(this.RUNE_AVAILABLE_PATTERN)!.groups!;
                instance.updateStatus({ rune: { runeTaskId: parseInt(runeTaskId), runeTaskLimit: parseInt(runeTaskLimit), runeGathered: 0, runeMaked: 0, finished: false } });
                instance.scheduleCommand({ type: 'rune_accept', body: `接制符任务 ${runeTaskId}` });
            }
            else if (response.match(this.RUNE_CURRENT_PATTERN)) {
                const { runeTaskId, runeTaskLimit, runeGathered, runeMaked } = response.match(this.RUNE_CURRENT_PATTERN)!.groups!;
                const finishTime = parseFullDate(response);
                instance.updateStatus({
                    rune: {
                        runeTaskId: parseInt(runeTaskId),
                        runeTaskLimit: parseInt(runeTaskLimit),
                        runeGathered: parseInt(runeGathered),
                        runeMaked: parseInt(runeMaked),
                        finishTime,
                        finished: false,
                    }
                });
                if (finishTime)
                    instance.scheduleCommand({ type: 'rune', body: `制符任务`, date: finishTime });
                else if (parseInt(runeGathered) < parseInt(runeTaskLimit))
                    instance.scheduleCommand({ type: 'rune_gather', body: `收集制符材料 ${parseInt(runeGathered) + 1}` });
                else if (parseInt(runeMaked) < parseInt(runeTaskLimit))
                    instance.scheduleCommand({ type: 'rune_make', body: `绘制灵符` });
            } else if (response.match(this.RUNE_FINISHED_PATTERN)) {
                instance.scheduleCommand({ type: 'rune_claim', body: '领制符任务奖励' });
            }
        }
        if (command.type === 'rune_accept')
            instance.scheduleCommand({ type: 'rune_gather', body: `收集制符材料 1` });
        if (command.type === 'rune_gather') {
            if (response.match(this.RUNE_LIMIT_PATTERN))
                instance.updateStatus({ rune: { finished: true } });
            this.registerScheduler(instance);
        }
        if (command.type === 'rune_make') {
            if (response.match(this.RUNE_LIMIT_PATTERN))
                instance.updateStatus({ rune: { finished: true } });
            this.registerScheduler(instance);
        }
        if (command.type === 'rune_claim')
            instance.scheduleCommand({ type: 'rune', body: '制符任务' });
    }

    async handleError(command: Command, error: Error, instance: GameInstance) {
        command = { ...command, type: 'rune', body: '制符任务', retries: (command.retries || 0) + 1 };
        return command.retries! < 3 ? command : undefined;
    }

    registerScheduler(instance: GameInstance): void {
        const config = instance.account.config.rune!;
        const status = instance.account.status.rune;
        if (!config.enabled)
            return;
        instance.scheduleCommand({ type: 'rune', body: '制符任务', date: status?.finishTime ?? getDate({ ...config.time, dayOffset: status?.finished ? 1 : 0 }) });
    }
}