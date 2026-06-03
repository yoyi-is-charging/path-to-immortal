import { accountManager } from "./account-manager.js";
import { eventBus } from "./event-bus.js";

class AccountsDashboard {
    constructor() {
        this.accountsList = document.getElementById('account-list');
        this.emptyState = document.getElementById('empty-state');
        this.searchField = document.getElementById('account-search');
        this.connectionStatus = document.getElementById('connection-status');
        this.toast = document.getElementById('toast');
        this.commandsByAccount = new Map();
        this.busyActions = new Set();
        this.searchText = '';
        this.toastTimer = null;

        document.getElementById('add-account').addEventListener('click', () => document.getElementById('add-account-dialog').show());
        document.getElementById('refresh-accounts').addEventListener('click', () => this.loadAccounts());
        document.getElementById('add-account-form').addEventListener('submit', event => this.handleAddAccount(event));
        document.getElementById('cancel-add-account').addEventListener('click', () => document.getElementById('add-account-dialog').close());
        document.getElementById('close-qr-dialog').addEventListener('click', () => document.getElementById('qr-code-dialog').close());
        this.searchField.addEventListener('input', () => {
            this.searchText = this.searchField.value.trim();
            this.render(accountManager.accounts);
        });
        this.accountsList.addEventListener('click', event => this.handleActionClick(event));
        this.accountsList.addEventListener('keydown', event => this.handleCommandKeydown(event));

        eventBus.on('accountsLoaded', accounts => this.render(accounts));
        eventBus.on('statusUpdated', account => this.updateAccount(account));
        eventBus.on('configUpdated', account => this.updateAccount(account));
        eventBus.on('accountLoaded', account => this.updateAccount(account));
        eventBus.on('accountUnloaded', account => this.removeAccount(account));
        eventBus.on('commandsUpdated', payload => this.updateCommands(payload));
        eventBus.on('qrcodeUpdated', payload => this.handleQRCodeUpdate(payload));
        eventBus.on('websocketConnected', () => {
            this.connectionStatus.textContent = '已连接';
            this.loadAccounts();
        });
        eventBus.on('websocketClosed', () => {
            this.connectionStatus.textContent = '连接已断开';
        });
    }

    async loadAccounts() {
        try {
            await accountManager.loadAccounts();
        } catch (error) {
            this.showToast(error.message, true);
        }
    }

    render(accounts) {
        const filteredAccounts = this.filterAccounts(accounts);
        this.accountsList.innerHTML = filteredAccounts.map(account => this.renderAccount(account)).join('');
        this.emptyState.style.display = filteredAccounts.length ? 'none' : 'block';
        this.updateMetrics(accounts);
    }

    updateAccount(account) {
        accountManager.upsertAccount(account);
        this.render(accountManager.accounts);
    }

    removeAccount(account) {
        this.commandsByAccount.delete(account.id);
        this.render(accountManager.accounts.filter(item => item.id !== account.id));
    }

    updateCommands({ id, scheduledCommands = [], pendingCommands = [] }) {
        this.commandsByAccount.set(id, { scheduledCommands, pendingCommands });
        this.render(accountManager.accounts);
    }

    renderAccount(account) {
        const session = this.getSessionInfo(account);
        const commands = this.commandsByAccount.get(account.id) || { scheduledCommands: [], pendingCommands: [] };
        const commandCount = commands.scheduledCommands.length + commands.pendingCommands.length;
        const enabledCount = this.getEnabledFeatures(account);
        const activityItems = this.getActivityItems(account);
        const lastUpdate = account.metadata?.lastUpdateTime ? new Date(account.metadata.lastUpdateTime).toLocaleString() : '未记录';
        const busyPrefix = action => this.busyActions.has(`${action}:${account.id}`) ? 'disabled' : '';
        const sessionDisabled = account.online || !session.hasSession ? 'disabled' : busyPrefix('clearSession');
        const updateDisabled = !account.online ? 'disabled' : busyPrefix('updateSession');
        const commandDisabled = !account.online ? 'disabled' : busyPrefix('send');

        return `
            <article class="account-card" data-account-id="${this.escapeAttr(account.id)}">
                <div class="account-header">
                    <div class="account-title">
                        <h2 class="account-id">${this.escapeHtml(account.id)}</h2>
                        <div class="account-subtitle">更新: ${this.escapeHtml(lastUpdate)}</div>
                    </div>
                    <div class="badge-row">
                        <span class="badge ${account.online ? 'online' : 'offline'}">${account.online ? '在线' : '离线'}</span>
                        <span class="badge ${session.badgeClass}">${this.escapeHtml(session.label)}</span>
                    </div>
                </div>

                <div class="detail-grid">
                    <div class="detail">
                        <span>会话过期</span>
                        <strong>${this.escapeHtml(session.expiresText)}</strong>
                    </div>
                    <div class="detail">
                        <span>启用项目</span>
                        <strong>${enabledCount}</strong>
                    </div>
                    <div class="detail">
                        <span>待执行</span>
                        <strong>${commands.scheduledCommands.length}</strong>
                    </div>
                    <div class="detail">
                        <span>等待响应</span>
                        <strong>${commands.pendingCommands.length}</strong>
                    </div>
                </div>

                ${this.renderActivityPanel(activityItems)}

                <div class="command-row">
                    <md-outlined-text-field class="command-input" label="发送命令" data-command-input="${this.escapeAttr(account.id)}" ${commandDisabled}></md-outlined-text-field>
                    <md-filled-button data-action="send" data-account-id="${this.escapeAttr(account.id)}" ${commandDisabled}>发送</md-filled-button>
                </div>

                <div class="button-row">
                    <md-filled-button data-action="toggleAuth" data-account-id="${this.escapeAttr(account.id)}" ${busyPrefix('toggleAuth')}>${account.online ? '登出' : '登入'}</md-filled-button>
                    <md-filled-tonal-button data-action="updateSession" data-account-id="${this.escapeAttr(account.id)}" ${updateDisabled}>更新会话</md-filled-tonal-button>
                    <md-outlined-button data-action="status" data-account-id="${this.escapeAttr(account.id)}">状态</md-outlined-button>
                    <md-outlined-button data-action="config" data-account-id="${this.escapeAttr(account.id)}">设置</md-outlined-button>
                </div>

                <div class="danger-row">
                    <md-outlined-button data-action="clearSession" data-account-id="${this.escapeAttr(account.id)}" ${sessionDisabled}>清除会话</md-outlined-button>
                    <md-text-button data-action="delete" data-account-id="${this.escapeAttr(account.id)}" ${busyPrefix('delete')}>删除账户</md-text-button>
                </div>
            </article>
        `;
    }

    async handleActionClick(event) {
        const target = event.target.closest('[data-action]');
        if (!target)
            return;
        const accountId = target.getAttribute('data-account-id');
        const action = target.getAttribute('data-action');
        try {
            switch (action) {
                case 'toggleAuth':
                    await this.withBusy(action, accountId, () => accountManager.toggleAuth(accountId));
                    break;
                case 'updateSession':
                    await this.withBusy(action, accountId, () => accountManager.updateSession(accountId));
                    break;
                case 'clearSession':
                    if (confirm(`清除账号 ${accountId} 的会话？账号配置和状态会保留。`))
                        await this.withBusy(action, accountId, () => accountManager.clearSession(accountId));
                    break;
                case 'delete':
                    if (confirm(`删除账号 ${accountId}？`))
                        await this.withBusy(action, accountId, () => accountManager.deleteAccount(accountId));
                    break;
                case 'status':
                    window.location.href = `/status/${encodeURIComponent(accountId)}`;
                    break;
                case 'config':
                    window.location.href = `/config/${encodeURIComponent(accountId)}`;
                    break;
                case 'send':
                    await this.sendCommand(accountId);
                    break;
            }
        } catch (error) {
            this.showToast(error.message, true);
        }
    }

    async handleCommandKeydown(event) {
        if (event.key !== 'Enter')
            return;
        const input = event.target.closest('[data-command-input]');
        if (!input)
            return;
        await this.sendCommand(input.getAttribute('data-command-input'));
    }

    async sendCommand(accountId) {
        const input = this.accountsList.querySelector(`[data-command-input="${CSS.escape(accountId)}"]`);
        const command = input?.value?.trim();
        if (!command)
            return;
        await this.withBusy('send', accountId, async () => {
            await accountManager.sendCommand(accountId, command);
            input.value = '';
            this.showToast(`已发送命令：${command}`);
        });
    }

    async handleAddAccount(event) {
        event.preventDefault();
        const id = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;
        if (!id)
            return;
        try {
            await accountManager.createAccount({ id, password });
            document.getElementById('username').value = '';
            document.getElementById('password').value = '';
            document.getElementById('add-account-dialog').close();
            this.showToast(`账户 ${id} 已添加`);
        } catch (error) {
            this.showToast(error.message, true);
        }
    }

    async handleQRCodeUpdate(payload) {
        const qrCodeDialog = document.getElementById('qr-code-dialog');
        const qrCode = document.getElementById('qr-code');
        qrCode.src = payload.base64;
        qrCodeDialog.show();
    }

    async withBusy(action, accountId, fn) {
        const key = `${action}:${accountId}`;
        this.busyActions.add(key);
        this.render(accountManager.accounts);
        try {
            return await fn();
        } finally {
            this.busyActions.delete(key);
            this.render(accountManager.accounts);
        }
    }

    updateMetrics(accounts) {
        const online = accounts.filter(account => account.online).length;
        const validSessions = accounts.filter(account => this.getSessionInfo(account).isValid).length;
        const commandCount = [...this.commandsByAccount.values()].reduce((sum, item) => sum + item.scheduledCommands.length + item.pendingCommands.length, 0);
        document.getElementById('metric-total').textContent = accounts.length;
        document.getElementById('metric-online').textContent = online;
        document.getElementById('metric-session').textContent = validSessions;
        document.getElementById('metric-command').textContent = commandCount;
    }

    filterAccounts(accounts) {
        const needle = this.searchText.toLowerCase();
        if (!needle)
            return accounts;
        return accounts.filter(account => account.id.toLowerCase().includes(needle));
    }

    getSessionInfo(account) {
        if (!account.session?.length)
            return { hasSession: false, isValid: false, badgeClass: 'bad', label: '无会话', expiresText: '无' };
        const expires = this.getSessionExpirationTime(account);
        if (!Number.isFinite(expires) || expires <= 0)
            return { hasSession: true, isValid: false, badgeClass: 'bad', label: '会话异常', expiresText: '未知' };
        const isValid = expires > Date.now();
        return {
            hasSession: true,
            isValid,
            badgeClass: isValid ? 'online' : 'warn',
            label: isValid ? '会话有效' : '会话过期',
            expiresText: new Date(expires).toLocaleString(),
        };
    }

    getSessionExpirationTime(account) {
        const expirations = (account.session || [])
            .filter(cookie => cookie.domain === '.pd.qq.com' && cookie.expires !== -1)
            .map(cookie => cookie.expires * 1000);
        return expirations.length ? Math.min(...expirations) : 0;
    }

    getEnabledFeatures(account) {
        return Object.entries(account.config || {})
            .filter(([, value]) => value && typeof value === 'object' && value.enabled === true)
            .length;
    }

    renderActivityPanel(items) {
        if (!items.length)
            return '';
        return `
            <div class="activity-panel">
                <div class="activity-title">
                    <span>活动关注</span>
                    <span>${items.length}</span>
                </div>
                <div class="activity-list">
                    ${items.map(item => `
                        <span class="activity-item ${item.kind}" title="${this.escapeAttr(item.detail || '')}">
                            <span class="activity-name">${this.escapeHtml(item.name)}</span>
                            <span class="activity-state">${this.escapeHtml(item.state)}</span>
                        </span>
                    `).join('')}
                </div>
            </div>
        `;
    }

    getActivityItems(account) {
        const status = account.status || {};
        const config = account.config || {};
        const items = [];

        this.addDailyItem(items, '打坐', config.meditation?.enabled, {
            done: status.meditation?.exhausted,
            running: status.meditation?.inProgress,
            nextTime: status.meditation?.finishTime,
            fail: false,
        });
        this.addLoopItem(items, '种田', config.garden?.enabled, {
            healthy: status.garden?.inProgress || status.garden?.finishTime,
            fail: status.garden?.noSeeds || status.garden?.ripen?.noSeeds,
            failText: '种子不足',
        });
        this.addBountyItem(items, status.bounty, config.bounty);
        this.addFinishedItem(items, '秘境', config.secretRealm?.enabled, status.secretRealm);
        this.addFinishedItem(items, '妖兽园', config.zoo?.enabled, status.zoo);
        this.addFinishedItem(items, '幻境', config.dreamland?.enabled, status.dreamland);
        this.addCountItem(items, '钓鱼', config.fishing?.enabled, status.fishing?.finishedCount || 0, this.expectedRuns(config.fishing?.levels), status.fishing?.inProgress, status.fishing?.pullTime);
        this.addCountItem(items, '种树', config.wooding?.enabled, status.wooding?.finishedCount || 0, this.expectedRuns(config.wooding?.levels), status.wooding?.inProgress, status.wooding?.waterTime);
        this.addFortuneItems(items, status.fortune, config.fortune);
        this.addBagItem(items, status.bag, config.bag);
        this.addMiscItems(items, status.misc, config.misc);
        this.addEventItems(items, status.event, config.event);
        this.addTaskItem(items, '救援', config.rescue?.enabled, status.rescue?.finished, status.rescue?.arrivalTime, status.rescue?.rescueTaskProgress);
        this.addTaskItem(items, '采集', config.gather?.enabled, status.gather?.finished, status.gather?.finishTime, status.gather?.gatherTaskProgress);
        this.addTaskItem(items, '制符', config.rune?.enabled, status.rune?.finished, status.rune?.finishTime, Math.max(status.rune?.runeGathered || 0, status.rune?.runeMaked || 0));
        this.addTaskItem(items, '法器', config.ritual?.enabled, status.ritual?.finished, status.ritual?.finishTime, Math.max(status.ritual?.ritualEastCount || 0, status.ritual?.ritualWestCount || 0));
        this.addTaskItem(items, '屠宗', config.genocide?.enabled, status.genocide?.finished, status.genocide?.finishTime, Math.max(status.genocide?.elderCount || 0, status.genocide?.kaidonCount || 0, status.genocide?.monkCount || 0));

        return items;
    }

    addDailyItem(items, name, enabled, { done, running, nextTime, fail, failText = '失败' }) {
        if (!enabled || done)
            return;
        if (fail) {
            items.push(this.activityItem(name, failText, 'fail'));
            return;
        }
        if (running || this.isFuture(nextTime)) {
            items.push(this.activityItem(name, '进行中', 'running', this.formatDate(nextTime)));
            return;
        }
        items.push(this.activityItem(name, '未完成', 'warn'));
    }

    addLoopItem(items, name, enabled, { healthy, fail, failText }) {
        if (!enabled)
            return;
        if (fail) {
            items.push(this.activityItem(name, failText, 'fail'));
            return;
        }
        if (healthy)
            return;
        items.push(this.activityItem(name, '未正常运行', 'warn'));
    }

    addFinishedItem(items, name, enabled, status) {
        if (!enabled || status?.isFinished)
            return;
        if (status?.inProgress) {
            items.push(this.activityItem(name, '进行中', 'running'));
            return;
        }
        items.push(this.activityItem(name, '未完成', 'warn'));
    }

    addCountItem(items, name, enabled, count, expected, running, nextTime) {
        if (!enabled || count >= expected)
            return;
        if (running || this.isFuture(nextTime)) {
            items.push(this.activityItem(name, `进行中 ${count}/${expected}`, 'running', this.formatDate(nextTime)));
            return;
        }
        items.push(this.activityItem(name, `未完成 ${count}/${expected}`, 'warn'));
    }

    addBountyItem(items, status = {}, config = {}) {
        if (!config.enabled)
            return;
        const accepted = status.accepted || 0;
        const limit = status.limit || 0;
        if (limit > 0 && accepted >= limit)
            return;
        if (config.refreshLimit !== undefined && status.refreshCount >= config.refreshLimit && accepted < limit)
            items.push(this.activityItem('悬赏', `失败 ${accepted}/${limit || '?'}`, 'fail'));
        else if (this.isFuture(status.updateTime) || status.claimTimes?.length)
            items.push(this.activityItem('悬赏', `进行中 ${accepted}/${limit || '?'}`, 'running', this.formatDate(status.updateTime)));
        else
            items.push(this.activityItem('悬赏', `未完成 ${accepted}/${limit || '?'}`, 'warn'));
    }

    addFortuneItems(items, status = {}, config = {}) {
        if (!config.enabled)
            return;
        const checks = [
            ['占矿', status.occupation],
            ['抽气运', (status.drawCount || 0) >= 3],
            ['三界战', status.realmWar],
            ['仙圣道战', status.levelWar],
            ['宗门混战', status.sectWar],
            ['道法神战', status.daoWar],
            ['区战力', status.serverWar],
            ['同境混战', status.stateWar],
        ];
        const missing = checks.filter(([, done]) => !done).map(([name]) => name);
        if (missing.length)
            items.push(this.activityItem('气运', `未完成 ${missing.length}项`, 'warn', missing.join('、')));
    }

    addBagItem(items, status = {}, config = {}) {
        if (!config.enabled)
            return;
        if (!config.target?.bytes_pb_reserve) {
            items.push(this.activityItem('背包送道具', '缺少目标', 'fail'));
            return;
        }
        if (status.items?.length)
            items.push(this.activityItem('背包送道具', `进行中 ${status.items.length}项`, 'running'));
    }

    addMiscItems(items, status = {}, config = {}) {
        if (!config.enabled)
            return;
        const missing = [];
        const running = [];
        this.collectBoolean(missing, '签到', status.signIn);
        this.collectBoolean(missing, '送能量', status.sendEnergy);
        this.collectBoolean(missing, '传功', status.transmission);
        this.collectBoolean(missing, '宗门签到', status.sect?.signIn);
        this.collectBoolean(missing, '宗门赐福', !config.sectBlessing || status.sect?.blessing);
        this.collectBoolean(missing, '月卡', !config.subscribe?.enabled || status.subscribe);
        this.collectBoolean(missing, '送礼物', !config.gift?.enabled || status.gift);
        this.collectBoolean(missing, '福泽', status.fortune);
        this.collectBoolean(missing, '收能量', status.receiveEnergy);
        this.collectBoolean(missing, '接收传功', status.receiveTransmission);
        this.collectBoolean(missing, '任务奖励', status.receiveTaskReward);
        this.collectBoolean(missing, '接收赐福', status.receiveBlessing);
        this.collectCount(missing, '砍一刀', status.kill?.count, 10);
        this.collectCount(missing, '噬魂兽', status.challenge?.count, 3);
        this.collectCount(missing, '锻造', status.forge?.count, config.forgeLimit || 50);
        this.collectCount(missing, '通天塔', status.tower?.count, 5);
        this.collectCount(missing, '膜拜', status.worship?.count, 10);
        this.collectFight(missing, status.fight, config.fight?.enabled);
        this.collectFlow(missing, running, '洞府', status.abode);
        this.collectFlow(missing, running, '宗门任务', status.sect?.task);
        this.collectFlow(missing, running, '大混战', status.battleSignUp);
        if (config.fightPet?.enabled)
            this.collectFlow(missing, running, '灵宠对决', status.fightPet);
        this.collectFlow(missing, running, '地狱寻宝', status.hell);
        if (config.levelUp?.enabled)
            this.collectFlow(missing, running, '提升境界', status.levelUp);

        if (running.length)
            items.push(this.activityItem('日常', `进行中 ${running.length}项`, 'running', running.join('、')));
        if (missing.length)
            items.push(this.activityItem('日常', `未完成 ${missing.length}项`, 'warn', missing.slice(0, 12).join('、')));
    }

    addEventItems(items, status = {}, config = {}) {
        if (!config.enabled)
            return;
        const missing = [];
        const running = [];
        this.collectFlow(missing, running, '礼包', status.package);
        this.collectFlow(missing, running, '扭蛋', status.capsule);
        this.collectFlow(missing, running, '血魔谷', { inProgress: !status.senior?.isFinished && status.senior?.currentPosition, isFinished: status.senior?.isFinished });
        this.collectFlow(missing, running, '传送', status.travel);
        if ((status.mining?.stamina ?? 30) > 0)
            missing.push('挖矿');
        if (running.length)
            items.push(this.activityItem('活动', `进行中 ${running.length}项`, 'running', running.join('、')));
        if (missing.length)
            items.push(this.activityItem('活动', `未完成 ${missing.length}项`, 'warn', missing.join('、')));
    }

    addTaskItem(items, name, enabled, finished, nextTime, progress) {
        if (!enabled || finished)
            return;
        if (this.isFuture(nextTime) || progress) {
            items.push(this.activityItem(name, '进行中', 'running', this.formatDate(nextTime)));
            return;
        }
        items.push(this.activityItem(name, '未完成', 'warn'));
    }

    collectBoolean(missing, name, done) {
        if (!done)
            missing.push(name);
    }

    collectCount(missing, name, count = 0, limit) {
        if (count < limit)
            missing.push(`${name}${count}/${limit}`);
    }

    collectFight(missing, fight = {}, enabled) {
        if (enabled) {
            if (!fight.nextTime)
                missing.push('试剑');
            return;
        }
        this.collectCount(missing, '随机试剑', fight.randomCount, 10);
        this.collectCount(missing, '师门切磋', fight.masterCount, 10);
        this.collectCount(missing, '宗门挑战', fight.challengeSectCount, 10);
        this.collectCount(missing, '宗门切磋', fight.sectCount, 10);
    }

    collectFlow(missing, running, name, flow = {}) {
        if (flow?.isFinished)
            return;
        if (flow?.inProgress) {
            running.push(name);
            return;
        }
        missing.push(name);
    }

    expectedRuns(levels = []) {
        return levels.length >= 2 ? 2 : 1;
    }

    activityItem(name, state, kind, detail = '') {
        return { name, state, kind, detail };
    }

    isFuture(value) {
        const date = this.asDate(value);
        return date ? date.getTime() > Date.now() : false;
    }

    asDate(value) {
        if (!value)
            return undefined;
        const date = value instanceof Date ? value : new Date(value);
        return Number.isNaN(date.getTime()) ? undefined : date;
    }

    formatDate(value) {
        const date = this.asDate(value);
        return date ? date.toLocaleString() : '';
    }

    showToast(message, isError = false) {
        clearTimeout(this.toastTimer);
        this.toast.textContent = message;
        this.toast.classList.toggle('error', isError);
        this.toast.classList.add('visible');
        this.toastTimer = setTimeout(() => this.toast.classList.remove('visible'), 3200);
    }

    escapeHtml(value) {
        return String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }

    escapeAttr(value) {
        return this.escapeHtml(value);
    }
}

new AccountsDashboard();
