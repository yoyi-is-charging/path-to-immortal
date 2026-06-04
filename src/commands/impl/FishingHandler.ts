import { Command, MessageBody, Status } from '../../server/types';
import { CommandHandler } from '../CommandHandler';
import { runEffects } from '../EffectRunner';
import { GameInstance } from '../../server/core/GameInstance';
import { getDate } from '../../utils/TimeUtils';
import { readChineseDuration, readNumberAfter, readNumberedLines } from '../../utils/FieldExtractor';

type FishingStatus = NonNullable<Status['fishing']>;

type FishingResponse =
    | { type: 'positionAvailable'; position: number }
    | { type: 'pullScheduled'; pullTime: Date; bait?: number }
    | { type: 'leaveSuggested' }
    | { type: 'left' }
    | { type: 'blocked' }
    | { type: 'unmatched' };

type FishingEffect =
    | { type: 'patchStatus'; status: FishingStatus }
    | { type: 'scheduleCommand'; command: Command }
    | { type: 'registerScheduler' };

const FISHING_COMMAND = {
    enter: '进入鱼塘',
    reenter: '重新进入鱼塘',
    cast: '甩杆',
    pull: '拉杆',
    leave: '离开鱼塘',
} as const;

export default class Fishing implements CommandHandler {
    readonly category = 'fishing';
    readonly COMMAND_TYPE = new Map([
        [FISHING_COMMAND.enter, 'fishing'],
        [FISHING_COMMAND.reenter, 'fishing'],
        [FISHING_COMMAND.cast, 'fishing'],
        [FISHING_COMMAND.pull, 'fishing'],
        [FISHING_COMMAND.leave, 'fishing'],
    ]);
    readonly RESPONSE_PATTERN = /无法进入鱼塘|预计[上咬]钩时间|位置\d+:[^\n]*|发送指令:离开鱼塘|已离开鱼塘/;

    async handleResponse(command: Command, response: string, instance: GameInstance) {
        instance.account.status.fishing = instance.account.status.fishing || {};
        const fishingResponse = this.parseResponse(response);
        const effects = this.transition(instance.account.status.fishing, fishingResponse);
        await runEffects(effects, { instance, statusKey: 'fishing', handler: this });
    }

    async handleError(command: Command, error: Error, instance: GameInstance) {
        const commandBody = this.commandText(command);
        const body = (instance.account.status.fishing?.inProgress || commandBody.includes(FISHING_COMMAND.enter))
            ? (commandBody === FISHING_COMMAND.pull ? FISHING_COMMAND.cast : FISHING_COMMAND.pull)
            : commandBody;
        command = { ...command, body, retries: (command.retries || 0) + 1 };
        return command.retries! < 3 ? command : undefined;
    }

    registerScheduler(instance: GameInstance): void {
        const config = instance.account.config.fishing!;
        const status = instance.account.status.fishing;
        if (!config.enabled)
            return;
        if (status?.inProgress) {
            if (status.pullTime)
                instance.scheduleCommand({ type: 'fishing', body: FISHING_COMMAND.pull, date: status.pullTime });
            else
                instance.scheduleCommand({ type: 'fishing', body: FISHING_COMMAND.cast });
        }
        else if (!status?.finishedCount)
            instance.scheduleCommand({ type: 'fishing', body: `${FISHING_COMMAND.enter} ${config.levels![0]}`, date: getDate({ ...config.time!, dayOffset: 0 }) });
        else if (status?.finishedCount === 1 && config.levels!.length >= 2)
            instance.scheduleCommand({ type: 'fishing', body: `${FISHING_COMMAND.reenter} ${config.levels![1]}`, date: getDate({ ...config.time!, dayOffset: 0 }) });
        else
            instance.scheduleCommand({ type: 'fishing', body: `${FISHING_COMMAND.enter} ${config.levels![0]}`, date: getDate({ ...config.time!, dayOffset: 1 }) });
    }

    private parseResponse(response: string): FishingResponse {
        if (response.includes('已离开鱼塘'))
            return { type: 'left' };
        if (response.includes('发送指令:离开鱼塘'))
            return { type: 'leaveSuggested' };
        const pullTime = readChineseDuration(response);
        if (pullTime) {
            const bait = readNumberAfter(response, '饵料:-1(');
            return { type: 'pullScheduled', pullTime, bait };
        }
        const positions = readNumberedLines(response, '位置');
        const itemPosition = positions.find(position => !position.text.startsWith('鱼'));
        if (itemPosition)
            return { type: 'positionAvailable', position: itemPosition.index };
        const goodPosition = positions.find(position => position.text.includes('鱼情好'));
        if (goodPosition)
            return { type: 'positionAvailable', position: goodPosition.index };
        if (response.includes('无法进入鱼塘'))
            return { type: 'blocked' };
        return { type: 'unmatched' };
    }

    private transition(status: FishingStatus, response: FishingResponse): FishingEffect[] {
        switch (response.type) {
            case 'positionAvailable':
                return [
                    { type: 'patchStatus', status: { inProgress: true, position: response.position, pullTime: undefined } },
                    { type: 'scheduleCommand', command: { type: 'fishing', body: `${FISHING_COMMAND.cast} ${response.position}` } },
                ];
            case 'pullScheduled':
                return [
                    { type: 'patchStatus', status: { inProgress: true, bait: response.bait ?? status.bait, position: undefined, pullTime: response.pullTime } },
                    { type: 'scheduleCommand', command: { type: 'fishing', body: FISHING_COMMAND.pull, date: response.pullTime } },
                ];
            case 'leaveSuggested':
                return [
                    { type: 'patchStatus', status: { inProgress: true, bait: 0, position: undefined, pullTime: undefined } },
                    { type: 'scheduleCommand', command: { type: 'fishing', body: FISHING_COMMAND.leave } },
                ];
            case 'left':
                return [
                    { type: 'patchStatus', status: { inProgress: false, finishedCount: (status.finishedCount || 0) + 1, bait: undefined, position: undefined, pullTime: undefined } },
                    { type: 'registerScheduler' },
                ];
            case 'blocked':
            case 'unmatched':
                return [];
        }
    }

    private commandText(command: Command): string {
        if (typeof command.body === 'string')
            return command.body;
        if (typeof command.body === 'function')
            return '';
        return (command.body as MessageBody)[0]?.str ?? '';
    }
}
