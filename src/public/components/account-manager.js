// src/public/components/account-manager.js
import { wsClient } from './websocket-client.js';
import { eventBus } from './event-bus.js';

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
        wsClient.request({ action, params: { accountId } })
            .then(account => {
                const accountIndex = this.accounts.findIndex(a => a.id === accountId);
                this.accounts[accountIndex] = account;
                eventBus.emit('statusUpdated', account);
            })
            .catch(error => console.error('Error toggling auth:', error));
    }

    async createAccount(credentials) {
        wsClient.request({ action: 'create', params: credentials })
            .then(account => {
                this.accounts.push(account);
                eventBus.emit('accountLoaded', account);
            })
            .catch(error => console.error('Error creating account:', error));
    }

    async deleteAccount(accountId) {
        wsClient.request({ action: 'delete', params: { accountId } })
            .then(account => {
                this.accounts = this.accounts.filter(a => a.id !== account.id);
                eventBus.emit('accountUnloaded', account);
            })
            .catch(error => console.error('Error deleting account:', error));
    }

    async updateSession(accountId) {
        wsClient.request({ action: 'updateSession', params: { accountId } })
            .then(account => {
                const accountIndex = this.accounts.findIndex(a => a.id === accountId);
                this.accounts[accountIndex] = account;
                eventBus.emit('statusUpdated', account);
            })
            .catch(error => console.error('Error updating session:', error));
    }

    async patchStatus(accountId, patch) {
        wsClient.request({ action: 'patchStatus', params: { accountId, patch } })
            .then(account => {
                const accountIndex = this.accounts.findIndex(a => a.id === accountId);
                this.accounts[accountIndex] = account;
                eventBus.emit('statusUpdated', account);
            })
            .catch(error => console.error('Error patching status:', error));
    }

    async patchConfig(accountId, patch) {
        wsClient.request({ action: 'patchConfig', params: { accountId, patch } })
            .then(account => {
                const accountIndex = this.accounts.findIndex(a => a.id === accountId);
                this.accounts[accountIndex] = account;
                eventBus.emit('configUpdated', account);
            })
            .catch(error => console.error('Error patching config:', error));
    }

    async loadAccounts() {
        wsClient.request({ action: 'getAccounts' })
            .then(accounts => {
                this.accounts = accounts;
                eventBus.emit('accountsLoaded', accounts);
            })
            .catch(error => console.error('Error loading accounts:', error));
    }

    async loadAccount(accountId) {
        const account = this.getAccount(accountId);
        if (account) return;
        wsClient.request({ action: 'getAccount', params: { accountId } })
            .then(account => {
                this.accounts.push(account);
                eventBus.emit('accountLoaded', account);
            })
            .catch(error => console.error('Error loading account:', error));
    }

    async sendCommand(accountId, command) {
        wsClient.request({ action: 'send', params: { accountId, command } })
            .catch(error => console.error('Error sending command:', error));
    }
}

export const accountManager = new AccountManager();
window.accountManager = accountManager;