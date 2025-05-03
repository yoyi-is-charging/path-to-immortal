// src/server/core/StorageService.ts

import fs from 'fs/promises';
import path from 'path';
import { queue } from 'async';
import { Account, ConfigSchema, StatusSchema } from '../types';
import { logger } from '../../utils/logger';

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
        return new Promise<void>((resolve, reject) => {
            this.saveQueue.push(async () => {
                try {
                    const tempPath = `${STORAGE_PATH}.tmp`;
                    const data = JSON.stringify(accounts);
                    await fs.writeFile(tempPath, data);
                    await fs.rename(tempPath, STORAGE_PATH);
                } catch (error) {
                    logger.error('Error saving accounts:', error);
                    throw error;
                }
            }, (error) => error ? reject(error) : resolve());
        });
    }

    static async load(): Promise<Account[]> {
        try {
            const data = await fs.readFile(STORAGE_PATH, 'utf-8');
            const accounts = JSON.parse(data) as Account[];
            accounts.forEach(account => {
                account.online = false;
                account.status = StatusSchema.parse(account.status);
                account.config = ConfigSchema.parse(account.config);
            });
            return accounts;
        } catch (error) {
            logger.error('Error loading accounts:', error);
            return [];
        }
    }
}