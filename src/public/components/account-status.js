// src/public/components/account-status.js

import { FieldRenderer } from './field-renderer.js';
import { accountManager } from './account-manager.js';
import { wsClient } from './websocket-client.js';
import { eventBus } from './event-bus.js';

class AccountStatusUI {
    constructor() {
        this.statusList = document.getElementById('status-list');
        this.console = document.querySelector('.console');
        this.sendButton = document.querySelector('.send-button');
        this.accountId = window.location.pathname.split('/').pop();
        this.schema = null;
        eventBus.on('accountLoaded', this.render.bind(this));
        eventBus.on('statusUpdated', this.render.bind(this));
        this.statusList.addEventListener('change', (event) => this.handleFieldUpdate(event));
        this.console.addEventListener('click', (event) => this.handleSendButtonClick(event));
        this.init();
    }

    async init() {
        document.getElementById('account-id').textContent = this.accountId;
        this.schema = await wsClient.request({ action: 'getSchema', params: { type: 'status' } });
        await accountManager.loadAccount(this.accountId);
    }

    async render(account) {
        if (account.id !== this.accountId)
            return;
        this.statusList.innerHTML = FieldRenderer.render(this.schema, account.status);
        this.sendButton.disabled = !account.online;
    }

    async handleFieldUpdate(event) {
        const id = event.target.id;
        const patch = FieldRenderer.parse(this.schema, this.statusList, '', path => id.startsWith(FieldRenderer.getId(path)));
        accountManager.patchStatus(this.accountId, patch);
    }

    async handleSendButtonClick(event) {
        if (event.target !== this.sendButton) return;
        this.sendButton.disabled = true;
        await accountManager.sendCommand(this.accountId, event.currentTarget.querySelector('.console-input').value);
        this.sendButton.disabled = false;
    }
}

eventBus.on('websocketConnected', () => new AccountStatusUI());