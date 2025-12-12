// src/server/core/GameInstance.ts
import { Browser, BrowserContext, chromium, Page, Response } from 'playwright-core';
import { CommandScheduler } from './CommandScheduler';
import { Status, MessageBody, Command, Account } from '../types';
import { logger } from '../../utils/logger';
import { Request } from 'playwright-core';
import { EventBus } from './EventBus';
import { AccountManager } from './AccountManager';

export class GameInstance {

    public tinyID: string | null = null;
    private lastMessageIndex: number = 0;
    static readonly fetchInterval: number = 1000;
    static readonly fetchThreshold: number = 5000;
    static readonly sessionExpirationThreshold: number = 12 * 60 * 60 * 1000;
    private isFetching: boolean = false;
    private fetchPaused: boolean = false;

    private browser: Browser | null = null;
    private context: BrowserContext | null = null;
    private page: Page | null = null;
    private baseUrl: string;
    private loginUrl: string;
    private channelUrl: string;
    private sendParams: { input: string; init: RequestInit } = { input: '', init: {} };
    private receiveParams: { input: string; init: RequestInit } = { input: '', init: {} };
    public scheduler: CommandScheduler | null = null;
    private fetchTimeout: NodeJS.Timeout | null = null;
    private reloginTimeout: NodeJS.Timeout | null = null;
    private updateSessionFailed: boolean = false;


    constructor(
        public readonly account: Account,
    ) {
        this.baseUrl = "https://pd.qq.com";
        this.loginUrl = `https://xui.ptlogin2.qq.com/cgi-bin/xlogin?appid=1600001587&s_url=${encodeURIComponent(this.baseUrl)}`;
        this.channelUrl = account.config.metadata?.channelUrl ?? process.env.CHANNEL_URL!;
        const lastUpdate = this.account.metadata.lastUpdateTime;
        const lastUpdateDate = lastUpdate ? new Date(lastUpdate).setHours(0, 0, 0, 0) : null;
        const today = new Date().setHours(0, 0, 0, 0);
        if (lastUpdateDate !== today) this.resetStatus();
    }


    public async register() {
        this.browser = await chromium.launch({ headless: true });
        this.context = await this.browser.newContext();
        this.page = await this.context.newPage();
        this.scheduler = new CommandScheduler(this);
        const session = this.account.session;
        if (!session || this.getSessionExpirationTime() < Date.now())
            await this.updateSession();
        await this.init();
    }

    public async close() {
        if (this.reloginTimeout) {
            clearTimeout(this.reloginTimeout);
            this.reloginTimeout = null;
        }
        if (this.fetchTimeout) {
            clearTimeout(this.fetchTimeout);
            this.fetchTimeout = null;
        }
        this.scheduler?.destroy();
        await this.browser!.close();
        this.account.online = false;
    }

    public async updateSession() {
        await this.scheduler?.destroy();
        this.account.online = false;
        logger.info(`Navigating to login page for accountId: ${this.account.id}`);
        await this.page!.goto(this.loginUrl, { waitUntil: 'domcontentloaded' });
        if (!await this.linkLogin() && !await this.credentialLogin() && !await this.qrLogin()) {
            this.updateSessionFailed = true;
            throw new Error(`Login failed for accountId: ${this.account.id}`);
        }
        this.updateSessionFailed = false;
        logger.info(`Login successful for accountId: ${this.account.id}`);
        await AccountManager.persist();
        EventBus.emit('sessionUpdated', { accountId: this.account.id, success: true });
    }

    private async linkLogin() {
        try {
            logger.info(`Attempting link login for accountId: ${this.account.id}`);
            const loginLink = await this.page!.waitForSelector(`a[uin="${this.account.id}"][type="4"]`, { timeout: 15000 });
            await loginLink!.click();
            logger.info(`Waiting for navigation to ${this.baseUrl} for accountId: ${this.account.id}`);
            await this.page!.waitForURL(this.baseUrl, { waitUntil: 'domcontentloaded' });
            this.account.session = await this.context!.cookies();
            return true;
        } catch (error) {
            logger.info(`Link login failed for accountId: ${this.account.id}`);
            return false;
        }
    }

    private async credentialLogin() {
        try {
            logger.info(`Attempting credential login for accountId: ${this.account.id}`);
            await this.page!.click('#switcher_plogin');
            await this.page!.waitForSelector('#u');
            await this.page!.waitForSelector('#p');
            const id = this.account.id;
            const password = AccountManager.decryptPassword(this.account.encryptedPassword);
            if (password === undefined)
                return false;
            await this.page!.fill('#u', id);
            await this.page!.fill('#p', password);
            await this.page!.click('#login_button');
            logger.info(`Waiting for navigation to ${this.baseUrl} for accountId: ${this.account.id}`);
            await this.page!.waitForURL(this.baseUrl, { timeout: 5000, waitUntil: 'commit' });
            this.account.session = await this.context!.cookies();
            return true;
        } catch (error) {
            logger.error(`Credential login failed for accountId: ${this.account.id}`);
            return false;
        }
    }

    private async qrLogin() {
        try {
            logger.info(`Attempting QR login for accountId: ${this.account.id}`);
            const captureQRCode = async (response: Response) => {
                const url = response.url();
                if (url.includes('ptqrshow')) {
                    EventBus.emit('qrcodeUpdated', {
                        base64: `data:image/png;base64,${Buffer.from(await response.body()).toString('base64')}`
                    });
                }
            };
            this.page?.on('response', captureQRCode);
            await this.page!.click('#switcher_qlogin');
            logger.info(`Waiting for navigation to ${this.loginUrl} for accountId: ${this.account.id}`);
            await this.page?.waitForURL(this.baseUrl, { timeout: 60000, waitUntil: 'load' });
            this.account.session = await this.context!.cookies();
            this.page?.off('response', captureQRCode);
            return true;
        } catch (error) {
            logger.error(`QR login failed for accountId: ${this.account.id}`, error);
            return false;
        }
    }

    public async init() {
        await this.context!.addCookies(this.account.session!);

        let sendParamsCaptured = false;
        let receiveParamsCaptured = false;

        const filterInvalidHeaders = (headers: Record<string, string>) => {
            const forbiddenHeaders = ['accept-encoding', 'content-length', 'origin', 'user-agent'];
            return Object.fromEntries(
                Object.entries(headers)
                    .filter(([key]) =>
                        !forbiddenHeaders.includes(key.toLowerCase()) &&
                        !key.startsWith(':')
                    )
            );
        }

        if (this.account.metadata.tinyid)
            this.tinyID = this.account.metadata.tinyid;

        const captureParamsHandler = async (request: Request) => {
            const url = request.url();
            if (url.includes('FirstViewProcess') && this.tinyID === null) {
                logger.info(`Capturing tinyID for accountId: ${this.account.id}`);
                const body = JSON.parse(request.postData() || '{}');
                logger.info(`Captured tinyID body: ${JSON.stringify(body)}`);
                this.tinyID = body.online_report_req?.tinyd_id || null;
                if (this.tinyID === null) {
                    logger.error(`Failed to capture tinyID for accountId: ${this.account.id}`);
                    await this.page!.reload({ waitUntil: 'domcontentloaded' });
                }
            }
            if (url.includes('HandleProcess?msg=1&polling')) {
                this.receiveParams = {
                    input: url,
                    init: {
                        method: request.method(),
                        headers: filterInvalidHeaders(await request.allHeaders()),
                        body: request.postData()
                    }
                }
                receiveParamsCaptured = true;
                var body = JSON.parse(this.receiveParams.init.body as string);
                this.sendParams = {
                    input: url.replace('cmd0x907e.Cmd0x907e/HandleProcess?msg=1&polling&', 'msgproxy.sendmsg/HandleProcess?'),
                    init: {
                        method: request.method(),
                        headers: filterInvalidHeaders(await request.allHeaders()),
                        body: JSON.stringify({
                            msg: {
                                head: {
                                    routing_head: {
                                        guild_id: body.get_channel_msg_req.rpt_channel_params[0].guild_id,
                                        channel_id: body.get_channel_msg_req.rpt_channel_params[0].channel_id,
                                        from_tinyid: null,
                                        direct_message_flag: 0
                                    },
                                    content_head: {
                                        msg_type: "3840", // NormalMsg
                                        random: Date.now().toString()
                                    }
                                },
                                body: {
                                    rich_text: {
                                        elems: []
                                    }
                                }
                            }
                        })
                    }
                }
            }
            if (receiveParamsCaptured && this.tinyID != null) {
                this.account.metadata.tinyid = this.tinyID;
                await AccountManager.persist();
                this.page!.off('request', captureParamsHandler);
                let headers = this.sendParams.init.headers as Record<string, string>;
                headers['x-oidb'] = "{\"uint32_service_type\":\"0\"}";
                await this.page?.waitForFunction(() => (window as any)._TDID && typeof (window as any)._TDID.signData === 'function', { timeout: 30000 });
                const signature = await this.page!.evaluate(() => (window as any)._TDID.signData(0));
                headers['x-turing-signature'] = signature;
                this.sendParams.init.headers = headers;
                let body = JSON.parse(this.sendParams.init.body as string);
                body.msg.head.routing_head.from_tinyid = this.tinyID;
                this.sendParams.init.body = JSON.stringify(body);
                logger.info(`TinyID and receive parameters captured for accountId: ${this.account.id}`);
                sendParamsCaptured = true;
            }
        }

        this.page!.on('request', captureParamsHandler);
        await this.page!.goto(this.channelUrl, { waitUntil: 'domcontentloaded' });

        await new Promise<void>((resolve) => {
            const checkParamsCaptured = () => (receiveParamsCaptured && sendParamsCaptured) ? resolve() : setTimeout(() => checkParamsCaptured(), 1000);
            checkParamsCaptured();
        });
        this.account.online = true;
        if (!this.updateSessionFailed)
            await this.scheduleRelogin();
        this.scheduler!.init();
    }

    public async scheduleRelogin() {
        const timestamp = this.getSessionExpirationTime() - GameInstance.sessionExpirationThreshold;
        this.reloginTimeout = setTimeout(async () => {
            try {
                await this.updateSession();
            } catch {
                EventBus.emit('sessionUpdated', { accountId: this.account.id, success: false });
            }
            await this.init();
        }, timestamp - Date.now());
        EventBus.emit('sessionUpdateScheduled', { accountId: this.account.id, timestamp });
    }

    private getSessionExpirationTime(): number {
        return Math.min(...this.account.session!.filter(cookie => cookie.domain === '.pd.qq.com' && cookie.expires !== -1).map(cookie => cookie.expires * 1000));
    }

    public async sendCommand(message: MessageBody) {
        await new Promise<void>((resolve) => {
            const validate = () => (this.account.online && !this.fetchPaused) ? resolve() : setTimeout(validate, 100);
            validate();
        });
        const body = JSON.parse(typeof this.sendParams.init?.body === 'string' ? this.sendParams.init.body : '{}');
        body.msg.head.content_head.random = Date.now() + this.scheduler!.commandCount;
        const head: MessageBody = [{ str: '@唐诗修仙', bytes_pb_reserve: 'GAIovIWNpPKAgIAC' }];
        body.msg.body.rich_text.elems = head.concat(message).map((elem, index) => ({
            text: {
                str: Buffer.from(index === 0 ? elem.str : ' ' + elem.str, 'utf-8').toString('base64'),
                bytes_pb_reserve: elem.bytes_pb_reserve
            }
        }));
        this.sendParams.init.body = JSON.stringify(body);
        try {
            const response = await fetch(this.sendParams.input, {
                ...this.sendParams.init,
                credentials: 'include',
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            return data;
        } catch (error) {
            logger.error(`Error sending message: ${(error as Error).message}`);
            throw error;
        }
    }

    public async fetchResponses() {
        if (this.isFetching)
            return;
        this.isFetching = true;
        try {
            const response = await fetch(this.receiveParams.input, {
                ...this.receiveParams.init,
                credentials: 'include',
            });
            if (response.ok) {
                const data = await response.json();
                if (!data?.data?.channel_msg_rsp)
                    throw new Error(`Invalid response data: ${JSON.stringify(data)} with params: ${JSON.stringify(this.receiveParams)}`);
                const msg = data.data.channel_msg_rsp.rpt_channel_msg[0];
                const begIndex = parseInt(msg.rsp_begin_seq);
                const endIndex = parseInt(msg.rsp_end_seq);
                if (begIndex === 0 && endIndex === 0)
                    return;
                for (let i = begIndex; i <= endIndex; ++i) {
                    const response = await this.validateAndParseResponse(msg, endIndex - i);
                    if (response && i > this.lastMessageIndex)
                        this.scheduler!.processResponse(response), this.lastMessageIndex = i;
                }
                this.setFetchParams(endIndex, endIndex + 30);
                return;
            }
        } catch (error) {
            logger.error(`Error fetching responses: ${(error as Error).message}`);
            this.setFetchParams(0, 0);
        } finally {
            this.isFetching = false;
            this.scheduleFetch();
        }
    }
    private setFetchParams(begIndex: number, endIndex: number) {
        const body = JSON.parse(this.receiveParams.init.body as string);
        body.get_channel_msg_req.rpt_channel_params[0].begin_seq = begIndex.toString();
        body.get_channel_msg_req.rpt_channel_params[0].end_seq = endIndex.toString();
        body.msg_box_get_req.cookie = "";
        this.receiveParams.init.body = JSON.stringify(body);
        this.fetchPaused = (begIndex === 0 && endIndex === 0);
    }

    public scheduleFetch() {
        if (this.fetchTimeout)
            clearTimeout(this.fetchTimeout);
        let timestamp = Date.now() + GameInstance.fetchInterval;
        if (!this.scheduler!.isPending() && this.scheduler!.isScheduled() && this.scheduler!.getNextScheduledCommand().date?.getTime()! - Date.now() > GameInstance.fetchThreshold) {
            this.setFetchParams(0, 0);
            timestamp = this.scheduler!.getNextScheduledCommand().date?.getTime()! - GameInstance.fetchThreshold;
        }
        this.fetchTimeout = setTimeout(() => this.fetchResponses(), timestamp - Date.now());
        EventBus.emit('fetchScheduled', { accountId: this.account.id, timestamp });
    }

    private async validateAndParseResponse(msg: any, index: number): Promise<string | null> {
        const content = Buffer.from(msg.rpt_msgs[index], 'base64').toString('utf-8').normalize("NFKC");
        let result = '';
        if (!content.includes(this.tinyID!))
            return null;
        const jsonContent = Buffer.from(msg.rpt_json_msgs[index], 'base64').toString('utf-8');
        try {
            const json = JSON.parse(jsonContent);
            const elems = json.body.rich_text.elems;
            for (const elem of elems) {
                if (elem.text?.bytes_pb_reserve && !this.account.status.personalInfo?.bytes_pb_reserve)
                    await this.updateStatus({ personalInfo: { str: Buffer.from(elem.text.str, 'base64').toString('utf-8'), bytes_pb_reserve: elem.text.bytes_pb_reserve } });
                if (elem.text?.bytes_pb_reserve)
                    result += '@{user_id}';
                else if (elem.text?.str)
                    result += Buffer.from(elem.text.str, 'base64').toString('utf-8').normalize("NFKC");
                else if (elem.common_elem?.uint32_service_type === 46)
                    result += Buffer.from(elem.common_elem.bytes_pb_elem, 'base64').toString('utf-8').normalize("NFKC");
            }
        } catch (error) {
            console.error('Failed to extract elements:', error);
            return null;
        }
        return result;
    }

    public async updateStatus(status: Partial<Status>) {
        await AccountManager.patchStatus(this.account.id, status);
    }

    public async scheduleCommand(command: Command, delay: number = 0) {
        this.scheduler!.scheduleCommand(command, delay);
    }

    public async waitForLevelUpdate() {
        this.account.status.personalInfo!.level = undefined;
        this.scheduleCommand({ type: 'personalInfo', body: '我的境界' });
        await new Promise<void>((resolve) => {
            const checkLevelUpdate = () => (this.account.status.personalInfo?.level !== undefined) ? resolve() : setTimeout(checkLevelUpdate, 100);
            checkLevelUpdate();
        });
    }

    public async resetStatus() {
        await this.updateStatus({
            meditation: { exhausted: false },
            garden: { ripen: { ripeCount: 30 } },
            bounty: { accepted: 0, refreshCount: 0 },
            secretRealm: { inProgress: false, isFinished: false },
            zoo: { inProgress: false, isFinished: false },
            dreamland: { inProgress: false, isFinished: false },
            fishing: { inProgress: false, finishedCount: 0 },
            wooding: { inProgress: false, finishedCount: 0, energyReceived: false },
            fortune: { occupation: false, realmDraw: false, levelDraw: false, realmWar: false, levelWar: false, sectWar: false, daoWar: false, serverWar: false },
            misc: {
                signIn: false,
                sendEnergy: false,
                receiveEnergy: false,
                abode: { inProgress: false, isFinished: false },
                transmission: false,
                receiveTransmission: false,
                receiveTaskReward: false,
                receiveBlessing: false,
                kill: { count: 0 },
                challenge: { count: 0 },
                forge: { count: 0, currentType: undefined },
                tower: { count: 0 },
                worship: { count: 0 },
                fight: { randomCount: 0, masterCount: 0, challengeSectCount: 0, sectCount: 0 },
                sect: { signIn: false, task: { inProgress: false, isFinished: false }, blessing: false },
                battleSignUp: { inProgress: false, isFinished: false },
                fightPet: { inProgress: false, isFinished: false, nextTime: undefined },
                hell: { inProgress: false, isFinished: false },
                gift: false,
                subscribe: false,
                fortune: false,
                levelUp: { inProgress: false, isFinished: false },
            },
            event: {
                package: { inProgress: false, isFinished: false },
                capsule: { inProgress: false, isFinished: false },
                trial: { count: 0 },
                senior: { currentPosition: undefined, monsterDefeated: false, isFinished: false },
                travel: { inProgress: false, isFinished: false },
                mining: { stamina: 30 },
            },
            gather: { finished: false },
        })
    }
}