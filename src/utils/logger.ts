// src/utils/logger.ts
import winston from 'winston';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

const LOG_DIR = path.resolve(__dirname, '../../logs');
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
fs.mkdirSync(LOG_DIR, { recursive: true });

const DEBUG_LOG_ENABLED = /^(1|true|yes|on)$/i.test(process.env.DEBUG_LOG ?? '');
const LOG_LEVEL = (process.env.LOG_LEVEL || (DEBUG_LOG_ENABLED ? 'debug' : 'info')).toLowerCase();

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date) && !(value instanceof Error);
};

const pruneMetadataValue = (value: unknown): unknown => {
    if (value === undefined)
        return undefined;
    if (!isPlainObject(value))
        return value;
    const entries = Object.entries(value)
        .map(([key, item]) => [key, pruneMetadataValue(item)] as const)
        .filter(([, item]) => item !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
};

const stringifyMetadata = (metadata: Record<string, unknown>) => {
    const entries = Object.entries(metadata)
        .map(([key, value]) => [key, pruneMetadataValue(value)] as const)
        .filter(([, value]) => value !== undefined);
    return entries.length ? ` ${JSON.stringify(Object.fromEntries(entries))}` : '';
};

const readablePrintf = winston.format.printf(info => {
    const metadata = { ...((info.metadata as Record<string, unknown> | undefined) ?? {}) };
    const debugEvent = metadata.scope && metadata.event
        ? `${metadata.scope}.${metadata.event}`
        : undefined;
    const message = debugEvent && info.message === debugEvent ? debugEvent : info.message;
    if (debugEvent && info.message === debugEvent) {
        delete metadata.scope;
        delete metadata.event;
    }
    const stack = info.stack ? `\n${info.stack}` : '';
    return `${info.timestamp} ${String(info.level).toUpperCase().padEnd(5)} ${message}${stringifyMetadata(metadata)}${stack}`;
});

const readableFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp', 'stack'] }),
    readablePrintf,
);

export const logger = winston.createLogger({
    level: LOG_LEVEL,
    format: readableFormat,
    transports: [
        new winston.transports.File({
            filename: path.join(LOG_DIR, 'error.log'),
            level: 'error'
        }),
        new winston.transports.File({
            filename: path.join(LOG_DIR, 'combined.log')
        })
    ]
});

if (LOG_LEVEL === 'debug' || LOG_LEVEL === 'silly') {
    logger.add(new winston.transports.File({
        filename: path.join(LOG_DIR, 'debug.log'),
        level: 'debug',
    }));
}

if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
            winston.format.errors({ stack: true }),
            winston.format.splat(),
            winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp', 'stack'] }),
            readablePrintf,
        )
    }));
}

logger.info('Logger initialized', {
    level: LOG_LEVEL,
    debugLogEnabled: LOG_LEVEL === 'debug' || LOG_LEVEL === 'silly',
    logDir: LOG_DIR,
});
