// src/commands/impl/BountyHandler.ts

import { Command } from '../../server/types';
import { CommandHandler } from '../CommandHandler';
import { GameInstance } from '../../server/core/GameInstance';
import { parseDate, getDate, min } from '../../utils/TimeUtils';

export default class BountyHandler implements CommandHandler {
    readonly category = 'bounty';
    readonly COMMAND_TYPE = new Map([
        ['查看宗门悬赏', 'bounty'],
        ['领宗门悬赏', 'bounty_claim'],
        ['接宗门悬赏', 'bounty_accept'],
        ['刷新宗门悬赏', 'bounty_refresh'],
        ['加速完成宗门悬赏', 'bounty_accelerate'],
    ]);
    readonly RESPONSE_PATTERN = new Map([
        ['bounty', /已领任务/],
        ['bounty_claim', /领宗门悬赏成功/],
        ['bounty_accept', /接收悬赏成功/],
        ['bounty_refresh', /刷新成功/],
        ['bounty_accelerate', /已完成加速/],
    ])
    readonly ACCEPTED_LIMIT_PATTERN = /(?<accepted>\d+)\/(?<limit>\d+)/;
    readonly UPDATE_TIME_PATTERN = /下次自动刷新时间:.*?(?<hours>\d+):(?<minutes>\d+):(?<seconds>\d+)/;
    readonly TIME_LEFT_PATTERN = /剩余(?<minutes>\d+)分钟/;
    readonly TIME_LEFT_PATTERN_GLOBAL = /剩余(?<minutes>\d+)分钟/g;
    readonly CLAIM_PATTERN_GLOBAL = /待领奖励/g;

    async handleResponse(command: Command, response: string, instance: GameInstance) {
        instance.account.status.bounty = instance.account.status.bounty || {};
        const config = instance.account.config.bounty!;
        if (command.type === 'bounty') {
            const { accepted, limit } = response.match(this.ACCEPTED_LIMIT_PATTERN)!.groups!;
            const finished = accepted === limit;
            const updateTime = finished ? getDate({ ...config.time!, dayOffset: 1 }) : min(parseDate(response, this.UPDATE_TIME_PATTERN)!, getDate({ ...config.time!, dayOffset: 1 }));
            const claimTimes: Date[] = [];
            response.match(this.CLAIM_PATTERN_GLOBAL)?.forEach((match) => claimTimes.push(new Date()));
            response.match(this.TIME_LEFT_PATTERN_GLOBAL)?.forEach((match) => claimTimes.push(parseDate(match, this.TIME_LEFT_PATTERN)!));
            const current = (response.match(this.CLAIM_PATTERN_GLOBAL)?.length || 0) + (response.match(this.TIME_LEFT_PATTERN_GLOBAL)?.length || 0);
            const claimTime = claimTimes.length > 0 ? Math.min(...claimTimes.map(date => date.getTime())) : undefined;
            const ACCEPT_PATTERN = new RegExp(`(?<next>\\d+):(${config.bountyTypes!.join('|')}).*\\n+.*需要时间`);
            const next = response.match(ACCEPT_PATTERN)?.groups?.next;
            instance.updateStatus({ bounty: { accepted: parseInt(accepted), limit: parseInt(limit), updateTime, claimTimes } });
            const updateDate = new Date(updateTime).setHours(0, 0, 0, 0);
            const currentDate = new Date().setHours(0, 0, 0, 0);
            if (!finished && updateDate !== currentDate) {
                const remaining = parseInt(limit) - parseInt(accepted);
                if (3 - current < remaining && remaining <= 3)
                    instance.scheduleCommand({ type: 'bounty_accelerate', body: '加速完成宗门悬赏' });
                else if (next)
                    instance.scheduleCommand({ type: 'bounty_accept', body: `接宗门悬赏 ${next}` });
                else if (instance.account.status.bounty.refreshCount! < config.refreshLimit!)
                    instance.scheduleCommand({ type: 'bounty_refresh', body: '刷新宗门悬赏' });
            } else if (!finished && next && current < 3)
                instance.scheduleCommand({ type: 'bounty_accept', body: `接宗门悬赏 ${next}` });
            if (claimTime)
                instance.scheduleCommand({ type: 'bounty_claim', body: '领宗门悬赏', date: new Date(claimTime) });
        } else if (command.type === 'bounty_refresh') {
            const refreshCount = (instance.account.status.bounty.refreshCount || 0) + 1;
            instance.updateStatus({ bounty: { refreshCount, updateTime: undefined } });
        } else
            instance.updateStatus({ bounty: { updateTime: undefined } });
        this.registerScheduler(instance);
    }

    async handleError(command: Command, error: Error, instance: GameInstance) {
        command = { ...command, type: 'bounty', body: '查看宗门悬赏', retries: (command.retries || 0) + 1 };
        return command.retries! < 3 ? command : undefined;
    }

    registerScheduler(instance: GameInstance): void {
        const config = instance.account.config.bounty!;
        const status = instance.account.status.bounty;
        if (!config.enabled)
            return;
        instance.scheduleCommand({ type: 'bounty', body: '查看宗门悬赏', date: status?.updateTime });
    }
}