// src/commands/impl/BagHandler.cs

import { GameInstance } from '../../server/core/GameInstance';
import { Command } from '../../server/types';
import { CommandHandler } from '../CommandHandler';

export default class BagHandler implements CommandHandler {
    readonly category = 'bag';
    readonly COMMAND_TYPE = new Map([
        ['我的背包', 'bag_check'],
        ['送道具', 'bag_sendItem'],
        ['确定送道具', 'bag_sendItem'],
    ]);
    readonly RESPONSE_PATTERN = new Map([
        ['bag_check', /我的背包如下/],
        ['bag_sendItem', /确定要送道具吗|成功送/],
    ]);

    readonly SEND_CONFIRM_PATTERN = /确定要送道具吗/;

    readonly ITEM_COUNT_PATTERN_GLOBAL = /(?<=\n)(?<item>[^卡]\S+):(?<count>\d+)/g;

    async handleResponse(command: Command, response: string, instance: GameInstance) {
        instance.account.status.bag = instance.account.status.bag || {};
        const status = instance.account.status.bag;
        const config = instance.account.config.bag;
        if (command.type === 'bag_check') {
            const items = [...response.matchAll(this.ITEM_COUNT_PATTERN_GLOBAL)];
            status.items = items.map(match => match.groups!.item);
            status.itemCounts = items.map(match => parseInt(match.groups!.count));
            this.validateItems(instance);
        }
        if (!config?.enabled)
            return;
        if (command.type === 'bag_sendItem') {
            if (this.SEND_CONFIRM_PATTERN.test(response)) {
                instance.scheduleCommand({ type: 'bag_sendItem', body: '确定送道具' });
                return;
            } else {
                status.items!.shift();
                status.itemCounts!.shift();
            }
        }
        if (status.items!.length > 0)
            instance.scheduleCommand({ type: 'bag_sendItem', body: [{ str: `送道具 ${status.items![0]} ${status.itemCounts![0]}`, bytes_pb_reserve: null }, { str: config.target?.str!, bytes_pb_reserve: config.target?.bytes_pb_reserve! }] });
    }

    async handleError(command: Command, error: Error, instance: GameInstance) {
        command = { ...command, type: 'bag_check', body: '我的背包', retries: (command.retries || 0) + 1 };
        return command.retries! < 3 ? command : undefined;
    }

    validateItems(instance: GameInstance) {
        const status = instance.account.status.bag!;
        const config = instance.account.config.bag!;
        status.items = status.items!.map(item => item === '双休丹' ? '双修丹' : item);
        const items = Object.fromEntries(status.items!.map((item, index) => [item, status.itemCounts![index]]));
        for (const key of ['抽卡券', '妖兽令', '心法令', '宠物蛋'])
            delete items[key];
        for (const reserved of config.reservedItems || [])
            delete items[reserved];
        status.items = Object.keys(items);
        status.itemCounts = Object.values(items);
    }
}