import { Command, Config, Status } from '../server/types';
import { GameInstance } from '../server/core/GameInstance';
import { logger } from '../utils/logger';
import { DebugLog } from '../utils/DebugLog';

export type HandlerEffect<TStatus = unknown, TConfig = unknown> =
    | { type: 'patchStatus'; status: TStatus; instance?: GameInstance }
    | { type: 'patchConfig'; config: TConfig; instance?: GameInstance }
    | { type: 'scheduleCommand'; command: Command; delay?: number; instance?: GameInstance }
    | { type: 'registerScheduler'; instance?: GameInstance }
    | { type: 'registerTypeScheduler'; commandType: string; instance?: GameInstance }
    | { type: 'logError'; message: string };

type EffectRunnerOptions = {
    instance: GameInstance;
    statusKey: keyof Status;
    configKey?: keyof Config;
    handler?: { registerScheduler: (instance: GameInstance) => void };
    registerTypeScheduler?: (instance: GameInstance, commandType: string) => void;
};

export async function runEffects(
    effects: ReadonlyArray<HandlerEffect>,
    options: EffectRunnerOptions,
) {
    for (const effect of effects)
        await runEffect(effect, options);
}

async function runEffect(effect: HandlerEffect, options: EffectRunnerOptions) {
    const target = 'instance' in effect && effect.instance ? effect.instance : options.instance;
    DebugLog.log('handlerEffect', 'apply', {
        accountId: target.account.id,
        effectType: effect.type,
        statusKey: options.statusKey,
        configKey: options.configKey,
        commandType: effect.type === 'scheduleCommand' ? effect.command.type : undefined,
    });
    switch (effect.type) {
        case 'patchStatus':
            await target.updateStatus({ [options.statusKey]: effect.status } as Partial<Status>);
            break;
        case 'patchConfig':
            if (!options.configKey)
                throw new Error(`configKey is required to apply patchConfig for ${String(options.statusKey)}`);
            await target.updateConfig({ [options.configKey]: effect.config } as Partial<Config>);
            break;
        case 'scheduleCommand':
            await target.scheduleCommand(effect.command, effect.delay);
            break;
        case 'registerScheduler':
            if (!options.handler)
                throw new Error(`handler is required to apply registerScheduler for ${String(options.statusKey)}`);
            options.handler.registerScheduler(target);
            break;
        case 'registerTypeScheduler':
            const registerTypeScheduler = options.registerTypeScheduler;
            if (!registerTypeScheduler)
                throw new Error(`registerTypeScheduler is required to apply ${effect.commandType}`);
            registerTypeScheduler(target, effect.commandType);
            break;
        case 'logError':
            logger.error(effect.message);
            break;
    }
}
