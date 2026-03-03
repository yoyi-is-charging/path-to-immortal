// src/public/components/account-list.js

import { accountManager } from "./account-manager.js";
import { eventBus } from "./event-bus.js";

class AccountsListUI {
    constructor() {
        this.accountsList = document.getElementById('account-list');
        this.accountsList.addEventListener('click', (event) => this.handleListClick(event));
        document.querySelector('.add-account-button').addEventListener('click', (event) => document.getElementById('add-account-dialog').show());
        document.querySelector('.submit-button').addEventListener('click', (event) => this.handleAddAccount(event));
        eventBus.on('accountsLoaded', this.render.bind(this));
        eventBus.on('statusUpdated', this.update.bind(this));
        eventBus.on('accountLoaded', this.attach.bind(this));
        eventBus.on('accountUnloaded', this.detach.bind(this));
        eventBus.on('qrcodeUpdated', this.handleQRCodeUpdate.bind(this));
        eventBus.on('websocketConnected', accountManager.loadAccounts.bind(accountManager));
    }

    render(accounts) {
        this.accountsList.innerHTML = '';
        accounts.forEach(account => this.attach(account));
    }

    attach(account) {
        this.accountsList.insertAdjacentHTML('beforeend', `
        <md-list-item class="account-item" type="button" id="${account.id}">
        <div class="account-item-content">
            <div slot="headline">
                ${account.id}
            </div>
            <div slot="supporting-text" class="expiration-time">
            </div>
        </div>
        <md-filled-button class="toggle-auth" data-account-id="${account.id}">
            登入
        </md-filled-button>
        <md-filled-button class="update-session" data-account-id="${account.id}">
            更新会话
        </md-filled-button>
        <md-filled-button class="view-status" href="/status/${account.id}">
            状态
        </md-filled-button>
        <md-filled-button class="view-config" href="/config/${account.id}">
            设置
        </md-filled-button>
        <md-filled-button class="delete-account" data-account-id="${account.id}">
            删除
        </md-filled-button>
        </md-list-item>`);
        this.update(account);
    }

    detach(account) {
        const accountItem = this.accountsList.querySelector(`[id="${account.id}"]`);
        if (accountItem)
            accountItem.remove();
    }


    update(account) {
        const accountItem = this.accountsList.querySelector(`[id="${account.id}"]`);
        if (accountItem) {
            accountItem.querySelector('.expiration-time').textContent = `会话过期时间: ${new Date(this.getSessionExpirationTime(account)).toLocaleString()}`;
            accountItem.querySelector('.toggle-auth').textContent = account.online ? '登出' : '登入';
            accountItem.querySelector('.toggle-auth').disabled = false;
            accountItem.querySelector('.update-session').disabled = !account.online;
        }
    }

    handleAddAccount(event) {
        event.stopPropagation();
        const id = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        accountManager.createAccount({ id, password })
            .catch(error => alert(`账户创建错误: ${error}`));
    }

    handleListClick(event) {
        event.stopPropagation();
        const target = event.target;
        if (target.classList.contains('toggle-auth')) {
            const accountId = target.getAttribute('data-account-id');
            target.disabled = true;
            target.textContent = '等待';
            accountManager.toggleAuth(accountId)
                .catch(error => alert(`切换登录状态错误: ${error}`));
        }
        if (target.classList.contains('delete-account')) {
            const accountId = target.getAttribute('data-account-id');
            target.disabled = true;
            target.textContent = '等待';
            accountManager.deleteAccount(accountId)
                .catch(error => alert(`删除账户错误: ${error}`));
        }
        if (target.classList.contains('update-session')) {
            const accountId = target.getAttribute('data-account-id');
            target.disabled = true;
            target.textContent = '等待';
            accountManager.updateSession(accountId)
                .catch(error => alert(`更新会话错误: ${error}`));
        }
    }

    async handleQRCodeUpdate(payload) {
        const qrCodeDialog = document.getElementById('qr-code-dialog');
        const qrCode = document.getElementById('qr-code');
        qrCode.src = payload.base64;
        qrCodeDialog.show();
    }

    getSessionExpirationTime(account) {
        if (!account.session)
            return 0;
        return Math.min(...account.session.filter(cookie => cookie.domain === '.pd.qq.com' && cookie.expires !== -1).map(cookie => cookie.expires * 1000));
    }
}

const accountsListUI = new AccountsListUI();