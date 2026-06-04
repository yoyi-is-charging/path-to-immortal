import { GameInstance } from '../../server/core/GameInstance';
import { Command, Config, MessageBody, Status } from '../../server/types';
import { CommandHandler } from '../CommandHandler';
import { runEffects } from '../EffectRunner';
import { readLineCounts } from '../../utils/FieldExtractor';

type BagStatus = NonNullable<Status['bag']>;
type BagConfig = NonNullable<Config['bag']>;

type BagResponse =
    | { type: 'items'; items: string[]; itemCounts: number[] }
    | { type: 'sendConfirm' }
    | { type: 'sendCompleted' }
    | { type: 'unmatched' };

type BagEffect =
    | { type: 'patchStatus'; status: BagStatus }
    | { type: 'scheduleCommand'; command: Command };

const BAG_COMMAND = {
    check: '我的背包',
    send: '送道具',
    confirmSend: '确定送道具',
} as const;

export default class BagHandler implements CommandHandler {
    readonly category = 'bag';
    readonly COMMAND_TYPE = new Map([
        [BAG_COMMAND.check, 'bag_check'],
        [BAG_COMMAND.send, 'bag_sendItem'],
        [BAG_COMMAND.confirmSend, 'bag_sendItem'],
    ]);
    readonly RESPONSE_PATTERN = new Map([
        ['bag_check', /我的背包如下/],
        ['bag_sendItem', /确定要送道具吗|成功送/],
    ]);

    async handleResponse(command: Command, response: string, instance: GameInstance) {
        instance.account.status.bag = instance.account.status.bag || {};
        const status = instance.account.status.bag;
        const config = instance.account.config.bag;
        const bagResponse = this.parseResponse(command, response);
        const effects = this.transition(status, bagResponse, config);
        await runEffects(effects, { instance, statusKey: 'bag' });
    }

    async handleError(command: Command, error: Error, instance: GameInstance) {
        command = { ...command, type: 'bag_check', body: BAG_COMMAND.check, retries: (command.retries || 0) + 1 };
        return command.retries! < 3 ? command : undefined;
    }

    private parseResponse(command: Command, response: string): BagResponse {
        if (command.type === 'bag_check') {
            const items = readLineCounts(response);
            return {
                type: 'items',
                items: items.map(item => item.name),
                itemCounts: items.map(item => item.count),
            };
        }
        if (command.type === 'bag_sendItem')
            return response.includes('确定要送道具吗') ? { type: 'sendConfirm' } : { type: 'sendCompleted' };
        return { type: 'unmatched' };
    }

    private transition(status: BagStatus, response: BagResponse, config?: BagConfig): BagEffect[] {
        switch (response.type) {
            case 'items': {
                const nextStatus = this.validateItems({ items: response.items, itemCounts: response.itemCounts }, config);
                return [
                    { type: 'patchStatus', status: nextStatus },
                    ...this.scheduleNextSend(nextStatus, config),
                ];
            }
            case 'sendConfirm':
                return config?.enabled
                    ? [{ type: 'scheduleCommand', command: { type: 'bag_sendItem', body: BAG_COMMAND.confirmSend } }]
                    : [];
            case 'sendCompleted': {
                if (!config?.enabled)
                    return [];
                const nextStatus = {
                    items: [...(status.items ?? [])].slice(1),
                    itemCounts: [...(status.itemCounts ?? [])].slice(1),
                };
                return [
                    { type: 'patchStatus', status: nextStatus },
                    ...this.scheduleNextSend(nextStatus, config),
                ];
            }
            case 'unmatched':
                return [];
        }
    }

    private validateItems(status: BagStatus, config?: BagConfig): BagStatus {
        const normalizedItems = (status.items ?? []).map(item => item === '双休丹' ? '双修丹' : item);
        const items = Object.fromEntries(normalizedItems.map((item, index) => [item, status.itemCounts![index]]));
        for (const key of ['抽卡券', '妖兽令', '心法令', '宠物蛋'])
            delete items[key];
        for (const reserved of config?.reservedItems || [])
            delete items[reserved];
        return { items: Object.keys(items), itemCounts: Object.values(items) };
    }

    private scheduleNextSend(status: BagStatus, config?: BagConfig): BagEffect[] {
        if (!config?.enabled || !status.items?.length)
            return [];
        const body: MessageBody = [
            { str: `${BAG_COMMAND.send} ${status.items[0]} ${status.itemCounts![0]}`, bytes_pb_reserve: null },
            { str: config.target?.str!, bytes_pb_reserve: config.target?.bytes_pb_reserve! },
        ];
        return [{ type: 'scheduleCommand', command: { type: 'bag_sendItem', body } }];
    }

}
