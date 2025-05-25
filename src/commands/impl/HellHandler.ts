// src/commands/impl/HellHandler.ts

export interface LevelData {
    boss: string;
    treasures: string[];
}

import { Command } from '../../server/types';
import { CommandHandler } from '../CommandHandler';
import { GameInstance } from '../../server/core/GameInstance';
import { logger } from '../../utils/logger';
import { getDate } from '../../utils/TimeUtils';



export default class HellHandler implements CommandHandler {
    readonly category = 'hell';
    readonly COMMAND_TYPE = new Map([
        ['地狱寻宝', 'hell'],
        ['提前领取地狱寻宝奖励', 'hell'],
    ]);
    readonly RESPONSE_PATTERN = /BOSS的位置|提前领取地狱寻宝奖励|领取成功|你今日已领过寻宝府石|地狱寻宝 10|府石已领取/;
    readonly FINISH_PATTERN = /府石已领取/;
    readonly LEVEL_PATTERN = /第(?<level>\d+)层/;
    readonly BOSS_POSITION_PATTERN = /BOSS的位置:(?<position>\d+-\d)/;
    readonly POSITION_PATTERN = /^[1-5]-[1-5]$/;

    private levelData: LevelData[] = [];
    private lastUpdateDate: Date | null = null;

    async handleResponse(command: Command, response: string, instance: GameInstance) {
        instance.account.status.hell = instance.account.status.hell || {};
        const config = instance.account.config.hell!;
        if (!this.FINISH_PATTERN.test(response) && (this.BOSS_POSITION_PATTERN.test(response) || this.LEVEL_PATTERN.test(response))) {
            const level = parseInt(response.match(this.LEVEL_PATTERN)?.groups?.level || '0') + 1;
            if (level <= 20) {
                try {
                    await this.getHellData();
                } catch (error) {
                    logger.error(`Failed to fetch hell data: ${(error as Error).message}`);
                    if (config.onFail)
                        instance.scheduleCommand({ type: 'hell', body: '地狱寻宝 10' });
                    return;
                }
                const levelData = this.levelData[level - 1];
                const attackBoss = config.maxLevel === undefined || config.maxLevel >= level;
                instance.updateStatus({ hell: { inProgress: true, isFinished: false, level, collected: false } });
                instance.scheduleCommand({ type: 'hell', body: `地狱寻宝 ${this.stringify(levelData, attackBoss)}` }, 1000);
            } else {
                instance.updateStatus({ hell: { inProgress: false, isFinished: true, level: 20, collected: false } });
                if (config.collect)
                    instance.scheduleCommand({ type: 'hell', body: '提前领取地狱寻宝奖励' });
            }
        } else {
            instance.updateStatus({ hell: { inProgress: false, isFinished: true, level: undefined, collected: true } });
            this.registerScheduler(instance);
        }
    }

    async handleError(command: Command, error: Error, instance: GameInstance) {
        command.retries = (command.retries || 0) + 1;
        return command.retries! < 3 ? command : undefined;
    }

    registerScheduler(instance: GameInstance) {
        const config = instance.account.config.hell!;
        if (!config.enabled)
            return;
        instance.scheduleCommand({ type: 'hell', body: '地狱寻宝', date: getDate({ ...config.time, dayOffset: instance.account.status.hell?.isFinished ? 1 : 0 }) });
    }

    private stringify(levelData: LevelData, attackBoss: boolean): string {
        return attackBoss ? `${levelData.boss} ${levelData.treasures.slice(0, 2).join(' ')}` : levelData.treasures.join(' ');
    }

    public async getHellData(): Promise<void> {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const lastUpdate = this.lastUpdateDate
            ? new Date(this.lastUpdateDate.getFullYear(), this.lastUpdateDate.getMonth(), this.lastUpdateDate.getDate()).getTime()
            : 0;

        if (this.lastUpdateDate && today === lastUpdate) return;

        try {
            const dateStr = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}`;
            const url = `https://xb.qiihao.com:8443/kv?base=xbhz${dateStr}`;
            const response = await fetch(url, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
            });

            if (!response.ok) throw new Error(`Fetch error: ${response.status} ${response.statusText}`);
            const data = await response.json();

            if (data.code !== 0) throw new Error(`API error: ${data.code} ${data.msg}`);

            this.levelData = Object.keys(data.data).map(key => ({
                boss: data.data[key].boss,
                treasures: data.data[key].bz
            }));

            if (this.levelData.length !== 20) throw new Error(`Invalid level data length: ${this.levelData.length}`);

            this.levelData.forEach((levelData, index) => {
                if (!this.POSITION_PATTERN.test(levelData.boss))
                    throw new Error(`Invalid boss position for level ${index + 1}: ${levelData.boss}`);
                if (levelData.treasures.some(pos => !this.POSITION_PATTERN.test(pos)))
                    throw new Error(`Invalid treasure position for level ${index + 1}: ${levelData.treasures.join(', ')}`);

                while (levelData.treasures.length < 3) {
                    const newPos = ['5-5', '5-4', '5-3', '5-2'].find(pos =>
                        pos !== levelData.boss && !levelData.treasures.includes(pos)
                    )!;
                    levelData.treasures.push(newPos);
                }
            });

            this.lastUpdateDate = new Date();
            logger.debug(`hell data updated successfully`);
        } catch (error) {
            logger.error(`Failed to fetch hell data: ${(error as Error).message}`);
            throw error;
        }
    }
}