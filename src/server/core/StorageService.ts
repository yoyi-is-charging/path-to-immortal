// src/server/core/StorageService.ts

import fs from 'fs/promises';
import path from 'path';
import { Account, ConfigSchema, StatusSchema } from '../types';
import { logger } from '../../utils/logger';

const STORAGE_PATH = path.resolve(__dirname, '../../../accounts.dat');

export class StorageService {

    static async save(accounts: Account[]) {
        const data = JSON.stringify(accounts);
        await fs.writeFile(STORAGE_PATH, data);
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