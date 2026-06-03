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

const jsonFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.errors({ stack: true }),
    winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp', 'stack'] }),
    winston.format.json()
);

export const logger = winston.createLogger({
    level: LOG_LEVEL,
    format: jsonFormat,
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
            winston.format.printf(info => {
                const metadata = info.metadata && Object.keys(info.metadata).length
                    ? ` ${JSON.stringify(info.metadata)}`
                    : '';
                return `${info.timestamp} ${info.level}: ${info.message}${metadata}`;
            })
        )
    }));
}

logger.info('Logger initialized', {
    level: LOG_LEVEL,
    debugLogEnabled: LOG_LEVEL === 'debug' || LOG_LEVEL === 'silly',
    logDir: LOG_DIR,
});
