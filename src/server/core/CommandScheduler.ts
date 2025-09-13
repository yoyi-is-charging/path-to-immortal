// src/server/core/CommandScheduler.ts

import { CommandFactory } from '../../commands/CommandFactory';
import { logger } from '../../utils/logger';
import { Command } from '../types';
import { EventBus } from './EventBus';
import { GameInstance } from './GameInstance';

export class CommandScheduler {

    static readonly COLLISION_THRESHOLD = 1000;
    static readonly DESTROY_THRESHOLD = 60 * 1000; // 60 seconds

    constructor(
        private readonly instance: GameInstance,
        public readonly pendingCommands: Array<Command> = [],
        public readonly scheduledCommands: Array<Command> = [],
        public commandCount: number = 0,
    ) { }

    public init() {
        CommandFactory.registerScheduler(this.instance);
    }

    public async destroy() {
        await new Promise<void>(resolve => {
            const checkCommands = () => (this.isPending() || (this.isScheduled() && this.getNextScheduledCommand().date!.getTime() - Date.now() < CommandScheduler.DESTROY_THRESHOLD)) ? setTimeout(checkCommands, 1000) : resolve();
            checkCommands();
        });
        this.scheduledCommands.forEach(cmd => clearTimeout(cmd.timeoutId!));
        this.pendingCommands.length = 0;
        this.scheduledCommands.length = 0;
    }

    public isPending() { return this.pendingCommands.length > 0; }
    public isScheduled() { return this.scheduledCommands.length > 0; }
    public getNextScheduledCommand() {
        return this.scheduledCommands.reduce((prev, curr) => prev.date! < curr.date! ? prev : curr);
    }

    public async scheduleCommand(command: Command, delay: number = 0) {
        const existingCommand = this.scheduledCommands.find(cmd => cmd.type === command.type);
        if (existingCommand) {
            clearTimeout(existingCommand.timeoutId!);
            this.scheduledCommands.splice(this.scheduledCommands.indexOf(existingCommand), 1);
        }
        let timestamp = (command.date || new Date()).getTime() + delay;
        while (this.scheduledCommands.some(cmd => Math.abs(cmd.date?.getTime()! - timestamp) < CommandScheduler.COLLISION_THRESHOLD))
            timestamp += CommandScheduler.COLLISION_THRESHOLD;
        command = { ...command, id: crypto.randomUUID(), date: new Date(timestamp) };
        const timeoutId = setTimeout(() => this.processCommand(command), timestamp - Date.now());
        command.timeoutId = timeoutId;
        this.scheduledCommands.push(command);
        EventBus.emit('commandScheduled', { accountId: this.instance.account.id, command });
        this.instance.scheduleFetch();
    }

    public async processCommand(command: Command) {
        if (Date.now() < command.date!.getTime()) {
            setTimeout(() => this.processCommand(command), command.date!.getTime() - Date.now());
            return;
        }
        const handler = CommandFactory.createHandler(command.type);
        let response = 'response uncaptured';
        try {
            response = await this.sendCommand(command);
            await handler.handleResponse(command, response, this.instance);
        } catch (error) {
            EventBus.emit('commandFailed', { accountId: this.instance.account.id, command, error: (error as Error).message, response });
            const newCommand = await handler.handleError(command, error as Error, this.instance);
            if (newCommand)
                this.instance.scheduleCommand(newCommand);
            else
                EventBus.emit('processCommandError', { accountId: this.instance.account.id, command, error: (error as Error).message });
        }
    }

    public async sendCommand(command: Command): Promise<string> {
        if (typeof command.body === 'function')
            command.body = await command.body(this.instance);
        if (typeof command.body === 'string')
            command.body = [{ str: command.body, bytes_pb_reserve: null }];
        this.commandCount++;
        try {
            await this.instance.sendCommand(command.body);
            this.scheduledCommands.splice(this.scheduledCommands.indexOf(command), 1);
            this.pendingCommands.push(command);
            EventBus.emit('commandSent', { accountId: this.instance.account.id, command });
            this.instance.scheduleFetch();
            let timeoutId: NodeJS.Timeout;
            const timeoutPromise = new Promise<string>((resolve, reject) => timeoutId = setTimeout(() => reject(new Error(`Command ${command.type} timed out`)), 15000));
            const responsePromise = new Promise<string>((resolve, reject) => { command.resolve = resolve, command.reject = reject; });
            return Promise.race([timeoutPromise, responsePromise]).finally(() => {
                clearTimeout(timeoutId);
                this.pendingCommands.splice(this.pendingCommands.indexOf(command), 1);
                EventBus.emit('commandProcessed', { accountId: this.instance.account.id, command });
                this.instance.scheduleFetch();
            });
        }
        catch (error) {
            logger.error(`Failed to send command ${command.type} for accountId: ${this.instance.account.id}`, (error as Error).message);
            return this.sendCommand(command);
        }
    }

    public async processResponse(response: string) {
        EventBus.emit('responseReceived', { accountId: this.instance.account.id, response });
        const command = this.pendingCommands.find(cmd => CommandFactory.matchResponse(cmd, response));
        if (!command) return;
        command.resolve!(response);
        EventBus.emit('commandResolved', { accountId: this.instance.account.id, command, response });
    }
}