// src/commands/impl/MeditationHandler.ts

import { Command } from '../../server/types';
import { CommandHandler } from '../CommandHandler';
import { GameInstance } from '../../server/core/GameInstance';
import { parseDate, getDate } from '../../utils/TimeUtils';
import { InstanceManager } from '../../server/core/InstanceManager';


export default class MeditationHandler implements CommandHandler {
    readonly category = 'meditation';
    readonly COMMAND_TYPE = new Map([
        ['打坐', 'meditation'],
        ['吸收灵力', 'meditation'],
        ['双休', 'meditation_tantricRequest'],
        ['同意双休', 'meditation_tantricResponse'],
    ]);
    readonly RESPONSE_PATTERN = new Map([
        ['meditation', /请等待(打坐|双修|双休)完成|吸收灵力成功|你还没有打坐|需要消耗次数/],
        ['meditation_tantricRequest', /想和你一起双休|已经发起一个双休请求|请对方先吸收|需要消耗次数/],
        ['meditation_tantricResponse', /一起双休中|没找到你要同意的双休请求/],
    ]);
    readonly FINISH_PATTERN = /(?<hours>\d+)时(?<minutes>\d+)分(?<seconds>\d+)秒/;
    readonly REQUEST_ABSORB_PATTERN = /请对方先吸收/;
    readonly EXHAUSTED_PATTERN = /需要消耗次数/;

    async handleResponse(command: Command, response: string, instance: GameInstance) {
        instance.account.status.meditation = instance.account.status.meditation || {};
        const config = instance.account.config.meditation!;
        if (command.type === 'meditation_tantricRequest') {
            const exhausted = this.EXHAUSTED_PATTERN.test(response);
            instance.updateStatus({ meditation: { exhausted } });
            if (!exhausted) {
                const target = instance.account.status.meditation?.target!;
                const targetInstance = InstanceManager.findInstance(target.bytes_pb_reserve!)!;
                if (this.REQUEST_ABSORB_PATTERN.test(response)) {
                    targetInstance.scheduleCommand({ type: 'meditation', body: '吸收灵力' });
                    instance.scheduleCommand(command, 1000);
                } else {
                    targetInstance.updateStatus({ meditation: { target: { str: instance.account.status.personalInfo!.str!, bytes_pb_reserve: instance.account.status.personalInfo!.bytes_pb_reserve! } } });
                    targetInstance.scheduleCommand({ type: 'meditation_tantricResponse', body: `同意双休` });
                }
            }
            if (exhausted)
                this.registerScheduler(instance);
        }
        if (command.type === 'meditation_tantricResponse') {
            const finishTime = parseDate(response, this.FINISH_PATTERN);
            if (finishTime) {
                const sourceInstance = InstanceManager.findInstance(instance.account.status.meditation.target?.bytes_pb_reserve!)!;
                instance.updateStatus({ meditation: { inProgress: true, finishTime, exhausted: false } });
                sourceInstance.updateStatus({ meditation: { inProgress: true, finishTime, exhausted: false } });
                instance.scheduleCommand({ type: 'meditation', body: '吸收灵力', date: finishTime });
                sourceInstance.scheduleCommand({ type: 'meditation', body: '吸收灵力', date: finishTime });
            }
        }
        if (command.type === 'meditation') {
            const finishTime = parseDate(response, this.FINISH_PATTERN);
            const inProgress = finishTime ? true : false;
            const exhausted = this.EXHAUSTED_PATTERN.test(response);
            instance.updateStatus({ meditation: { inProgress, finishTime, exhausted } });
            if (config.enabled && !inProgress && !exhausted) {
                instance.updateStatus({ meditation: { target: undefined } });
                if (config.tantric?.enabled) {
                    let targetInstance: GameInstance | undefined = undefined;
                    for (const target of config.tantric.targets!) {
                        targetInstance = InstanceManager.findInstance(target);
                        if (targetInstance && !targetInstance.account.status.meditation?.exhausted)
                            break;
                        targetInstance = undefined;
                    }
                    if (targetInstance) {
                        const target = { str: targetInstance.account.status.personalInfo!.str!, bytes_pb_reserve: targetInstance.account.status.personalInfo!.bytes_pb_reserve! };
                        instance.updateStatus({ meditation: { target } });
                        instance.scheduleCommand({ type: 'meditation_tantricRequest', body: [{ str: '双休', bytes_pb_reserve: null }, target, { str: `${config.count}`, bytes_pb_reserve: null }] });
                    } else if (config.tantric.autoMeditation)
                        instance.scheduleCommand({ type: 'meditation', body: `打坐 ${config.count}` });
                } else
                    instance.scheduleCommand({ type: 'meditation', body: `打坐 ${config.count}` });
            }
            if (inProgress) {
                instance.scheduleCommand({ type: 'meditation', body: '吸收灵力', date: finishTime });
                const sourceInstance = InstanceManager.findInstance(instance.account.status.meditation.target?.bytes_pb_reserve!);
                if (sourceInstance) {
                    sourceInstance.updateStatus({ meditation: { inProgress: true, finishTime, exhausted: false } });
                    sourceInstance.scheduleCommand({ type: 'meditation', body: '吸收灵力', date: finishTime });
                }
            }
            if (exhausted)
                this.registerScheduler(instance);
        }
    }

    async handleError(command: Command, error: Error, instance: GameInstance) {
        command = { ...command, type: 'meditation', body: '吸收灵力', retries: (command.retries || 0) + 1 };
        return command.retries! < 3 ? command : undefined;
    }

    registerScheduler(instance: GameInstance): void {
        const config = instance.account.config.meditation!;
        if (instance.account.status.meditation?.finishTime)
            instance.scheduleCommand({ type: 'meditation', body: '吸收灵力', date: instance.account.status.meditation?.finishTime });
        else if (config.enabled)
            instance.scheduleCommand({ type: 'meditation', body: '吸收灵力', date: getDate({ ...config.time!, dayOffset: instance.account.status.meditation?.exhausted ? 1 : 0 }) });
    }
}