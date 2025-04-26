// src/commands/CommandHandler.ts

import { GameInstance } from '../server/core/GameInstance';
import { Command } from '../server/types';
export interface CommandHandler {
    readonly category: string;
    readonly COMMAND_TYPE: Map<string, string>;
    readonly RESPONSE_PATTERN: Map<string, RegExp> | RegExp;
    handleResponse(command: Command, response: string, instance: GameInstance): Promise<void>;
    handleError(command: Command, error: Error, instance: GameInstance): Promise<Command | undefined>;
    registerScheduler?(instance: GameInstance): void;
}