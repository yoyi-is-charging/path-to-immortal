// src/public/components/account-manager.js
import { wsClient } from './websocket-client.js';
import { eventBus } from './event-bus.js';
import { notificationManager } from './notification-manager.js';

export class AccountManager {
    constructor() {
        this.accounts = [];
    }

    getAccount(accountId) {
        return this.accounts.find(a => a.id === accountId);
    }

    async toggleAuth(accountId) {
        const account = this.getAccount(accountId);
        const action = !account.online ? 'login' : 'logout';
        const updatedAccount = await wsClient.request({ action, params: { accountId } });
        this.upsertAccount(updatedAccount);
        eventBus.emit('statusUpdated', updatedAccount);
        return updatedAccount;
    }

    async createAccount(credentials) {
        const account = await wsClient.request({ action: 'create', params: credentials });
        this.upsertAccount(account);
        eventBus.emit('accountLoaded', account);
        return account;
    }

    async deleteAccount(accountId) {
        const account = await wsClient.request({ action: 'delete', params: { accountId } });
        this.accounts = this.accounts.filter(a => a.id !== account.id);
        eventBus.emit('accountUnloaded', account);
        return account;
    }

    async updateSession(accountId) {
        const account = await wsClient.request({ action: 'updateSession', params: { accountId } });
        this.upsertAccount(account);
        eventBus.emit('statusUpdated', account);
        return account;
    }

    async clearSession(accountId) {
        const account = await wsClient.request({ action: 'clearSession', params: { accountId } });
        this.upsertAccount(account);
        eventBus.emit('statusUpdated', account);
        return account;
    }

    async patchStatus(accountId, patch) {
        const account = await wsClient.request({ action: 'patchStatus', params: { accountId, patch } });
        this.upsertAccount(account);
        eventBus.emit('statusUpdated', account);
        return account;
    }

    async patchConfig(accountId, patch) {
        const account = await wsClient.request({ action: 'patchConfig', params: { accountId, patch } });
        this.upsertAccount(account);
        eventBus.emit('configUpdated', account);
        return account;
    }

    async loadAccounts() {
        const accounts = await wsClient.request({ action: 'getAccounts' });
        this.accounts = accounts.map(account => this.withLiveState(account));
        eventBus.emit('accountsLoaded', this.accounts);
        return this.accounts;
    }

    async loadAccount(accountId) {
        const account = this.getAccount(accountId);
        if (account) {
            eventBus.emit('accountLoaded', account);
            return account;
        }
        const loadedAccount = await wsClient.request({ action: 'getAccount', params: { accountId } });
        this.upsertAccount(loadedAccount);
        eventBus.emit('accountLoaded', loadedAccount);
        return loadedAccount;
    }

    async sendCommand(accountId, command) {
        return wsClient.request({ action: 'send', params: { accountId, command } });
    }

    upsertAccount(account) {
        account = this.withLiveState(account);
        const accountIndex = this.accounts.findIndex(a => a.id === account.id);
        if (accountIndex >= 0)
            this.accounts[accountIndex] = account;
        else
            this.accounts.push(account);
    }

    withLiveState(account) {
        const existing = this.getAccount(account.id);
        return {
            ...account,
            scheduledCommands: account.scheduledCommands ?? existing?.scheduledCommands ?? [],
            pendingCommands: account.pendingCommands ?? existing?.pendingCommands ?? [],
        };
    }
}

export const accountManager = new AccountManager();
window.accountManager = accountManager;
