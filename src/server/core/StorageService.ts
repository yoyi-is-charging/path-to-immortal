// src/server/core/StorageService.ts

import fs from 'fs/promises';
import path from 'path';
import { queue } from 'async';
import { Account, ConfigSchema, StatusSchema } from '../types';
import { logger } from '../../utils/logger';
import { DebugLog } from '../../utils/DebugLog';

const STORAGE_PATH = path.resolve(__dirname, '../../../accounts.dat');
const STORAGE_BACKUP_PATH = `${STORAGE_PATH}.bak`;
const SAVE_RETRY_DELAYS_MS = [50, 100, 250, 500, 1000, 2000];
const RETRYABLE_SAVE_ERROR_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

export class StorageService {

    private static saveQueue = queue(async (task: () => Promise<void>) => {
        await task();
    }, 1);

    static async save(accounts: Account[]) {
        const data = JSON.stringify(accounts);
        const bytes = Buffer.byteLength(data);
        DebugLog.log('storage', 'save.enqueue', { accountCount: accounts.length, bytes });
        return new Promise<void>((resolve, reject) => {
            this.saveQueue.push(async () => {
                try {
                    DebugLog.log('storage', 'save.write', { accountCount: accounts.length, bytes, path: STORAGE_PATH });
                    await this.writeSaveFile(data);
                    DebugLog.log('storage', 'save.complete', { accountCount: accounts.length, path: STORAGE_PATH });
                } catch (error) {
                    DebugLog.log('storage', 'save.failed', { error, path: STORAGE_PATH });
                    logger.error('Error saving accounts:', error);
                    throw error;
                }
            }, (error) => error ? reject(error) : resolve());
        });
    }

    private static async writeSaveFile(data: string) {
        await fs.mkdir(path.dirname(STORAGE_PATH), { recursive: true });
        const tempPath = this.createTempPath();
        try {
            await this.writeFileDurably(tempPath, data);
            await this.validateSaveFile(tempPath);
            await this.backupCurrentSave();
            await this.replaceCurrentSave(tempPath);
        } finally {
            await this.removeTempFile(tempPath);
        }
    }

    private static createTempPath() {
        const random = Math.random().toString(36).slice(2);
        return `${STORAGE_PATH}.${process.pid}.${Date.now()}.${random}.tmp`;
    }

    private static async writeFileDurably(filePath: string, data: string) {
        const handle = await fs.open(filePath, 'w');
        try {
            await handle.writeFile(data, 'utf8');
            await handle.sync();
        } finally {
            await handle.close();
        }
    }

    private static async replaceCurrentSave(tempPath: string) {
        await this.withRetry(
            () => fs.rename(tempPath, STORAGE_PATH),
            error => this.isRetryableSaveError(error),
            retry => DebugLog.log('storage', 'save.rename.retry', {
                attempt: retry.attempt,
                delayMs: retry.delayMs,
                code: retry.error.code,
                path: tempPath,
                dest: STORAGE_PATH,
            })
        );
    }

    private static async validateSaveFile(filePath: string) {
        await this.loadFromPath(filePath);
        DebugLog.log('storage', 'save.validate.complete', { path: filePath });
    }

    private static async backupCurrentSave() {
        if (!await this.exists(STORAGE_PATH)) {
            DebugLog.log('storage', 'backup.skipMissingSource', { path: STORAGE_PATH });
            return;
        }
        try {
            await this.loadFromPath(STORAGE_PATH);
        } catch (error) {
            logger.warn('Skipped storage backup because current save is invalid', { path: STORAGE_PATH, error });
            DebugLog.log('storage', 'backup.skipInvalidSource', { error, path: STORAGE_PATH });
            return;
        }
        await this.withRetry(
            () => fs.copyFile(STORAGE_PATH, STORAGE_BACKUP_PATH),
            error => this.isRetryableSaveError(error),
            retry => DebugLog.log('storage', 'backup.retry', {
                attempt: retry.attempt,
                delayMs: retry.delayMs,
                code: retry.error.code,
                path: STORAGE_PATH,
                dest: STORAGE_BACKUP_PATH,
            })
        );
        DebugLog.log('storage', 'backup.complete', { path: STORAGE_BACKUP_PATH });
    }

    private static async withRetry(
        operation: () => Promise<void>,
        shouldRetry: (error: NodeJS.ErrnoException) => boolean,
        onRetry: (retry: { attempt: number; delayMs: number; error: NodeJS.ErrnoException }) => void,
    ) {
        let lastError: NodeJS.ErrnoException | undefined;
        for (let attempt = 0; attempt <= SAVE_RETRY_DELAYS_MS.length; attempt++) {
            try {
                await operation();
                return;
            } catch (error) {
                lastError = this.toNodeError(error);
                const delayMs = SAVE_RETRY_DELAYS_MS[attempt];
                if (delayMs === undefined || !shouldRetry(lastError))
                    throw error;
                onRetry({ attempt: attempt + 1, delayMs, error: lastError });
                await this.sleep(delayMs);
            }
        }
        throw lastError;
    }

    private static toNodeError(error: unknown): NodeJS.ErrnoException {
        return error instanceof Error ? error as NodeJS.ErrnoException : new Error(String(error));
    }

    private static isRetryableSaveError(error: unknown): error is NodeJS.ErrnoException {
        const nodeError = this.toNodeError(error);
        return Boolean(nodeError.code && RETRYABLE_SAVE_ERROR_CODES.has(nodeError.code));
    }

    private static sleep(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private static async removeTempFile(tempPath: string) {
        try {
            await fs.rm(tempPath, { force: true });
        } catch (error) {
            logger.warn('Failed to remove temporary storage file', { path: tempPath, error });
        }
    }

    private static async exists(filePath: string) {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    static async load(): Promise<Account[]> {
        try {
            DebugLog.log('storage', 'load.start', { path: STORAGE_PATH });
            return await this.loadFromPath(STORAGE_PATH);
        } catch (error) {
            DebugLog.log('storage', 'load.failed', { error, path: STORAGE_PATH });
            logger.error('Error loading accounts:', error);
            try {
                DebugLog.log('storage', 'load.backup.start', { path: STORAGE_BACKUP_PATH });
                const accounts = await this.loadFromPath(STORAGE_BACKUP_PATH);
                logger.warn('Loaded accounts from backup storage', { path: STORAGE_BACKUP_PATH });
                return accounts;
            } catch (backupError) {
                DebugLog.log('storage', 'load.backup.failed', { error: backupError, path: STORAGE_BACKUP_PATH });
                logger.error('Error loading backup accounts:', backupError);
            }
            return [];
        }
    }

    private static async loadFromPath(filePath: string): Promise<Account[]> {
        const data = await fs.readFile(filePath, 'utf-8');
        const accounts = JSON.parse(data) as Account[];
        accounts.forEach(account => {
            account.online = false;
            account.status = StatusSchema.parse(account.status);
            account.config = ConfigSchema.parse(account.config);
        });
        DebugLog.log('storage', 'load.complete', { accountCount: accounts.length, bytes: Buffer.byteLength(data), path: filePath });
        return accounts;
    }
}
