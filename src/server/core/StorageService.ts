// src/server/core/StorageService.ts

import fs from 'fs/promises';
import path from 'path';
import { queue } from 'async';
import { Account, ConfigSchema, StatusSchema } from '../types';
import { logger } from '../../utils/logger';
import { DebugLog } from '../../utils/DebugLog';

const STORAGE_PATH = path.resolve(__dirname, '../../../accounts.dat');

export class StorageService {

    private static saveQueue = queue(async (task: () => Promise<void>) => {
        try {
            await task();
        } catch (error) {
            logger.error('Error in save queue:', error);
        }
    }, 1);

    static async save(accounts: Account[]) {
        DebugLog.log('storage', 'save.enqueue', { accountCount: accounts.length });
        return new Promise<void>((resolve, reject) => {
            this.saveQueue.push(async () => {
                try {
                    const tempPath = `${STORAGE_PATH}.tmp`;
                    const data = JSON.stringify(accounts);
                    DebugLog.log('storage', 'save.write', { accountCount: accounts.length, bytes: Buffer.byteLength(data), path: STORAGE_PATH });
                    await fs.writeFile(tempPath, data);
                    await fs.rename(tempPath, STORAGE_PATH);
                    DebugLog.log('storage', 'save.complete', { accountCount: accounts.length, path: STORAGE_PATH });
                } catch (error) {
                    DebugLog.log('storage', 'save.failed', { error, path: STORAGE_PATH });
                    logger.error('Error saving accounts:', error);
                    throw error;
                }
            }, (error) => error ? reject(error) : resolve());
        });
    }

    static async load(): Promise<Account[]> {
        try {
            DebugLog.log('storage', 'load.start', { path: STORAGE_PATH });
            const data = await fs.readFile(STORAGE_PATH, 'utf-8');
            const accounts = JSON.parse(data) as Account[];
            accounts.forEach(account => {
                account.online = false;
                account.status = StatusSchema.parse(account.status);
                account.config = ConfigSchema.parse(account.config);
            });
            DebugLog.log('storage', 'load.complete', { accountCount: accounts.length, bytes: Buffer.byteLength(data) });
            return accounts;
        } catch (error) {
            DebugLog.log('storage', 'load.failed', { error, path: STORAGE_PATH });
            logger.error('Error loading accounts:', error);
            return [];
        }
    }
}
