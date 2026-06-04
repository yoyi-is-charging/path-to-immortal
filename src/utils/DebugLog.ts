import type { Account, Command, Config, MessageBody, Status } from '../server/types';
import type { IncomingMessage } from '../server/core/RuntimeEvents';
import { logger } from './logger';

type Jsonish = Record<string, unknown>;

const REDACTED = '[redacted]';
const STRING_LIMIT = Number(process.env.DEBUG_LOG_STRING_LIMIT ?? 180);
const ARRAY_LIMIT = Number(process.env.DEBUG_LOG_ARRAY_LIMIT ?? 8);
const DEPTH_LIMIT = Number(process.env.DEBUG_LOG_DEPTH_LIMIT ?? 4);

const SENSITIVE_KEY_PATTERN = /(password|encryptedPassword|token|secret|authorization|cookie|session|base64|qrcode|bytes_pb_reserve|x-turing-signature|x-oidb)/i;

const LEVEL_PRIORITY: Record<string, number> = {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    verbose: 4,
    debug: 5,
    silly: 6,
};

export class DebugLog {
    public static enabled(): boolean {
        return (LEVEL_PRIORITY[logger.level] ?? 2) >= LEVEL_PRIORITY.debug;
    }

    public static log(scope: string, event: string, data: Jsonish = {}) {
        if (!this.enabled())
            return;
        try {
            const sanitized = this.sanitize(data);
            logger.debug(`${scope}.${event}`, {
                scope,
                event,
                ...(this.isPlainObject(sanitized) ? sanitized : { data: sanitized }),
            });
        } catch (error) {
            logger.warn('Debug log serialization failed', {
                scope,
                event,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    public static runtimeEvent(event: string, payload: unknown) {
        if (!this.enabled())
            return;
        try {
            this.log('runtime', event, this.summarizeRuntimeEvent(event, payload));
        } catch (error) {
            logger.warn('Runtime debug event serialization failed', {
                event,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    public static command(command: Command | undefined): Jsonish | undefined {
        if (!command)
            return undefined;
        return {
            id: command.id,
            type: command.type,
            retries: command.retries ?? 0,
            date: command.date instanceof Date ? command.date.toISOString() : command.date,
            body: this.messageBody(command.body),
        };
    }

    public static message(message: IncomingMessage | undefined): Jsonish | undefined {
        if (!message)
            return undefined;
        return {
            accountId: message.accountId,
            seq: message.seq,
            mentionsMe: message.mentionsMe,
            text: this.preview(message.text),
            raw: {
                contentLength: message.raw.content.length,
                jsonContentLength: message.raw.jsonContent.length,
                hasParsedJson: message.raw.parsedJson !== undefined,
            },
        };
    }

    public static account(account: Account | undefined): Jsonish | undefined {
        if (!account)
            return undefined;
        return {
            id: account.id,
            online: account.online,
            hasPassword: Boolean(account.encryptedPassword),
            sessionCookieCount: account.session?.length ?? 0,
            sessionExpiresAt: this.sessionExpiresAt(account),
            metadata: {
                hasTinyid: Boolean(account.metadata?.tinyid),
                lastUpdateTime: account.metadata?.lastUpdateTime
                    ? new Date(account.metadata.lastUpdateTime).toISOString()
                    : undefined,
            },
            enabledFeatures: Object.entries(account.config || {})
                .filter(([, value]) => value && typeof value === 'object' && (value as { enabled?: boolean }).enabled)
                .map(([key]) => key),
            statusKeys: Object.keys(account.status || {}),
        };
    }

    public static statusPatch(accountId: string, patch: Partial<Status>): Jsonish {
        return {
            accountId,
            patchKeys: Object.keys(patch),
            patch: this.sanitize(patch),
        };
    }

    public static configPatch(accountId: string, patch: Partial<Config>): Jsonish {
        return {
            accountId,
            patchKeys: Object.keys(patch),
            patch: this.sanitize(patch),
        };
    }

    public static messageBody(body: Command['body'] | MessageBody | undefined): unknown {
        if (body === undefined)
            return undefined;
        if (typeof body === 'function')
            return '[Function command body]';
        if (typeof body === 'string')
            return this.preview(body);
        return body.map((item, index) => ({
            index,
            str: this.preview(item.str),
            hasMentionRef: Boolean(item.bytes_pb_reserve),
        }));
    }

    public static preview(value: string | undefined, limit = STRING_LIMIT): string | undefined {
        if (value === undefined)
            return undefined;
        return value.length > limit ? `${value.slice(0, limit)}...<${value.length - limit} more chars>` : value;
    }

    public static sanitize(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
        if (value === null || value === undefined)
            return value;
        if (typeof value === 'string')
            return this.preview(value);
        if (typeof value === 'number' || typeof value === 'boolean')
            return value;
        if (typeof value === 'bigint')
            return value.toString();
        if (typeof value === 'function')
            return '[Function]';
        if (value instanceof Date)
            return value.toISOString();
        if (value instanceof Error)
            return { name: value.name, message: value.message, stack: this.preview(value.stack) };
        if (typeof value !== 'object')
            return String(value);
        if (seen.has(value))
            return '[Circular]';
        if (depth >= DEPTH_LIMIT)
            return '[MaxDepth]';

        seen.add(value);
        if (Array.isArray(value)) {
            const items = value.slice(0, ARRAY_LIMIT).map(item => this.sanitize(item, depth + 1, seen));
            if (value.length > ARRAY_LIMIT)
                items.push(`...<${value.length - ARRAY_LIMIT} more items>`);
            return items;
        }

        const output: Jsonish = {};
        for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
            if (this.isSensitiveKey(key)) {
                output[key] = REDACTED;
                continue;
            }
            if (['timeoutId', 'resolve', 'reject', 'browser', 'context', 'page'].includes(key))
                continue;
            output[key] = this.sanitize(item, depth + 1, seen);
        }
        return output;
    }

    private static summarizeRuntimeEvent(event: string, payload: unknown): Jsonish {
        const data = payload as any;
        switch (event) {
            case 'statusUpdated':
            case 'configUpdated':
                return { account: this.account(data) };
            case 'qrcodeUpdated':
                return { qrcodeBytes: typeof data?.base64 === 'string' ? data.base64.length : undefined };
            case 'messageReceived':
                return { message: this.message(data) };
            case 'messageUnmatched':
                return { accountId: data?.accountId, message: this.message(data?.message) };
            case 'responseReceived':
            case 'commandResolved':
                return {
                    accountId: data?.accountId,
                    command: this.command(data?.command),
                    response: this.preview(data?.response),
                    message: this.message(data?.message),
                };
            case 'commandResponseMatched':
            case 'commandScheduled':
            case 'commandSent':
            case 'commandProcessed':
                return { accountId: data?.accountId, command: this.command(data?.command), message: this.message(data?.message) };
            case 'commandFailed':
            case 'processCommandError':
                return {
                    accountId: data?.accountId,
                    command: this.command(data?.command),
                    error: data?.error,
                    response: this.preview(data?.response),
                };
            default:
                return this.sanitize(payload) as Jsonish;
        }
    }

    private static sessionExpiresAt(account: Account): string | undefined {
        const expirations = (account.session || [])
            .filter(cookie => cookie.domain === '.pd.qq.com' && cookie.expires !== -1)
            .map(cookie => cookie.expires * 1000);
        if (!expirations.length)
            return undefined;
        return new Date(Math.min(...expirations)).toISOString();
    }

    private static isPlainObject(value: unknown): value is Jsonish {
        return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    }

    private static isSensitiveKey(key: string): boolean {
        const lowerKey = key.toLowerCase();
        if (lowerKey.startsWith('has') || /(count|length|bytes|expiresat)$/.test(lowerKey))
            return false;
        return SENSITIVE_KEY_PATTERN.test(key);
    }
}
