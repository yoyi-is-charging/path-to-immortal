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
const METADATA_LIMIT = 180;

const COLORS: Record<string, string> = {
    error: '\x1b[31m',
    warn: '\x1b[33m',
    info: '\x1b[36m',
    http: '\x1b[35m',
    verbose: '\x1b[34m',
    debug: '\x1b[90m',
    silly: '\x1b[90m',
};
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

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

const compactValue = (value: unknown): string => {
    if (value instanceof Error)
        return value.message;
    if (value instanceof Date)
        return value.toISOString();
    if (typeof value === 'string')
        return value.length > METADATA_LIMIT ? `${value.slice(0, METADATA_LIMIT)}...` : value;
    if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined)
        return String(value);
    try {
        const serialized = JSON.stringify(value);
        return serialized.length > METADATA_LIMIT ? `${serialized.slice(0, METADATA_LIMIT)}...` : serialized;
    } catch {
        return String(value);
    }
};

const quoteValue = (value: string): string => /^[\w./:-]+$/.test(value) ? value : JSON.stringify(value);

const collectMetadata = (info: winston.Logform.TransformableInfo) => {
    const reserved = new Set(['level', 'message', 'timestamp', 'stack', 'metadata']);
    const output: Record<string, unknown> = {};
    const metadata = info.metadata;
    if (isPlainObject(metadata)) {
        if (isPlainObject(metadata.metadata))
            Object.assign(output, metadata.metadata);
        Object.assign(output, Object.fromEntries(Object.entries(metadata).filter(([key]) => key !== 'metadata')));
    }
    for (const [key, value] of Object.entries(info)) {
        if (!reserved.has(key))
            output[key] = value;
    }
    return output;
};

const formatMetadata = (metadata: Record<string, unknown>, color = false) => {
    const aliases: Record<string, string> = {
        accountId: 'account',
        actionName: 'action',
        commandType: 'cmd',
        durationMs: 'ms',
        scheduledCount: 'scheduled',
        pendingCount: 'pending',
    };
    const entries = Object.entries(metadata)
        .map(([key, value]) => [aliases[key] ?? key, pruneMetadataValue(value)] as const)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${color ? DIM : ''}${key}=${quoteValue(compactValue(value))}${color ? RESET : ''}`);
    return entries.length ? ` ${entries.join(' ')}` : '';
};

const readablePrintf = (options: { color?: boolean } = {}) => winston.format.printf(info => {
    const metadata = collectMetadata(info);
    const debugEvent = metadata.scope && metadata.event
        ? `${metadata.scope}.${metadata.event}`
        : undefined;
    const message = debugEvent && info.message === debugEvent ? debugEvent : info.message;
    if (debugEvent && info.message === debugEvent) {
        delete metadata.scope;
        delete metadata.event;
    }
    const stack = info.stack ? `\n${info.stack}` : '';
    const level = String(info.level).toLowerCase();
    const levelLabel = level.toUpperCase().padEnd(5);
    if (!options.color)
        return `${info.timestamp} ${levelLabel} ${message}${formatMetadata(metadata)}${stack}`;
    const color = COLORS[level] ?? '';
    return `${DIM}${info.timestamp}${RESET} ${color}${levelLabel}${RESET} ${color}${message}${RESET}${formatMetadata(metadata, true)}${stack}`;
});

const readableFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp', 'stack'] }),
    readablePrintf(),
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
            winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
            winston.format.errors({ stack: true }),
            winston.format.splat(),
            winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp', 'stack'] }),
            readablePrintf({ color: true }),
        )
    }));
}

logger.info('Logger initialized', {
    level: LOG_LEVEL,
    debugLogEnabled: LOG_LEVEL === 'debug' || LOG_LEVEL === 'silly',
    logDir: LOG_DIR,
});
