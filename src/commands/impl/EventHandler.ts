import { GameInstance } from "../../server/core/GameInstance";
import { Command, Config, Status } from "../../server/types";
import { getDate } from "../../utils/TimeUtils";
import { readCoordinate, readMiningEventFields, readMiningFields, readStartedPackageCodes } from "../../utils/FieldExtractor";
import { CommandHandler } from "../CommandHandler";

type EventStatus = NonNullable<Status['event']>;
type EventConfig = NonNullable<Config['event']>;
type Position = { x: number; y: number };

type EventResponse =
    | { type: 'packageList'; validCodes: string[] }
    | { type: 'packageClaimed' }
    | { type: 'capsule'; finished: boolean }
    | { type: 'trial' }
    | { type: 'seniorInit' }
    | { type: 'seniorPosition'; currentPosition: Position; gardenPosition: Position; monsterPosition: Position; monsterDefeated: boolean; isFinished: boolean }
    | { type: 'travelInit' }
    | { type: 'travel'; finished: boolean }
    | { type: 'travelFinished' }
    | { type: 'miningEvent'; shovelLevel: number; bagLevel: number; stamina: number; ticket: number; output: number; capacity: number; shovelUpgradeCost: number; bagUpgradeCost: number }
    | { type: 'mining'; stamina: number; currentCapacity: number; capacity: number; depth: number }
    | { type: 'miningSold' }
    | { type: 'miningShovelUpgraded' }
    | { type: 'miningBagUpgraded' }
    | { type: 'miningExchange' }
    | { type: 'unmatched' };

type EventEffect =
    | { type: 'patchStatus'; status: EventStatus }
    | { type: 'scheduleCommand'; command: Command; delay?: number }
    | { type: 'registerTypeScheduler'; commandType: string };

const EVENT_COMMAND = {
    capsule: '扭蛋',
    trial: '接受考验',
    seniorInit: '领辟雷幡',
    seniorEnter: '进入血魔谷',
    seniorMove: '行进方向',
    travelInit: '领传送符',
    travel: '传送',
    travelFinish: '炼化明信片',
    miningEvent: '挖矿活动',
    mining: '挖矿',
    miningSell: '挖矿出售',
    miningShovelUpgrade: '挖矿铲子升级',
    miningBagUpgrade: '挖矿背包升级',
    miningExchange: '矿券兑矿石',
    package: '领取礼包',
} as const;

export default class EventHandler implements CommandHandler {
    readonly category = 'event';
    readonly COMMAND_TYPE = new Map([
        ['扭蛋', 'event_capsule'],
        ['接受考验', 'event_trial'],
        ['领辟雷幡', 'event_seniorInit'],
        ['进入血魔谷', 'event_seniorEnter'],
        ['行进方向', 'event_seniorMove'],
        ['领传送符', 'event_travelInit'],
        ['传送', 'event_travel'],
        ['炼化明信片', 'event_travelFinish'],
        ['挖矿活动', 'event_miningEvent'],
        ['挖矿', 'event_mining'],
        ['挖矿出售', 'event_miningSell'],
        ['挖矿铲子升级', 'event_miningShovelUpgrade'],
        ['挖矿背包升级', 'event_miningBagUpgrade'],
        ['矿券兑矿石', 'event_miningExchange'],
        ['领取礼包', 'event_package'],
    ]);
    readonly RESPONSE_PATTERN = new Map([
        ['event_capsule', /扭蛋成功|扭蛋体力用完/],
        ['event_trial', /考验开始|该项已经考验/],
        ['event_seniorInit', /可以进入血魔谷/],
        ['event_seniorEnter', /顺利进入血魔谷/],
        ['event_seniorMove', /走了一段距离/],
        ['event_travelInit', /传送符\+20/],
        ['event_travel', /传送成功/],
        ['event_travelFinish', /炼化完成/],
        ['event_miningEvent', /挖矿说明/],
        ['event_mining', /已挖/],
        ['event_miningSell', /出售成功|无法出售/],
        ['event_miningShovelUpgrade', /升级成功/],
        ['event_miningBagUpgrade', /升级成功/],
        ['event_miningExchange', /兑换成功/],
        ['event_package', /领取礼包/],
    ]);

    async handleResponse(command: Command, response: string, instance: GameInstance): Promise<void> {
        instance.account.status.event = instance.account.status.event || {};
        const eventResponse = this.parseResponse(command, response, instance);
        const effects = this.transition(eventResponse, instance);
        for (const effect of effects)
            await this.applyEffect(effect, instance);
    }

    private parseResponse(command: Command, response: string, instance: GameInstance): EventResponse {
        switch (command.type) {
            case 'event_package':
                return this.parsePackage(response);
            case 'event_capsule':
                return { type: 'capsule', finished: response.includes('扭蛋体力用完') };
            case 'event_trial':
                return { type: 'trial' };
            case 'event_seniorInit':
                return { type: 'seniorInit' };
            case 'event_seniorEnter':
            case 'event_seniorMove':
                return this.parseSeniorPosition(response, instance);
            case 'event_travelInit':
                return { type: 'travelInit' };
            case 'event_travel':
                return { type: 'travel', finished: response.includes('今日传送符已耗尽') };
            case 'event_travelFinish':
                return { type: 'travelFinished' };
            case 'event_miningEvent':
                return this.parseMiningEvent(response);
            case 'event_mining':
                return this.parseMining(response);
            case 'event_miningSell':
                return { type: 'miningSold' };
            case 'event_miningShovelUpgrade':
                return { type: 'miningShovelUpgraded' };
            case 'event_miningBagUpgrade':
                return { type: 'miningBagUpgraded' };
            case 'event_miningExchange':
                return { type: 'miningExchange' };
            default:
                return { type: 'unmatched' };
        }
    }

    private parsePackage(response: string): EventResponse {
        if (!response.includes('礼包如下'))
            return { type: 'packageClaimed' };
        return { type: 'packageList', validCodes: readStartedPackageCodes(response) };
    }

    private parseSeniorPosition(response: string, instance: GameInstance): EventResponse {
        const current = readCoordinate(response, '你现在的位置是');
        if (!current)
            return { type: 'unmatched' };
        return {
            type: 'seniorPosition',
            currentPosition: current,
            gardenPosition: readCoordinate(response, '药园所在位置') ?? this.emptyPosition(),
            monsterPosition: readCoordinate(response, '魔物所在位置') ?? this.emptyPosition(),
            monsterDefeated: response.includes('遇到强大魔物') || Boolean(instance.account.status.event?.senior?.monsterDefeated),
            isFinished: response.includes('拿到灵芝回来'),
        };
    }

    private parseMiningEvent(response: string): EventResponse {
        const fields = readMiningEventFields(response);
        if (!fields)
            return { type: 'unmatched' };
        return { type: 'miningEvent', ...fields };
    }

    private parseMining(response: string): EventResponse {
        const fields = readMiningFields(response);
        if (!fields)
            return { type: 'unmatched' };
        return { type: 'mining', ...fields };
    }

    private transition(response: EventResponse, instance: GameInstance): EventEffect[] {
        switch (response.type) {
            case 'packageList':
                return this.transitionPackageList(response);
            case 'packageClaimed':
                return [
                    { type: 'patchStatus', status: { package: { inProgress: true, isFinished: false } } },
                    { type: 'registerTypeScheduler', commandType: 'event_package' },
                ];
            case 'capsule':
                return this.transitionCapsule(response);
            case 'trial':
                return this.transitionTrial(instance.account.status.event!);
            case 'seniorInit':
                return [{ type: 'scheduleCommand', command: { type: 'event_seniorEnter', body: EVENT_COMMAND.seniorEnter }, delay: 1000 }];
            case 'seniorPosition':
                return this.transitionSeniorPosition(response);
            case 'travelInit':
                return [
                    { type: 'patchStatus', status: { travel: { inProgress: true, isFinished: false } } },
                    { type: 'scheduleCommand', command: { type: 'event_travel', body: EVENT_COMMAND.travel }, delay: 1000 },
                ];
            case 'travel':
                return [
                    { type: 'patchStatus', status: { travel: { isFinished: response.finished } } },
                    { type: 'scheduleCommand', command: { type: response.finished ? 'event_travelFinish' : 'event_travel', body: response.finished ? EVENT_COMMAND.travelFinish : EVENT_COMMAND.travel }, delay: 1000 },
                ];
            case 'travelFinished':
                return [
                    { type: 'patchStatus', status: { travel: { inProgress: false } } },
                    { type: 'registerTypeScheduler', commandType: 'event_travelInit' },
                ];
            case 'miningEvent':
                return this.transitionMiningEvent(response, instance.account.status.event!, instance.account.config.event!);
            case 'mining':
                return this.transitionMining(response, instance.account.status.event!);
            case 'miningSold':
                return [
                    { type: 'patchStatus', status: { mining: { currentCapacity: 0 } } },
                    { type: 'registerTypeScheduler', commandType: 'event_miningEvent' },
                ];
            case 'miningShovelUpgraded':
                return [
                    { type: 'patchStatus', status: { mining: { shovelLevel: (instance.account.status.event?.mining?.shovelLevel || 0) + 1 } } },
                    { type: 'registerTypeScheduler', commandType: 'event_miningEvent' },
                ];
            case 'miningBagUpgraded':
                return [
                    { type: 'patchStatus', status: { mining: { bagLevel: (instance.account.status.event?.mining?.bagLevel || 0) + 1 } } },
                    { type: 'registerTypeScheduler', commandType: 'event_miningEvent' },
                ];
            case 'miningExchange':
            case 'unmatched':
                return [];
        }
    }

    private transitionPackageList(response: Extract<EventResponse, { type: 'packageList' }>): EventEffect[] {
        if (response.validCodes.length > 0)
            return [
                { type: 'patchStatus', status: { package: { inProgress: true, isFinished: false } } },
                { type: 'scheduleCommand', command: { type: 'event_package', body: `${EVENT_COMMAND.package} ${response.validCodes[0]}` }, delay: 1000 },
            ];
        return [
            { type: 'patchStatus', status: { package: { inProgress: false, isFinished: true } } },
            { type: 'registerTypeScheduler', commandType: 'event_package' },
        ];
    }

    private transitionCapsule(response: Extract<EventResponse, { type: 'capsule' }>): EventEffect[] {
        const inProgress = !response.finished;
        const effects: EventEffect[] = [
            { type: 'patchStatus', status: { capsule: { inProgress, isFinished: !inProgress } } },
        ];
        if (inProgress)
            effects.push({ type: 'scheduleCommand', command: { type: 'event_capsule', body: EVENT_COMMAND.capsule }, delay: 1000 });
        return effects;
    }

    private transitionTrial(status: EventStatus): EventEffect[] {
        const count = (status.trial?.count || 0) + 1;
        const effects: EventEffect[] = [
            { type: 'patchStatus', status: { trial: { count } } },
        ];
        if (count < 8)
            effects.push({ type: 'scheduleCommand', command: { type: 'event_trial', body: `${EVENT_COMMAND.trial} ${count + 1}` }, delay: 1000 });
        return effects;
    }

    private transitionSeniorPosition(response: Extract<EventResponse, { type: 'seniorPosition' }>): EventEffect[] {
        const effects: EventEffect[] = [
            { type: 'patchStatus', status: { senior: { currentPosition: response.currentPosition, monsterDefeated: response.monsterDefeated, isFinished: response.isFinished } } },
        ];
        if (response.isFinished) {
            effects.push({ type: 'registerTypeScheduler', commandType: 'event_seniorInit' });
            return effects;
        }
        const nextMove = this.seniorNextMove(response);
        effects.push({ type: 'scheduleCommand', command: { type: 'event_seniorMove', body: `${EVENT_COMMAND.seniorMove} ${nextMove}` }, delay: 1000 });
        return effects;
    }

    private transitionMiningEvent(response: Extract<EventResponse, { type: 'miningEvent' }>, status: EventStatus, config: EventConfig): EventEffect[] {
        const effects: EventEffect[] = [
            { type: 'patchStatus', status: { mining: { shovelLevel: response.shovelLevel, bagLevel: response.bagLevel, stamina: response.stamina, ticket: response.ticket, output: response.output, capacity: response.capacity, shovelUpgradeCost: response.shovelUpgradeCost, bagUpgradeCost: response.bagUpgradeCost } } },
        ];
        const currentCapacity = status.mining?.currentCapacity || 0;
        const minedCount = status.mining?.minedCount || 0;
        if (response.stamina === 0) {
            effects.push({ type: 'registerTypeScheduler', commandType: 'event_miningEvent' });
            return effects;
        }
        if (minedCount < 5) {
            if (response.shovelLevel < config.mining?.maxShovelLevel! && response.shovelUpgradeCost <= response.ticket)
                effects.push({ type: 'scheduleCommand', command: { type: 'event_miningShovelUpgrade', body: EVENT_COMMAND.miningShovelUpgrade }, delay: 1000 });
            else if (response.bagLevel < config.mining?.maxBagLevel! && response.bagUpgradeCost <= response.ticket)
                effects.push({ type: 'scheduleCommand', command: { type: 'event_miningBagUpgrade', body: EVENT_COMMAND.miningBagUpgrade }, delay: 1000 });
            else if (response.capacity - currentCapacity < response.output)
                effects.push({ type: 'scheduleCommand', command: { type: 'event_miningSell', body: EVENT_COMMAND.miningSell }, delay: 1000 });
            else
                effects.push({ type: 'scheduleCommand', command: { type: 'event_mining', body: `${EVENT_COMMAND.mining} ${minedCount + 1}` }, delay: 1000 });
        } else if (response.ticket >= 100) {
            effects.push({ type: 'scheduleCommand', command: { type: 'event_miningExchange', body: `${EVENT_COMMAND.miningExchange} ${response.ticket}` }, delay: 1000 });
        }
        return effects;
    }

    private transitionMining(response: Extract<EventResponse, { type: 'mining' }>, status: EventStatus): EventEffect[] {
        const minedCount = response.depth === 510 ? (status.mining?.minedCount || 0) + 1 : status.mining?.minedCount || 0;
        return [
            { type: 'patchStatus', status: { mining: { stamina: response.stamina, currentCapacity: response.currentCapacity, capacity: response.capacity, minedCount } } },
            { type: 'registerTypeScheduler', commandType: 'event_miningEvent' },
        ];
    }

    private seniorNextMove(response: Extract<EventResponse, { type: 'seniorPosition' }>): 1 | 2 | 3 | 4 {
        const { currentPosition, gardenPosition, monsterPosition, monsterDefeated } = response;
        if (gardenPosition.x !== -1 && gardenPosition.y !== -1)
            return monsterDefeated
                ? this.nextMove(currentPosition, gardenPosition, monsterPosition)
                : this.nextMove(currentPosition, monsterPosition, gardenPosition);
        return this.nextMove(currentPosition, { x: 0, y: 0 }, monsterPosition);
    }

    private emptyPosition(): Position {
        return { x: -1, y: -1 };
    }

    private async applyEffect(effect: EventEffect, instance: GameInstance) {
        switch (effect.type) {
            case 'patchStatus':
                await instance.updateStatus({ event: effect.status });
                break;
            case 'scheduleCommand':
                await instance.scheduleCommand(effect.command, effect.delay);
                break;
            case 'registerTypeScheduler':
                this.registerTypeScheduler(instance, effect.commandType);
                break;
        }
    }
    async handleError(command: Command, error: Error, instance: GameInstance): Promise<Command | undefined> {
        command.retries = (command.retries || 0) + 1;
        if (command.type.startsWith('event_mining'))
            command = { ...command, type: 'event_miningEvent', body: '挖矿活动', retries: command.retries };
        return command.retries! < 3 ? command : undefined;
    }

    nextMove(source: { x: number, y: number }, target: { x: number, y: number }, obstacle: { x: number, y: number }): 1 | 2 | 3 | 4 {
        const isColinear = (a: { x: number, y: number }, b: { x: number, y: number }, c: { x: number, y: number }): boolean => (a.x === b.x && a.x === c.x && (a.y - c.y) * (b.y - c.y) <= 0) || (a.y === b.y && a.y === c.y && (a.x - c.x) * (b.x - c.x) <= 0);
        if (obstacle && isColinear(source, target, obstacle)) {
            if (source.x === target.x)
                return source.y === 0 ? 1 : 2; // up : down
            if (source.y === target.y)
                return source.x === 0 ? 4 : 3; // right : left
        }
        if (source.x === target.x)
            return source.y < target.y ? 1 : 2; // up : down
        if (source.y === target.y)
            return source.x < target.x ? 4 : 3; // right : left
        const intermediate1 = { x: source.x, y: target.y };
        const intermediate2 = { x: target.x, y: source.y };
        const path1Clear = !obstacle || (!isColinear(source, intermediate1, obstacle) && !isColinear(intermediate1, target, obstacle));
        const path2Clear = !obstacle || (!isColinear(source, intermediate2, obstacle) && !isColinear(intermediate2, target, obstacle));
        if (path1Clear)
            return source.y < target.y ? 1 : 2; // up : down
        if (path2Clear)
            return source.x < target.x ? 4 : 3; // right : left
        throw new Error('No available path');
    }

    registerScheduler(instance: GameInstance): void {
        ['event_package', 'event_seniorInit', 'event_travelInit', 'event_miningEvent'].forEach(type =>
            this.registerTypeScheduler(instance, type));
    }
    public registerTypeScheduler(instance: GameInstance, type: string): void {
        const status = instance.account.status.event;
        const config = instance.account.config.event!;
        if (!config.enabled)
            return;
        switch (type) {
            case 'event_package':
                const packageDate = getDate({ ...config.time, dayOffset: status?.package?.isFinished ? 1 : 0 });
                instance.scheduleCommand({ type: 'event_package', body: '领取礼包', date: packageDate });
                break;
            case 'event_seniorInit':
                const seniorDate = getDate({ ...config.time, dayOffset: status?.senior?.isFinished ? 1 : 0 });
                if (seniorDate > new Date(2025, 8, 28, 23, 59, 59))
                    return;
                instance.scheduleCommand({ type: 'event_seniorInit', body: '领辟雷幡', date: seniorDate });
                break;
            case 'event_travelInit':
                const travelDate = getDate({ ...config.time, dayOffset: status?.travel?.isFinished ? 1 : 0 });
                if (travelDate > new Date(2025, 9, 8, 23, 59, 59))
                    return;
                instance.scheduleCommand({ type: 'event_travelInit', body: '领传送符', date: travelDate });
                break;
            case 'event_miningEvent':
                const miningDate = getDate({ ...config.time, dayOffset: status?.mining?.stamina === 0 ? 1 : 0 });
                if (miningDate > new Date(2026, 4, 5, 23, 59, 59))
                    return;
                instance.scheduleCommand({ type: 'event_miningEvent', body: '挖矿活动', date: miningDate });
                break;
        }
    }
}
