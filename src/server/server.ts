// src/server/server.ts

import { WebSocket } from 'ws';
import express from 'express';
import { AccountManager } from './core/AccountManager';
import { InstanceManager } from './core/InstanceManager';
import { logger } from '../utils/logger';
import path from 'path';
import dotenv from 'dotenv';
import { CommandFactory } from '../commands/CommandFactory';
import { createServer } from 'http';
import zodToJsonSchema from 'zod-to-json-schema';
import { Account, Config, ConfigSchema, Status, StatusSchema } from './types';
import { ZodObject } from 'zod';
import { EventBus } from './core/EventBus';
import { Telegraf } from 'telegraf';

async function main() {

    dotenv.config({ path: __dirname + '/../../.env' });



    const app = express();
    const server = createServer(app);
    const wss = new WebSocket.Server({ server });

    const bot: Telegraf | undefined = process.env.BOT_TOKEN ? new Telegraf(process.env.BOT_TOKEN) : undefined;
    if (bot) {
        bot.command('start', (ctx) => ctx.reply(`BOT_CHAT_ID: ${ctx.chat.id}`));
        bot.launch().then(() => logger.info('Telegram bot started'));
    }

    wss.on('connection', (ws, req) => {


        ws.on('message', async (message) => {
            logger.info(`Received message: ${message}`);
            const data = JSON.parse(message.toString());
            const actionName: string = data.action;
            const params: object = data.params || {};
            const action = actions[actionName];
            if (!action)
                ws.send(JSON.stringify({ type: 'response', requestId: data.requestId, success: false, payload: `Action ${actionName} not found` }));
            else
                action(params)
                    .then(response => ws.send(JSON.stringify({ type: 'response', requestId: data.requestId, success: true, payload: response })))
                    .catch(error => ws.send(JSON.stringify({ type: 'response', requestId: data.requestId, success: false, payload: error.message })));
        });


        const actions: Record<string, (params: any) => Promise<object>> = {
            getAccounts: async () => AccountManager.getAccounts(),
            getAccount: async ({ accountId }: { accountId: string }) => {
                const account = AccountManager.getAccount(accountId);
                if (!account)
                    throw new Error(`Account ${accountId} not found`);
                return account;
            },
            getSchema: async ({ type }: { type: string }) => {
                const schemas: Record<string, ZodObject<any>> = {
                    status: StatusSchema,
                    config: ConfigSchema
                };
                const schema = schemas[type];
                if (!schema)
                    throw new Error(`Schema ${type} not found`);
                return zodToJsonSchema(schema);
            },
            updateSession: async ({ accountId }: { accountId: string }) => {
                const instance = InstanceManager.getInstance(accountId);
                if (!instance)
                    throw new Error(`Instance for account ${accountId} not found`);
                await instance.updateSession();
                await instance.init();
                return instance.account;
            },
            patchStatus: async ({ accountId, patch }: { accountId: string, patch: Partial<Status> }) => {
                const parsedPatch = StatusSchema.parse(patch);
                await AccountManager.patchStatus(accountId, parsedPatch);
                return AccountManager.getAccount(accountId);
            },
            patchConfig: async ({ accountId, patch }: { accountId: string, patch: Partial<Config> }) => {
                const parsedPatch = ConfigSchema.parse(patch);
                await AccountManager.patchConfig(accountId, parsedPatch);
                return AccountManager.getAccount(accountId);
            },
            login: async ({ accountId }: { accountId: string }) => {
                const account = AccountManager.getAccount(accountId);
                await InstanceManager.createInstance(account);
                return account;
            },
            logout: async ({ accountId }: { accountId: string }) => {
                const account = AccountManager.getAccount(accountId);
                await InstanceManager.closeInstance(account);
                return account;
            },
            create: async ({ id, password }: { id: string, password: string | undefined }) => {
                const newAccount = await AccountManager.createAccount(id, password);
                return newAccount;
            },
            delete: async ({ accountId }: { accountId: string }) => {
                const account = AccountManager.getAccount(accountId);
                if (account.online)
                    await InstanceManager.closeInstance(account);
                await AccountManager.removeAccount(accountId);
                return account;
            },
            send: async ({ accountId, command }: { accountId: string, command: string }) => {
                await InstanceManager.sendCommand(accountId, command);
                return {};
            }
        };

        const broadcast: (event: string, payload: object) => void = (event, payload) => ws.send(JSON.stringify({ type: 'broadcast', event, payload }));
        const broadcastStatus: (account: Account) => void = (account) => broadcast('statusUpdated', account);
        const broadcastQRCode: ({ base64 }: { base64: string }) => void = ({ base64 }) => broadcast('qrcodeUpdated', { base64 });
        const broadcastSessionUpdate: ({ accountId, success }: { accountId: string, success: boolean }) => void = ({ accountId, success }) => broadcast('sessionUpdated', { id: accountId, success });
        const broadcastCommands: ({ accountId, command }: { accountId: string, command: object }) => void = ({ accountId, command }) => {
            const scheduler = InstanceManager.getInstance(accountId)!.scheduler!;
            const scheduledCommands = scheduler.scheduledCommands.map(cmd => ({ ...cmd, timeoutId: undefined }));
            const pendingCommands = scheduler.pendingCommands.map(cmd => ({ ...cmd, timeoutId: undefined }));
            broadcast('commandsUpdated', { id: accountId, scheduledCommands, pendingCommands });
        }

        const notify: ({ chatId, message }: { chatId: string, message: string }) => Promise<void> = async ({ chatId, message }) => {
            try {
                await bot!.telegram.sendMessage(chatId, message);
            } catch (error) {
                logger.error(`Failed to send message to ${chatId}: ${error}`);
            }
        }

        EventBus.on('statusUpdated', broadcastStatus);
        EventBus.on('commandScheduled', broadcastCommands);
        EventBus.on('commandSent', broadcastCommands);
        EventBus.on('commandProcessed', broadcastCommands);
        EventBus.on('qrcodeUpdated', broadcastQRCode);
        EventBus.on('sessionUpdated', broadcastSessionUpdate);
        EventBus.on('notification', notify);

        ws.on('close', () => {
            EventBus.off('statusUpdated', broadcastStatus);
            EventBus.off('commandScheduled', broadcastCommands);
            EventBus.off('commandSent', broadcastCommands);
            EventBus.off('commandProcessed', broadcastCommands);
            EventBus.off('qrcodeUpdated', broadcastQRCode);
            EventBus.off('sessionUpdated', broadcastSessionUpdate);
            EventBus.off('notification', notify);
            logger.info(`WebSocket connection closed`);
        });
    });

    await AccountManager.init();
    await InstanceManager.init();
    await CommandFactory.init();
    EventBus.init();

    const nodeModulesPath = path.join(__dirname, '../../node_modules');
    logger.info(`Serving node_modules from ${nodeModulesPath}`);
    app.use('/node_modules', express.static(nodeModulesPath));
    app.use(express.json());
    app.use(express.static(path.join(__dirname, '../public')));
    app.get('/', (req, res) => {
        res.sendFile(path.join(__dirname, '../public/index.html'));
    });
    app.get('/status/:id', (req, res) => {
        res.sendFile(path.join(__dirname, '../public/status.html'));
    });
    app.get('/config/:id', (req, res) => {
        res.sendFile(path.join(__dirname, '../public/config.html'));
    });

    const PORT = process.env.PORT || 3000;
    server.listen(
        PORT,
        0, () => {
            logger.info(`Server is running on http://${getLocalIp()}:${PORT}`);
        });

    function getLocalIp() {
        const interfaces = require('os').networkInterfaces();
        for (const name in interfaces) {
            for (const iface of interfaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    return iface.address;
                }
            }
        }
        return 'localhost';
    }
}

main();