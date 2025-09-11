// src/commands/impl/WoodingHandler.ts

import { Command } from '../../server/types';
import { CommandHandler } from '../CommandHandler';
import { GameInstance } from '../../server/core/GameInstance';
import { parseDate, getDate } from '../../utils/TimeUtils';
import { EventBus } from '../../server/core/EventBus';


export default class WoodingHandler implements CommandHandler {
    readonly category = 'wooding';
    readonly COMMAND_TYPE = new Map([
        ['进入林场', 'wooding'],
        ['浇水', 'wooding'],
        ['砍伐树木', 'wooding'],
        ['我的树木', 'wooding_priceInquiry'],
        ['出售给木商', 'wooding_sell'],
        ['确定出售给木商', 'wooding_sell'],
        ['友商报价', 'wooding_priceInquiryFriend'],
        ['出售给友商', 'wooding_sellFriend'],
        ['确定出售给友商', 'wooding_sellFriend'],
        ['领木商能量', 'wooding_receiveEnergy'],
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
    readonly WATER_TIME_PATTERN = /(?<hours>\d+)时(?<minutes>\d+)分(?<seconds>\d+)秒/;
    readonly STOP_GROWTH_PATTERN = /停止增长/;
    readonly WOOD_PRICE_PATTERN = /门前木商报架:(?<price>\d+)/;
    readonly WOOD_BLOCK_PATTERN = /我的木块:(?<amount>\d+)/;
    readonly PRICE_UPDATE_PATTERN = /(?<minutes>\d+)分后更新/;
    readonly CONFIRM_SELL_PATTERN = /确定要出售/;
    readonly FRIEND_PRICE_PATTERN_GLOBAL = /(?<id>\d+):(?<price>\d+)\((?<duration>\d+)分后失效\)/g;
    readonly AMOUNT_THRESHOLD = 100;

    async handleResponse(command: Command, response: string, instance: GameInstance) {
        instance.account.status.wooding = instance.account.status.wooding || {};
        const config = instance.account.config.wooding!;
        if (command.type === 'wooding') {
            if (this.ENTER_PATTERN.test(response)) {
                instance.updateStatus({ wooding: { inProgress: true, waterTime: new Date() } });
                instance.scheduleCommand({ type: 'wooding', body: '浇水' });
            }
            else if (this.WATER_TIME_PATTERN.test(response)) {
                const waterTime = parseDate(response, this.WATER_TIME_PATTERN)!;
                instance.updateStatus({ wooding: { inProgress: true, waterTime } });
                instance.scheduleCommand({ type: 'wooding', body: '浇水', date: waterTime });
            } else if (this.STOP_GROWTH_PATTERN.test(response)) {
                instance.updateStatus({ wooding: { inProgress: true, waterTime: undefined } });
                instance.scheduleCommand({ type: 'wooding', body: '砍伐树木' });
            }
            else {
                instance.updateStatus({ wooding: { inProgress: false, finishedCount: (instance.account.status.wooding?.finishedCount || 0) + 1, waterTime: undefined } });
                this.registerTypeScheduler(instance, 'wooding');
            }
        }
        if (command.type === 'wooding_priceInquiry') {
            const price = parseInt(response.match(this.WOOD_PRICE_PATTERN)!.groups!.price);
            const amount = parseInt(response.match(this.WOOD_BLOCK_PATTERN)!.groups!.amount);
            const priceUpdateTime = parseDate(response, this.PRICE_UPDATE_PATTERN);
            instance.updateStatus({ wooding: { price, amount, priceUpdateTime } });
            instance.scheduleCommand({ type: 'wooding_priceInquiry', body: '我的树木', date: priceUpdateTime });
            if (config.minPrice && price >= config.minPrice) {
                if (process.env.BOT_CHAT_ID)
                    EventBus.emit('notification', { chatId: process.env.BOT_CHAT_ID, message: `木块价格已达到 ${price}，请及时出售` });
                if (amount >= this.AMOUNT_THRESHOLD)
                    instance.scheduleCommand({ type: 'wooding_sell', body: `出售给木商 ${amount}` });
            }
        }
        if (command.type === 'wooding_priceInquiryFriend') {
            const friendPrices = [...response.matchAll(this.FRIEND_PRICE_PATTERN_GLOBAL)];
            const amount = parseInt(response.match(this.WOOD_BLOCK_PATTERN)!.groups!.amount);
            const index = friendPrices.reduce((maxIndex, current, i) => {
                const duration = parseInt(current.groups!.duration);
                if (duration > 0 && (maxIndex === -1 || parseInt(current.groups!.price) > parseInt(friendPrices[maxIndex].groups!.price))) {
                    return i;
                }
                return maxIndex;
            }, -1);

            if (index >= 0) {
                const { id, price } = friendPrices[index].groups!;
                if (config.minPrice && parseInt(price) >= config.minPrice) {
                    const pattern = new RegExp(`友${id}.*出售给友商 数量 (?<reference>\\d+)0`);
                    const reference = response.match(pattern)!.groups!.reference;
                    if (process.env.BOT_CHAT_ID)
                        EventBus.emit('notification', { chatId: process.env.BOT_CHAT_ID, message: `友商${id} (uid:${reference}) 的木块报价已达到 ${price}，请及时出售` });
                    if (amount >= this.AMOUNT_THRESHOLD)
                        instance.scheduleCommand({ type: 'wooding_sellFriend', body: `出售给友商 ${amount} ${reference}` });
                }
            }
            if (config.friendPriceInquiryInterval) {
                const friendPricesUpdateTime = new Date(Date.now() + config.friendPriceInquiryInterval * 60 * 1000);
                instance.updateStatus({ wooding: { amount, friendPricesUpdateTime } });
                instance.scheduleCommand({ type: 'wooding_priceInquiryFriend', body: '友商报价', date: friendPricesUpdateTime });
            }
        }
        if (command.type === 'wooding_sell') {
            const isSelling = this.CONFIRM_SELL_PATTERN.test(response);
            if (isSelling)
                instance.scheduleCommand({ type: 'wooding_sell', body: '确定出售给木商' });
        }
        if (command.type === 'wooding_sellFriend') {
            const isSelling = this.CONFIRM_SELL_PATTERN.test(response);
            if (isSelling)
                instance.scheduleCommand({ type: 'wooding_sellFriend', body: '确定出售给友商' });
        }
        if (command.type === 'wooding_receiveEnergy') {
            instance.updateStatus({ wooding: { energyReceived: true } });
            this.registerTypeScheduler(instance, 'wooding_receiveEnergy');
        }
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
                    instance.scheduleCommand({ type: 'wooding', body: '浇水', date: status.waterTime });
                else if (!status?.finishedCount)
                    instance.scheduleCommand({ type: 'wooding', body: `进入林场 ${config.levels![0]}`, date: getDate({ ...config.time, dayOffset: 0 }) });
                else if (status?.finishedCount === 1 && config.levels!.length >= 2)
                    instance.scheduleCommand({ type: 'wooding', body: `进入林场 ${config.levels![1]}`, date: getDate({ ...config.time, dayOffset: 0 }) });
                else
                    instance.scheduleCommand({ type: 'wooding', body: `进入林场 ${config.levels![0]}`, date: getDate({ ...config.time, dayOffset: 1 }) });
                break;
            case 'wooding_priceInquiry':
                instance.scheduleCommand({ type: 'wooding_priceInquiry', body: '我的树木', date: status?.priceUpdateTime });
                break;
            case 'wooding_priceInquiryFriend':
                instance.scheduleCommand({ type: 'wooding_priceInquiryFriend', body: '友商报价', date: status?.friendPricesUpdateTime });
                break;
            case 'wooding_receiveEnergy':
                if (!config.enabled)
                    break;
                instance.scheduleCommand({ type: 'wooding_receiveEnergy', body: '领木商能量', date: getDate({ ...config.energyReceiveTime, dayOffset: status?.energyReceived ? 1 : 0 }) });
        }
    }
}