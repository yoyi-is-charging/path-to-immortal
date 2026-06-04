// src/commands/impl/GardenHandler.ts

import { Command, Config, GARDEN_SEED_TYPES, Status } from '../../server/types';
import { CommandHandler } from '../CommandHandler';
import { runEffects } from '../EffectRunner';
import { GameInstance } from '../../server/core/GameInstance';
import { readChineseDuration, readClockTime, readNumberAfter } from '../../utils/FieldExtractor';

type GardenStatus = NonNullable<Status['garden']>;
type GardenConfig = NonNullable<Config['garden']>;

type GardenResponse =
    | { type: 'ripened'; ripeCount: number }
    | { type: 'finished' }
    | { type: 'growing'; finishTime: Date; noSeeds: boolean; attemptedSeed?: GardenSeed; allowSeedFallback: boolean }
    | { type: 'idle'; noSeeds: boolean; attemptedSeed?: GardenSeed; allowSeedFallback: boolean }
    | { type: 'unmatched' };

type GardenEffect =
    | { type: 'patchStatus'; status: GardenStatus }
    | { type: 'patchConfig'; config: GardenConfig }
    | { type: 'scheduleCommand'; command: Command };

type GardenSeed = NonNullable<GardenConfig['seedType']>;

const GARDEN_COMMAND = {
    status: '药园',
    plant: '一键种植',
    harvest: '收获',
    ripen: '一键催熟',
} as const;

const GARDEN_SEEDS = [...GARDEN_SEED_TYPES] as GardenSeed[];

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
        ['garden_plantAfterRipen', /目前药园种植情况|一键种植成功|请先购买种子|区域1|分钟后可来收获|暂无种植的区域/],
        ['garden_ripe', /催熟符不足|一键催熟成功|每人每天可催熟30次/],
    ]);
    async handleResponse(command: Command, response: string, instance: GameInstance) {
        instance.account.status.garden = instance.account.status.garden || {};
        const config = instance.account.config.garden!;
        const status = instance.account.status.garden;
        const gardenResponse = this.parseResponse(command, response);
        const effects = this.transition(status, gardenResponse, config);
        await runEffects(effects, { instance, statusKey: 'garden', configKey: 'garden' });
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
        if (command.type !== 'garden' && command.type !== 'garden_plantAfterRipen')
            return { type: 'unmatched' };
        if (response.includes('已成熟'))
            return { type: 'finished' };
        const finishTime = readClockTime(response) ?? readChineseDuration(response);
        const noSeeds = response.includes('请先购买种子');
        const attemptedSeed = this.extractPlantSeed(command);
        const allowSeedFallback = command.type !== 'garden_plantAfterRipen';
        return finishTime
            ? { type: 'growing', finishTime, noSeeds, attemptedSeed, allowSeedFallback }
            : { type: 'idle', noSeeds, attemptedSeed, allowSeedFallback };
    }

    private transition(status: GardenStatus, response: GardenResponse, config: GardenConfig): GardenEffect[] {
        switch (response.type) {
            case 'ripened':
                return [
                    { type: 'patchStatus', status: { ripen: { ripeCount: response.ripeCount } } },
                    { type: 'scheduleCommand', command: { type: 'garden_plantAfterRipen', body: `${GARDEN_COMMAND.plant} ${response.ripeCount > 0 ? config.ripen?.seedType : config.seedType} 1` } },
                ];
            case 'finished':
                return [
                    { type: 'patchStatus', status: { inProgress: true, finishTime: new Date() } },
                    { type: 'scheduleCommand', command: { type: 'garden', body: GARDEN_COMMAND.harvest } },
                ];
            case 'growing':
                if (config.ripen?.enabled && (status.ripen?.ripeCount === undefined || status.ripen.ripeCount > 0)) {
                    const effects: GardenEffect[] = [
                        { type: 'patchStatus', status: { inProgress: true, finishTime: response.finishTime, seedFallback: undefined, ripen: { noSeeds: response.noSeeds } } },
                        { type: 'scheduleCommand', command: { type: 'garden_ripe', body: GARDEN_COMMAND.ripen } },
                    ];
                    effects.push(...this.seedConfigEffects(response, config));
                    return effects;
                }
                return [
                    { type: 'patchStatus', status: { inProgress: true, finishTime: response.finishTime, noSeeds: response.noSeeds, seedFallback: undefined } },
                    ...this.seedConfigEffects(response, config),
                    { type: 'scheduleCommand', command: { type: 'garden', body: GARDEN_COMMAND.harvest, date: response.finishTime } },
                ];
            case 'idle': {
                const fallback = this.seedFallbackEffects(status, response, config);
                if (fallback.length)
                    return fallback;
                const effects: GardenEffect[] = [
                    { type: 'patchStatus', status: { inProgress: false, finishTime: undefined, noSeeds: response.noSeeds, seedFallback: undefined } },
                ];
                if (!response.noSeeds)
                    effects.push({ type: 'scheduleCommand', command: { type: 'garden', body: `${GARDEN_COMMAND.plant} ${config.seedType} 1` } });
                return effects;
            }
            case 'unmatched':
                return [];
        }
    }

    private seedFallbackEffects(status: GardenStatus, response: Extract<GardenResponse, { type: 'idle' }>, config: GardenConfig): GardenEffect[] {
        if (!response.noSeeds || !response.allowSeedFallback)
            return [];
        const attemptedSeed = response.attemptedSeed ?? config.seedType;
        if (!attemptedSeed)
            return [];
        const triedSeeds = [...new Set([...(status.seedFallback?.triedSeeds ?? []), attemptedSeed])];
        const nextSeed = GARDEN_SEEDS.find(seed => !triedSeeds.includes(seed));
        if (!nextSeed)
            return [
                { type: 'patchStatus', status: { inProgress: false, finishTime: undefined, noSeeds: true, seedFallback: undefined } },
            ];
        return [
            { type: 'patchStatus', status: { inProgress: false, finishTime: undefined, noSeeds: false, seedFallback: { originalSeed: status.seedFallback?.originalSeed ?? config.seedType, triedSeeds } } },
            { type: 'scheduleCommand', command: { type: 'garden', body: `${GARDEN_COMMAND.plant} ${nextSeed} 1` } },
        ];
    }

    private seedConfigEffects(response: Extract<GardenResponse, { type: 'growing' }>, config: GardenConfig): GardenEffect[] {
        if (!response.allowSeedFallback || !response.attemptedSeed || response.attemptedSeed === config.seedType)
            return [];
        return [{ type: 'patchConfig', config: { seedType: response.attemptedSeed } }];
    }

    private extractPlantSeed(command: Command): GardenSeed | undefined {
        const body = typeof command.body === 'string'
            ? command.body
            : Array.isArray(command.body)
                ? command.body[0]?.str
                : undefined;
        const seed = GARDEN_SEEDS.find(seed => body?.includes(`${GARDEN_COMMAND.plant} ${seed}`));
        return seed;
    }
}
