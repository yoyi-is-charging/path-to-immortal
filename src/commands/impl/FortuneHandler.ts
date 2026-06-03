// src/commands/impl/FortuneHandler.ts

import { GameInstance } from "../../server/core/GameInstance";
import { Command, Status } from "../../server/types";
import { getDate } from "../../utils/TimeUtils";
import { CommandHandler } from "../CommandHandler";

type FortuneStatus = NonNullable<Status['fortune']>;
type FortuneResponse = { type: 'completed'; commandType: string };
type FortuneEffect =
    | { type: 'patchStatus'; status: FortuneStatus }
    | { type: 'registerTypeScheduler'; commandType: string };

export default class FortuneHandler implements CommandHandler {
    readonly category = 'fortune';
    readonly COMMAND_TYPE = new Map([
        ['进攻矿山', 'fortune_occupation'],
        ['抽气运', 'fortune_draw'],
        ['加入战场', 'fortune_realmWar'],
        ['参加仙圣道战', 'fortune_levelWar'],
        ['参加宗门混战', 'fortune_sectWar'],
        ['参加道法神战', 'fortune_daoWar'],
        ['参加区战力', 'fortune_serverWar'],
        ['参加同境混战', 'fortune_stateWar'],
    ])

    readonly RESPONSE_PATTERN = new Map([
        ['fortune_occupation', /[仙妖魔]界矿山/],
        ['fortune_draw', /已参加.*抽气运/],
        ['fortune_levelWar', /[上中下]路/],
        ['fortune_realmWar', /已加入战场/],
        ['fortune_sectWar', /宗门最多上阵|本周已经参加过/],
        ['fortune_daoWar', /已加入道法神战|号战场/],
        ['fortune_serverWar', /已加入区战力/],
        ['fortune_stateWar', /参加同境混战/],
    ])

    async handleResponse(command: Command, response: string, instance: GameInstance) {
        instance.account.status.fortune = instance.account.status.fortune || {};
        const fortuneResponse = this.parseResponse(command);
        const effects = this.transition(instance.account.status.fortune, fortuneResponse);
        for (const effect of effects)
            await this.applyEffect(effect, instance);
    }

    async handleError(command: Command, error: Error, instance: GameInstance) {
        command.retries = (command.retries || 0) + 1;
        return command.retries! < 3 ? command : undefined;
    }

    registerScheduler(instance: GameInstance): void {
        ['fortune_occupation', 'fortune_draw', 'fortune_realmWar', 'fortune_levelWar', 'fortune_sectWar', 'fortune_daoWar', 'fortune_serverWar', 'fortune_stateWar'].forEach(type => this.registerTypeScheduler(instance, type));
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
            case 'fortune_draw':
                const drawCount = status?.drawCount || 0;
                if (drawCount < 3)
                    instance.scheduleCommand({ type, body: `抽气运 ${drawCount + 1}`, date: getDate({ ...config.time, dayOffset: 0 }) }, 1000);
                else
                    instance.scheduleCommand({ type, body: `抽气运 1`, date: getDate({ ...config.time, dayOffset: 1 }) });
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
                instance.scheduleCommand({ type, body: `参加道法神战 ${config.daoWar}`, date: getDate({ ...config.time, dayOffset: status?.daoWar ? 1 : 0 }) });
                break;
            case 'fortune_serverWar':
                instance.scheduleCommand({ type, body: `参加区战力`, date: getDate({ ...config.time, dayOffset: status?.serverWar ? 1 : 0 }) });
                break;
            case 'fortune_stateWar':
                instance.scheduleCommand({ type, body: `参加同境混战`, date: getDate({ ...config.time, dayOffset: status?.stateWar ? 1 : 0 }) });
                break;
        }
    }

    private parseResponse(command: Command): FortuneResponse {
        return { type: 'completed', commandType: command.type };
    }

    private transition(status: FortuneStatus, response: FortuneResponse): FortuneEffect[] {
        return [
            { type: 'patchStatus', status: this.statusPatch(status, response.commandType) },
            { type: 'registerTypeScheduler', commandType: response.commandType },
        ];
    }

    private statusPatch(status: FortuneStatus, commandType: string): FortuneStatus {
        switch (commandType) {
            case 'fortune_occupation':
                return { occupation: true };
            case 'fortune_draw':
                return { drawCount: (status.drawCount || 0) + 1 };
            case 'fortune_realmWar':
                return { realmWar: true };
            case 'fortune_levelWar':
                return { levelWar: true };
            case 'fortune_sectWar':
                return { sectWar: true };
            case 'fortune_daoWar':
                return { daoWar: true };
            case 'fortune_serverWar':
                return { serverWar: true };
            case 'fortune_stateWar':
                return { stateWar: true };
            default:
                return {};
        }
    }

    private async applyEffect(effect: FortuneEffect, instance: GameInstance) {
        switch (effect.type) {
            case 'patchStatus':
                await instance.updateStatus({ fortune: effect.status });
                break;
            case 'registerTypeScheduler':
                this.registerTypeScheduler(instance, effect.commandType);
                break;
        }
    }
}
