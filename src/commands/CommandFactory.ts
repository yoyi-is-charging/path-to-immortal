// src/commands/CommandFactory.ts

import { CommandHandler } from './CommandHandler';
import { Command } from '../server/types';
import path from 'path';
import fs from 'fs/promises';
import { GameInstance } from '../server/core/GameInstance';
import { DebugLog } from '../utils/DebugLog';

export class CommandFactory {
    private static registry = new Map<string, CommandHandler>();

    public static getCommandType(command: string) {
        const keyword = command.split(' ')[0].trim();
        DebugLog.log('commandFactory', 'getCommandType.start', { keyword, command: DebugLog.preview(command) });
        for (const handler of this.registry.values()) {
            const commandType = handler.COMMAND_TYPE.get(keyword);
            if (commandType) {
                DebugLog.log('commandFactory', 'getCommandType.matched', { keyword, commandType, category: handler.category });
                return commandType;
            }
        }
        DebugLog.log('commandFactory', 'getCommandType.unmatched', { keyword });
        return undefined;
    }

    public static getHandlerCategory(commandType: string) {
        return commandType.split('_')[0];
    }

    public static async init() {
        const handlersDir = path.resolve(__dirname, './impl');
        const files = await fs.readdir(handlersDir);
        DebugLog.log('commandFactory', 'init.start', { handlersDir, files });
        for (const file of files) {
            if (file.endsWith('Handler.ts')) {
                const HandlerClass = require(path.join(handlersDir, file)).default;
                this.register(new HandlerClass());
            }
        }
        DebugLog.log('commandFactory', 'init.complete', { registeredCategories: [...this.registry.keys()] });
    }

    public static register(handler: CommandHandler) {
        this.registry.set(handler.category, handler);
        DebugLog.log('commandFactory', 'register', { category: handler.category, commandCount: handler.COMMAND_TYPE.size });
    }

    public static createHandler(commandType: string): CommandHandler {
        const category = this.getHandlerCategory(commandType);
        const handler = this.registry.get(category)!;
        DebugLog.log('commandFactory', 'createHandler', { commandType, category, found: Boolean(handler) });
        return handler;
    }

    public static matchResponse(command: Command, response: string): boolean {
        const category = this.getHandlerCategory(command.type);
        const handler = this.registry.get(category)!;
        const pattern = handler.RESPONSE_PATTERN instanceof RegExp
            ? handler.RESPONSE_PATTERN
            : handler.RESPONSE_PATTERN.get(command.type)!;
        const matched = pattern.test(response);
        DebugLog.log('commandFactory', 'matchResponse', {
            command: DebugLog.command(command),
            category,
            matched,
            response: DebugLog.preview(response),
        });
        return matched;
    }

    public static registerScheduler(instance: GameInstance) {
        DebugLog.log('commandFactory', 'registerScheduler.start', { accountId: instance.account.id, categories: [...this.registry.keys()] });
        this.registry.forEach(handler => handler.registerScheduler?.(instance));
        DebugLog.log('commandFactory', 'registerScheduler.complete', { accountId: instance.account.id });
    }
}
