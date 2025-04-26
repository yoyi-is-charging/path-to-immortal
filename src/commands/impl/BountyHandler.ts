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
    ]);
    readonly RESPONSE_PATTERN = new Map([
        ['bounty', /已领任务/],
        ['bounty_claim', /领宗门悬赏成功/],
        ['bounty_accept', /接收悬赏成功/],
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
            const updateTime = finished ? getDate({}) : min(parseDate(response, this.UPDATE_TIME_PATTERN)!, getDate({}));
            const claimTimes: Date[] = [];
            response.match(this.CLAIM_PATTERN_GLOBAL)?.forEach((match) => claimTimes.push(new Date()));
            response.match(this.TIME_LEFT_PATTERN_GLOBAL)?.forEach((match) => claimTimes.push(parseDate(match, this.TIME_LEFT_PATTERN)!));
            const claimTime = claimTimes.length > 0 ? Math.min(...claimTimes.map(date => date.getTime())) : undefined;
            const ACCEPT_PATTERN = new RegExp(`(?<next>\\d+):(${config.bountyTypes!.join('|')}).*\\n\\n.*需要时间`);
            const next = response.match(ACCEPT_PATTERN)?.groups?.next;
            instance.updateStatus({ bounty: { accepted: parseInt(accepted), limit: parseInt(limit), updateTime, claimTimes } });
            if (next && !finished && claimTimes.length < 3)
                instance.scheduleCommand({ type: 'bounty_accept', body: `接宗门悬赏 ${next}` });
            if (claimTime)
                instance.scheduleCommand({ type: 'bounty_claim', body: '领宗门悬赏', date: new Date(claimTime) });
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