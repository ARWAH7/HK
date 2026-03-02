import { saveBlock, publishBlock, getStats, redis, REDIS_KEYS } from './redis';
import WebSocket from 'ws';

// Alchemy WebSocket 配置
const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY || '';
const TRON_GRID_BASE = "https://api.trongrid.io";
const TRON_GRID_API_KEY = "107f1e35-65c2-49ef-bc7d-30120a5864ef";

interface BlockData {
  height: number;
  hash: string;
  timestamp: number;
  resultValue: number;
  type: 'ODD' | 'EVEN';
  sizeType: 'BIG' | 'SMALL';
}

export class TronBlockListener {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectDelay = 1000;
  private lastProcessedHeight = 0;
  private missingBlockCheckInterval: NodeJS.Timeout | null = null;
  private wsHealthCheckInterval: NodeJS.Timeout | null = null;
  private lastWsMessageTime = 0; // 上次收到 WS 消息的时间

  // 全局限流控制
  private isFillingGaps = false; // 是否正在补全缺失区块
  private lastApiCallTime = 0;   // 上次 API 调用时间
  private minApiInterval = 250;  // 最小 API 调用间隔（初始 250ms，约 4 个/秒）
  private baseApiInterval = 250; // 基础 API 调用间隔
  private rateLimitHitCount = 0; // 遇到 429 错误的次数

  // 全量扫描控制
  private hasReceivedFirstBlock = false; // 是否已接收到第一个实时区块
  private firstRealTimeBlockHeight = 0;  // 第一个实时区块的高度
  private fullScanCompleted = false;     // 全量扫描是否已完成

  constructor(private apiKey: string) {}
  
  async start() {
    if (!this.apiKey) {
      console.error('[TRON Listener] ❌ 缺少 Alchemy API Key');
      return;
    }
    
    // 连接 WebSocket（实时获取新区块）
    this.connect();
    
    // 启动定期缺失区块检测
    this.startMissingBlockCheck();
  }
  
  private connect() {
    try {
      const url = `wss://tron-mainnet.g.alchemy.com/v2/${this.apiKey}`;
      this.ws = new WebSocket(url);
      
      this.ws.on('open', () => {
        console.log('[TRON Listener] ✅ 连接到 Alchemy WebSocket');
        this.reconnectAttempts = 0;
        this.lastWsMessageTime = Date.now();

        // 订阅新区块
        this.ws?.send(JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_subscribe',
          params: ['newHeads']
        }));

        // 启动 WS 健康检测（TRON 约 3 秒出一个块，超过 30 秒无消息视为连接异常）
        this.startWsHealthCheck();
      });

      this.ws.on('message', async (data: Buffer) => {
        try {
          this.lastWsMessageTime = Date.now();
          const message = JSON.parse(data.toString());

          if (message.method === 'eth_subscription') {
            const rawBlock = message.params.result;
            const block = this.parseBlock(rawBlock);

            // 如果是第一个实时区块，触发全量扫描
            if (!this.hasReceivedFirstBlock) {
              this.hasReceivedFirstBlock = true;
              this.firstRealTimeBlockHeight = block.height;
              console.log(`[TRON Listener] 📡 接收到第一个实时区块: ${block.height}`);
              console.log(`[TRON Listener] 🔍 将从 ${block.height} 往旧数据扫描，检测缺失...`);

              // 异步执行全量扫描，不阻塞实时数据处理
              this.performFullScanFromRealTimeBlock(block.height).catch(err =>
                console.error('[全量扫描] 异步扫描失败:', err)
              );
            }

            console.log(`[TRON Listener] 📦 新区块: ${block.height} (${block.type}, ${block.sizeType})`);

            // 先捕获缺失区块范围（在更新 lastProcessedHeight 之前），避免竞态
            const prevHeight = this.lastProcessedHeight;

            // 立即更新最后处理的区块高度（防止异步补全回退该值）
            if (block.height > this.lastProcessedHeight) {
              this.lastProcessedHeight = block.height;
            }

            // 优先保存和发布当前实时区块（不被缺失补全阻塞）
            const startTime = Date.now();

            // 保存到 Redis
            await saveBlock(block);
            const saveTime = Date.now() - startTime;

            // 发布到 Pub/Sub
            await publishBlock(block);
            const publishTime = Date.now() - startTime - saveTime;

            // 缺失区块检测 - 使用之前捕获的高度，异步执行
            if (prevHeight > 0 && block.height > prevHeight + 1) {
              const missingStart = prevHeight + 1;
              const missingEnd = block.height - 1;
              console.warn(`[缺失检测] ⚠️ 检测到 ${missingEnd - missingStart + 1} 个缺失区块: ${missingStart} - ${missingEnd}`);
              this.fillMissingBlocks(missingStart, missingEnd).catch(err =>
                console.error('[缺失检测] 异步补全失败:', err)
              );
            }

            console.log(`[性能] 保存: ${saveTime}ms, 发布: ${publishTime}ms, 总计: ${Date.now() - startTime}ms`);
          }
        } catch (error) {
          console.error('[TRON Listener] 解析消息失败:', error);
        }
      });

      this.ws.on('close', () => {
        console.log('[TRON Listener] ❌ 连接关闭');
        this.stopWsHealthCheck();
        this.reconnect();
      });

      this.ws.on('error', (error) => {
        console.error('[TRON Listener] 错误:', error);
      });

      // 设置 ping 保持连接活跃
      this.ws.on('pong', () => {
        this.lastWsMessageTime = Date.now();
      });
      
    } catch (error) {
      console.error('[TRON Listener] 连接失败:', error);
      this.reconnect();
    }
  }
  
  private reconnect() {
    this.reconnectAttempts++;
    // 指数退避，但上限为 30 秒（确保永远不会放弃重连）
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 30000);

    console.log(`[TRON Listener] 🔄 ${delay}ms 后重连 (第 ${this.reconnectAttempts} 次)`);

    setTimeout(() => {
      this.connect();
    }, delay);
  }

  // Alchemy WebSocket 健康检测：TRON 约 3 秒出一个块，超过 30 秒无消息则主动断开重连
  private startWsHealthCheck() {
    this.stopWsHealthCheck();
    this.wsHealthCheckInterval = setInterval(() => {
      if (!this.ws) return;

      const silentMs = Date.now() - this.lastWsMessageTime;

      // 发送 ping 保持活跃
      if (this.ws.readyState === WebSocket.OPEN) {
        try { this.ws.ping(); } catch (_) { /* ignore */ }
      }

      // 超过 60 秒没有任何消息（包括 pong），主动断开重连
      if (silentMs > 60000) {
        console.warn(`[WS 健康] ⚠️ 超过 ${Math.round(silentMs / 1000)} 秒无消息，主动断开重连`);
        try { this.ws.terminate(); } catch (_) { /* ignore */ }
      }
    }, 15000); // 每 15 秒检测一次
  }

  private stopWsHealthCheck() {
    if (this.wsHealthCheckInterval) {
      clearInterval(this.wsHealthCheckInterval);
      this.wsHealthCheckInterval = null;
    }
  }
  
  private parseBlock(rawBlock: any): BlockData {
    const height = parseInt(rawBlock.number, 16);
    const hash = rawBlock.hash;
    const timestamp = parseInt(rawBlock.timestamp, 16);
    
    // 从 Hash 中提取最后一个数字（与前端逻辑一致）
    const resultValue = this.deriveResultFromHash(hash);
    const type = resultValue % 2 === 0 ? 'EVEN' : 'ODD';
    const sizeType = resultValue >= 5 ? 'BIG' : 'SMALL';
    
    return {
      height,
      hash,
      timestamp,
      resultValue,
      type,
      sizeType,
    };
  }
  
  // 从 Hash 中提取结果值（与前端 apiHelpers.ts 中的逻辑一致）
  private deriveResultFromHash(hash: string): number {
    if (!hash) return 0;
    const digits = hash.match(/\d/g);
    if (digits && digits.length > 0) {
      return parseInt(digits[digits.length - 1], 10);
    }
    return 0;
  }
  
  // 检测并填补缺失的区块
  private async checkAndFillMissingBlocks(currentHeight: number) {
    try {
      // 如果是第一次处理，不检查缺失
      if (this.lastProcessedHeight === 0) {
        this.lastProcessedHeight = currentHeight;
        return;
      }
      
      // 检查是否有缺失的区块
      const expectedHeight = this.lastProcessedHeight + 1;
      if (currentHeight > expectedHeight) {
        const missingCount = currentHeight - expectedHeight;
        console.warn(`[缺失检测] ⚠️ 检测到 ${missingCount} 个缺失区块: ${expectedHeight} - ${currentHeight - 1}`);
        
        // 补全缺失的区块
        await this.fillMissingBlocks(expectedHeight, currentHeight - 1);
      }
    } catch (error) {
      console.error('[缺失检测] 检测失败:', error);
    }
  }
  
  // 补全缺失的区块（优化版：支持并发处理，按高度顺序发布）
  private async fillMissingBlocks(startHeight: number, endHeight: number) {
    try {
      console.log(`[区块补全] 🔧 开始补全区块: ${startHeight} - ${endHeight}`);

      const missingCount = endHeight - startHeight + 1;

      // 如果缺失太多，只补全最近的 200 个
      const maxToFill = 200;
      const actualStart = missingCount > maxToFill ? endHeight - maxToFill + 1 : startHeight;

      if (actualStart > startHeight) {
        console.warn(`[区块补全] ⚠️ 缺失区块过多 (${missingCount}个)，只补全最近的 ${maxToFill} 个`);
      }

      // 使用并发批量获取，提高补全速度
      const batchSize = 10; // 每批处理 10 个区块
      const heights = [];
      for (let height = actualStart; height <= endHeight; height++) {
        heights.push(height);
      }

      let successCount = 0;
      let failCount = 0;

      // 分批并发处理
      for (let i = 0; i < heights.length; i += batchSize) {
        const batch = heights.slice(i, i + batchSize);

        // 并发获取这一批区块
        const promises = batch.map(height =>
          this.fetchBlockByHeight(height)
            .then(async block => {
              if (block) {
                // 只保存，不立即发布（等批次完成后按顺序发布）
                await saveBlock(block);
                return block;
              } else {
                failCount++;
                console.error(`[区块补全] ❌ 补全区块 ${height} 失败`);
                return null;
              }
            })
            .catch(error => {
              failCount++;
              console.error(`[区块补全] ❌ 补全区块 ${height} 失败:`, error);
              return null;
            })
        );

        // 等待这一批完成
        const results = await Promise.all(promises);

        // 按高度升序排序后再发布，确保前端收到的区块顺序正确
        const successBlocks = results.filter(Boolean).sort((a, b) => a!.height - b!.height);
        for (const block of successBlocks) {
          await publishBlock(block!);
          successCount++;
          console.log(`[区块补全] ✅ 补全区块: ${block!.height} (${successCount}/${heights.length})`);
        }

        // 批次间隔，避免请求过快
        if (i + batchSize < heights.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      // 仅在 endHeight 更大时更新，避免回退实时区块已推进的高度
      if (endHeight > this.lastProcessedHeight) {
        this.lastProcessedHeight = endHeight;
      }

      console.log(`[区块补全] ✅ 补全完成: ${actualStart} - ${endHeight}`);
      console.log(`[区块补全] 📊 成功: ${successCount}, 失败: ${failCount}, 总计: ${heights.length}`);
    } catch (error) {
      console.error('[区块补全] ❌ 补全失败:', error);
    }
  }
  
  // 从 TronGrid API 获取指定高度的区块
  private async fetchBlockByHeight(height: number): Promise<BlockData | null> {
    // 全局限流：确保两次 API 调用之间至少间隔 minApiInterval
    const now = Date.now();
    const timeSinceLastCall = now - this.lastApiCallTime;
    if (timeSinceLastCall < this.minApiInterval) {
      const waitTime = this.minApiInterval - timeSinceLastCall;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    const maxRetries = 5;
    const baseDelay = 1000; // 基础延迟 1 秒
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // 更新最后调用时间
        this.lastApiCallTime = Date.now();
        
        const response = await fetch(`${TRON_GRID_BASE}/wallet/getblockbynum`, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json; charset=utf-8',
            'TRON-PRO-API-KEY': TRON_GRID_API_KEY
          },
          body: JSON.stringify({ num: height })
        });
        
        if (response.status === 429) {
          // 遇到速率限制，动态调整请求速率
          this.rateLimitHitCount++;
          const oldInterval = this.minApiInterval;
          this.minApiInterval = Math.floor(this.minApiInterval * 1.5); // 增加 50%
          
          console.warn(`[速率限制] ⚠️ 遇到 429 错误 (第 ${this.rateLimitHitCount} 次)`);
          console.warn(`[速率限制] 📉 调整请求间隔: ${oldInterval}ms → ${this.minApiInterval}ms (增加 50%)`);
          console.warn(`[速率限制] 📊 新请求速率: ~${(1000 / this.minApiInterval).toFixed(2)} 个/秒`);
          
          // 等待后重试
          const delay = baseDelay * Math.pow(2, attempt);
          console.warn(`[TronGrid] ${delay}ms 后重试 (${attempt + 1}/${maxRetries}) - 区块 ${height}`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        if (!response.ok) {
          throw new Error(`HTTP Error: ${response.status}`);
        }
        
        const data: any = await response.json();
        
        if (!data.blockID) {
          throw new Error(`Block ${height} not found`);
        }
        
        const hash = data.blockID;
        const timestamp = data.block_header.raw_data.timestamp;
        const resultValue = this.deriveResultFromHash(hash);
        const type = resultValue % 2 === 0 ? 'EVEN' : 'ODD';
        const sizeType = resultValue >= 5 ? 'BIG' : 'SMALL';
        
        // 请求成功，如果速率限制次数较多，逐步恢复速率
        if (this.rateLimitHitCount > 0 && this.minApiInterval > this.baseApiInterval) {
          // 每 10 次成功请求，尝试恢复 10% 的速率
          if (Math.random() < 0.1) {
            const oldInterval = this.minApiInterval;
            this.minApiInterval = Math.max(
              this.baseApiInterval,
              Math.floor(this.minApiInterval * 0.9)
            );
            if (oldInterval !== this.minApiInterval) {
              console.log(`[速率恢复] 📈 调整请求间隔: ${oldInterval}ms → ${this.minApiInterval}ms (恢复 10%)`);
              console.log(`[速率恢复] 📊 新请求速率: ~${(1000 / this.minApiInterval).toFixed(2)} 个/秒`);
            }
          }
        }
        
        return {
          height,
          hash,
          timestamp: Math.floor(timestamp / 1000), // 转换为秒
          resultValue,
          type,
          sizeType,
        };
      } catch (error) {
        console.error(`[TronGrid] 获取区块 ${height} 失败 (尝试 ${attempt + 1}/${maxRetries}):`, error);
        
        // 如果不是429错误，直接返回失败
        if (error instanceof Error && !error.message.includes('429')) {
          return null;
        }
        
        // 如果是429错误，继续重试
        if (attempt < maxRetries - 1) {
          const delay = baseDelay * Math.pow(2, attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    console.error(`[TronGrid] 获取区块 ${height} 失败，已达到最大重试次数`);
    return null;
  }
  
  // 从实时区块开始执行全量扫描
  private async performFullScanFromRealTimeBlock(realTimeHeight: number) {
    try {
      console.log('[全量扫描] 🔍 开始从实时区块往旧数据扫描...');
      console.log(`[全量扫描] 📊 实时区块高度: ${realTimeHeight}`);
      
      // 获取 Redis 中的最新区块高度
      const stats = await getStats();
      const redisLatestHeight = stats.latestHeight;
      
      console.log(`[全量扫描] 📊 Redis 最新区块: ${redisLatestHeight}`);
      
      // 1. 先检测 Redis 最新高度到实时高度之间的缺失（末尾缺失）
      if (realTimeHeight > redisLatestHeight) {
        const missingCount = realTimeHeight - redisLatestHeight;
        console.warn(`[全量扫描] ⚠️ 检测到末尾缺失 ${missingCount} 个区块: ${redisLatestHeight + 1} - ${realTimeHeight - 1}`);
        
        // 等待中间缺失补全完成
        await this.waitForGapFillingComplete();
        
        console.log(`[全量扫描] 🔧 开始补全末尾缺失区块...`);
        await this.fillMissingBlocksAsync(redisLatestHeight + 1, realTimeHeight - 1);
      } else {
        console.log(`[全量扫描] ✅ 末尾数据完整，无缺失区块`);
      }
      
      // 2. 扫描数据库中间是否有缺失
      console.log('[全量扫描] 🔍 开始扫描数据库中的所有区块，检测中间缺失...');
      const internalGaps = await this.scanForInternalGaps();
      
      if (internalGaps.length > 0) {
        console.warn(`[全量扫描] ⚠️ 检测到数据库中间有 ${internalGaps.length} 个缺失区间`);
        
        // 等待之前的补全任务完成
        await this.waitForGapFillingComplete();
        
        // 从最新的缺失区间开始补全
        for (let i = internalGaps.length - 1; i >= 0; i--) {
          const gap = internalGaps[i];
          console.log(`[全量扫描] 🔧 补全中间缺失区间 ${internalGaps.length - i}/${internalGaps.length}: ${gap.start} - ${gap.end} (${gap.count} 个区块)`);
          
          // 等待之前的补全任务完成
          await this.waitForGapFillingComplete();
          
          // 异步补全这个区间
          await this.fillMissingBlocksAsync(gap.start, gap.end);
        }
      } else {
        console.log('[全量扫描] ✅ 数据库中间数据完整，无缺失区块');
      }
      
      this.fullScanCompleted = true;
      console.log('[全量扫描] ✅ 全量扫描完成');
    } catch (error) {
      console.error('[全量扫描] ❌ 扫描失败:', error);
    }
  }
  
  // 等待补全任务完成
  private async waitForGapFillingComplete(): Promise<void> {
    if (!this.isFillingGaps) {
      return;
    }
    
    console.log('[全量扫描] ⏳ 等待当前补全任务完成...');
    
    // 最多等待 5 分钟
    const maxWaitTime = 5 * 60 * 1000;
    const startTime = Date.now();
    
    while (this.isFillingGaps && (Date.now() - startTime) < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    if (this.isFillingGaps) {
      console.warn('[全量扫描] ⚠️ 等待超时，继续执行');
    } else {
      console.log('[全量扫描] ✅ 补全任务已完成，继续扫描');
    }
  }
  
  // 扫描数据库中的所有区块，检测中间缺失
  private async scanForInternalGaps(): Promise<Array<{ start: number; end: number; count: number }>> {
    try {
      // 从 Redis 获取所有区块高度
      const heights = await this.getAllBlockHeights();
      
      if (heights.length === 0) {
        console.log('[缺失扫描] ℹ️ 数据库中暂无数据');
        return [];
      }
      
      console.log(`[缺失扫描] 📊 数据库中共有 ${heights.length} 个区块`);
      console.log(`[缺失扫描] 📊 区块高度范围: ${heights[0]} - ${heights[heights.length - 1]}`);
      
      // 检测缺失区间
      const gaps: Array<{ start: number; end: number; count: number }> = [];
      
      for (let i = 0; i < heights.length - 1; i++) {
        const currentHeight = heights[i];
        const nextHeight = heights[i + 1];
        
        // 如果两个区块之间有缺失
        if (nextHeight - currentHeight > 1) {
          const gapStart = currentHeight + 1;
          const gapEnd = nextHeight - 1;
          const gapCount = gapEnd - gapStart + 1;
          
          gaps.push({
            start: gapStart,
            end: gapEnd,
            count: gapCount
          });
          
          console.warn(`[缺失扫描] ⚠️ 发现缺失区间: ${gapStart} - ${gapEnd} (${gapCount} 个区块)`);
        }
      }
      
      if (gaps.length === 0) {
        console.log('[缺失扫描] ✅ 数据库中间数据连续，无缺失区块');
      } else {
        console.warn(`[缺失扫描] ⚠️ 共发现 ${gaps.length} 个缺失区间，总计 ${gaps.reduce((sum, gap) => sum + gap.count, 0)} 个缺失区块`);
      }
      
      return gaps;
    } catch (error) {
      console.error('[缺失扫描] ❌ 扫描失败:', error);
      return [];
    }
  }
  
  // 获取数据库中所有区块的高度（按升序排序）
  private async getAllBlockHeights(): Promise<number[]> {
    try {
      // 从 Redis 有序集合中获取所有区块高度
      const heights = await redis.zrange(REDIS_KEYS.BLOCKS, 0, -1);
      
      // 转换为数字并排序
      const numericHeights = heights.map(h => parseInt(h, 10)).sort((a, b) => a - b);
      
      return numericHeights;
    } catch (error) {
      console.error('[获取区块高度] ❌ 失败:', error);
      return [];
    }
  }
  
  // 异步补全缺失区块（不阻塞主流程，只保存不推送，避免乱序）
  private async fillMissingBlocksAsync(startHeight: number, endHeight: number) {
    // 检查是否已经有补全任务在运行
    if (this.isFillingGaps) {
      console.log(`[后台补全] ⏳ 已有补全任务在运行，跳过本次补全`);
      return;
    }

    try {
      this.isFillingGaps = true; // 标记补全任务开始
      console.log(`[后台补全] 🔧 开始后台补全区块: ${startHeight} - ${endHeight}`);
      console.log(`[后台补全] 📊 补全顺序: 从新到旧 (${endHeight} → ${startHeight}) - 优先获取最新数据`);
      console.log(`[后台补全] ⚠️ 后台补全只保存不推送 WebSocket，避免区块乱序`);

      // 生成倒序的区块高度数组（从新到旧）
      const heights = [];
      for (let height = endHeight; height >= startHeight; height--) {
        heights.push(height);
      }

      console.log(`[后台补全] 📊 总计需要补全: ${heights.length} 个区块`);

      let successCount = 0;
      let failCount = 0;

      // 使用串行处理
      for (let i = 0; i < heights.length; i++) {
        const height = heights[i];

        try {
          const block = await this.fetchBlockByHeight(height);

          if (block) {
            // 只保存到 Redis，不发布到 WebSocket（避免大量历史区块乱序推送到前端）
            await saveBlock(block);
            successCount++;

            // 每 10 个区块输出一次进度
            if (successCount % 10 === 0 || successCount === 1) {
              console.log(`[后台补全] 📊 进度: ${successCount}/${heights.length} (${Math.round(successCount / heights.length * 100)}%) - 当前区块: ${height}`);
            }
          } else {
            failCount++;
            console.error(`[后台补全] ❌ 补全区块 ${height} 失败`);
          }
        } catch (error) {
          failCount++;
          console.error(`[后台补全] ❌ 补全区块 ${height} 失败:`, error instanceof Error ? error.message : error);
        }
      }

      console.log(`[后台补全] ✅ 补全完成: ${endHeight} → ${startHeight} (倒序)`);
      console.log(`[后台补全] 📊 成功: ${successCount}, 失败: ${failCount}, 总计: ${heights.length}`);

      if (failCount > 0) {
        console.warn(`[后台补全] ⚠️ 有 ${failCount} 个区块补全失败，将在下次定期检测中重试`);
      }
    } catch (error) {
      console.error('[后台补全] ❌ 补全失败:', error);
    } finally {
      this.isFillingGaps = false; // 标记补全任务结束
    }
  }
  
  // 启动定期缺失区块检测（每30秒检查一次，确保数据完整性）
  private startMissingBlockCheck() {
    console.log('[数据完整性] 🔍 启动定期检测任务（每30秒检查一次）');
    
    this.missingBlockCheckInterval = setInterval(async () => {
      try {
        // 如果正在补全，跳过本次检测
        if (this.isFillingGaps) {
          console.log('[数据完整性] ⏳ 补全任务正在运行，跳过本次检测');
          return;
        }
        
        // 获取 Redis 中的最新区块高度
        const stats = await getStats();
        const redisLatestHeight = stats.latestHeight;
        
        if (redisLatestHeight === 0) {
          console.log('[数据完整性] ⏳ Redis 中暂无数据，跳过检测');
          return;
        }
        
        // 获取链上最新区块高度
        const chainLatestHeight = await this.getChainLatestHeight();
        
        if (!chainLatestHeight) {
          console.warn('[数据完整性] ⚠️ 无法获取链上最新高度，跳过本次检测');
          return;
        }
        
        // 如果链上高度大于 Redis 高度，说明有缺失
        if (chainLatestHeight > redisLatestHeight) {
          const missingCount = chainLatestHeight - redisLatestHeight;
          console.warn(`[数据完整性] ⚠️ 检测到 ${missingCount} 个缺失区块: ${redisLatestHeight + 1} - ${chainLatestHeight}`);
          console.log(`[数据完整性] 🔧 立即开始补全缺失区块...`);
          
          // 立即补全缺失的区块（最多补全 100 个）
          const maxToFill = 100;
          const endHeight = Math.min(redisLatestHeight + maxToFill, chainLatestHeight);
          
          if (missingCount > maxToFill) {
            console.warn(`[数据完整性] ⚠️ 缺失区块过多 (${missingCount}个)，本次补全最近的 ${maxToFill} 个`);
          }
          
          await this.fillMissingBlocks(redisLatestHeight + 1, endHeight);
          
          console.log(`[数据完整性] ✅ 补全完成，当前 Redis 高度: ${endHeight}`);
        } else {
          console.log(`[数据完整性] ✅ 数据完整，无缺失区块 (Redis: ${redisLatestHeight}, 链上: ${chainLatestHeight})`);
        }
      } catch (error) {
        console.error('[数据完整性] ❌ 检测失败:', error);
      }
    }, 30000); // 每30秒检查一次，降低检测频率
  }
  
  // 获取链上最新区块高度（带重试机制）
  private async getChainLatestHeight(): Promise<number | null> {
    const maxRetries = 3;
    const baseDelay = 500;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch(`${TRON_GRID_BASE}/wallet/getnowblock`, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json; charset=utf-8',
            'TRON-PRO-API-KEY': TRON_GRID_API_KEY
          },
          body: '{}'
        });
        
        if (response.status === 429) {
          // 遇到速率限制，等待后重试
          const delay = baseDelay * Math.pow(2, attempt);
          console.warn(`[链上查询] 速率限制 (429)，${delay}ms 后重试 (${attempt + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        if (!response.ok) {
          throw new Error(`HTTP Error: ${response.status}`);
        }
        
        const data: any = await response.json();
        
        // 检查数据结构是否正确
        if (!data || !data.block_header || !data.block_header.raw_data || !data.block_header.raw_data.number) {
          throw new Error('API 返回数据格式错误');
        }
        
        return data.block_header.raw_data.number;
      } catch (error) {
        console.error(`[链上查询] 获取最新区块失败 (尝试 ${attempt + 1}/${maxRetries}):`, error);
        
        if (attempt < maxRetries - 1) {
          const delay = baseDelay * Math.pow(2, attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    console.error('[链上查询] ❌ 获取最新区块失败，已达到最大重试次数');
    return null;
  }
  
  // 旧的定期检测代码（已废弃，保留注释供参考）
  /*
  private startMissingBlockCheck_OLD() {
    this.missingBlockCheckInterval = setInterval(async () => {
      try {
        // 获取 Redis 中的最新区块高度
        const stats = await getStats();
        const redisLatestHeight = stats.latestHeight;
        
        if (redisLatestHeight === 0) return;
        
        // 获取链上最新区块高度
        const maxRetries = 3;
        const baseDelay = 500;
        let response;
        
        for (let attempt = 0; attempt < maxRetries; attempt++) {
          try {
            response = await fetch(`${TRON_GRID_BASE}/wallet/getnowblock`, {
              method: 'POST',
              headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json; charset=utf-8',
                'TRON-PRO-API-KEY': TRON_GRID_API_KEY
              },
              body: '{}'
            });
            
            if (response.status === 429) {
              // 遇到速率限制，等待后重试
              const delay = baseDelay * Math.pow(2, attempt);
              console.warn(`[定期检测] 速率限制 (429)，${delay}ms 后重试 (${attempt + 1}/${maxRetries})`);
              await new Promise(resolve => setTimeout(resolve, delay));
              continue;
            }
            
            if (!response.ok) {
              console.error(`[定期检测] HTTP 错误: ${response.status}`);
              return;
            }
            
            break;
          } catch (error) {
            console.error(`[定期检测] 获取最新区块失败 (尝试 ${attempt + 1}/${maxRetries}):`, error);
            
            if (attempt < maxRetries - 1) {
              const delay = baseDelay * Math.pow(2, attempt);
              await new Promise(resolve => setTimeout(resolve, delay));
            } else {
              return;
            }
          }
        }
        
        if (!response) {
          console.error('[定期检测] 获取最新区块失败，已达到最大重试次数');
          return;
        }
        
        const data: any = await response.json();
        
        // 检查数据结构是否正确
        if (!data || !data.block_header || !data.block_header.raw_data || !data.block_header.raw_data.number) {
          console.error('[定期检测] API 返回数据格式错误:', JSON.stringify(data).substring(0, 200));
          return;
        }
        
        const chainLatestHeight = data.block_header.raw_data.number;
        
        // 如果链上高度大于 Redis 高度，说明有缺失
        if (chainLatestHeight > redisLatestHeight) {
          const missingCount = chainLatestHeight - redisLatestHeight;
          console.warn(`[定期检测] ⚠️ 检测到 ${missingCount} 个缺失区块: ${redisLatestHeight + 1} - ${chainLatestHeight}`);
          
          // 补全缺失的区块（最多补全 50 个）
          const endHeight = Math.min(redisLatestHeight + 50, chainLatestHeight);
          await this.fillMissingBlocks(redisLatestHeight + 1, endHeight);
        } else {
          console.log(`[定期检测] ✅ 数据完整，无缺失区块 (Redis: ${redisLatestHeight}, 链上: ${chainLatestHeight})`);
        }
      } catch (error) {
        console.error('[定期检测] 检测失败:', error);
      }
    }, 60000); // 每分钟检查一次
  }
  */
  
  stop() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.stopWsHealthCheck();

    if (this.missingBlockCheckInterval) {
      clearInterval(this.missingBlockCheckInterval);
      this.missingBlockCheckInterval = null;
    }
  }
}

// 导出单例
export const tronListener = new TronBlockListener(ALCHEMY_API_KEY);
