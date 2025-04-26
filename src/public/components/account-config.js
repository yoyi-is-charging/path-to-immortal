// src/public/components/account-config.js

import { FieldRenderer } from './field-renderer.js'
import { accountManager } from './account-manager.js';
import { wsClient } from './websocket-client.js';
import { eventBus } from './event-bus.js';

class AccountConfigUI {
    constructor() {
        this.configList = document.getElementById('config-list');
        this.accountId = window.location.pathname.split('/').pop();
        this.schema = null;
        eventBus.on('accountLoaded', this.render.bind(this));
        eventBus.on('configUpdated', this.render.bind(this));
        this.configList.addEventListener('change', (event) => this.handleFieldUpdate(event));
        this.init();
    }

    async init() {
        document.getElementById('account-id').textContent = this.accountId;
        this.schema = await wsClient.request({ action: 'getSchema', params: { type: 'config' } });
        await accountManager.loadAccount(this.accountId);
    }

    render(account) {
        if (account.id !== this.accountId)
            return;
        this.configList.innerHTML = FieldRenderer.render(this.schema, account.config);
    }

    parse() {
        const config = FieldRenderer.parse(this.schema, this.configList);
        console.log(config);
    }

    handleFieldUpdate(event) {
        const id = event.target.id;
        const patch = FieldRenderer.parse(this.schema, this.configList, '', path => id.startsWith(FieldRenderer.getId(path)));
        accountManager.patchConfig(this.accountId, patch);
    }
}

eventBus.on('websocketConnected', () => new AccountConfigUI());