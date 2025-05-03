// src/server/core/InstanceManager.ts

import { Account } from '../types';
import { GameInstance } from './GameInstance';
import { logger } from '../../utils/logger';
import { CommandFactory } from '../../commands/CommandFactory';

export class InstanceManager {
    private static instances = new Map<string, GameInstance>();
    public static async init() {
        this.scheduleStatusReset();
    }
    public static getInstance(accountId: string) {
        return this.instances.get(accountId);
    }
    public static findInstance(bytes_pb_reserve: string) {
        return Array.from(this.instances.values()).find(instance => instance.account.status.personalInfo?.bytes_pb_reserve === bytes_pb_reserve);
    }

    public static async createInstance(account: Account) {
        if (this.instances.has(account.id)) {
            logger.info(`Instance already exists for accountId: ${account.id}, closing instance...`);
            await this.closeInstance(account);
        }
        const instance = new GameInstance(account);
        this.instances.set(account.id, instance);
        try {
            await instance.register();
        } catch (error) {
            logger.error((error as Error).message);
            await this.closeInstance(account);
            throw new Error((error as Error).message);
        }
    }
    static async closeInstance(account: Account) {
        const instance = this.instances.get(account.id);
        if (!instance) {
            logger.info(`Instance not found for accountId: ${account.id}`);
            return;
        }
        await instance.close();
        this.instances.delete(account.id);
        account.online = false;
    }
    static async sendCommand(accountId: string, message: string) {
        const instance = this.instances.get(accountId);
        if (!instance) throw new Error('Instance not found');
        const body = [{ str: message, bytes_pb_reserve: null }];
        const type = CommandFactory.getCommandType(message);
        type ? instance.scheduleCommand({ type, body }) : instance.sendCommand(body);
    }
    static scheduleStatusReset() {
        const now = new Date();
        const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
        const timeUntilMidnight = nextMidnight.getTime() - now.getTime();
        setTimeout(async () => {
            await Promise.all(Array.from(this.instances.values()).map(instance => instance.resetStatus()));
            this.scheduleStatusReset();
        }, timeUntilMidnight);
    }
}