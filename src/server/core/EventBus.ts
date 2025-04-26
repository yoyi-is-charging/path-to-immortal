// src/server/core/EventBus.ts

import { logger } from "../../utils/logger";
import { Command } from "../types";

export class EventBus {
    private static listeners: Record<string, Array<(data: any) => void>> = {};

    public static init() {
        EventBus.on('commandScheduled', ({ accountId, command }: { accountId: string, command: Command }) => logger.info(`Command scheduled for account ${accountId}: ${command.type} at ${new Date(command.date!).toLocaleString()}`));
        EventBus.on('commandSent', ({ accountId, command }: { accountId: string, command: Command }) => logger.info(`Command sent for account ${accountId}: ${command.type}`));
        EventBus.on('commandProcessed', ({ accountId, command }: { accountId: string, command: Command }) => logger.info(`Command processed for account ${accountId}: ${command.type}`));
        EventBus.on('commandFailed', ({ accountId, command, error }: { accountId: string, command: Command, error: string }) => logger.info(`Command failed for account ${accountId}: ${command.type} - ${error}`));
        EventBus.on('processCommandError', ({ accountId, command, error }: { accountId: string, command: Command, error: string }) => logger.error(`Error processing command ${command.type} for account ${accountId}: ${error}`));
        EventBus.on('sessionUpdateScheduled', ({ accountId, timestamp }: { accountId: string, timestamp: number }) => logger.info(`Relogin scheduled for account ${accountId} at ${new Date(timestamp).toLocaleString()}`));
    }

    public static on(event: string, listener: (data: any) => void) {
        if (!this.listeners[event])
            this.listeners[event] = [];
        this.listeners[event].push(listener);
    }

    public static off(event: string, listener: (data: any) => void) {
        if (!this.listeners[event])
            return;
        this.listeners[event] = this.listeners[event].filter(l => l !== listener);
    }


    public static emit(event: string, data: any) {
        this.listeners[event]?.forEach(listener => listener(data));
    }
}