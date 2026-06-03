// src/commands/impl/GardenHandler.ts

import { Command, Config, Status } from '../../server/types';
import { CommandHandler } from '../CommandHandler';
import { GameInstance } from '../../server/core/GameInstance';
import { readChineseDuration, readClockTime, readNumberAfter } from '../../utils/FieldExtractor';

type GardenStatus = NonNullable<Status['garden']>;
type GardenConfig = NonNullable<Config['garden']>;

type GardenResponse =
    | { type: 'ripened'; ripeCount: number }
    | { type: 'finished' }
    | { type: 'growing'; finishTime: Date; noSeeds: boolean }
    | { type: 'idle'; noSeeds: boolean }
    | { type: 'unmatched' };

type GardenEffect =
    | { type: 'patchStatus'; status: GardenStatus }
    | { type: 'scheduleCommand'; command: Command };

const GARDEN_COMMAND = {
    status: '药园',
    plant: '一键种植',
    harvest: '收获',
    ripen: '一键催熟',
} as const;

export default class GardenHandler implements CommandHandler {
    readonly category = 'garden';
    readonly COMMAND_TYPE = new Map([
        [GARDEN_COMMAND.status, 'garden'],
        [GARDEN_COMMAND.plant, 'garden'],
        [GARDEN_COMMAND.harvest, 'garden'],
        [GARDEN_COMMAND.ripen, 'garden_ripe'],
    ]);
    readonly RESPONSE_PATTERN = new Map([
        ['garden', /目前药园种植情况|一键种植成功|请先购买种子|区域1|分钟后可来收获|暂无种植的区域/],
        ['garden_ripe', /催熟符不足|一键催熟成功|每人每天可催熟30次/],
    ]);
    async handleResponse(command: Command, response: string, instance: GameInstance) {
        instance.account.status.garden = instance.account.status.garden || {};
        const config = instance.account.config.garden!;
        const status = instance.account.status.garden;
        const gardenResponse = this.parseResponse(command, response);
        const effects = this.transition(status, gardenResponse, config);
        for (const effect of effects)
            await this.applyEffect(effect, instance);
    }

    async handleError(command: Command, error: Error, instance: GameInstance) {
        command = { ...command, type: 'garden', body: '药园', retries: (command.retries || 0) + 1 };
        return command.retries! < 3 ? command : undefined;
    }

    registerScheduler(instance: GameInstance): void {
        const config = instance.account.config.garden!;
        if (!config.enabled)
            return;
        if (instance.account.status.garden?.finishTime)
            instance.scheduleCommand({ type: 'garden', body: GARDEN_COMMAND.harvest, date: instance.account.status.garden.finishTime });
        else
            instance.scheduleCommand({ type: 'garden', body: GARDEN_COMMAND.status });
    }

    private parseResponse(command: Command, response: string): GardenResponse {
        if (command.type === 'garden_ripe') {
            return { type: 'ripened', ripeCount: readNumberAfter(response, '催熟次数-1/') ?? 0 };
        }
        if (command.type !== 'garden')
            return { type: 'unmatched' };
        if (response.includes('已成熟'))
            return { type: 'finished' };
        const finishTime = readClockTime(response) ?? readChineseDuration(response);
        const noSeeds = response.includes('请先购买种子');
        return finishTime
            ? { type: 'growing', finishTime, noSeeds }
            : { type: 'idle', noSeeds };
    }

    private transition(status: GardenStatus, response: GardenResponse, config: GardenConfig): GardenEffect[] {
        switch (response.type) {
            case 'ripened':
                return [
                    { type: 'patchStatus', status: { ripen: { ripeCount: response.ripeCount } } },
                    { type: 'scheduleCommand', command: { type: 'garden', body: `${GARDEN_COMMAND.plant} ${response.ripeCount > 0 ? config.ripen?.seedType : config.seedType} 1` } },
                ];
            case 'finished':
                return [
                    { type: 'patchStatus', status: { inProgress: true, finishTime: new Date() } },
                    { type: 'scheduleCommand', command: { type: 'garden', body: GARDEN_COMMAND.harvest } },
                ];
            case 'growing':
                if (config.ripen?.enabled && (status.ripen?.ripeCount === undefined || status.ripen.ripeCount > 0))
                    return [
                        { type: 'patchStatus', status: { inProgress: true, finishTime: response.finishTime, ripen: { noSeeds: response.noSeeds } } },
                        { type: 'scheduleCommand', command: { type: 'garden_ripe', body: GARDEN_COMMAND.ripen } },
                    ];
                return [
                    { type: 'patchStatus', status: { inProgress: true, finishTime: response.finishTime, noSeeds: response.noSeeds } },
                    { type: 'scheduleCommand', command: { type: 'garden', body: GARDEN_COMMAND.harvest, date: response.finishTime } },
                ];
            case 'idle': {
                const effects: GardenEffect[] = [
                    { type: 'patchStatus', status: { inProgress: false, finishTime: undefined, noSeeds: response.noSeeds } },
                ];
                if (!response.noSeeds)
                    effects.push({ type: 'scheduleCommand', command: { type: 'garden', body: `${GARDEN_COMMAND.plant} ${config.seedType} 1` } });
                return effects;
            }
            case 'unmatched':
                return [];
        }
    }

    private async applyEffect(effect: GardenEffect, instance: GameInstance) {
        switch (effect.type) {
            case 'patchStatus':
                await instance.updateStatus({ garden: effect.status });
                break;
            case 'scheduleCommand':
                await instance.scheduleCommand(effect.command);
                break;
        }
    }
}
