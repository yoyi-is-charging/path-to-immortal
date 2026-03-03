// src/utils/logger.ts
import winston from 'winston';
import path from 'path';

const LOG_DIR = path.resolve(__dirname, '../../logs');

export const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
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

if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
        )
    }));
}