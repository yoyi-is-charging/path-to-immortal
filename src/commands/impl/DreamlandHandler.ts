// src/commands/impl/DreamlandHandler.ts

import { Command } from '../../server/types';
import { CommandHandler } from '../CommandHandler';
import { GameInstance } from '../../server/core/GameInstance';
import { getDate } from '../../utils/TimeUtils';



export default class DreamlandHandler implements CommandHandler {
    readonly category = 'dreamland';
    readonly COMMAND_TYPE = new Map([
        ['进入幻境', 'dreamland'],
        ['击杀幻兽', 'dreamland'],
        ['出幻境', 'dreamland'],
    ]);
    readonly RESPONSE_PATTERN = /已进入幻境|进入幻境已达上限|随周末活动一起开启|已击杀幻兽|已击杀全部幻兽|找到了生门/;
    readonly LEVEL_PATTERN = /(?<=\n[^幻].*LV)(?<level>\d+)/;
    readonly MONSTER_LEVEL_PATTERN = /幻兽(?<monsterIndex>\d+):.*LV(?<monsterLevel>\d+)/;
    readonly MONSTER_LEVEL_PATTERN_GLOBAL = /幻兽(?<monsterIndex>\d+):.*LV(?<monsterLevel>\d+)/g;
    readonly DOOR_PATTERN = /门(?<doorIndex>\d+):.*八宝罗盘响动/;

    async handleResponse(command: Command, response: string, instance: GameInstance) {
        instance.account.status.dreamland = instance.account.status.dreamland || {};
        if (this.LEVEL_PATTERN.test(response)) {
            const level = parseInt(response.match(this.LEVEL_PATTERN)!.groups!.level);
            const monsterLevels: Array<number | null> = new Array(5).fill(null);
            response.match(this.MONSTER_LEVEL_PATTERN_GLOBAL)?.forEach((match) => {
                const { monsterIndex, monsterLevel } = match.match(this.MONSTER_LEVEL_PATTERN)!.groups!;
                monsterLevels[parseInt(monsterIndex) - 1] = parseInt(monsterLevel);
            });
            const attackableMonsterIndex = monsterLevels.findIndex(monsterLevel => monsterLevel !== null && monsterLevel < level)!;
            instance.updateStatus({ dreamland: { inProgress: true, isFinished: true, level, monsterLevels } });
            instance.scheduleCommand({ type: 'dreamland', body: `击杀幻兽 ${attackableMonsterIndex + 1}` }, 1000);
        } else if (this.DOOR_PATTERN.test(response)) {
            const doorIndex = parseInt(response.match(this.DOOR_PATTERN)!.groups!.doorIndex);
            instance.updateStatus({ dreamland: { inProgress: true, isFinished: false, level: undefined, monsterLevels: undefined, doorIndex } });
            instance.scheduleCommand({ type: 'dreamland', body: `出幻境 ${doorIndex}` });
        } else {
            instance.updateStatus({ dreamland: { inProgress: false, isFinished: true, level: undefined, monsterLevels: undefined, doorIndex: undefined } });
            this.registerScheduler(instance);
        }
    }

    async handleError(command: Command, error: Error, instance: GameInstance) {
        command.retries = (command.retries || 0) + 1;
        return command.retries! < 3 ? command : undefined;
    }

    registerScheduler(instance: GameInstance): void {
        const config = instance.account.config.dreamland!;
        if (!config.enabled)
            return;
        instance.scheduleCommand({ type: 'dreamland', body: `进入幻境 ${config.type}`, date: getDate({ ...config.time, dayOffset: instance.account.status.dreamland?.isFinished ? 1 : 0 }) });
    }
}