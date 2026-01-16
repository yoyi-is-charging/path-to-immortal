// src/server/core/AccountManager.ts

import { StorageService } from './StorageService';
import { Config, Account, Status } from '../types';
import { EventBus } from './EventBus';
import { merge } from '../../utils/ObjectUtils';

export class AccountManager {
    private static accounts: Account[] = [];
    public static defaultConfig(): Config {
        return ({
            metadata: { channelUrl: process.env.CHANNEL_URL! },
            meditation: { enabled: false, time: { hours: 0, minutes: 0, seconds: 0 }, count: 1, tantric: { enabled: false, targets: [], autoMeditation: false }, partner: { enabled: false, isRequester: false } },
            garden: { enabled: false, seedType: '仙露草种子', ripen: { enabled: false, seedType: '灵芝种子' } },
            bounty: { enabled: false, time: { hours: 0, minutes: 0, seconds: 0 }, bountyTypes: ['帮扶凡间疾苦', '保护我方大殿', '保护我方药园', '解救被困修士', '铲除山贼保护城镇', '度化恶灵', '铲除妖兽', '保护我方岩矿', '抵御外族入侵', '铲除邪修', '寻找空间节点', '游历古战场', '游历仙灵谷', '游历五龙池'], refreshLimit: 0 },
            secretRealm: { enabled: false, time: { hours: 20, minutes: 0, seconds: 0 }, skillTypePriority: ['防御', '血量', '攻击', '免伤'] },
            zoo: { enabled: false, time: { hours: 20, minutes: 0, seconds: 0 }, autoEscape: true },
            dreamland: { enabled: false, type: 1, time: { hours: 20, minutes: 0, seconds: 0 } },
            fishing: { enabled: false, time: { hours: 12, minutes: 0, seconds: 0 }, levels: [5, 1] },
            wooding: { enabled: false, time: { hours: 12, minutes: 0, seconds: 0 }, levels: [5, 1], minPrice: 3995, friendPriceInquiryInterval: 15, energyReceiveTime: { hours: 23, minutes: 55, seconds: 0 } },
            fortune: { enabled: false, time: { hours: 18, minutes: 0, seconds: 0 }, occupation: 1, realmWar: '东1', levelWar: '上路 1', daoWar: 9 },
            bag: { enabled: false, reservedItems: ['十连'] },
            misc: { enabled: false, time: { hours: 0, minutes: 0, seconds: 0 }, timePost: { hours: 21, minutes: 0, seconds: 0 }, forgeLimit: 50, forgeTypes: [1, 2, 3], fight: { enabled: false }, fightPet: { enabled: false }, gift: { enabled: false, type: '1 1' }, sectBlessing: false, subscribe: { enabled: false, type: 1 }, levelUp: { enabled: false, toMax: false } },
            event: { enabled: false, package: false, time: { hours: 12, minutes: 0, seconds: 0 }, mining: { maxShovelLevel: 8, maxBagLevel: 6 } },
            rescue: { enabled: false, time: { hours: 0, minutes: 0, seconds: 0 } },
            gather: { enabled: false, time: { hours: 0, minutes: 0, seconds: 0 } },
            rune: { enabled: false, time: { hours: 0, minutes: 0, seconds: 0 } },
        });
    }

    public static async init() {
        this.accounts = await StorageService.load();
        this.accounts.forEach(account => {
            account.config = merge(AccountManager.defaultConfig(), account.config);
        });
    }

    static async createAccount(id: string, password?: string) {
        const existing = this.accounts.find(acc => acc.id === id);
        if (existing)
            throw new Error(`Account with id ${id} already exists`);
        const newAccount: Account = {
            id,
            encryptedPassword: this.encryptPassword(password),
            status: {},
            online: false,
            metadata: {},
            config: this.defaultConfig(),
        };
        this.accounts.push(newAccount);
        await this.persist();
        return newAccount;
    }

    static async removeAccount(id: string) {
        this.accounts = this.accounts.filter(acc => acc.id !== id);
        await this.persist();
    }

    static async persist() {
        await StorageService.save(this.accounts);
    }

    private static encryptPassword(password: string | undefined) {
        if (!password) return undefined;
        return Buffer.from(password, 'utf-8').toString('base64');
    }

    static decryptPassword(encrypted: string | undefined) {
        if (!encrypted) return undefined;
        return Buffer.from(encrypted, 'base64').toString('utf-8');
    }


    static getAccounts() {
        return this.accounts;
    }

    static getAccount(id: string) {
        const account = this.accounts.find(acc => acc.id === id);
        if (!account) {
            throw new Error(`Account with ID ${id} not found`);
        }
        return account;
    }

    static async patchStatus(accountId: string, patch: Partial<Status>) {
        const account = this.getAccount(accountId);
        account.status = merge(account.status, patch);
        EventBus.emit('statusUpdated', account);
        account.metadata.lastUpdateTime = Date.now();
        await AccountManager.persist();
    }

    static async patchConfig(accountId: string, patch: Partial<Config>) {
        const account = this.getAccount(accountId);
        account.config = merge(account.config, patch);
        EventBus.emit('configUpdated', account);
        await AccountManager.persist();
    }
}
