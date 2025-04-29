// src/commands/impl/ZooHandler.ts

import { Command } from '../../server/types';
import { CommandHandler } from '../CommandHandler';
import { GameInstance } from '../../server/core/GameInstance';
import { getDate } from '../../utils/TimeUtils';


export default class ZooHandler implements CommandHandler {
    readonly category = 'zoo';
    readonly COMMAND_TYPE = new Map([
        ['进入妖兽园', 'zoo'],
        ['横扫', 'zoo'],
        ['力劈', 'zoo'],
        ['逃跑', 'zoo'],
    ]);
    readonly RESPONSE_PATTERN = /剩余妖兽|仅可进入妖兽园1次|妖兽已过期|被消灭了|已进入妖兽园/;
    readonly REMAINING_PATTERN = /剩余妖兽(?<remaining>\d+)/;
    readonly ENTERED_PATTERN = /已进入妖兽园/;
    readonly VERTICAL_PATTERN = /(?<=#)(?<monster_1>[^\(你]+)\(([0-9]+)\)\n(?<monster_2>[^\(你]+)\(([0-9]+)\)(\n(?<monster_3>[^\(你]+)\(([0-9]+)\))?/;
    readonly HORIZONTAL_PATTERN = /(?<=#)(?<monster_1>[^\(你]+)\(([0-9]+)\)((?<monster_2>[^\(你]+)\(([0-9]+)\))?((?<monster_3>[^\(你]+)\(([0-9]+)\))?/;
    readonly RETRY_THRESHOLD = 5;

    private retryCount = 0;

    async handleResponse(command: Command, response: string, instance: GameInstance) {
        instance.account.status.zoo = instance.account.status.zoo || {};
        const config = instance.account.config.zoo!;
        if (this.REMAINING_PATTERN.test(response)) {
            const remaining = parseInt(response.match(this.REMAINING_PATTERN)!.groups!.remaining);
            let choice: '横扫' | '力劈' | '逃跑' | undefined = undefined;
            if (remaining > 0) {
                const monstersVertical = response.match(this.VERTICAL_PATTERN)?.groups;
                const monstersHorizontal = response.match(this.HORIZONTAL_PATTERN)?.groups;
                choice = monstersVertical ? '力劈' : '横扫';
                if (config.autoEscape && this.retryCount < this.RETRY_THRESHOLD && remaining > 3 && monstersHorizontal!.monster_1.match(/王/) && (monstersVertical?.monster_3 || monstersHorizontal?.monster_3))
                    choice = '逃跑';
                if (choice === '逃跑')
                    this.retryCount++;
                else
                    this.retryCount = 0;
            }
            instance.updateStatus({ zoo: { inProgress: remaining > 0, isFinished: remaining === 0, remaining, choice } });
            if (choice)
                instance.scheduleCommand({ type: 'zoo', body: choice }, 1000);
        } else if (this.ENTERED_PATTERN.test(response)) {
            instance.updateStatus({ zoo: { inProgress: true, isFinished: false, remaining: undefined, choice: '逃跑' } });
            instance.scheduleCommand({ type: 'zoo', body: '逃跑' }, 1000);
        } else {
            instance.updateStatus({ zoo: { inProgress: false, isFinished: true, remaining: 0, choice: undefined } });
            this.registerScheduler(instance);
        }
    }

    async handleError(command: Command, error: Error, instance: GameInstance) {
        command.retries = (command.retries || 0) + 1;
        return command.retries! < 3 ? command : undefined;
    }

    registerScheduler(instance: GameInstance): void {
        const config = instance.account.config.zoo!;
        if (!config.enabled)
            return;
        instance.scheduleCommand({
            type: 'zoo', body: async (instance: GameInstance) => {
                await instance.waitForLevelUpdate();
                const level = instance.account.status.personalInfo?.level!;
                return `进入妖兽园 ${Math.floor((level - 10) / 9)}`;
            }, date: getDate({ ...config.time, dayOffset: instance.account.status.zoo?.isFinished ? 1 : 0 })
        });
    }
}