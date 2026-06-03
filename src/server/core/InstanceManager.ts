// src/server/core/InstanceManager.ts

import { Account } from '../types';
import { GameInstance } from './GameInstance';
import { logger } from '../../utils/logger';
import { CommandFactory } from '../../commands/CommandFactory';
import { DebugLog } from '../../utils/DebugLog';

export class InstanceManager {
    private static instances = new Map<string, GameInstance>();
    public static async init() {
        DebugLog.log('instanceManager', 'init', { instanceCount: this.instances.size });
        this.scheduleStatusReset();
    }
    public static getInstance(accountId: string) {
        return this.instances.get(accountId);
    }
    public static findInstance(bytes_pb_reserve: string) {
        return Array.from(this.instances.values()).find(instance => instance.account.status.personalInfo?.bytes_pb_reserve === bytes_pb_reserve);
    }

    public static async createInstance(account: Account) {
        DebugLog.log('instanceManager', 'create.request', {
            account: DebugLog.account(account),
            existing: this.instances.has(account.id),
        });
        if (this.instances.has(account.id)) {
            logger.info(`Instance already exists for accountId: ${account.id}, closing instance...`);
            await this.closeInstance(account);
        }
        const instance = new GameInstance(account);
        this.instances.set(account.id, instance);
        try {
            await instance.register();
            DebugLog.log('instanceManager', 'create.complete', { account: DebugLog.account(account), instanceCount: this.instances.size });
        } catch (error) {
            DebugLog.log('instanceManager', 'create.failed', { accountId: account.id, error });
            logger.error((error as Error).message);
            await this.closeInstance(account);
            throw new Error((error as Error).message);
        }
    }
    static async closeInstance(account: Account) {
        DebugLog.log('instanceManager', 'close.request', { account: DebugLog.account(account), existing: this.instances.has(account.id) });
        const instance = this.instances.get(account.id);
        if (!instance) {
            logger.info(`Instance not found for accountId: ${account.id}`);
            DebugLog.log('instanceManager', 'close.missing', { accountId: account.id });
            return;
        }
        await instance.close();
        this.instances.delete(account.id);
        account.online = false;
        DebugLog.log('instanceManager', 'close.complete', { account: DebugLog.account(account), instanceCount: this.instances.size });
    }
    static async sendCommand(accountId: string, message: string) {
        DebugLog.log('instanceManager', 'manualCommand.request', { accountId, message: DebugLog.preview(message) });
        const instance = this.instances.get(accountId);
        if (!instance) throw new Error('Instance not found');
        const body = [{ str: message, bytes_pb_reserve: null }];
        const type = CommandFactory.getCommandType(message);
        DebugLog.log('instanceManager', 'manualCommand.routed', { accountId, type, scheduled: Boolean(type) });
        type ? instance.scheduleCommand({ type, body }) : instance.sendCommand(body);
    }
    static scheduleStatusReset() {
        const now = new Date();
        const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
        const timeUntilMidnight = nextMidnight.getTime() - now.getTime();
        DebugLog.log('instanceManager', 'statusReset.schedule', {
            nextMidnight: nextMidnight.toISOString(),
            dueInMs: timeUntilMidnight,
            instanceCount: this.instances.size,
        });
        setTimeout(async () => {
            DebugLog.log('instanceManager', 'statusReset.run', { instanceCount: this.instances.size });
            await Promise.all(Array.from(this.instances.values()).map(instance => instance.resetStatus()));
            this.scheduleStatusReset();
        }, timeUntilMidnight);
    }
}
