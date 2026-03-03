// src/commands/CommandFactory.ts

import { CommandHandler } from './CommandHandler';
import { Command } from '../server/types';
import path from 'path';
import fs from 'fs/promises';
import { GameInstance } from '../server/core/GameInstance';

export class CommandFactory {
    private static registry = new Map<string, CommandHandler>();

    public static getCommandType(command: string) {
        const keyword = command.split(' ')[0].trim();
        for (const handler of this.registry.values()) {
            const commandType = handler.COMMAND_TYPE.get(keyword);
            if (commandType)
                return commandType;
        }
        return undefined;
    }

    public static getHandlerCategory(commandType: string) {
        return commandType.split('_')[0];
    }

    public static async init() {
        const handlersDir = path.resolve(__dirname, './impl');
        const files = await fs.readdir(handlersDir);
        for (const file of files) {
            if (file.endsWith('Handler.ts')) {
                const HandlerClass = require(path.join(handlersDir, file)).default;
                this.register(new HandlerClass());
            }
        }
    }

    public static register(handler: CommandHandler) {
        this.registry.set(handler.category, handler);
    }

    public static createHandler(commandType: string): CommandHandler {
        const category = this.getHandlerCategory(commandType);
        const handler = this.registry.get(category)!;
        return handler;
    }

    public static matchResponse(command: Command, response: string): boolean {
        const category = this.getHandlerCategory(command.type);
        const handler = this.registry.get(category)!;
        if (handler.RESPONSE_PATTERN instanceof RegExp)
            return handler.RESPONSE_PATTERN.test(response);
        const pattern = handler.RESPONSE_PATTERN.get(command.type)!;
        return pattern.test(response);
    }

    public static registerScheduler(instance: GameInstance) {
        this.registry.forEach(handler => handler.registerScheduler?.(instance));
    }
}