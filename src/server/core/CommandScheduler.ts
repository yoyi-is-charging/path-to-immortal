// src/server/core/CommandScheduler.ts

import { CommandFactory } from '../../commands/CommandFactory';
import { logger } from '../../utils/logger';
import { DebugLog } from '../../utils/DebugLog';
import { Command } from '../types';
import { EventBus } from './EventBus';
import { GameInstance } from './GameInstance';
import { MessageRouter } from './MessageRouter';
import { IncomingMessage } from './RuntimeEvents';

export class CommandScheduler {

    static readonly COLLISION_THRESHOLD = 1000;
    static readonly DESTROY_THRESHOLD = 60 * 1000; // 60 seconds

    private readonly messageRouter: MessageRouter;

    constructor(
        private readonly instance: GameInstance,
        public readonly pendingCommands: Array<Command> = [],
        public readonly scheduledCommands: Array<Command> = [],
        public commandCount: number = 0,
    ) {
        this.messageRouter = new MessageRouter(instance.account.id);
    }

    public init() {
        DebugLog.log('scheduler', 'init', {
            accountId: this.instance.account.id,
            scheduledCount: this.scheduledCommands.length,
            pendingCount: this.pendingCommands.length,
        });
        CommandFactory.registerScheduler(this.instance);
    }

    public async destroy() {
        DebugLog.log('scheduler', 'destroy.start', {
            accountId: this.instance.account.id,
            scheduledCount: this.scheduledCommands.length,
            pendingCount: this.pendingCommands.length,
        });
        await new Promise<void>(resolve => {
            const checkCommands = () => (this.isPending() || (this.isScheduled() && this.getNextScheduledCommand().date!.getTime() - Date.now() < CommandScheduler.DESTROY_THRESHOLD)) ? setTimeout(checkCommands, 1000) : resolve();
            checkCommands();
        });
        this.scheduledCommands.forEach(cmd => clearTimeout(cmd.timeoutId!));
        this.pendingCommands.length = 0;
        this.scheduledCommands.length = 0;
        DebugLog.log('scheduler', 'destroy.complete', { accountId: this.instance.account.id });
    }

    public isPending() { return this.pendingCommands.length > 0; }
    public isScheduled() { return this.scheduledCommands.length > 0; }
    public getNextScheduledCommand() {
        return this.scheduledCommands.reduce((prev, curr) => prev.date! < curr.date! ? prev : curr);
    }

    public async scheduleCommand(command: Command, delay: number = 0) {
        DebugLog.log('scheduler', 'schedule.request', {
            accountId: this.instance.account.id,
            command: DebugLog.command(command),
            delay,
            scheduledCount: this.scheduledCommands.length,
        });
        const existingCommand = this.scheduledCommands.find(cmd => cmd.type === command.type);
        if (existingCommand) {
            clearTimeout(existingCommand.timeoutId!);
            this.scheduledCommands.splice(this.scheduledCommands.indexOf(existingCommand), 1);
            DebugLog.log('scheduler', 'schedule.replaceExisting', {
                accountId: this.instance.account.id,
                existingCommand: DebugLog.command(existingCommand),
                nextCommand: DebugLog.command(command),
            });
        }
        let timestamp = (command.date || new Date()).getTime() + delay;
        let collisionCount = 0;
        while (this.scheduledCommands.some(cmd => Math.abs(cmd.date?.getTime()! - timestamp) < CommandScheduler.COLLISION_THRESHOLD)) {
            timestamp += CommandScheduler.COLLISION_THRESHOLD;
            collisionCount++;
        }
        command = { ...command, id: crypto.randomUUID(), date: new Date(timestamp) };
        const timeoutId = setTimeout(() => this.processCommand(command), timestamp - Date.now());
        command.timeoutId = timeoutId;
        this.scheduledCommands.push(command);
        DebugLog.log('scheduler', 'schedule.enqueued', {
            accountId: this.instance.account.id,
            command: DebugLog.command(command),
            dueInMs: timestamp - Date.now(),
            collisionCount,
            scheduledCount: this.scheduledCommands.length,
        });
        EventBus.emit('commandScheduled', { accountId: this.instance.account.id, command });
        this.instance.scheduleFetch();
    }

    public async processCommand(command: Command) {
        if (Date.now() < command.date!.getTime()) {
            DebugLog.log('scheduler', 'process.tooEarly', {
                accountId: this.instance.account.id,
                command: DebugLog.command(command),
                dueInMs: command.date!.getTime() - Date.now(),
            });
            setTimeout(() => this.processCommand(command), command.date!.getTime() - Date.now());
            return;
        }
        const handler = CommandFactory.createHandler(command.type);
        let response = 'response uncaptured';
        DebugLog.log('scheduler', 'process.start', {
            accountId: this.instance.account.id,
            command: DebugLog.command(command),
            handlerCategory: handler.category,
        });
        try {
            response = await this.sendCommand(command);
            DebugLog.log('scheduler', 'handler.start', {
                accountId: this.instance.account.id,
                command: DebugLog.command(command),
                response: DebugLog.preview(response),
            });
            await handler.handleResponse(command, response, this.instance);
            DebugLog.log('scheduler', 'handler.complete', {
                accountId: this.instance.account.id,
                command: DebugLog.command(command),
            });
        } catch (error) {
            DebugLog.log('scheduler', 'process.error', {
                accountId: this.instance.account.id,
                command: DebugLog.command(command),
                error,
                response: DebugLog.preview(response),
            });
            EventBus.emit('commandFailed', { accountId: this.instance.account.id, command, error: (error as Error).message, response });
            const newCommand = await handler.handleError(command, error as Error, this.instance);
            if (newCommand) {
                DebugLog.log('scheduler', 'retry.scheduled', {
                    accountId: this.instance.account.id,
                    failedCommand: DebugLog.command(command),
                    retryCommand: DebugLog.command(newCommand),
                });
                this.instance.scheduleCommand(newCommand);
            } else {
                DebugLog.log('scheduler', 'retry.exhausted', {
                    accountId: this.instance.account.id,
                    command: DebugLog.command(command),
                });
                EventBus.emit('processCommandError', { accountId: this.instance.account.id, command, error: (error as Error).message });
            }
        }
    }

    public async sendCommand(command: Command): Promise<string> {
        if (typeof command.body === 'function') {
            DebugLog.log('scheduler', 'body.resolveFunction.start', {
                accountId: this.instance.account.id,
                command: DebugLog.command(command),
            });
            command.body = await command.body(this.instance);
            DebugLog.log('scheduler', 'body.resolveFunction.complete', {
                accountId: this.instance.account.id,
                command: DebugLog.command(command),
            });
        }
        if (typeof command.body === 'string')
            command.body = [{ str: command.body, bytes_pb_reserve: null }];
        this.commandCount++;
        try {
            DebugLog.log('scheduler', 'send.start', {
                accountId: this.instance.account.id,
                command: DebugLog.command(command),
                commandCount: this.commandCount,
            });
            await this.instance.sendCommand(command.body);
            this.scheduledCommands.splice(this.scheduledCommands.indexOf(command), 1);
            this.pendingCommands.push(command);
            DebugLog.log('scheduler', 'pending.added', {
                accountId: this.instance.account.id,
                command: DebugLog.command(command),
                scheduledCount: this.scheduledCommands.length,
                pendingCount: this.pendingCommands.length,
            });
            EventBus.emit('commandSent', { accountId: this.instance.account.id, command });
            this.instance.scheduleFetch();
            let timeoutId: NodeJS.Timeout;
            const timeoutPromise = new Promise<string>((resolve, reject) => timeoutId = setTimeout(() => {
                DebugLog.log('scheduler', 'send.timeout', {
                    accountId: this.instance.account.id,
                    command: DebugLog.command(command),
                    pendingCount: this.pendingCommands.length,
                });
                reject(new Error(`Command ${command.type} timed out`));
            }, 15000));
            const responsePromise = new Promise<string>((resolve, reject) => { command.resolve = resolve, command.reject = reject; });
            return Promise.race([timeoutPromise, responsePromise]).finally(() => {
                clearTimeout(timeoutId);
                this.pendingCommands.splice(this.pendingCommands.indexOf(command), 1);
                DebugLog.log('scheduler', 'pending.removed', {
                    accountId: this.instance.account.id,
                    command: DebugLog.command(command),
                    pendingCount: this.pendingCommands.length,
                });
                EventBus.emit('commandProcessed', { accountId: this.instance.account.id, command });
                this.instance.scheduleFetch();
            });
        }
        catch (error) {
            DebugLog.log('scheduler', 'send.errorRetry', {
                accountId: this.instance.account.id,
                command: DebugLog.command(command),
                error,
            });
            logger.error(`Failed to send command ${command.type} for accountId: ${this.instance.account.id}`, (error as Error).message);
            return this.sendCommand(command);
        }
    }

    public async processMessage(message: IncomingMessage) {
        DebugLog.log('scheduler', 'message.process', {
            accountId: this.instance.account.id,
            message: DebugLog.message(message),
            pendingCount: this.pendingCommands.length,
        });
        EventBus.emit('messageReceived', message);
        await this.processResponse(message.text, message);
    }

    public async processResponse(response: string, message?: IncomingMessage) {
        DebugLog.log('scheduler', 'response.process', {
            accountId: this.instance.account.id,
            response: DebugLog.preview(response),
            message: DebugLog.message(message),
            pendingCount: this.pendingCommands.length,
        });
        EventBus.emit('responseReceived', { accountId: this.instance.account.id, response, message });
        const command = message
            ? this.messageRouter.matchPendingCommand(this.pendingCommands, message)
            : this.pendingCommands.find(cmd => CommandFactory.matchResponse(cmd, response));
        if (!command) {
            DebugLog.log('scheduler', 'response.unmatched', {
                accountId: this.instance.account.id,
                response: DebugLog.preview(response),
                message: DebugLog.message(message),
                pendingCommands: this.pendingCommands.map(command => DebugLog.command(command)),
            });
            return;
        }
        DebugLog.log('scheduler', 'response.matched', {
            accountId: this.instance.account.id,
            command: DebugLog.command(command),
            message: DebugLog.message(message),
        });
        command.resolve!(response);
        EventBus.emit('commandResolved', { accountId: this.instance.account.id, command, response, message });
    }
}
