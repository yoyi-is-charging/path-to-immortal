import { CommandFactory } from '../../commands/CommandFactory';
import { DebugLog } from '../../utils/DebugLog';
import { Command } from '../types';
import { EventBus } from './EventBus';
import { IncomingMessage } from './RuntimeEvents';

export class MessageRouter {
    constructor(private readonly accountId: string) { }

    public matchPendingCommand(pendingCommands: Command[], message: IncomingMessage): Command | undefined {
        DebugLog.log('router', 'match.start', {
            accountId: this.accountId,
            message: DebugLog.message(message),
            pendingCommands: pendingCommands.map(command => DebugLog.command(command)),
        });
        const command = pendingCommands.find(cmd => CommandFactory.matchResponse(cmd, message.text));
        if (command) {
            DebugLog.log('router', 'match.success', {
                accountId: this.accountId,
                command: DebugLog.command(command),
                message: DebugLog.message(message),
            });
            EventBus.emit('commandResponseMatched', { accountId: this.accountId, command, message });
        }
        else {
            DebugLog.log('router', 'match.missed', {
                accountId: this.accountId,
                message: DebugLog.message(message),
                pendingCount: pendingCommands.length,
            });
            EventBus.emit('messageUnmatched', { accountId: this.accountId, message });
        }
        return command;
    }
}
