import { Command, Status } from '../../server/types';
import { CommandHandler } from '../CommandHandler';
import { GameInstance } from '../../server/core/GameInstance';
import { getDate } from '../../utils/TimeUtils';
import { InstanceManager } from '../../server/core/InstanceManager';
import { readChineseDuration } from '../../utils/FieldExtractor';

type MeditationStatus = NonNullable<Status['meditation']>;

type MeditationResponse = {
    commandType: string;
    finishTime?: Date;
    exhausted: boolean;
    requestAbsorb: boolean;
};

type MeditationEffect =
    | { type: 'patchStatus'; instance: GameInstance; status: MeditationStatus }
    | { type: 'scheduleCommand'; instance: GameInstance; command: Command; delay?: number }
    | { type: 'registerScheduler'; instance: GameInstance };

const MEDITATION_COMMAND = {
    meditate: '打坐',
    absorb: '吸收灵力',
    tantricRequest: '双休',
    tantricResponse: '同意双休',
    partnerRequest: '道侣双休',
    partnerResponse: '同意道侣双休',
} as const;

export default class MeditationHandler implements CommandHandler {
    readonly category = 'meditation';
    readonly COMMAND_TYPE = new Map([
        [MEDITATION_COMMAND.meditate, 'meditation'],
        [MEDITATION_COMMAND.absorb, 'meditation'],
        [MEDITATION_COMMAND.tantricRequest, 'meditation_tantricRequest'],
        [MEDITATION_COMMAND.tantricResponse, 'meditation_tantricResponse'],
        [MEDITATION_COMMAND.partnerRequest, 'meditation_partnerRequest'],
        [MEDITATION_COMMAND.partnerResponse, 'meditation_partnerResponse'],
    ]);
    readonly RESPONSE_PATTERN = new Map([
        ['meditation', /请等待(打坐|双修|双休)完成|吸收灵力成功|你还没有打坐|需要消耗次数/],
        ['meditation_tantricRequest', /想和你一起双休|已经发起一个双休请求|请对方先吸收|需要消耗次数/],
        ['meditation_tantricResponse', /一起双休中|没找到你要同意的双休请求/],
        ['meditation_partnerRequest', /想和你一起道侣双休|已经发起一个道侣双休请求|请对方先吸收|需要消耗次数/],
        ['meditation_partnerResponse', /一起道侣双休中|没找到你要同意的道侣双休请求/],
    ]);
    async handleResponse(command: Command, response: string, instance: GameInstance) {
        instance.account.status.meditation = instance.account.status.meditation || {};
        const meditationResponse = this.parseResponse(command, response);
        const effects = this.transition(command, meditationResponse, instance);
        for (const effect of effects)
            await this.applyEffect(effect);
    }

    async handleError(command: Command, error: Error, instance: GameInstance) {
        command = { ...command, type: 'meditation', body: MEDITATION_COMMAND.absorb, retries: (command.retries || 0) + 1 };
        return command.retries! < 3 ? command : undefined;
    }

    registerScheduler(instance: GameInstance): void {
        const config = instance.account.config.meditation!;
        if (instance.account.status.meditation?.finishTime)
            instance.scheduleCommand({ type: 'meditation', body: MEDITATION_COMMAND.absorb, date: instance.account.status.meditation?.finishTime });
        else if (config.enabled)
            instance.scheduleCommand({ type: 'meditation', body: MEDITATION_COMMAND.absorb, date: getDate({ ...config.time!, dayOffset: instance.account.status.meditation?.exhausted ? 1 : 0 }) });
    }

    private parseResponse(command: Command, response: string): MeditationResponse {
        return {
            commandType: command.type,
            finishTime: readChineseDuration(response),
            exhausted: response.includes('需要消耗次数'),
            requestAbsorb: response.includes('请对方先吸收'),
        };
    }

    private transition(command: Command, response: MeditationResponse, instance: GameInstance): MeditationEffect[] {
        switch (response.commandType) {
            case 'meditation_tantricRequest':
                return this.transitionTantricRequest(command, response, instance);
            case 'meditation_tantricResponse':
                return this.transitionTantricResponse(response, instance);
            case 'meditation_partnerRequest':
                return this.transitionPartnerRequest(response, instance);
            case 'meditation_partnerResponse':
                return this.transitionPartnerResponse(response, instance);
            case 'meditation':
                return this.transitionMeditation(response, instance);
            default:
                return [];
        }
    }

    private transitionTantricRequest(command: Command, response: MeditationResponse, instance: GameInstance): MeditationEffect[] {
        const effects: MeditationEffect[] = [
            { type: 'patchStatus', instance, status: { exhausted: response.exhausted } },
        ];
        if (!response.exhausted) {
            const target = instance.account.status.meditation?.target;
            const targetInstance = target?.bytes_pb_reserve ? InstanceManager.findInstance(target.bytes_pb_reserve) : undefined;
            if (targetInstance && response.requestAbsorb) {
                effects.push(
                    { type: 'scheduleCommand', instance: targetInstance, command: { type: 'meditation', body: MEDITATION_COMMAND.absorb } },
                    { type: 'scheduleCommand', instance, command, delay: 1000 },
                );
            } else if (targetInstance) {
                const source = { str: instance.account.status.personalInfo!.str!, bytes_pb_reserve: instance.account.status.personalInfo!.bytes_pb_reserve! };
                effects.push(
                    { type: 'patchStatus', instance: targetInstance, status: { target: source } },
                    { type: 'scheduleCommand', instance: targetInstance, command: { type: 'meditation_tantricResponse', body: MEDITATION_COMMAND.tantricResponse } },
                );
            }
        } else {
            effects.push({ type: 'registerScheduler', instance });
        }
        return effects;
    }

    private transitionTantricResponse(response: MeditationResponse, instance: GameInstance): MeditationEffect[] {
        if (!response.finishTime)
            return [];
        const sourceInstance = InstanceManager.findInstance(instance.account.status.meditation?.target?.bytes_pb_reserve!);
        const effects: MeditationEffect[] = [
            { type: 'patchStatus', instance, status: { inProgress: true, finishTime: response.finishTime, exhausted: false } },
            { type: 'scheduleCommand', instance, command: { type: 'meditation', body: MEDITATION_COMMAND.absorb, date: response.finishTime } },
        ];
        if (sourceInstance)
            effects.push(
                { type: 'patchStatus', instance: sourceInstance, status: { inProgress: true, finishTime: response.finishTime, exhausted: false } },
                { type: 'scheduleCommand', instance: sourceInstance, command: { type: 'meditation', body: MEDITATION_COMMAND.absorb, date: response.finishTime } },
            );
        return effects;
    }

    private transitionPartnerRequest(response: MeditationResponse, instance: GameInstance): MeditationEffect[] {
        const effects: MeditationEffect[] = [
            { type: 'patchStatus', instance, status: { exhausted: response.exhausted } },
        ];
        if (!response.exhausted) {
            const retries = instance.account.status.meditation?.partner?.retries || 0;
            effects.push({ type: 'scheduleCommand', instance, command: { type: 'meditation', body: MEDITATION_COMMAND.absorb }, delay: Math.min(5000 * Math.pow(2, retries), 500000) });
        } else {
            effects.push({ type: 'registerScheduler', instance });
        }
        return effects;
    }

    private transitionPartnerResponse(response: MeditationResponse, instance: GameInstance): MeditationEffect[] {
        if (response.finishTime)
            return [
                { type: 'patchStatus', instance, status: { inProgress: true, finishTime: response.finishTime, exhausted: false, partner: { retries: 0 } } },
                { type: 'scheduleCommand', instance, command: { type: 'meditation', body: MEDITATION_COMMAND.absorb, date: response.finishTime } },
            ];
        const retries = instance.account.status.meditation?.partner?.retries || 0;
        return [
            { type: 'patchStatus', instance, status: { partner: { retries: retries + 1 } } },
            { type: 'scheduleCommand', instance, command: { type: 'meditation_partnerResponse', body: MEDITATION_COMMAND.partnerResponse }, delay: Math.min(5000 * Math.pow(2, retries), 500000) },
        ];
    }

    private transitionMeditation(response: MeditationResponse, instance: GameInstance): MeditationEffect[] {
        const config = instance.account.config.meditation!;
        const inProgress = response.finishTime !== undefined;
        const effects: MeditationEffect[] = [
            { type: 'patchStatus', instance, status: { inProgress, finishTime: response.finishTime, exhausted: response.exhausted } },
        ];
        if (config.enabled && !inProgress && !response.exhausted)
            effects.push(...this.nextMeditationStartEffects(instance));
        if (inProgress && response.finishTime)
            effects.push(...this.inProgressEffects(instance, response.finishTime));
        if (response.exhausted)
            effects.push({ type: 'registerScheduler', instance });
        return effects;
    }

    private nextMeditationStartEffects(instance: GameInstance): MeditationEffect[] {
        const config = instance.account.config.meditation!;
        const effects: MeditationEffect[] = [
            { type: 'patchStatus', instance, status: { target: undefined } },
        ];
        if (config.tantric?.enabled) {
            const targetInstance = this.findTantricTarget(config.tantric.targets ?? []);
            if (targetInstance) {
                const target = { str: targetInstance.account.status.personalInfo!.str!, bytes_pb_reserve: targetInstance.account.status.personalInfo!.bytes_pb_reserve! };
                effects.push(
                    { type: 'patchStatus', instance, status: { target } },
                    { type: 'scheduleCommand', instance, command: { type: 'meditation_tantricRequest', body: [{ str: MEDITATION_COMMAND.tantricRequest, bytes_pb_reserve: null }, target, { str: `${config.count}`, bytes_pb_reserve: null }] } },
                );
            } else if (config.tantric.autoMeditation) {
                effects.push({ type: 'scheduleCommand', instance, command: { type: 'meditation', body: `${MEDITATION_COMMAND.meditate} ${config.count}` } });
            }
            return effects;
        }
        if (config.partner?.enabled) {
            const retries = instance.account.status.meditation?.partner?.retries || 0;
            if (config.partner.isRequester) {
                effects.push(
                    { type: 'scheduleCommand', instance, command: { type: 'meditation_partnerRequest', body: `${MEDITATION_COMMAND.partnerRequest} ${config.count}` }, delay: Math.min(5000 * (Math.pow(2, retries) - 1), 500000) },
                    { type: 'patchStatus', instance, status: { partner: { retries: retries + 1 } } },
                );
            } else {
                effects.push({ type: 'scheduleCommand', instance, command: { type: 'meditation_partnerResponse', body: MEDITATION_COMMAND.partnerResponse }, delay: Math.min(5000 * Math.pow(2, retries), 500000) });
            }
            return effects;
        }
        effects.push({ type: 'scheduleCommand', instance, command: { type: 'meditation', body: `${MEDITATION_COMMAND.meditate} ${config.count}` } });
        return effects;
    }

    private inProgressEffects(instance: GameInstance, finishTime: Date): MeditationEffect[] {
        const effects: MeditationEffect[] = [
            { type: 'patchStatus', instance, status: { partner: { retries: 0 } } },
            { type: 'scheduleCommand', instance, command: { type: 'meditation', body: MEDITATION_COMMAND.absorb, date: finishTime } },
        ];
        const sourceInstance = InstanceManager.findInstance(instance.account.status.meditation?.target?.bytes_pb_reserve!);
        if (sourceInstance)
            effects.push(
                { type: 'patchStatus', instance: sourceInstance, status: { inProgress: true, finishTime, exhausted: false } },
                { type: 'scheduleCommand', instance: sourceInstance, command: { type: 'meditation', body: MEDITATION_COMMAND.absorb, date: finishTime } },
            );
        return effects;
    }

    private findTantricTarget(targets: string[]) {
        for (const target of targets) {
            const targetInstance = InstanceManager.findInstance(target);
            if (targetInstance && !targetInstance.account.status.meditation?.exhausted)
                return targetInstance;
        }
        return undefined;
    }

    private async applyEffect(effect: MeditationEffect) {
        switch (effect.type) {
            case 'patchStatus':
                await effect.instance.updateStatus({ meditation: effect.status });
                break;
            case 'scheduleCommand':
                await effect.instance.scheduleCommand(effect.command, effect.delay);
                break;
            case 'registerScheduler':
                this.registerScheduler(effect.instance);
                break;
        }
    }
}
