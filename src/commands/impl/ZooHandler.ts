import { Command, Config, Status } from '../../server/types';
import { CommandHandler } from '../CommandHandler';
import { runEffects } from '../EffectRunner';
import { GameInstance } from '../../server/core/GameInstance';
import { getDate } from '../../utils/TimeUtils';
import { readMonsterLayout, readNumberAfter } from '../../utils/FieldExtractor';

type ZooStatus = NonNullable<Status['zoo']>;
type ZooConfig = NonNullable<Config['zoo']>;
type ZooChoice = NonNullable<ZooStatus['choice']>;

type ZooResponse =
    | { type: 'remaining'; remaining: number; hasVerticalMonsters: boolean; hasHorizontalKing: boolean; hasThirdMonster: boolean }
    | { type: 'entered' }
    | { type: 'finished' }
    | { type: 'unmatched' };

type ZooEffect =
    | { type: 'patchStatus'; status: ZooStatus }
    | { type: 'scheduleCommand'; command: Command; delay?: number }
    | { type: 'registerScheduler' };

const ZOO_COMMAND = {
    enter: '进入妖兽园',
    horizontal: '横扫',
    vertical: '力劈',
    escape: '逃跑',
} as const;

export default class ZooHandler implements CommandHandler {
    readonly category = 'zoo';
    readonly COMMAND_TYPE = new Map([
        [ZOO_COMMAND.enter, 'zoo'],
        [ZOO_COMMAND.horizontal, 'zoo'],
        [ZOO_COMMAND.vertical, 'zoo'],
        [ZOO_COMMAND.escape, 'zoo'],
    ]);
    readonly RESPONSE_PATTERN = /剩余妖兽|仅可进入妖兽园1次|妖兽已过期|被消灭了|已进入妖兽园/;
    readonly RETRY_THRESHOLD = 5;

    private retryCount = 0;

    async handleResponse(command: Command, response: string, instance: GameInstance) {
        instance.account.status.zoo = instance.account.status.zoo || {};
        const config = instance.account.config.zoo!;
        const zooResponse = this.parseResponse(response);
        const effects = this.transition(zooResponse, config);
        await runEffects(effects, { instance, statusKey: 'zoo', handler: this });
    }

    async handleError(command: Command, error: Error, instance: GameInstance) {
        command.retries = (command.retries || 0) + 1;
        return command.retries! < 3 ? command : undefined;
    }

    registerScheduler(instance: GameInstance): void {
        const config = instance.account.config.zoo!;
        if (!config.enabled)
            return;
        instance.scheduleCommand({
            type: 'zoo', body: async (instance: GameInstance) => {
                await instance.waitForLevelUpdate();
                const level = instance.account.status.personalInfo?.level!;
                return `${ZOO_COMMAND.enter} ${Math.floor((level - 10) / 9)}`;
            }, date: getDate({ ...config.time, dayOffset: instance.account.status.zoo?.isFinished ? 1 : 0 })
        });
    }

    private parseResponse(response: string): ZooResponse {
        const remaining = readNumberAfter(response, '剩余妖兽');
        if (remaining !== undefined) {
            const monsterLayout = readMonsterLayout(response);
            return {
                type: 'remaining',
                remaining,
                ...monsterLayout,
            };
        }
        if (response.includes('已进入妖兽园'))
            return { type: 'entered' };
        if (this.RESPONSE_PATTERN.test(response))
            return { type: 'finished' };
        return { type: 'unmatched' };
    }

    private transition(response: ZooResponse, config: ZooConfig): ZooEffect[] {
        switch (response.type) {
            case 'remaining': {
                const choice = this.chooseAction(response, config);
                const effects: ZooEffect[] = [
                    { type: 'patchStatus', status: { inProgress: response.remaining > 0, isFinished: response.remaining === 0, remaining: response.remaining, choice } },
                ];
                if (choice)
                    effects.push({ type: 'scheduleCommand', command: { type: 'zoo', body: choice }, delay: 1000 });
                return effects;
            }
            case 'entered':
                return [
                    { type: 'patchStatus', status: { inProgress: true, isFinished: false, remaining: undefined, choice: ZOO_COMMAND.escape } },
                    { type: 'scheduleCommand', command: { type: 'zoo', body: ZOO_COMMAND.escape }, delay: 1000 },
                ];
            case 'finished':
                return [
                    { type: 'patchStatus', status: { inProgress: false, isFinished: true, remaining: 0, choice: undefined } },
                    { type: 'registerScheduler' },
                ];
            case 'unmatched':
                return [];
        }
    }

    private chooseAction(response: Extract<ZooResponse, { type: 'remaining' }>, config: ZooConfig): ZooChoice | undefined {
        if (response.remaining <= 0)
            return undefined;
        let choice: ZooChoice = response.hasVerticalMonsters ? ZOO_COMMAND.vertical : ZOO_COMMAND.horizontal;
        if (config.autoEscape && this.retryCount < this.RETRY_THRESHOLD && response.remaining > 3 && response.hasHorizontalKing && response.hasThirdMonster)
            choice = ZOO_COMMAND.escape;
        if (choice === ZOO_COMMAND.escape)
            this.retryCount++;
        else
            this.retryCount = 0;
        return choice;
    }

}
