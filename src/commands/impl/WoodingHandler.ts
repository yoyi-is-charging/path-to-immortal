import { Command, Config, Status } from '../../server/types';
import { CommandHandler } from '../CommandHandler';
import { GameInstance } from '../../server/core/GameInstance';
import { getDate } from '../../utils/TimeUtils';
import { readChineseDuration, readFriendPriceOffers, readMinuteDuration, readNumberAfter } from '../../utils/FieldExtractor';

type WoodingStatus = NonNullable<Status['wooding']>;
type WoodingConfig = NonNullable<Config['wooding']>;
type WoodingSellType = 'wooding_sell' | 'wooding_sellFriend';

type FriendOffer = {
    id: string;
    price: number;
    reference?: string;
};

type WoodingResponse =
    | { type: 'entered' }
    | { type: 'waterScheduled'; waterTime: Date }
    | { type: 'stoppedGrowth' }
    | { type: 'finished' }
    | { type: 'priceInquiry'; price: number; amount: number; priceUpdateTime?: Date }
    | { type: 'priceUnavailable' }
    | { type: 'friendPriceInquiry'; amount: number; bestOffer?: FriendOffer }
    | { type: 'confirmSell'; sellType: WoodingSellType }
    | { type: 'sold' }
    | { type: 'energyReceived' }
    | { type: 'unmatched' };

type WoodingEffect =
    | { type: 'patchStatus'; status: WoodingStatus }
    | { type: 'scheduleCommand'; command: Command }
    | { type: 'registerTypeScheduler'; commandType: string };

const WOODING_COMMAND = {
    enter: '进入林场',
    water: '浇水',
    chop: '砍伐树木',
    priceInquiry: '我的树木',
    sell: '出售给木商',
    confirmSell: '确定出售给木商',
    friendPriceInquiry: '友商报价',
    sellFriend: '出售给友商',
    confirmSellFriend: '确定出售给友商',
    receiveEnergy: '领木商能量',
} as const;

export default class WoodingHandler implements CommandHandler {
    readonly category = 'wooding';
    readonly COMMAND_TYPE = new Map([
        [WOODING_COMMAND.enter, 'wooding'],
        [WOODING_COMMAND.water, 'wooding'],
        [WOODING_COMMAND.chop, 'wooding'],
        [WOODING_COMMAND.priceInquiry, 'wooding_priceInquiry'],
        [WOODING_COMMAND.sell, 'wooding_sell'],
        [WOODING_COMMAND.confirmSell, 'wooding_sell'],
        [WOODING_COMMAND.friendPriceInquiry, 'wooding_priceInquiryFriend'],
        [WOODING_COMMAND.sellFriend, 'wooding_sellFriend'],
        [WOODING_COMMAND.confirmSellFriend, 'wooding_sellFriend'],
        [WOODING_COMMAND.receiveEnergy, 'wooding_receiveEnergy'],
    ]);
    readonly RESPONSE_PATTERN = new Map([
        ['wooding', /已进入林场|已离开林场|无法进入林场|预计缺水时间|停止增长|砍伐完成|还未砍伐/],
        ['wooding_priceInquiry', /门前木商报架|还没种过树/],
        ['wooding_sell', /确定要出售给门前的木商|出售完成/],
        ['wooding_priceInquiryFriend', /友商高报价/],
        ['wooding_sellFriend', /确定要出售给友友的木商|出售完成/],
        ['wooding_receiveEnergy', /还没有获得木商能量|领木商能量成功/],
    ]);
    readonly ENTER_PATTERN = /已进入林场|还未砍伐/;
    readonly STOP_GROWTH_PATTERN = /停止增长/;
    readonly CONFIRM_SELL_PATTERN = /确定要出售/;
    readonly AMOUNT_THRESHOLD = 100;

    async handleResponse(command: Command, response: string, instance: GameInstance) {
        instance.account.status.wooding = instance.account.status.wooding || {};
        const config = instance.account.config.wooding!;
        const woodingResponse = this.parseResponse(command, response);
        const effects = this.transition(instance.account.status.wooding, woodingResponse, config);
        for (const effect of effects)
            await this.applyEffect(effect, instance);
    }

    async handleError(command: Command, error: Error, instance: GameInstance) {
        if (command.type === 'wooding_priceInquiryFriend')
            command.date = new Date(Date.now() + (instance.account.config.wooding!.friendPriceInquiryInterval || 0) * 60 * 1000);
        command.retries = (command.retries || 0) + 1;
        return command.retries! < 3 ? command : undefined;
    }

    registerScheduler(instance: GameInstance): void {
        ['wooding', 'wooding_priceInquiry', 'wooding_priceInquiryFriend', 'wooding_receiveEnergy'].forEach(type => this.registerTypeScheduler(instance, type));
    }

    registerTypeScheduler(instance: GameInstance, type: string): void {
        const status = instance.account.status.wooding;
        const config = instance.account.config.wooding!;
        switch (type) {
            case 'wooding':
                if (!config.enabled)
                    break;
                if (status?.inProgress)
                    instance.scheduleCommand({ type: 'wooding', body: WOODING_COMMAND.water, date: status.waterTime });
                else if (!status?.finishedCount)
                    instance.scheduleCommand({ type: 'wooding', body: `${WOODING_COMMAND.enter} ${config.levels![0]}`, date: getDate({ ...config.time, dayOffset: 0 }) });
                else if (status?.finishedCount === 1 && config.levels!.length >= 2)
                    instance.scheduleCommand({ type: 'wooding', body: `${WOODING_COMMAND.enter} ${config.levels![1]}`, date: getDate({ ...config.time, dayOffset: 0 }) });
                else
                    instance.scheduleCommand({ type: 'wooding', body: `${WOODING_COMMAND.enter} ${config.levels![0]}`, date: getDate({ ...config.time, dayOffset: 1 }) });
                break;
            case 'wooding_priceInquiry':
                instance.scheduleCommand({ type: 'wooding_priceInquiry', body: WOODING_COMMAND.priceInquiry, date: status?.priceUpdateTime });
                break;
            case 'wooding_priceInquiryFriend':
                instance.scheduleCommand({ type: 'wooding_priceInquiryFriend', body: WOODING_COMMAND.friendPriceInquiry, date: status?.friendPricesUpdateTime });
                break;
            case 'wooding_receiveEnergy':
                if (!config.enabled)
                    break;
                instance.scheduleCommand({ type: 'wooding_receiveEnergy', body: WOODING_COMMAND.receiveEnergy, date: getDate({ ...config.energyReceiveTime, dayOffset: status?.energyReceived ? 1 : 0 }) });
        }
    }

    private parseResponse(command: Command, response: string): WoodingResponse {
        switch (command.type) {
            case 'wooding':
                return this.parseWoodingResponse(response);
            case 'wooding_priceInquiry':
                return this.parsePriceInquiry(response);
            case 'wooding_priceInquiryFriend':
                return this.parseFriendPriceInquiry(response);
            case 'wooding_sell':
            case 'wooding_sellFriend':
                return this.CONFIRM_SELL_PATTERN.test(response)
                    ? { type: 'confirmSell', sellType: command.type }
                    : { type: 'sold' };
            case 'wooding_receiveEnergy':
                return { type: 'energyReceived' };
            default:
                return { type: 'unmatched' };
        }
    }

    private parseWoodingResponse(response: string): WoodingResponse {
        if (this.ENTER_PATTERN.test(response))
            return { type: 'entered' };
        const waterTime = readChineseDuration(response);
        if (waterTime)
            return { type: 'waterScheduled', waterTime };
        if (this.STOP_GROWTH_PATTERN.test(response))
            return { type: 'stoppedGrowth' };
        if (this.RESPONSE_PATTERN.get('wooding')!.test(response))
            return { type: 'finished' };
        return { type: 'unmatched' };
    }

    private parsePriceInquiry(response: string): WoodingResponse {
        const price = readNumberAfter(response, '门前木商报架:');
        const amount = readNumberAfter(response, '我的木块:');
        if (price === undefined || amount === undefined)
            return { type: 'priceUnavailable' };
        return {
            type: 'priceInquiry',
            price,
            amount,
            priceUpdateTime: readMinuteDuration(response, '分后更新'),
        };
    }

    private parseFriendPriceInquiry(response: string): WoodingResponse {
        const amount = readNumberAfter(response, '我的木块:');
        if (amount === undefined)
            return { type: 'unmatched' };
        const friendPrices = readFriendPriceOffers(response);
        const bestOffer = friendPrices
            .filter(offer => offer.duration > 0)
            .sort((left, right) => right.price - left.price)[0];

        if (!bestOffer)
            return { type: 'friendPriceInquiry', amount };

        return {
            type: 'friendPriceInquiry',
            amount,
            bestOffer,
        };
    }

    private transition(status: WoodingStatus, response: WoodingResponse, config: WoodingConfig): WoodingEffect[] {
        switch (response.type) {
            case 'entered':
                return [
                    { type: 'patchStatus', status: { inProgress: true, waterTime: new Date() } },
                    { type: 'scheduleCommand', command: { type: 'wooding', body: WOODING_COMMAND.water } },
                ];
            case 'waterScheduled':
                return [
                    { type: 'patchStatus', status: { inProgress: true, waterTime: response.waterTime } },
                    { type: 'scheduleCommand', command: { type: 'wooding', body: WOODING_COMMAND.water, date: response.waterTime } },
                ];
            case 'stoppedGrowth':
                return [
                    { type: 'patchStatus', status: { inProgress: true, waterTime: undefined } },
                    { type: 'scheduleCommand', command: { type: 'wooding', body: WOODING_COMMAND.chop } },
                ];
            case 'finished':
                return [
                    { type: 'patchStatus', status: { inProgress: false, finishedCount: (status.finishedCount || 0) + 1, waterTime: undefined } },
                    { type: 'registerTypeScheduler', commandType: 'wooding' },
                ];
            case 'priceInquiry':
                return this.transitionPriceInquiry(response, config);
            case 'friendPriceInquiry':
                return this.transitionFriendPriceInquiry(response, config);
            case 'confirmSell':
                return [
                    {
                        type: 'scheduleCommand',
                        command: {
                            type: response.sellType,
                            body: response.sellType === 'wooding_sell'
                                ? WOODING_COMMAND.confirmSell
                                : WOODING_COMMAND.confirmSellFriend,
                        },
                    },
                ];
            case 'energyReceived':
                return [
                    { type: 'patchStatus', status: { energyReceived: true } },
                    { type: 'scheduleCommand', command: { type: 'misc_abode', body: '全部转动' } },
                    { type: 'registerTypeScheduler', commandType: 'wooding_receiveEnergy' },
                ];
            case 'priceUnavailable':
            case 'sold':
            case 'unmatched':
                return [];
        }
    }

    private transitionPriceInquiry(response: Extract<WoodingResponse, { type: 'priceInquiry' }>, config: WoodingConfig): WoodingEffect[] {
        const effects: WoodingEffect[] = [
            { type: 'patchStatus', status: { price: response.price, amount: response.amount, priceUpdateTime: response.priceUpdateTime } },
            { type: 'scheduleCommand', command: { type: 'wooding_priceInquiry', body: WOODING_COMMAND.priceInquiry, date: response.priceUpdateTime } },
        ];
        if (config.minPrice && response.price >= config.minPrice && response.amount >= this.AMOUNT_THRESHOLD)
            effects.push({ type: 'scheduleCommand', command: { type: 'wooding_sell', body: `${WOODING_COMMAND.sell} ${response.amount}` } });
        return effects;
    }

    private transitionFriendPriceInquiry(response: Extract<WoodingResponse, { type: 'friendPriceInquiry' }>, config: WoodingConfig): WoodingEffect[] {
        const effects: WoodingEffect[] = [];
        const offer = response.bestOffer;
        if (offer?.reference && config.minPrice && offer.price >= config.minPrice && response.amount >= this.AMOUNT_THRESHOLD)
            effects.push({ type: 'scheduleCommand', command: { type: 'wooding_sellFriend', body: `${WOODING_COMMAND.sellFriend} ${response.amount} ${offer.reference}` } });
        if (config.friendPriceInquiryInterval) {
            const friendPricesUpdateTime = new Date(Date.now() + config.friendPriceInquiryInterval * 60 * 1000);
            effects.push(
                { type: 'patchStatus', status: { amount: response.amount, friendPricesUpdateTime } },
                { type: 'scheduleCommand', command: { type: 'wooding_priceInquiryFriend', body: WOODING_COMMAND.friendPriceInquiry, date: friendPricesUpdateTime } },
            );
        }
        return effects;
    }

    private async applyEffect(effect: WoodingEffect, instance: GameInstance) {
        switch (effect.type) {
            case 'patchStatus':
                await instance.updateStatus({ wooding: effect.status });
                break;
            case 'scheduleCommand':
                await instance.scheduleCommand(effect.command);
                break;
            case 'registerTypeScheduler':
                this.registerTypeScheduler(instance, effect.commandType);
                break;
        }
    }
}
