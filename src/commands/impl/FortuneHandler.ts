// src/commands/impl/FortuneHandler.ts

import { GameInstance } from "../../server/core/GameInstance";
import { Command } from "../../server/types";
import { getDate } from "../../utils/TimeUtils";
import { CommandHandler } from "../CommandHandler";

export default class FortuneHandler implements CommandHandler {
    readonly category = 'fortune';
    readonly COMMAND_TYPE = new Map([
        ['进攻矿山', 'fortune_occupation'],
        ['三界抽气运', 'fortune_realmDraw'],
        ['境界抽气运', 'fortune_levelDraw'],
        ['加入战场', 'fortune_realmWar'],
        ['参加仙圣道战', 'fortune_levelWar'],
        ['参加宗门混战', 'fortune_sectWar'],
        ['参加道道道战', 'fortune_daoWar'],
        ['参加区战力', 'fortune_serverWar']
    ])

    readonly RESPONSE_PATTERN = new Map([
        ['fortune_occupation', /[仙妖魔]界矿山/],
        ['fortune_realmDraw', /【[仙妖魔]界】/],
        ['fortune_levelDraw', /【[仙圣道]境】/],
        ['fortune_levelWar', /[上中下]路/],
        ['fortune_realmWar', /已加入战场/],
        ['fortune_sectWar', /宗门最多上阵|本周已经参加过/],
        ['fortune_daoWar', /已加入道道道战|号战场/],
        ['fortune_serverWar', /已加入区战力/]
    ])

    async handleResponse(command: Command, response: string, instance: GameInstance) {
        instance.account.status.fortune = instance.account.status.fortune || {};
        switch (command.type) {
            case 'fortune_occupation':
                instance.updateStatus({ fortune: { occupation: true } });
                break;
            case 'fortune_realmDraw':
                instance.updateStatus({ fortune: { realmDraw: true } });
                break;
            case 'fortune_levelDraw':
                instance.updateStatus({ fortune: { levelDraw: true } });
                break;
            case 'fortune_realmWar':
                instance.updateStatus({ fortune: { realmWar: true } });
                break;
            case 'fortune_levelWar':
                instance.updateStatus({ fortune: { levelWar: true } });
                break;
            case 'fortune_sectWar':
                instance.updateStatus({ fortune: { sectWar: true } });
                break;
            case 'fortune_daoWar':
                instance.updateStatus({ fortune: { daoWar: true } });
                break;
            case 'fortune_serverWar':
                instance.updateStatus({ fortune: { serverWar: true } });
                break;
        }
        this.registerTypeScheduler(instance, command.type);
    }

    async handleError(command: Command, error: Error, instance: GameInstance) {
        command.retries = (command.retries || 0) + 1;
        return command.retries! < 3 ? command : undefined;
    }

    registerScheduler(instance: GameInstance): void {
        ['fortune_occupation', 'fortune_realmDraw', 'fortune_levelDraw', 'fortune_realmWar', 'fortune_levelWar', 'fortune_sectWar', 'fortune_daoWar', 'fortune_serverWar'].forEach(type => this.registerTypeScheduler(instance, type));
    }

    registerTypeScheduler(instance: GameInstance, type: string): void {
        const status = instance.account.status.fortune;
        const config = instance.account.config.fortune!;
        if (!config.enabled)
            return;
        switch (type) {
            case 'fortune_occupation':
                instance.scheduleCommand({ type, body: `进攻矿山 ${config.occupation}`, date: getDate({ ...config.time, dayOffset: status?.occupation ? 1 : 0 }) });
                break;
            case 'fortune_realmDraw':
                instance.scheduleCommand({ type, body: `三界抽气运`, date: getDate({ ...config.time, dayOffset: status?.realmDraw ? 1 : 0 }) });
                break;
            case 'fortune_levelDraw':
                instance.scheduleCommand({ type, body: `境界抽气运`, date: getDate({ ...config.time, dayOffset: status?.levelDraw ? 1 : 0 }) });
                break;
            case 'fortune_realmWar':
                instance.scheduleCommand({ type, body: `加入战场 ${config.realmWar}`, date: getDate({ ...config.time, dayOffset: status?.realmWar ? 1 : 0 }) });
                break;
            case 'fortune_levelWar':
                instance.scheduleCommand({ type, body: `参加仙圣道战 ${config.levelWar}`, date: getDate({ ...config.time, dayOffset: status?.levelWar ? 1 : 0 }) });
                break;
            case 'fortune_sectWar':
                instance.scheduleCommand({ type, body: `参加宗门混战`, date: getDate({ ...config.time, dayOffset: status?.sectWar ? 1 : 0 }) });
                break;
            case 'fortune_daoWar':
                instance.scheduleCommand({ type, body: `参加道道道战 ${config.daoWar}`, date: getDate({ ...config.time, dayOffset: status?.daoWar ? 1 : 0 }) });
                break;
            case 'fortune_serverWar':
                instance.scheduleCommand({ type, body: `参加区战力`, date: getDate({ ...config.time, dayOffset: status?.serverWar ? 1 : 0 }) });
        }
    }
}