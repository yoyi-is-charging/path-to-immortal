import { GameInstance } from "../../server/core/GameInstance";
import { Command } from "../../server/types";
import { getDate, parseFullDate } from "../../utils/TimeUtils";
import { CommandHandler } from "../CommandHandler";

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

    readonly CAPSULE_FINISHED_PATTERN = /扭蛋体力用完/;
    readonly SENIOR_CURRENT_POSITION_PATTERN = /你现在的位置是\((?<x>\d+),(?<y>\d+)\)/;
    readonly SENIOR_GARDEN_POSITION_PATTERN = /药园所在位置\((?<x>\d+),(?<y>\d+)\)/;
    readonly SENIOR_MONSTER_POSITION_PATTERN = /魔物所在位置\((?<x>\d+),(?<y>\d+)\)/;
    readonly SENIOR_MONSTER_DEFEATED_PATTERN = /遇到强大魔物/;
    readonly SENIOR_FINISHED_PATTERN = /拿到灵芝回来/;
    readonly TRAVEL_FINISHED_PATTERN = /今日传送符已耗尽/;
    readonly PACKAGE_LIST_PATTERN = /礼包如下/;
    readonly PACKAGE_CODE_PATTERN = /礼包码:(?<code>\S+)\n+.*✅.*活动时间:(?<start>\d+-\d+-\d+\s\d+:\d+:\d+)/;
    readonly MINING_EVENT_SHOVEL_LEVEL_PATTERN = /铲子LV(?<level>\d+)/;
    readonly MINING_EVENT_BAG_LEVEL_PATTERN = /背包LV(?<level>\d+)/;
    readonly MINING_EVENT_STAMINA_PATTERN = /体力(?<stamina>\d+)/;
    readonly MINING_EVENT_OUTPUT_PATTERN = /每次挖(?<output>\d+)0cm/;
    readonly MINING_EVENT_CAPACITY_PATTERN = /格子(?<capacity>\d+)/;
    readonly MINING_EVENT_TICKET_PATTERN = /矿券(?<ticket>\d+)/;
    readonly MINING_EVENT_SHOVEL_UPGRADE_COST_PATTERN = /铲子.*升级需(?<shovelUpgradeCost>\d+)/;
    readonly MINING_EVENT_BAG_UPGRADE_COST_PATTERN = /背包.*升级需(?<bagUpgradeCost>\d+)/;
    readonly MINING_STAMINA_PATTERN = /体力-1\/(?<stamina>\d+)/;
    readonly MINING_CAPACITY_PATTERN = /背包:(?<currentCapacity>\d+)\/(?<capacity>\d+)/;
    readonly MINING_DEPTH_PATTERN = /已挖深度:(?<depth>\d+)/;

    async handleResponse(command: Command, response: string, instance: GameInstance): Promise<void> {
        instance.account.status.event = instance.account.status.event || {};
        switch (command.type) {
            case 'event_package':
                if (this.PACKAGE_LIST_PATTERN.test(response)) {
                    const match = response.match(this.PACKAGE_CODE_PATTERN);
                    if (match) {
                        const code = match.groups!.code;
                        const startDate = parseFullDate(match.groups!.start);
                        if (startDate && startDate <= new Date()) {
                            instance.updateStatus({ event: { package: { inProgress: true, isFinished: false } } });
                            instance.scheduleCommand({ type: 'event_package', body: `领取礼包 ${code}` }, 1000);
                            return;
                        }
                    }
                    instance.updateStatus({ event: { package: { inProgress: false, isFinished: true } } });
                } else
                    instance.updateStatus({ event: { package: { inProgress: true, isFinished: false } } });
                this.registerTypeScheduler(instance, 'event_package');
                break;
            case 'event_capsule':
                instance.account.status.event.capsule = instance.account.status.event.capsule || {};
                const inProgress = !this.CAPSULE_FINISHED_PATTERN.test(response);
                instance.updateStatus({ event: { capsule: { inProgress: inProgress, isFinished: !inProgress } } });
                if (inProgress)
                    instance.scheduleCommand({ type: 'event_capsule', body: '扭蛋' }, 1000);
                break;
            case 'event_trial':
                const count = (instance.account.status.event?.trial?.count || 0) + 1;
                instance.updateStatus({ event: { trial: { count: count } } });
                if (count < 8)
                    instance.scheduleCommand({ type: 'event_trial', body: `接受考验 ${count + 1}` }, 1000);
                break;
            case 'event_seniorInit':
                instance.account.status.event.senior = instance.account.status.event.senior || {};
                instance.scheduleCommand({ type: 'event_seniorEnter', body: '进入血魔谷' }, 1000);
                break;
            case 'event_seniorEnter':
            case 'event_seniorMove':
                const currentPosition = {
                    x: parseInt(response.match(this.SENIOR_CURRENT_POSITION_PATTERN)!.groups!.x),
                    y: parseInt(response.match(this.SENIOR_CURRENT_POSITION_PATTERN)!.groups!.y),
                }
                const gardenPosition = {
                    x: parseInt(response.match(this.SENIOR_GARDEN_POSITION_PATTERN)?.groups?.x || '-1'),
                    y: parseInt(response.match(this.SENIOR_GARDEN_POSITION_PATTERN)?.groups?.y || '-1'),
                }
                const monsterPosition = {
                    x: parseInt(response.match(this.SENIOR_MONSTER_POSITION_PATTERN)?.groups?.x || '-1'),
                    y: parseInt(response.match(this.SENIOR_MONSTER_POSITION_PATTERN)?.groups?.y || '-1'),
                }
                const monsterDefeated = this.SENIOR_MONSTER_DEFEATED_PATTERN.test(response) || instance.account.status.event.senior?.monsterDefeated;
                const isFinished = this.SENIOR_FINISHED_PATTERN.test(response);
                instance.updateStatus({ event: { senior: { currentPosition, monsterDefeated, isFinished } } });
                if (isFinished) {
                    this.registerTypeScheduler(instance, 'event_seniorInit');
                    break;
                }
                let nextMove: 1 | 2 | 3 | 4;
                if (gardenPosition.x !== -1 && gardenPosition.y !== -1) {
                    if (monsterDefeated)
                        nextMove = this.nextMove(currentPosition, gardenPosition, monsterPosition)
                    else
                        nextMove = this.nextMove(currentPosition, monsterPosition, gardenPosition)
                } else
                    nextMove = this.nextMove(currentPosition, { x: 0, y: 0 }, monsterPosition)
                instance.scheduleCommand({ type: 'event_seniorMove', body: `行进方向 ${nextMove}` }, 1000);
                break;
            case 'event_travelInit':
                instance.account.status.event.travel = instance.account.status.event.travel || {};
                instance.updateStatus({ event: { travel: { inProgress: true, isFinished: false } } });
                instance.scheduleCommand({ type: 'event_travel', body: '传送' }, 1000);
                break;
            case 'event_travel':
                const travelFinished = this.TRAVEL_FINISHED_PATTERN.test(response);
                instance.updateStatus({ event: { travel: { isFinished: travelFinished } } });
                if (!travelFinished)
                    instance.scheduleCommand({ type: 'event_travel', body: '传送' }, 1000);
                else
                    instance.scheduleCommand({ type: 'event_travelFinish', body: '炼化明信片' }, 1000);
                break;
            case 'event_travelFinish':
                instance.updateStatus({ event: { travel: { inProgress: false } } });
                this.registerTypeScheduler(instance, 'event_travelInit');
                break;
            case 'event_miningEvent':
                const shovelLevel = parseInt(response.match(this.MINING_EVENT_SHOVEL_LEVEL_PATTERN)!.groups!.level);
                const bagLevel = parseInt(response.match(this.MINING_EVENT_BAG_LEVEL_PATTERN)!.groups!.level);
                const stamina = parseInt(response.match(this.MINING_EVENT_STAMINA_PATTERN)!.groups!.stamina);
                const ticket = parseInt(response.match(this.MINING_EVENT_TICKET_PATTERN)!.groups!.ticket);
                const output = parseInt(response.match(this.MINING_EVENT_OUTPUT_PATTERN)!.groups!.output);
                const capacity = parseInt(response.match(this.MINING_EVENT_CAPACITY_PATTERN)!.groups!.capacity);
                const shovelUpgradeCost = parseInt(response.match(this.MINING_EVENT_SHOVEL_UPGRADE_COST_PATTERN)!.groups!.shovelUpgradeCost);
                const bagUpgradeCost = parseInt(response.match(this.MINING_EVENT_BAG_UPGRADE_COST_PATTERN)!.groups!.bagUpgradeCost);
                instance.updateStatus({ event: { mining: { shovelLevel, bagLevel, stamina, ticket, output, capacity, shovelUpgradeCost, bagUpgradeCost } } });
                const currentCapacity = instance.account.status.event.mining?.currentCapacity || 0;
                const minedCount = instance.account.status.event.mining?.minedCount || 0;
                if (stamina === 0) {
                    this.registerTypeScheduler(instance, 'event_miningEvent');
                    break;
                }
                if (minedCount < 5) {
                    if (shovelLevel < instance.account.config.event?.mining?.maxShovelLevel! && shovelUpgradeCost <= ticket) {
                        instance.scheduleCommand({ type: 'event_miningShovelUpgrade', body: '挖矿铲子升级' }, 1000);
                        break;
                    }
                    if (bagLevel < instance.account.config.event?.mining?.maxBagLevel! && bagUpgradeCost <= ticket) {
                        instance.scheduleCommand({ type: 'event_miningBagUpgrade', body: '挖矿背包升级' }, 1000);
                        break;
                    }
                    if (capacity - currentCapacity < output)
                        instance.scheduleCommand({ type: 'event_miningSell', body: '挖矿出售' }, 1000);
                    else
                        instance.scheduleCommand({ type: 'event_mining', body: `挖矿 ${minedCount + 1}` }, 1000);
                }
                else if (ticket >= 100)
                    instance.scheduleCommand({ type: 'event_miningExchange', body: `矿券兑矿石 ${ticket}` }, 1000);
                break;
            case 'event_mining':
                const newStamina = parseInt(response.match(this.MINING_STAMINA_PATTERN)!.groups!.stamina);
                const newCurrentCapacity = parseInt(response.match(this.MINING_CAPACITY_PATTERN)!.groups!.currentCapacity);
                const newCapacity = parseInt(response.match(this.MINING_CAPACITY_PATTERN)!.groups!.capacity);
                const depth = parseInt(response.match(this.MINING_DEPTH_PATTERN)!.groups!.depth);
                const newMinedCount = depth === 510 ? (instance.account.status.event.mining?.minedCount || 0) + 1 : instance.account.status.event.mining?.minedCount || 0;
                instance.updateStatus({ event: { mining: { stamina: newStamina, currentCapacity: newCurrentCapacity, capacity: newCapacity, minedCount: newMinedCount } } });
                this.registerTypeScheduler(instance, 'event_miningEvent');
                break;
            case 'event_miningSell':
                instance.updateStatus({ event: { mining: { currentCapacity: 0 } } });
                this.registerTypeScheduler(instance, 'event_miningEvent');
                break;
            case 'event_miningShovelUpgrade':
                instance.updateStatus({ event: { mining: { shovelLevel: (instance.account.status.event.mining?.shovelLevel || 0) + 1 } } });
                this.registerTypeScheduler(instance, 'event_miningEvent');
                break;
            case 'event_miningBagUpgrade':
                instance.updateStatus({ event: { mining: { bagLevel: (instance.account.status.event.mining?.bagLevel || 0) + 1 } } });
                this.registerTypeScheduler(instance, 'event_miningEvent');
                break;
            case 'event_miningExchange':
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
                if (miningDate > new Date(2025, 10, 25, 23, 59, 59))
                    return;
                instance.scheduleCommand({ type: 'event_miningEvent', body: '挖矿活动', date: miningDate });
                break;
        }
    }
}