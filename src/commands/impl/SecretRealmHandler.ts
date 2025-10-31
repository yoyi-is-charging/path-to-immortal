// src/commands/impl/SecretRealmHandler.ts

import { Command } from '../../server/types';
import { CommandHandler } from '../CommandHandler';
import { GameInstance } from '../../server/core/GameInstance';
import { getDate } from '../../utils/TimeUtils';


export default class SecretRealmHandler implements CommandHandler {
    readonly category = 'secretRealm';
    readonly COMMAND_TYPE = new Map([
        ['进入秘境', 'secretRealm_enter'],
        ['秘境选择', 'secretRealm_select'],
    ]);
    readonly RESPONSE_PATTERN = /注意选择合适的技能|仅可进入秘境1次|可以选择以下技能|今日本层秘境魔物已全部清除|秘境选择已过期|已进入秘境/;
    readonly MONSTER_PATTERN = /魔物境界:(?<monsterLevel>.*)/;
    readonly ENTERED_PATTERN = /已进入秘境/;
    readonly SKILL_PATTERN = /(?<index>\d+):(?<name>[^\(]*)\((?<type>[^\+]*)\+(?<strength>\d+)[%次]\)/;
    readonly SKILL_PATTERN_GLOBAL = /(?<index>\d+):(?<name>[^\(]*)\((?<type>[^\+]*)\+(?<strength>\d+)[%次]\)/g;

    async handleResponse(command: Command, response: string, instance: GameInstance) {
        instance.account.status.secretRealm = instance.account.status.secretRealm || {};
        const config = instance.account.config.secretRealm!;
        if (this.MONSTER_PATTERN.test(response)) {
            const monsterLevel = response.match(this.MONSTER_PATTERN)!.groups!.monsterLevel;
            const skillList = response.matchAll(this.SKILL_PATTERN_GLOBAL);
            const skills = Array.from(skillList).map((match) => ({
                index: parseInt(match.groups!.index) as 1 | 2 | 3,
                name: match.groups!.name.trim(),
                type: match.groups!.type.trim() as '攻击' | '防御' | '血量' | '免伤',
                strength: parseInt(match.groups!.strength)
            }));
            const selectedSkill = config.skillTypePriority!.map(type => skills.find(skill => skill.type === type)).filter(skill => skill !== undefined)[0];
            instance.updateStatus({ secretRealm: { inProgress: true, isFinished: false, monsterLevel, skill: selectedSkill } });
            instance.scheduleCommand({ type: 'secretRealm_select', body: `秘境选择 ${selectedSkill.index}` }, 1000);
        } else if (this.ENTERED_PATTERN.test(response)) {
            instance.updateStatus({ secretRealm: { inProgress: true, isFinished: false, monsterLevel: undefined, skill: undefined } });
            instance.scheduleCommand({ type: 'secretRealm_select', body: `秘境选择 1` }, 1000);
        } else {
            instance.updateStatus({ secretRealm: { inProgress: false, isFinished: true, monsterLevel: undefined, skill: undefined } });
            this.registerScheduler(instance);
        }
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
}