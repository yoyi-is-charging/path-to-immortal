import { GameInstance } from "../../server/core/GameInstance";
import { Command } from "../../server/types";
import { getDate } from "../../utils/TimeUtils";
import { CommandHandler } from "../CommandHandler";

export default class EventHandler implements CommandHandler {
    readonly category = 'event';
    readonly COMMAND_TYPE = new Map([
        ['扭蛋', 'event_capsule'],
        ['接受考验', 'event_trial'],
        ['领辟雷幡', 'event_seniorInit'],
        ['进入血魔谷', 'event_seniorEnter'],
        ['行进方向', 'event_seniorMove']
    ]);
    readonly RESPONSE_PATTERN = new Map([
        ['event_capsule', /扭蛋成功|扭蛋体力用完/],
        ['event_trial', /考验开始|该项已经考验/],
        ['event_seniorInit', /可以进入血魔谷/],
        ['event_seniorEnter', /顺利进入血魔谷/],
        ['event_seniorMove', /走了一段距离/],
    ]);

    readonly CAPSULE_FINISHED_PATTERN = /扭蛋体力用完/;
    readonly SENIOR_CURRENT_POSITION_PATTERN = /你现在的位置是\((?<x>\d+),(?<y>\d+)\)/;
    readonly SENIOR_GARDEN_POSITION_PATTERN = /药园所在位置\((?<x>\d+),(?<y>\d+)\)/;
    readonly SENIOR_MONSTER_POSITION_PATTERN = /魔物所在位置\((?<x>\d+),(?<y>\d+)\)/;
    readonly SENIOR_MONSTER_DEFEATED_PATTERN = /遇到强大魔物/;
    readonly SENIOR_FINISHED_PATTERN = /拿到灵芝回来/;

    async handleResponse(command: Command, response: string, instance: GameInstance): Promise<void> {
        instance.account.status.event = instance.account.status.event || {};
        switch (command.type) {
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
        }

    }
    async handleError(command: Command, error: Error, instance: GameInstance): Promise<Command | undefined> {
        command.retries = (command.retries || 0) + 1;
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
        ['event_seniorInit'].forEach(type =>
            this.registerTypeScheduler(instance, type));
    }
    public registerTypeScheduler(instance: GameInstance, type: string): void {
        const status = instance.account.status.event;
        const config = instance.account.config.event!;
        if (!config.enabled)
            return;
        switch (type) {
            case 'event_seniorInit':
                const date = getDate({ ...config.time, dayOffset: status?.senior?.isFinished ? 1 : 0 });
                if (date > new Date(2025, 8, 28, 23, 59, 59))
                    return;
                instance.scheduleCommand({ type: 'event_seniorInit', body: '领辟雷幡', date });
                break;
        }
    }
}