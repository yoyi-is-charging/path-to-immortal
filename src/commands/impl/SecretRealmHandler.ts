// src/commands/impl/SecretRealmHandler.ts

import { Command, Config, Status } from '../../server/types';
import { CommandHandler } from '../CommandHandler';
import { runEffects } from '../EffectRunner';
import { GameInstance } from '../../server/core/GameInstance';
import { getDate } from '../../utils/TimeUtils';
import { readLineValue, readSkillOptions } from '../../utils/FieldExtractor';

type SecretRealmStatus = NonNullable<Status['secretRealm']>;
type SecretRealmConfig = NonNullable<Config['secretRealm']>;
type SecretRealmSkill = Required<NonNullable<SecretRealmStatus['skill']>>;
type SecretRealmSkillType = SecretRealmSkill['type'];

type SecretRealmResponse =
    | { type: 'skillOptions'; monsterLevel: string; skills: SecretRealmSkill[] }
    | { type: 'entered' }
    | { type: 'finished' }
    | { type: 'unmatched' };

type SecretRealmEffect =
    | { type: 'patchStatus'; status: SecretRealmStatus }
    | { type: 'scheduleCommand'; command: Command; delay?: number }
    | { type: 'registerScheduler' };

const SECRET_REALM_COMMAND = {
    enter: '进入秘境',
    select: '秘境选择',
} as const;

export default class SecretRealmHandler implements CommandHandler {
    readonly category = 'secretRealm';
    readonly COMMAND_TYPE = new Map([
        [SECRET_REALM_COMMAND.enter, 'secretRealm_enter'],
        [SECRET_REALM_COMMAND.select, 'secretRealm_select'],
    ]);
    readonly RESPONSE_PATTERN = /注意选择合适的技能|仅可进入秘境1次|可以选择以下技能|今日本层秘境魔物已全部清除|秘境选择已过期|已进入秘境/;

    async handleResponse(command: Command, response: string, instance: GameInstance) {
        instance.account.status.secretRealm = instance.account.status.secretRealm || {};
        const config = instance.account.config.secretRealm!;
        const secretRealmResponse = this.parseResponse(response);
        const effects = this.transition(secretRealmResponse, config);
        await runEffects(effects, { instance, statusKey: 'secretRealm', handler: this });
    }

    async handleError(command: Command, error: Error, instance: GameInstance) {
        command.retries = (command.retries || 0) + 1;
        const maxRetries = command.type === 'secretRealm_select' ? 20 : 3;
        return command.retries! < maxRetries ? command : undefined;
    }

    registerScheduler(instance: GameInstance): void {
        const config = instance.account.config.secretRealm!;
        if (!config.enabled)
            return;
        instance.scheduleCommand({
            type: 'secretRealm_enter', body: async (instance: GameInstance) => {
                await instance.waitForLevelUpdate();
                const level = instance.account.status.personalInfo?.level!;
                return `进入秘境 ${Math.floor((level - 28) / 18)}`;
            }, date: getDate({ ...config.time, dayOffset: instance.account.status.secretRealm?.isFinished ? 1 : 0 })
        });
    }

    private parseResponse(response: string): SecretRealmResponse {
        const monsterLevel = readLineValue(response, '魔物境界:');
        if (monsterLevel) {
            return {
                type: 'skillOptions',
                monsterLevel,
                skills: readSkillOptions(response).map(skill => ({
                    ...skill,
                    index: skill.index as 1 | 2 | 3,
                    type: skill.type as SecretRealmSkillType,
                })),
            };
        }
        if (response.includes('已进入秘境'))
            return { type: 'entered' };
        if (this.RESPONSE_PATTERN.test(response))
            return { type: 'finished' };
        return { type: 'unmatched' };
    }

    private transition(response: SecretRealmResponse, config: SecretRealmConfig): SecretRealmEffect[] {
        switch (response.type) {
            case 'skillOptions': {
                const selectedSkill = this.selectSkill(response.skills, config.skillTypePriority);
                return [
                    { type: 'patchStatus', status: { inProgress: true, isFinished: false, monsterLevel: response.monsterLevel, skill: selectedSkill } },
                    { type: 'scheduleCommand', command: { type: 'secretRealm_select', body: `${SECRET_REALM_COMMAND.select} ${selectedSkill?.index ?? 1}` }, delay: 1000 },
                ];
            }
            case 'entered':
                return [
                    { type: 'patchStatus', status: { inProgress: true, isFinished: false, monsterLevel: undefined, skill: undefined } },
                    { type: 'scheduleCommand', command: { type: 'secretRealm_select', body: `${SECRET_REALM_COMMAND.select} 1` }, delay: 1000 },
                ];
            case 'finished':
                return [
                    { type: 'patchStatus', status: { inProgress: false, isFinished: true, monsterLevel: undefined, skill: undefined } },
                    { type: 'registerScheduler' },
                ];
            case 'unmatched':
                return [];
        }
    }

    private selectSkill(skills: SecretRealmSkill[], priority: string[] = []): SecretRealmSkill | undefined {
        return priority
            .map(type => skills.find(skill => skill.type === type))
            .find((skill): skill is SecretRealmSkill => skill !== undefined)
            ?? skills[0];
    }

}
