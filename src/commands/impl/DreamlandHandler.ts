import { Command, Config, Status } from '../../server/types';
import { CommandHandler } from '../CommandHandler';
import { GameInstance } from '../../server/core/GameInstance';
import { getDate } from '../../utils/TimeUtils';
import { readNumberAfter, readNumberedLines, readNumberFromLine } from '../../utils/FieldExtractor';

type DreamlandStatus = NonNullable<Status['dreamland']>;
type DreamlandConfig = NonNullable<Config['dreamland']>;

type DreamlandResponse =
    | { type: 'monsterList'; level: number; monsterLevels: Array<number | null> }
    | { type: 'doorFound'; doorIndex: number }
    | { type: 'finished' }
    | { type: 'unmatched' };

type DreamlandEffect =
    | { type: 'patchStatus'; status: DreamlandStatus }
    | { type: 'scheduleCommand'; command: Command; delay?: number }
    | { type: 'registerScheduler' };

const DREAMLAND_COMMAND = {
    enter: '进入幻境',
    attack: '击杀幻兽',
    leave: '出幻境',
} as const;

export default class DreamlandHandler implements CommandHandler {
    readonly category = 'dreamland';
    readonly COMMAND_TYPE = new Map([
        [DREAMLAND_COMMAND.enter, 'dreamland'],
        [DREAMLAND_COMMAND.attack, 'dreamland'],
        [DREAMLAND_COMMAND.leave, 'dreamland'],
    ]);
    readonly RESPONSE_PATTERN = /已进入幻境|进入幻境已达上限|随周末活动一起开启|已击杀幻兽|已击杀全部幻兽|找到了生门/;

    async handleResponse(command: Command, response: string, instance: GameInstance) {
        instance.account.status.dreamland = instance.account.status.dreamland || {};
        const dreamlandResponse = this.parseResponse(response);
        const effects = this.transition(dreamlandResponse);
        for (const effect of effects)
            await this.applyEffect(effect, instance);
    }

    async handleError(command: Command, error: Error, instance: GameInstance) {
        command.retries = (command.retries || 0) + 1;
        return command.retries! < 3 ? command : undefined;
    }

    registerScheduler(instance: GameInstance): void {
        const config = instance.account.config.dreamland!;
        if (!config.enabled)
            return;
        instance.scheduleCommand({ type: 'dreamland', body: `${DREAMLAND_COMMAND.enter} ${config.type}`, date: getDate({ ...config.time, dayOffset: instance.account.status.dreamland?.isFinished ? 1 : 0 }) });
    }

    private parseResponse(response: string): DreamlandResponse {
        const level = readNumberFromLine(response, 'LV', line => !line.includes('幻'));
        if (level) {
            const monsterLevels: Array<number | null> = new Array(5).fill(null);
            for (const monster of readNumberedLines(response, '幻兽')) {
                const monsterLevel = readNumberAfter(monster.text, 'LV');
                if (monsterLevel !== undefined)
                    monsterLevels[monster.index - 1] = monsterLevel;
            }
            return { type: 'monsterList', level, monsterLevels };
        }
        const door = readNumberedLines(response, '门').find(door => door.text.includes('八宝罗盘响动'));
        if (door)
            return { type: 'doorFound', doorIndex: door.index };
        if (this.RESPONSE_PATTERN.test(response))
            return { type: 'finished' };
        return { type: 'unmatched' };
    }

    private transition(response: DreamlandResponse): DreamlandEffect[] {
        switch (response.type) {
            case 'monsterList': {
                const attackableMonsterIndex = response.monsterLevels.findIndex(monsterLevel => monsterLevel !== null && monsterLevel < response.level);
                return [
                    { type: 'patchStatus', status: { inProgress: true, isFinished: true, level: response.level, monsterLevels: response.monsterLevels } },
                    { type: 'scheduleCommand', command: { type: 'dreamland', body: `${DREAMLAND_COMMAND.attack} ${attackableMonsterIndex + 1}` }, delay: 1000 },
                ];
            }
            case 'doorFound':
                return [
                    { type: 'patchStatus', status: { inProgress: true, isFinished: false, level: undefined, monsterLevels: undefined, doorIndex: response.doorIndex } },
                    { type: 'scheduleCommand', command: { type: 'dreamland', body: `${DREAMLAND_COMMAND.leave} ${response.doorIndex}` } },
                ];
            case 'finished':
                return [
                    { type: 'patchStatus', status: { inProgress: false, isFinished: true, level: undefined, monsterLevels: undefined, doorIndex: undefined } },
                    { type: 'registerScheduler' },
                ];
            case 'unmatched':
                return [];
        }
    }

    private async applyEffect(effect: DreamlandEffect, instance: GameInstance) {
        switch (effect.type) {
            case 'patchStatus':
                await instance.updateStatus({ dreamland: effect.status });
                break;
            case 'scheduleCommand':
                await instance.scheduleCommand(effect.command, effect.delay);
                break;
            case 'registerScheduler':
                this.registerScheduler(instance);
                break;
        }
    }
}
