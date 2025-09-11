import { GameInstance } from "../../server/core/GameInstance";
import { Command } from "../../server/types";
import { CommandHandler } from "../CommandHandler";

export default class EventHandler implements CommandHandler {
    readonly category = 'event';
    readonly COMMAND_TYPE = new Map([
        ['扭蛋', 'event_capsule'],
        ['接受考验', 'event_trial'],
    ]);
    readonly RESPONSE_PATTERN = new Map([
        ['event_capsule', /扭蛋成功|扭蛋体力用完/],
        ['event_trial', /考验开始|该项已经考验/],
    ]);

    readonly CAPSULE_FINISHED_PATTERN = /扭蛋体力用完/;

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
        }
    }
    async handleError(command: Command, error: Error, instance: GameInstance): Promise<Command | undefined> {
        command.retries = (command.retries || 0) + 1;
        return command.retries! < 3 ? command : undefined;
    }
}