import { Command, Status } from '../../server/types';
import { CommandHandler } from '../CommandHandler';
import { GameInstance } from '../../server/core/GameInstance';
import { readNumberAfter } from '../../utils/FieldExtractor';

type PersonalInfoStatus = NonNullable<Status['personalInfo']>;
type PersonalInfoResponse = { type: 'level'; level: number } | { type: 'unmatched' };
type PersonalInfoEffect = { type: 'patchStatus'; status: PersonalInfoStatus };

export default class PersonalInfoHandler implements CommandHandler {
    readonly category = 'personalInfo';
    readonly COMMAND_TYPE = new Map([
        ['我的境界', 'personalInfo'],
    ]);
    readonly RESPONSE_PATTERN = /你的修仙境界/;

    async handleResponse(command: Command, response: string, instance: GameInstance) {
        instance.account.status.personalInfo = instance.account.status.personalInfo || {};
        const personalInfoResponse = this.parseResponse(response);
        const effects = this.transition(personalInfoResponse);
        for (const effect of effects)
            await this.applyEffect(effect, instance);
    }

    async handleError(command: Command, error: Error, instance: GameInstance) {
        command.retries = (command.retries || 0) + 1;
        return command.retries! < 3 ? command : undefined;
    }

    private parseResponse(response: string): PersonalInfoResponse {
        const level = readNumberAfter(response, '境界LV');
        return level ? { type: 'level', level } : { type: 'unmatched' };
    }

    private transition(response: PersonalInfoResponse): PersonalInfoEffect[] {
        if (response.type === 'level')
            return [{ type: 'patchStatus', status: { level: response.level } }];
        return [];
    }

    private async applyEffect(effect: PersonalInfoEffect, instance: GameInstance) {
        await instance.updateStatus({ personalInfo: effect.status });
    }
}
