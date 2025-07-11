// src/server/types.ts

import { z } from 'zod';

import { AccountManager } from './core/AccountManager';
import { InstanceManager } from './core/InstanceManager';
import { GameInstance } from './core/GameInstance';

export interface RouterDependencies {
    accountManager: AccountManager;
    instanceManager: InstanceManager;
}

export interface Account {
    id: string;
    encryptedPassword?: string;
    status: Status;
    online: boolean;
    session?: Array<{
        name: string;
        value: string;
        domain: string;
        path: string;
        expires: number;
    }>;
    metadata: {
        lastUpdateTime?: number;
    };
    config: Config;
}

export interface Command {
    type: string;
    body: MessageBody | string | ((instance: GameInstance) => Promise<string>);
    id?: string;
    retries?: number;
    date?: Date;
    timeoutId?: NodeJS.Timeout;
    resolve?: (value: string) => void;
    reject?: (reason: Error) => void;
}

const PersonalInfoSchema = z.object({
    level: z.number().optional().describe('角色等级'),
    str: z.string().optional().describe('角色ID'),
    bytes_pb_reserve: z.string().optional().describe('角色引用'),
}).describe('个人信息');

const MeditationStatusSchema = z.object({
    inProgress: z.boolean().optional().describe('进行中'),
    finishTime: z.coerce.date().optional().describe('结束时刻'),
    exhausted: z.boolean().optional().describe('体力不足'),
    target: z.object({
        str: z.string().optional().describe('双修目标ID'),
        bytes_pb_reserve: z.string().optional().describe('双修目标引用'),
    }).optional().describe('双修目标'),
}).describe('打坐状态');

const GardenStatusSchema = z.object({
    inProgress: z.boolean().optional().describe('进行中'),
    finishTime: z.coerce.date().optional().describe('结束时刻'),
    noSeeds: z.boolean().optional().describe('种子不足'),
    ripen: z.object({
        ripeCount: z.number().optional().describe('剩余催熟次数'),
        noSeeds: z.boolean().optional().describe('种子不足'),
    }).optional().describe('催熟状态'),
}).describe('种田状态');

const BountyStatusSchema = z.object({
    accepted: z.number().optional().describe('已接受悬赏数量'),
    limit: z.number().optional().describe('悬赏数量上限'),
    updateTime: z.coerce.date().optional().describe('悬赏更新时刻'),
    claimTimes: z.array(z.coerce.date()).optional().describe('悬赏领取时刻'),
}).describe('悬赏状态');

const SecretRealmStatusSchema = z.object({
    inProgress: z.boolean().optional().describe('进行中'),
    isFinished: z.boolean().optional().describe('已完成'),
    monsterLevel: z.string().optional().describe('怪物等级'),
    skill: z.object({
        index: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional().describe('技能索引'),
        name: z.string().optional().describe('技能名称'),
        type: z.enum(['攻击', '防御', '血量', '免伤']).optional().describe('技能类型'),
        strength: z.number().optional().describe('技能强度'),
    }).optional().describe('技能信息'),
}).describe('秘境状态');

const ZooStatusSchema = z.object({
    inProgress: z.boolean().optional().describe('进行中'),
    isFinished: z.boolean().optional().describe('已完成'),
    remaining: z.number().optional().describe('剩余妖兽数量'),
    choice: z.enum(['横扫', '力劈', '逃跑']).optional().describe('进攻选择'),
}).describe('妖兽园状态');

const DreamlandStatusSchema = z.object({
    inProgress: z.boolean().optional().describe('进行中'),
    isFinished: z.boolean().optional().describe('已完成'),
    level: z.number().optional().describe('角色等级'),
    monsterLevels: z.array(z.union([z.number(), z.undefined()])).optional().describe('怪物等级'),
    doorIndex: z.number().optional().describe('生门索引'),
}).describe('幻境状态');

const FishingStatusSchema = z.object({
    inProgress: z.boolean().optional().describe('进行中'),
    finishedCount: z.number().optional().describe('完成次数'),
    bait: z.number().optional().describe('鱼饵数量'),
    position: z.number().optional().describe('甩杆位置'),
    pullTime: z.coerce.date().optional().describe('拉杆时刻'),
}).describe('钓鱼状态');

const WoodingStatusSchema = z.object({
    inProgress: z.boolean().optional().describe('进行中'),
    finishedCount: z.number().optional().describe('完成次数'),
    waterTime: z.coerce.date().optional().describe('浇水时刻'),
    price: z.number().optional().describe('当前木商价格'),
    amount: z.number().optional().describe('木块数量'),
    priceUpdateTime: z.coerce.date().optional().describe('价格更新时刻'),
}).describe('种树状态');

const HellStatusSchema = z.object({
    inProgress: z.boolean().optional().describe('进行中'),
    isFinished: z.boolean().optional().describe('已完成'),
    level: z.number().optional().describe('当前层数'),
    collected: z.boolean().optional().describe('已收集府石'),
}).describe('地狱寻宝状态');

const FortuneStatusSchema = z.object({
    occupation: z.boolean().optional().describe('占领矿山'),
    realmDraw: z.boolean().optional().describe('三界抽气运'),
    levelDraw: z.boolean().optional().describe('境界抽气运'),
    realmWar: z.boolean().optional().describe('三界战'),
    levelWar: z.boolean().optional().describe('仙圣道战'),
    sectWar: z.boolean().optional().describe('宗门混战'),
}).describe('气运争夺战状态');

const MiscStatusSchema = z.object({
    signIn: z.boolean().optional().describe('签到'),
    sendEnergy: z.boolean().optional().describe('送能量'),
    receiveEnergy: z.boolean().optional().describe('领道友能量'),
    abode: z.object({
        inProgress: z.boolean().optional().describe('进行中'),
        isFinished: z.boolean().optional().describe('已完成'),
    }).optional().describe('洞府状态'),
    transmission: z.boolean().optional().describe('传功'),
    receiveTransmission: z.boolean().optional().describe('接收传功'),
    receiveTaskReward: z.boolean().optional().describe('领取任务奖励'),
    receiveBlessing: z.boolean().optional().describe('接收赐福'),
    kill: z.object({
        count: z.number().optional().describe('一刀斩次数'),
    }).optional().describe('一刀斩状态'),
    challenge: z.object({
        count: z.number().optional().describe('挑战次数'),
    }).optional().describe('挑战噬魂兽状态'),
    forge: z.object({
        count: z.number().optional().describe('锻造次数'),
        currentType: z.number().optional().describe('当前锻造类型索引'),
    }).optional().describe('锻造状态'),
    tower: z.object({
        count: z.number().optional().describe('塔攻击次数'),
    }).optional().describe('通天塔状态'),
    worship: z.object({
        count: z.number().optional().describe('膜拜次数'),
    }).optional().describe('膜拜状态'),
    fight: z.object({
        randomCount: z.number().optional().describe('随机试剑次数'),
        masterCount: z.number().optional().describe('师门切磋次数'),
        challengeSectCount: z.number().optional().describe('宗门挑战次数'),
        sectCount: z.number().optional().describe('宗门切磋次数'),
        nextTime: z.coerce.date().optional().describe('下次试剑时间'),
    }).optional().describe('试剑状态'),
    sect: z.object({
        signIn: z.boolean().optional().describe('宗门签到'),
        task: z.object({
            inProgress: z.boolean().optional().describe('进行中'),
            isFinished: z.boolean().optional().describe('已完成'),
        }).optional().describe('宗门任务状态'),
    }).optional().describe('宗门状态'),
    battleSignUp: z.object({
        inProgress: z.boolean().optional().describe('进行中'),
        isFinished: z.boolean().optional().describe('已完成'),
        nextTime: z.coerce.date().optional().describe('下次报名时间'),
    }).optional().describe('大混战报名状态'),
    capsule: z.object({
        inProgress: z.boolean().optional().describe('进行中'),
        isFinished: z.boolean().optional().describe('已完成'),
    }).optional().describe('扭蛋状态'),
}).describe('日常状态');

export const StatusSchema = z.object({
    personalInfo: PersonalInfoSchema.optional(),
    meditation: MeditationStatusSchema.optional(),
    garden: GardenStatusSchema.optional(),
    bounty: BountyStatusSchema.optional(),
    secretRealm: SecretRealmStatusSchema.optional(),
    zoo: ZooStatusSchema.optional(),
    dreamland: DreamlandStatusSchema.optional(),
    fishing: FishingStatusSchema.optional(),
    wooding: WoodingStatusSchema.optional(),
    hell: HellStatusSchema.optional(),
    fortune: FortuneStatusSchema.optional(),
    misc: MiscStatusSchema.optional(),
}).describe('账户状态');

export type Status = z.infer<typeof StatusSchema>;

const MetadataConfigSchema = z.object({
    channelUrl: z.string().optional().describe('频道URL'),
}).describe('元数据配置');

const MeditationConfigSchema = z.object({
    enabled: z.boolean().optional().describe('启用自动打坐'),
    time: z.object({
        hours: z.number().min(0).max(23).optional(),
        minutes: z.number().min(0).max(59).optional(),
        seconds: z.number().min(0).max(59).optional(),
    }).optional().describe('开始时刻'),
    count: z.union([
        z.literal(1),
        z.literal(10),
        z.literal(20),
        z.literal(30),
        z.literal(40),
        z.literal(50),
    ]).optional().describe('打坐次数'),
    tantric: z.object({
        enabled: z.boolean().optional().describe('启用双修'),
        targets: z.array(z.string()).optional().describe('双修目标引用'),
        autoMeditation: z.boolean().optional().describe('所有目标没体力时自动打坐'),
    }).optional().describe('双修配置'),

}).describe('打坐配置');

const GardenConfigSchema = z.object({
    enabled: z.boolean().optional().describe('启用自动种田'),
    seedType: z.enum(['仙露草种子', '灵芝种子', '九叶灵草种子', '龙木种子', '星露种子']).optional().describe('种子类型'),
    ripen: z.object({
        enabled: z.boolean().optional().describe('启用催熟'),
        seedType: z.enum(['仙露草种子', '灵芝种子', '九叶灵草种子', '龙木种子', '星露种子']).optional().describe('催熟种子类型'),
    }).optional().describe('催熟配置'),
}).describe('种田配置');

const BountyConfigSchema = z.object({
    enabled: z.boolean().optional().describe('启用自动悬赏'),
    bountyTypes: z.array(z.string()).optional().describe('悬赏类型'),
}).describe('悬赏配置');

const SecretRealmConfigSchema = z.object({
    enabled: z.boolean().optional().describe('启用自动秘境'),
    time: z.object({
        hours: z.number().min(0).max(23).optional(),
        minutes: z.number().min(0).max(59).optional(),
        seconds: z.number().min(0).max(59).optional(),
    }).optional().describe('进入时刻'),
    skillTypePriority: z.array(z.string()).optional().describe('技能类型优先级'),
}).describe('秘境配置');

const ZooConfigSchema = z.object({
    enabled: z.boolean().optional().describe('启用自动妖兽园'),
    time: z.object({
        hours: z.number().min(0).max(23).optional(),
        minutes: z.number().min(0).max(59).optional(),
        seconds: z.number().min(0).max(59).optional(),
    }).optional().describe('进入时刻'),
    autoEscape: z.boolean().optional().describe('自动逃跑'),
}).describe('妖兽园配置');

const DreamlandConfigSchema = z.object({
    enabled: z.boolean().optional().describe('启用自动幻境'),
    time: z.object({
        hours: z.number().min(0).max(23).optional(),
        minutes: z.number().min(0).max(59).optional(),
        seconds: z.number().min(0).max(59).optional(),
    }).optional().describe('进入时刻'),
}).describe('幻境配置');

const FishingConfigSchema = z.object({
    enabled: z.boolean().optional().describe('启用自动钓鱼'),
    time: z.object({
        hours: z.number().min(0).max(23).optional(),
        minutes: z.number().min(0).max(59).optional(),
        seconds: z.number().min(0).max(59).optional(),
    }).optional().describe('进入时刻'),
    levels: z.array(z.number()).optional().describe('鱼塘等级'),
}).describe('钓鱼配置');

const WoodingConfigSchema = z.object({
    enabled: z.boolean().optional().describe('启用自动种树'),
    time: z.object({
        hours: z.number().min(0).max(23).optional(),
        minutes: z.number().min(0).max(59).optional(),
        seconds: z.number().min(0).max(59).optional(),
    }).optional().describe('进入时刻'),
    levels: z.array(z.number()).optional().describe('林场等级'),
    minPrice: z.number().optional().describe('最低出售价格'),
}).describe('种树配置');

const HellConfigSchema = z.object({
    enabled: z.boolean().optional().describe('启用自动地狱寻宝'),
    time: z.object({
        hours: z.number().min(0).max(23).optional(),
        minutes: z.number().min(0).max(59).optional(),
        seconds: z.number().min(0).max(59).optional(),
    }).optional().describe('进入时刻'),
    maxLevel: z.number().optional().describe('最大攻击BOSS层数'),
    collect: z.boolean().optional().describe('自动收集'),
    onFail: z.boolean().optional().describe('获取数据失败时十连寻宝')
}).describe('地狱寻宝配置');

const FortuneConfigSchema = z.object({
    enabled: z.boolean().optional().describe('启用自动气运争夺战'),
    time: z.object({
        hours: z.number().min(0).max(23).optional(),
        minutes: z.number().min(0).max(59).optional(),
        seconds: z.number().min(0).max(59).optional(),
    }).optional().describe('运行时刻'),
    occupation: z.number().optional().describe('矿山索引'),
    realmWar: z.string().optional().describe('三界战位置'),
    levelWar: z.string().optional().describe('仙圣道战位置'),
}).describe('气运争夺战配置');

const MiscConfigSchema = z.object({
    enabled: z.boolean().optional().describe('启用自动日常'),
    time: z.object({
        hours: z.number().min(0).max(23).optional(),
        minutes: z.number().min(0).max(59).optional(),
        seconds: z.number().min(0).max(59).optional(),
    }).optional().describe('运行时刻'),
    timePost: z.object({
        hours: z.number().min(0).max(23).optional(),
        minutes: z.number().min(0).max(59).optional(),
        seconds: z.number().min(0).max(59).optional(),
    }).optional().describe('延迟命令运行时刻'),
    forgeLimit: z.number().optional().describe('锻造次数'),
    forgeTypes: z.array(z.number()).optional().describe('锻造类型优先级'),
    fight: z.object({
        enabled: z.boolean().optional().describe('启用固定试剑'),
        target: z.object({
            str: z.string().optional().describe('试剑目标ID'),
            bytes_pb_reserve: z.string().optional().describe('试剑目标引用'),
        }).optional().describe('试剑目标'),
    }).optional().describe('试剑配置')
}).describe('日常配置');

export const ConfigSchema = z.object({
    metadata: MetadataConfigSchema.optional(),
    meditation: MeditationConfigSchema.optional(),
    garden: GardenConfigSchema.optional(),
    bounty: BountyConfigSchema.optional(),
    secretRealm: SecretRealmConfigSchema.optional(),
    zoo: ZooConfigSchema.optional(),
    dreamland: DreamlandConfigSchema.optional(),
    fishing: FishingConfigSchema.optional(),
    wooding: WoodingConfigSchema.optional(),
    hell: HellConfigSchema.optional(),
    fortune: FortuneConfigSchema.optional(),
    misc: MiscConfigSchema.optional(),
}).describe('自动化配置');

export type Config = z.infer<typeof ConfigSchema>;

export type MessageBody = Array<{
    str: string;
    bytes_pb_reserve: string | null;
}>;