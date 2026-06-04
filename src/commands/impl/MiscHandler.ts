// src/commands/impl/MiscHandler.ts

import { Command, Status } from '../../server/types';
import { CommandHandler } from '../CommandHandler';
import { runEffects } from '../EffectRunner';
import { GameInstance } from '../../server/core/GameInstance';
import { getDate } from '../../utils/TimeUtils';
import { readAnswerIndex, readBracketValue, readFirstCount, readNumberAfter } from '../../utils/FieldExtractor';

type MiscStatus = NonNullable<Status['misc']>;

type MiscResponse = {
    commandType: string;
    text: string;
};

type MiscEffect =
    | { type: 'patchStatus'; status: MiscStatus }
    | { type: 'scheduleCommand'; command: Command; delay?: number }
    | { type: 'registerTypeScheduler'; commandType: string }
    | { type: 'logError'; message: string };

export default class MiscHandler implements CommandHandler {
    readonly category = 'misc';
    readonly COMMAND_TYPE = new Map([
        ['签到', 'misc_signIn'],
        ['宗门签到', 'misc_sectSignIn'],
        ['送能量', 'misc_sendEnergy'],
        ['领道友能量', 'misc_receiveEnergy'],
        ['领每日能量', 'misc_abode'],
        ['全部转动', 'misc_abode'],
        ['传功', 'misc_transmission'],
        ['接收传功', 'misc_receiveTransmission'],
        ['一键领任务奖励', 'misc_receiveTaskReward'],
        ['接收赐福', 'misc_receiveBlessing'],
        ['砍一刀', 'misc_kill'],
        ['挑战噬魂兽', 'misc_challenge'],
        ['锻造', 'misc_forge'],
        ['塔攻击', 'misc_tower'],
        ['膜拜排位', 'misc_worship'],
        ['随机试剑', 'misc_fightRandom'],
        ['师门切磋', 'misc_fightMaster'],
        ['宗门挑战', 'misc_challengeSect'],
        ['宗门切磋', 'misc_fightSect'],
        ['试剑', 'misc_fight'],
        ['开始宗门任务', 'misc_sectTask'],
        ['任务选择', 'misc_sectTask'],
        ['大混战报名', 'misc_battleSignUp'],
        ['灵宠对决', 'misc_fightPet'],
        ['地狱寻宝', 'misc_hell'],
        ['送礼物', 'misc_gift'],
        ['确定送礼物', 'misc_giftConfirm'],
        ['开启赐福', 'misc_sectBlessing'],
        ['领灵石月卡', 'misc_subscribe'],
        ['一键领福泽', 'misc_fortune'],
        ['提升境界', 'misc_levelUp'],
    ]);
    readonly RESPONSE_PATTERN = new Map([
        ['misc_signIn', /签到成功|今日已签到/],
        ['misc_sectSignIn', /宗门签到成功|今日已宗门签到/],
        ['misc_sendEnergy', /送能量成功|已送过能量/],
        ['misc_receiveEnergy', /领道友能量成功|没有可领取的能量/],
        ['misc_abode', /领取每日能量成功|已领过能量|我的洞府|能量不足|没有能量/],
        ['misc_transmission', /传功成功|已经传功|无法传功/],
        ['misc_receiveTransmission', /已接收传功|接受传功成功|还没有传功/],
        ['misc_receiveTaskReward', /领取任务奖励成功|暂无可领取的任务奖励/],
        ['misc_receiveBlessing', /领取赐福成功|没有可领取的赐福/],
        ['misc_kill', /挑战一刀斩|体力不足/],
        ['misc_challenge', /剩余挑战次数|每人每天挑战噬魂兽3次/],
        ['misc_forge', /本次锻造次数|炼器上限/],
        ['misc_tower', /挑战通天塔|每人每天最多50个体力/],
        ['misc_worship', /崇拜的目光|已膜拜|膜拜排位10次/],
        ['misc_fightRandom', /试剑(成功|失败|过了)|最多试剑25次|1小时内只能试剑1次/],
        ['misc_fightMaster', /师门切磋|切磋过了|暂无其它弟子|没找到你要切磋的序号/],
        ['misc_challengeSect', /宗门挑战|最多挑战10次/],
        ['misc_fightSect', /宗门切磋|切磋过了|没找到你要切磋的序号|今日切磋次数已用完/],
        ['misc_fight', /试剑(成功|失败|过了)|最多试剑25次|1小时内只能试剑1次|奖励后再来试剑/],
        ['misc_sectTask', /任务选择|每人每日任务次数|今日任务已全部完成|任务选择已过期/],
        ['misc_battleSignUp', /预计开打时间|当小时内已报名|当前小时的报名已截止|今日已经报名/],
        ['misc_fightPet', /对决开始|灵宠只能对决|每天最多对决/],
        ['misc_hell', /寻宝位置|已领过寻宝府石/],
        ['misc_gift', /确定要送礼物吗/],
        ['misc_giftConfirm', /送礼物成功/],
        ['misc_sectBlessing', /赐福后宗门弟子|每人每日赐福次数/],
        ['misc_subscribe', /月卡/],
        ['misc_fortune', /你的福泽殿/],
        ['misc_levelUp', /无法提升|提升境界/],
    ])
    readonly ABODE_RECEIVE_PATTERN = /领取每日能量成功|已领过能量/;
    readonly KILL_PATTERN = /挑战一刀斩/;
    readonly FORGE_LIMIT_PATTERN = /炼器上限/;
    readonly WORSHIP_PATTERN = /崇拜的目光|已膜拜/;
    readonly FIGHT_PATTERN = /试剑(成功|失败|过了)/;
    readonly FIGHT_FREQUENCY_PATTERN = /1小时内只能试剑1次/;
    readonly FIGHT_NOT_AVAILABLE_PATTERN = /奖励后再来试剑/;
    readonly FIGHT_SECT_PATTERN = /宗门切磋|切磋过了|没找到你要切磋的序号/;
    readonly FIGHT_MASTER_PATTERN = /师门切磋/;
    readonly CHALLENGE_SECT_PATTERN = /宗门挑战/;
    readonly SIGNUP_FINISHED_PATTERN = /今日已经报名/;
    readonly FIGHT_PET_FINISHED_PATTERN = /每天最多对决/;
    readonly HELL_FINISHED_PATTERN = /府石已领取|已领过寻宝府石/;
    readonly LEVEL_UP_UNAVAILABLE_PATTERN = /无法提升/;
    readonly TASK_DATABASE = new Map([
        ['厨房帮工', new Map([
            ['洗菜', /炒出来/],
            ['切菜', /还没切|吃丝|好的帮厨/],
            ['倒垃圾', /垃圾|苍蝇|你懒/],
            ['洗碗', /上次的碗|吃饱|不干不净/]
        ])],
        ['指点新人', new Map([
            ['妖兽园打法攻略', /兽核/],
            ['秘境打法攻略', /葫芦|提升(功法|装备)/],
            ['通天塔打法攻略', /金丹/],
            ['双休攻略', /道缘/],
            ['宗门新手引导', /玩转宗门/]
        ])],
        ['跑腿打杂', new Map([
            ['砍柴', /柴火/],
            ['挑水', /水缸/],
            ['挑大粪', /肥料/],
            ['搬搬抬抬', /卸车/]
        ])],
        ['下山历练', new Map([
            ['新手村A', /\n1\n/],
            ['新手村B', /\n2\n/],
            ['新手村C', /\n3\n/]
        ])],
        ['组织活动', new Map([
            ['修炼交流会', /修炼进度缓慢/],
            ['下山历练', /历练历练/],
            ['资源采集', /储存资源/]
        ])],
        ['灵植萃取', new Map([
            ['指尖从上往下', /上细下粗/],
            ['指尖从下往下', /上粗下细/],
            ['手握从上往下', /上下一致/]
        ])],
        ['打理药园', new Map([
            ['除草', /杂草|毒草|野草/],
            ['除虫', /虫害|害虫/],
            ['浇水', /赤地|枯萎|干裂/]
        ])],
        ['整理经卷', new Map([
            ['功法区', /掌法|拳法|御剑术|元功|魔功|长生诀/],
            ['药园区', /灵植术/],
            ['炼丹区', /炼丹秘术/],
            ['炼器区', /炼器秘术/]
        ])],
        ['编写经卷', new Map([
            ['功法类', /掌法|拳法|御剑术|元功|魔功|长生诀/],
            ['药园类', /灵植术/],
            ['炼丹类', /炼丹秘术/],
            ['炼器类', /炼器秘术/]
        ])],
        ['装备锻造', new Map([
            ['寒铁', /2级/],
            ['寒铁、精铁', /10级/],
            ['寒铁、精铁、元神', /1001级/]
        ])],
        ['资源分配', new Map([
            ['炼器师', /寒铁|精铁/],
            ['炼丹师', /灵树|灵植|灵草/]
        ])],
        ['宗门授课1', new Map([
            ['打更高级的地图', /更高阶/],
            ['回合过多最好加攻击', /选择加攻击/],
            ['只要打你还掉血', /选择加防御/],
            ['预计血量不足以支持2个回合', /选择加血量/],
            ['不免伤就挂了', /选择加免伤/],
            ['妖兽阵型是一排的时候', /选择横扫/],
            ['妖兽阵型是一列的时候', /选择力劈/],
            ['看妖兽对你造成的伤害和自己的血量', /选择逃跑/]
        ])],
        ['宗门授课3', new Map([
            ['做宗门任务', /宗石/],
            ['做宗门任务、宗门挑战', /增加贡献/],
            ['可去藏宝阁兑换资源', /宗门宗石有什么用/],
            ['领宗门灵丹福利的', /赐福/],
            ['可获得功法点', /切磋/],
            ['提升宗门等吉、提升个人职位', /宗门贡献有什么用/]
        ])],
        ['弟子考核', new Map([
            ['内门弟子', /遛灵兽|研习法宝|打理药园|整理经卷|指点新人|下山历练/],
            ['外门弟子', /整理经卷|看守药园|喂养灵兽|跑腿打杂|擦拭法宝|厨房帮工|打扫大殿/]
        ])],
        ['任务分配', new Map([
            ['内门弟子', /遛灵兽|研习法宝|打理药园|整理经卷|指点新人|下山历练/],
            ['外门弟子', /整理经卷|看守药园|喂养灵兽|跑腿打杂|擦拭法宝|厨房帮工|打扫大殿/]
        ])],
        ['研习法宝', new Map([
            ['攻击法宝', /没能破甲/],
            ['防御法宝', /被破甲/],
            ['血量法宝', /没血/]
        ])],
        ['法宝注灵', new Map([
            ['攻击法宝', /攻击5000[万W]/],
            ['防御法宝', /防御1000[万W]/],
            ['血量法宝', /血量1000[万W]/]
        ])],
        ['钻研功法', new Map([
            ['主要提升攻击', /攻击5000[万W]/],
            ['主要提升防御', /防御1000[万W]/],
            ['主要提升血量', /血量1000[万W]/]
        ])],
        ['宗门决策', new Map([
            ['支持', /增加贡献的获取方式|开通|增加赐福的灵丹数量\n/],
            ['反对', /不拿宗石|宗石获得|减少赐福的灵丹数量\n/],
            ['中立', /增加\S+减少|减少\S+增加/]
        ])],
        ['喂养灵兽', new Map([
            ['青龙兽', /东方位/],
            ['朱雀兽', /南方位/],
            ['白虎兽', /西方位/],
            ['玄武兽', /北方位/]
        ])],
        ['遛灵兽', new Map([
            ['青龙兽', /东方位/],
            ['朱雀兽', /南方位/],
            ['白虎兽', /西方位/],
            ['玄武兽', /北方位/]
        ])],
        ['打扫大殿', new Map([
            ['左偏殿', /\n左偏殿/],
            ['右偏殿', /\n右偏殿/],
            ['正中殿', /\n正中殿/]
        ])],
        ['看守药园', new Map([
            ['东', /\n东/],
            ['南', /\n南/],
            ['西', /\n西/],
            ['北', /\n北/]
        ])],
        ['擦拭法宝', new Map([
            ['龙鳞', /神龙|青龙/],
            ['紫瑶石', /紫气|紫霄/],
            ['金丝绢', /金罡|金箍|金灵/],
            ['风之精华', /清风|风云/],
            ['黄稻草', /地藏|地府/],
            ['火焰之力', /燃木|火之心/],
            ['月光水晶', /月影|妖月/],
            ['闪电之力', /雷霆|火雷/]
        ])],
        ['修炼阵法', new Map([
            ['呀', /选1/],
            ['呀呀', /选2/],
            ['呀呀呀', /选3/],
            ['呀呀呀呀', /选4/],
            ['呀呀呀呀呀', /选5/]
        ])],
        ['攻打魔族', new Map([
            ['吼', /选1/],
            ['吼吼', /选2/],
            ['吼吼吼', /选3/],
            ['吼吼吼吼', /选4/],
            ['吼吼吼吼吼', /选5/]
        ])],
        ['宗门外交', new Map([
            ['啊', /选1/],
            ['啊啊', /选2/],
            ['啊啊啊', /选3/],
            ['啊啊啊啊', /选4/],
            ['啊啊啊啊啊', /选5/]
        ])],
        ['物色人才', new Map([
            ['广招修仙者加入宗门', /第1步/],
            ['查看宗门修炼记录', /第2步/],
            ['举办宗门试剑大会', /第3步/],
            ['准优胜者进入藏经阁', /第4步/],
            ['传授高级神通', /第5步/]
        ])],
        ['炼制法宝', new Map([
            ['获得法宝图纸', /第1步/],
            ['找到法宝材料', /第2步/],
            ['学习炼制方法', /第3步/],
            ['编写使用方法', /第4步/],
            ['编写注灵方法', /第5步/]
        ])],
        ['加强结界', new Map([
            ['东方位', /青龙怒/],
            ['南方位', /朱雀怒/],
            ['西方位', /白虎怒/],
            ['北方位', /玄武怒/]
        ])],
        ['修炼神通', new Map([
            ['金系神通', /肺/],
            ['木系神通', /肝/],
            ['水系神通', /肾/],
            ['火系神通', /心/],
            ['土系神通', /脾/]
        ])]
    ]);

    async handleResponse(command: Command, response: string, instance: GameInstance) {
        instance.account.status.misc = instance.account.status.misc || {};
        const miscResponse = this.parseResponse(command, response);
        const effects = this.transition(miscResponse, instance);
        await runEffects(effects, { instance, statusKey: 'misc', registerTypeScheduler: (target, commandType) => this.registerTypeScheduler(target, commandType) });
    }

    private parseResponse(command: Command, response: string): MiscResponse {
        return { commandType: command.type, text: response };
    }

    private transition(event: MiscResponse, instance: GameInstance): MiscEffect[] {
        const response = event.text;
        const commandType = event.commandType;
        const status = instance.account.status.misc!;
        const config = instance.account.config.misc!;
        switch (commandType) {
            case 'misc_signIn':
                return this.done({ signIn: true }, commandType);
            case 'misc_sectSignIn':
                return this.done({ sect: { signIn: true } }, commandType);
            case 'misc_sendEnergy':
                return this.done({ sendEnergy: true }, commandType);
            case 'misc_receiveEnergy':
                return [
                    { type: 'patchStatus', status: { receiveEnergy: true } },
                    { type: 'scheduleCommand', command: { type: 'misc_abode', body: '全部转动' } },
                ];
            case 'misc_abode':
                return this.ABODE_RECEIVE_PATTERN.test(response)
                    ? [
                        { type: 'patchStatus', status: { abode: { inProgress: true, isFinished: false } } },
                        { type: 'scheduleCommand', command: { type: 'misc_abode', body: '全部转动' } },
                    ]
                    : [
                        { type: 'patchStatus', status: { abode: { inProgress: false, isFinished: true } } },
                        { type: 'registerTypeScheduler', commandType },
                    ];
            case 'misc_transmission':
                return this.done({ transmission: true }, commandType);
            case 'misc_receiveTransmission':
                return this.done({ receiveTransmission: true }, commandType);
            case 'misc_receiveTaskReward':
                return this.done({ receiveTaskReward: true }, commandType);
            case 'misc_receiveBlessing':
                return this.done({ receiveBlessing: true }, commandType);
            case 'misc_kill':
                return this.transitionCountLoop('kill', this.KILL_PATTERN.test(response) ? (status.kill?.count || 0) + 1 : 10, 10, 'misc_kill', '砍一刀');
            case 'misc_challenge': {
                const count = 3 - (readNumberAfter(response, '剩余挑战次数:') ?? 0);
                return this.transitionCountLoop('challenge', count, 3, 'misc_challenge', '挑战噬魂兽');
            }
            case 'misc_forge':
                return this.transitionForge(response, status, config);
            case 'misc_tower': {
                const towerCount = readFirstCount(response);
                const count = towerCount ? towerCount.limit - towerCount.current : 50;
                return this.transitionCountLoop('tower', count, 5, 'misc_tower', '塔攻击');
            }
            case 'misc_worship':
                return this.transitionCountLoop('worship', this.WORSHIP_PATTERN.test(response) ? (status.worship?.count || 0) + 1 : 10, 10, 'misc_worship', count => `膜拜排位 ${count + 1}`);
            case 'misc_fightRandom':
                return this.transitionFightChain('randomCount', this.FIGHT_PATTERN.test(response) ? (status.fight?.randomCount || 0) + 1 : 25, 10, 'misc_fightRandom', count => `随机试剑 ${count + 1}`, { type: 'misc_fightMaster', body: '师门切磋 1' });
            case 'misc_fightMaster':
                return this.transitionFightChain('masterCount', this.FIGHT_MASTER_PATTERN.test(response) ? (status.fight?.masterCount || 0) + 1 : 10, 10, 'misc_fightMaster', count => `师门切磋 ${count + 1}`, { type: 'misc_challengeSect', body: '宗门挑战 1' });
            case 'misc_challengeSect':
                return this.transitionFightChain('challengeSectCount', this.CHALLENGE_SECT_PATTERN.test(response) ? (status.fight?.challengeSectCount || 0) + 1 : 10, 10, 'misc_challengeSect', count => `宗门挑战 ${count + 1}`, { type: 'misc_fightSect', body: '宗门切磋 1' });
            case 'misc_fightSect':
                return this.transitionFightChain('sectCount', this.FIGHT_SECT_PATTERN.test(response) ? (status.fight?.sectCount || 0) + 1 : 10, 10, 'misc_fightSect', count => `宗门切磋 ${count + 1}`);
            case 'misc_fight':
                return this.transitionFight(response, config);
            case 'misc_sectTask':
                return this.transitionSectTask(response, commandType);
            case 'misc_battleSignUp': {
                const next = !this.SIGNUP_FINISHED_PATTERN.test(response)
                    ? { inProgress: true, isFinished: false, nextTime: getDate({ hours: new Date().getHours() + 1, seconds: 5 }) }
                    : { inProgress: false, isFinished: true, nextTime: getDate({ seconds: 5, dayOffset: 1 }) };
                return this.done({ battleSignUp: next }, commandType);
            }
            case 'misc_fightPet': {
                const next = !this.FIGHT_PET_FINISHED_PATTERN.test(response)
                    ? { inProgress: true, isFinished: false, nextTime: new Date(Date.now() + 10 * 60 * 1000) }
                    : { inProgress: false, isFinished: true, nextTime: getDate({ dayOffset: 1 }) };
                return this.done({ fightPet: next }, commandType);
            }
            case 'misc_hell': {
                const next = !this.HELL_FINISHED_PATTERN.test(response)
                    ? { inProgress: true, isFinished: false }
                    : { inProgress: false, isFinished: true };
                return this.done({ hell: next }, commandType);
            }
            case 'misc_gift':
                return [{ type: 'scheduleCommand', command: { type: 'misc_giftConfirm', body: '确定送礼物' }, delay: 1000 }];
            case 'misc_giftConfirm':
                return this.done({ gift: true }, 'misc_gift');
            case 'misc_sectBlessing':
                return this.done({ sect: { blessing: true } }, commandType);
            case 'misc_subscribe':
                return this.done({ subscribe: true }, commandType);
            case 'misc_fortune':
                return this.done({ fortune: true }, commandType);
            case 'misc_levelUp':
                return this.done({ levelUp: { inProgress: !(this.LEVEL_UP_UNAVAILABLE_PATTERN.test(response) || !config.levelUp?.toMax), isFinished: this.LEVEL_UP_UNAVAILABLE_PATTERN.test(response) || !config.levelUp?.toMax } }, commandType);
            default:
                return [];
        }
    }

    private done(status: MiscStatus, commandType: string): MiscEffect[] {
        return [
            { type: 'patchStatus', status },
            { type: 'registerTypeScheduler', commandType },
        ];
    }

    private transitionCountLoop(key: 'kill' | 'challenge' | 'tower' | 'worship', count: number, limit: number, commandType: string, body: string | ((count: number) => string)): MiscEffect[] {
        const status = { [key]: { count } } as MiscStatus;
        const effects: MiscEffect[] = [{ type: 'patchStatus', status }];
        if (count < limit)
            effects.push({ type: 'scheduleCommand', command: { type: commandType, body: typeof body === 'function' ? body(count) : body }, delay: 1000 });
        else
            effects.push({ type: 'registerTypeScheduler', commandType });
        return effects;
    }

    private transitionForge(response: string, status: MiscStatus, config: NonNullable<GameInstance['account']['config']['misc']>): MiscEffect[] {
        const forgeLimit = config.forgeLimit!;
        let currentType = status.forge?.currentType || config.forgeTypes![0];
        let count = status.forge?.count || 0;
        if (this.FORGE_LIMIT_PATTERN.test(response)) {
            const index = config.forgeTypes!.indexOf(currentType);
            if (index === config.forgeTypes!.length - 1)
                count = forgeLimit;
            else
                currentType = config.forgeTypes![index + 1];
        } else {
            count = readNumberAfter(response, '次数') ?? count;
        }
        const effects: MiscEffect[] = [{ type: 'patchStatus', status: { forge: { count, currentType } } }];
        if (count < forgeLimit)
            effects.push({ type: 'scheduleCommand', command: { type: 'misc_forge', body: `锻造 ${currentType}` }, delay: 1000 });
        else
            effects.push({ type: 'registerTypeScheduler', commandType: 'misc_forge' });
        return effects;
    }

    private transitionFightChain(key: 'randomCount' | 'masterCount' | 'challengeSectCount' | 'sectCount', count: number, limit: number, commandType: string, body: (count: number) => string, nextCommand?: Command): MiscEffect[] {
        const effects: MiscEffect[] = [{ type: 'patchStatus', status: { fight: { [key]: count } } as MiscStatus }];
        if (count < limit)
            effects.push({ type: 'scheduleCommand', command: { type: commandType, body: body(count) }, delay: 1000 });
        else if (nextCommand)
            effects.push({ type: 'scheduleCommand', command: nextCommand, delay: 1000 });
        else
            effects.push({ type: 'registerTypeScheduler', commandType });
        return effects;
    }

    private transitionFight(response: string, config: NonNullable<GameInstance['account']['config']['misc']>): MiscEffect[] {
        let nextTime = getDate({ dayOffset: 1 });
        if (this.FIGHT_PATTERN.test(response) || this.FIGHT_FREQUENCY_PATTERN.test(response))
            nextTime = new Date(Date.now() + 60 * 60 * 1000);
        else if (this.FIGHT_NOT_AVAILABLE_PATTERN.test(response))
            nextTime = getDate({ hours: 23 });
        return [
            { type: 'patchStatus', status: { fight: { nextTime } } },
            { type: 'scheduleCommand', command: { type: 'misc_fight', body: [{ str: '试剑', bytes_pb_reserve: null }, { str: config.fight?.target?.str!, bytes_pb_reserve: config.fight?.target?.bytes_pb_reserve! }], date: nextTime } },
        ];
    }

    private transitionSectTask(response: string, commandType: string): MiscEffect[] {
        const taskType = readBracketValue(response);
        if (!taskType)
            return this.done({ sect: { task: { inProgress: false, isFinished: true } } }, commandType);
        const { index, errors } = this.resolveTaskAnswer(taskType, response);
        return [
            ...errors.map(message => ({ type: 'logError', message }) as MiscEffect),
            { type: 'patchStatus', status: { sect: { task: { inProgress: true, isFinished: false } } } },
            { type: 'scheduleCommand', command: { type: 'misc_sectTask', body: `任务选择 ${index}` }, delay: 1000 },
        ];
    }

    private resolveTaskAnswer(taskType: string, response: string): { index: number; errors: string[] } {
        const task = this.TASK_DATABASE.get(taskType);
        if (!task)
            return { index: 1, errors: [`Task type ${taskType} not found, using default index 1`] };
        const answer = [...task.entries()].find(([, value]) => value.test(response))?.[0];
        if (!answer)
            return { index: 1, errors: [`Answer for task type ${taskType} not found, using default index 1`] };
        return { index: readAnswerIndex(response, answer) ?? 1, errors: [] };
    }

    async handleError(command: Command, error: Error, instance: GameInstance) {
        command.retries = (command.retries || 0) + 1;
        return command.retries! < 3 ? command : undefined;
    }

    public registerScheduler(instance: GameInstance): void {
        ['misc_signIn', 'misc_sendEnergy', 'misc_abode', 'misc_transmission', 'misc_kill', 'misc_challenge', 'misc_forge', 'misc_tower', 'misc_worship', 'misc_fightSect', 'misc_fight', 'misc_sectSignIn', 'misc_sectTask', 'misc_battleSignUp', 'misc_fightPet', 'misc_hell', 'misc_gift', 'misc_sectBlessing', 'misc_subscribe', 'misc_fortune', 'misc_levelUp', 'misc_receiveEnergy', 'misc_receiveTransmission', 'misc_receiveTaskReward', 'misc_receiveBlessing'].forEach(type =>
            this.registerTypeScheduler(instance, type));
    }

    public registerTypeScheduler(instance: GameInstance, type: string): void {
        const status = instance.account.status.misc;
        const config = instance.account.config.misc!;
        if (!config.enabled)
            return;
        switch (type) {
            case 'misc_signIn':
                instance.scheduleCommand({ type, body: '签到', date: getDate({ ...config.time, dayOffset: status?.signIn ? 1 : 0 }) });
                break;
            case 'misc_sendEnergy':
                instance.scheduleCommand({ type, body: '送能量', date: getDate({ ...config.time, dayOffset: status?.sendEnergy ? 1 : 0 }) });
                break;
            case 'misc_abode':
                instance.scheduleCommand({ type, body: '领每日能量', date: getDate({ ...config.time, dayOffset: status?.abode?.isFinished ? 1 : 0 }) });
                break;
            case 'misc_transmission':
                instance.scheduleCommand({ type, body: '传功', date: getDate({ ...config.time, dayOffset: status?.transmission ? 1 : 0 }) });
                break;
            case 'misc_kill':
                instance.scheduleCommand({ type, body: '砍一刀', date: getDate({ ...config.time, dayOffset: (status?.kill?.count || 0) >= 10 ? 1 : 0 }) });
                break;
            case 'misc_challenge':
                instance.scheduleCommand({ type, body: '挑战噬魂兽', date: getDate({ ...config.time, dayOffset: (status?.challenge?.count || 0) >= 3 ? 1 : 0 }) });
                break;
            case 'misc_forge':
                instance.scheduleCommand({ type, body: `锻造 ${config.forgeTypes![0]}`, date: getDate({ ...config.time, dayOffset: (status?.forge?.count || 0) >= config.forgeLimit! ? 1 : 0 }) });
                break;
            case 'misc_tower':
                instance.scheduleCommand({ type, body: '塔攻击', date: getDate({ ...config.time, dayOffset: (status?.tower?.count || 0) >= 5 ? 1 : 0 }) });
                break;
            case 'misc_worship':
                instance.scheduleCommand({ type, body: '膜拜排位 1', date: getDate({ ...config.time, dayOffset: (status?.worship?.count || 0) >= 10 ? 1 : 0 }) });
                break;
            case 'misc_fightSect':
                if (!config.fight?.enabled)
                    instance.scheduleCommand({ type: 'misc_fightRandom', body: '随机试剑 1', date: getDate({ ...config.time, dayOffset: (status?.fight?.randomCount || 0) >= 10 ? 1 : 0 }) });
                else
                    instance.scheduleCommand({ type: 'misc_fightMaster', body: '师门切磋 1', date: getDate({ ...config.time, dayOffset: (status?.fight?.masterCount || 0) >= 10 ? 1 : 0 }) });
                break;
            case 'misc_fight':
                if (config.fight?.enabled)
                    instance.scheduleCommand({ type, body: [{ str: '试剑', bytes_pb_reserve: null }, { str: config.fight?.target?.str!, bytes_pb_reserve: config.fight?.target?.bytes_pb_reserve! }], date: status?.fight?.nextTime });
                break;
            case 'misc_sectSignIn':
                instance.scheduleCommand({ type, body: '宗门签到', date: getDate({ ...config.time, dayOffset: status?.sect?.signIn ? 1 : 0 }) });
                break;
            case 'misc_sectTask':
                instance.scheduleCommand({ type, body: '开始宗门任务', date: getDate({ ...config.time, dayOffset: status?.sect?.task?.isFinished ? 1 : 0 }) });
                break;
            case 'misc_battleSignUp':
                instance.scheduleCommand({ type, body: '大混战报名', date: status?.battleSignUp?.isFinished ? getDate({ ...config.time, dayOffset: 1 }) : status?.battleSignUp?.nextTime });
                break;
            case 'misc_fightPet':
                if (config.fightPet?.enabled)
                    instance.scheduleCommand({ type, body: [{ str: '灵宠对决', bytes_pb_reserve: null }, { str: config.fightPet?.target?.str!, bytes_pb_reserve: config.fightPet?.target?.bytes_pb_reserve! }], date: status?.fightPet?.nextTime });
                break;
            case 'misc_hell':
                instance.scheduleCommand({ type, body: '地狱寻宝 10', date: getDate({ ...config.time, dayOffset: status?.hell?.isFinished ? 1 : 0 }) });
                break;
            case 'misc_gift':
                if (config.gift?.enabled)
                    instance.scheduleCommand({ type, body: `送礼物 ${config.gift.type}`, date: getDate({ ...config.time, dayOffset: status?.gift ? 1 : 0 }) });
                break;
            case 'misc_sectBlessing':
                if (config.sectBlessing)
                    instance.scheduleCommand({ type, body: '开启赐福', date: getDate({ ...config.time, dayOffset: status?.sect?.blessing ? 1 : 0 }) });
                break;
            case 'misc_subscribe':
                if (config.subscribe?.enabled)
                    instance.scheduleCommand({ type, body: `领灵石月卡 ${config.subscribe.type}`, date: getDate({ ...config.time, dayOffset: status?.subscribe ? 1 : 0 }) });
                break;
            case 'misc_fortune':
                instance.scheduleCommand({ type, body: '一键领福泽', date: getDate({ ...config.time, dayOffset: status?.fortune ? 1 : 0 }) });
                break;
            case 'misc_levelUp':
                if (config.levelUp?.enabled)
                    instance.scheduleCommand({ type, body: '提升境界', date: getDate({ ...config.time, dayOffset: status?.levelUp?.isFinished ? 1 : 0 }) });
                break;
            case 'misc_receiveEnergy':
                instance.scheduleCommand({ type, body: '领道友能量', date: getDate({ ...config.timePost, dayOffset: status?.receiveEnergy ? 1 : 0 }) });
                break;
            case 'misc_receiveTransmission':
                instance.scheduleCommand({ type, body: '接收传功', date: getDate({ ...config.timePost, dayOffset: status?.receiveTransmission ? 1 : 0 }) });
                break;
            case 'misc_receiveTaskReward':
                instance.scheduleCommand({ type, body: '一键领任务奖励', date: getDate({ ...config.timePost, dayOffset: status?.receiveTaskReward ? 1 : 0 }) });
                break;
            case 'misc_receiveBlessing':
                instance.scheduleCommand({ type, body: '接收赐福', date: getDate({ ...config.timePost, dayOffset: status?.receiveBlessing ? 1 : 0 }) });
                break;
        }
    }
}
