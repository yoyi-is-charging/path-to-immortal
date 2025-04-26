// src/commands/impl/PersonalInfoHandler.ts

import { Command } from '../../server/types';
import { CommandHandler } from '../CommandHandler';
import { GameInstance } from '../../server/core/GameInstance';


export default class PersonalInfoHandler implements CommandHandler {
    readonly category = 'personalInfo';
    readonly COMMAND_TYPE = new Map([
        ['我的境界', 'personalInfo'],
    ]);
    readonly RESPONSE_PATTERN = /你的修仙境界/;
    readonly LEVEL_PATTERN = /境界LV(?<level>\d+)/;

    async handleResponse(command: Command, response: string, instance: GameInstance) {
        instance.account.status.personalInfo = instance.account.status.personalInfo || {};
        const level = response.match(this.LEVEL_PATTERN)!.groups!.level;
        instance.updateStatus({ personalInfo: { level: parseInt(level) } });
    }

    async handleError(command: Command, error: Error, instance: GameInstance) {
        command.retries = (command.retries || 0) + 1;
        return command.retries! < 3 ? command : undefined;
    }
}