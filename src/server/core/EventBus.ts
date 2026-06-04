// src/server/core/EventBus.ts

import { logger } from "../../utils/logger";
import { DebugLog } from "../../utils/DebugLog";
import { Command } from "../types";
import { RuntimeEventMap } from "./RuntimeEvents";

type EventListener<T> = (data: T) => void;

export class EventBus {
    private static listeners: Partial<{ [K in keyof RuntimeEventMap]: Array<EventListener<RuntimeEventMap[K]>> }> = {};

    public static init() {
        EventBus.on('commandFailed', ({ accountId, command, error, response }: { accountId: string, command: Command, error: string, response: string }) => logger.warn('command.failed', {
            accountId,
            commandType: command.type,
            error,
            response: DebugLog.preview(response),
        }));
        EventBus.on('processCommandError', ({ accountId, command, error }: { accountId: string, command: Command, error: string }) => logger.error('command.processError', {
            accountId,
            commandType: command.type,
            error,
        }));
        EventBus.on('sessionUpdateScheduled', ({ accountId, timestamp }: { accountId: string, timestamp: number }) => logger.info('session.reloginScheduled', {
            accountId,
            scheduledAt: new Date(timestamp).toISOString(),
        }));
        logger.info('Runtime event bus initialized');
    }

    public static on<K extends keyof RuntimeEventMap>(event: K, listener: EventListener<RuntimeEventMap[K]>) {
        const listeners = this.listeners as Record<string, Array<EventListener<any>> | undefined>;
        if (!listeners[event])
            listeners[event] = [];
        listeners[event]!.push(listener);
    }

    public static off<K extends keyof RuntimeEventMap>(event: K, listener: EventListener<RuntimeEventMap[K]>) {
        const listeners = this.listeners as Record<string, Array<EventListener<any>> | undefined>;
        if (!listeners[event])
            return;
        listeners[event] = listeners[event]!.filter(l => l !== listener);
    }


    public static emit<K extends keyof RuntimeEventMap>(event: K, data: RuntimeEventMap[K]) {
        DebugLog.runtimeEvent(String(event), data);
        const listeners = this.listeners as Record<string, Array<EventListener<any>> | undefined>;
        listeners[event]?.forEach(listener => listener(data));
    }
}
