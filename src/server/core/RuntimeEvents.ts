import { Account, Command } from '../types';

export interface IncomingMessage {
    accountId: string;
    seq: number;
    text: string;
    mentionsMe: boolean;
    raw: {
        content: string;
        jsonContent: string;
        parsedJson?: unknown;
    };
}

export interface RuntimeEventMap {
    statusUpdated: Account;
    configUpdated: Account;
    qrcodeUpdated: { base64: string };
    sessionUpdated: { accountId: string; success: boolean };
    sessionUpdateScheduled: { accountId: string; timestamp: number };
    fetchScheduled: { accountId: string; timestamp: number };
    messageReceived: IncomingMessage;
    messageUnmatched: { accountId: string; message: IncomingMessage };
    responseReceived: { accountId: string; response: string; message?: IncomingMessage };
    commandResponseMatched: { accountId: string; command: Command; message: IncomingMessage };
    commandScheduled: { accountId: string; command: Command };
    commandSent: { accountId: string; command: Command };
    commandResolved: { accountId: string; command: Command; response: string; message?: IncomingMessage };
    commandProcessed: { accountId: string; command: Command };
    commandFailed: { accountId: string; command: Command; error: string; response: string };
    processCommandError: { accountId: string; command: Command; error: string };
    notification: { chatId: string; message: string };
}
