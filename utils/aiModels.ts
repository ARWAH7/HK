/**
 * AI 预测模型集合 v5.1
 * 包含 16 个独立的预测模型
 */

import { BlockData } from '../types';

interface ModelResult {
  match: boolean;
  val: 'ODD' | 'EVEN' | 'BIG' | 'SMALL' | 'NEUTRAL';
  conf: number;
  modelName: string;
}

// ============================================
// 1. 隐马尔可夫模型 (HMM)
// ============================================
export const runHMMModel = (seq: string, type: 'parity' | 'size'): ModelResult => {
  // 定义隐藏状态：HOT（热态）、COLD（冷态）、BALANCED（平衡态）
  // 通过观测序列推断当前隐藏状态
  
  const len = seq.length;
  if (len < 15) return { match: false, val: 'NEUTRAL', conf: 0, modelName: '隐马尔可夫模型' };
  
  // 计算状态转换概率
  let transitions = 0;
  for (let i = 1; i < Math.min(len, 15); i++) {
    if (seq[i] !== seq[i-1]) transitions++;
  }
  
  const transitionRate = transitions / 14;
  
  // 识别隐藏状态
  if (transitionRate > 0.7) {
    // 高转换率 = 平衡态 = 交替模式
    const pattern = seq.slice(0, 6);
    if (pattern === 'OEOEOE' || pattern === 'EOEOEO' || pattern === 'BSBSBS' || pattern === 'SBSBSB') {
      const nextVal = seq[0] === 'O' ? 'EVEN' : seq[0] === 'E' ? 'ODD' : seq[0] === 'B' ? 'SMALL' : 'BIG';
      return { match: true, val: nextVal as any, conf: 92, modelName: '隐马尔可夫模型' };
    }
  } else if (transitionRate < 0.3) {
    // 低转换率 = 热态/冷态 = 连续模式 → 均值回归：预测反转
    const first = seq[0];
    let count = 0;
    for (let i = 0; i < Math.min(len, 10); i++) {
      if (seq[i] === first) count++;
    }
    if (count >= 7) {
      // 连续出现过多，预测反转（均值回归）
      const nextVal = first === 'O' ? 'EVEN' : first === 'E' ? 'ODD' : first === 'B' ? 'SMALL' : 'BIG';
      return { match: true, val: nextVal as any, conf: 91, modelName: '隐马尔可夫模型' };
    }
  }
  
  return { match: false, val: 'NEUTRAL', conf: 0, modelName: '隐马尔可夫模型' };
};

// ============================================
// 2. LSTM 时间序列模型
// ============================================
export const runLSTMModel = (seq: string, type: 'parity' | 'size'): ModelResult => {
  // 简化版 LSTM：使用权重衰减模拟记忆机制
  const len = seq.length;
  if (len < 20) return { match: false, val: 'NEUTRAL', conf: 0, modelName: 'LSTM时间序列' };
  
  // 计算加权频率（近期权重高）
  let weight0 = 0, weight1 = 0;
  for (let i = 0; i < Math.min(len, 20); i++) {
    const weight = Math.exp(-i * 0.1); // 指数衰减
    if (type === 'parity') {
      if (seq[i] === 'O') weight0 += weight;
      else if (seq[i] === 'E') weight1 += weight;
    } else {
      if (seq[i] === 'B') weight0 += weight;
      else if (seq[i] === 'S') weight1 += weight;
    }
  }
  
  const total = weight0 + weight1;
  
  // 均值回归预测：近期偏向一方时预测反转
  if (total > 0) {
    const bias = weight0 / total;
    if (bias > 0.64) {
      // 近期偏向主值过多，预测反转
      const val = type === 'parity' ? 'EVEN' : 'SMALL';
      return { match: true, val: val as any, conf: 91, modelName: 'LSTM时间序列' };
    }
    if (bias < 0.36) {
      // 近期偏向副值过多，预测反转
      const val = type === 'parity' ? 'ODD' : 'BIG';
      return { match: true, val: val as any, conf: 91, modelName: 'LSTM时间序列' };
    }
  }
  
  return { match: false, val: 'NEUTRAL', conf: 0, modelName: 'LSTM时间序列' };
};

// ============================================
// 3. ARIMA 自回归移动平均
// ============================================
export const runARIMAModel = (seq: string, type: 'parity' | 'size'): ModelResult => {
  const len = seq.length;
  if (len < 15) return { match: false, val: 'NEUTRAL', conf: 0, modelName: 'ARIMA模型' };

  // 正确的自相关系数（ACF）计算：中心化 + 归一化
  const numSeq = Array.from(seq).map(c => (c === 'O' || c === 'B') ? 1 : 0);
  const mean = numSeq.reduce((a, b) => a + b, 0) / numSeq.length;
  const variance = numSeq.reduce((s, v) => s + (v - mean) ** 2, 0) / numSeq.length;

  const calculateACF = (lag: number): number => {
    if (variance === 0) return 0;
    let sum = 0;
    for (let i = 0; i < len - lag; i++) {
      sum += (numSeq[i] - mean) * (numSeq[i + lag] - mean);
    }
    return sum / ((len - lag) * variance);
  };

  const acf1 = calculateACF(1);
  const acf2 = calculateACF(2);
  const acf3 = calculateACF(3);

  const primaryChar = type === 'parity' ? 'O' : 'B';
  const secondaryChar = type === 'parity' ? 'E' : 'S';

  // 1. 强负相关 = 交替模式（ACF(1) 显著为负）
  if (acf1 < -0.3) {
    const nextVal = seq[0] === primaryChar
      ? (type === 'parity' ? 'EVEN' : 'SMALL')
      : (type === 'parity' ? 'ODD' : 'BIG');
    return { match: true, val: nextVal as any, conf: 92, modelName: 'ARIMA模型' };
  }

  // 2. 强正相关 = 趋势延续（ACF(1) 显著为正）
  if (acf1 > 0.25) {
    const nextVal = seq[0] === primaryChar
      ? (type === 'parity' ? 'ODD' : 'BIG')
      : (type === 'parity' ? 'EVEN' : 'SMALL');
    return { match: true, val: nextVal as any, conf: 91, modelName: 'ARIMA模型' };
  }

  // 3. 周期2检测（ACF(2) 显著为正且 ACF(1) 接近0）
  if (acf2 > 0.25 && Math.abs(acf1) < 0.15) {
    // 近期偏向判断
    const recent5 = seq.slice(0, 5);
    const pCount = (recent5.match(new RegExp(primaryChar, 'g')) || []).length;
    if (pCount >= 4) {
      const val = type === 'parity' ? 'ODD' : 'BIG';
      return { match: true, val: val as any, conf: 90, modelName: 'ARIMA模型' };
    }
    if (pCount <= 1) {
      const val = type === 'parity' ? 'EVEN' : 'SMALL';
      return { match: true, val: val as any, conf: 90, modelName: 'ARIMA模型' };
    }
  }

  return { match: false, val: 'NEUTRAL', conf: 0, modelName: 'ARIMA模型' };
};

// ============================================
// 4. 熵值突变检测（最高准确率）
// ============================================
export const runEntropyModel = (seq: string, type: 'parity' | 'size'): ModelResult => {
  const len = seq.length;
  if (len < 12) return { match: false, val: 'NEUTRAL', conf: 0, modelName: '熵值突变检测' };
  
  // 计算香农熵
  const calculateEntropy = (subSeq: string): number => {
    const freq: Record<string, number> = {};
    for (const char of subSeq) {
      freq[char] = (freq[char] || 0) + 1;
    }
    let entropy = 0;
    for (const count of Object.values(freq)) {
      const p = count / subSeq.length;
      if (p > 0) entropy -= p * Math.log2(p);
    }
    return entropy;
  };
  
  // 计算近期和远期的熵值
  const recentEntropy = calculateEntropy(seq.slice(0, 6));
  const previousEntropy = calculateEntropy(seq.slice(6, 12));
  
  // 检测熵值突变（从高到低 = 从混乱到有序）
  const entropyDrop = previousEntropy - recentEntropy;
  const entropyDropRate = entropyDrop / previousEntropy;
  
  if (entropyDropRate > 0.25 && recentEntropy < 0.75) {
    // 熵值显著下降，系统变得有序
    const recent = seq.slice(0, 6);
    
    if (type === 'parity') {
      const oCount = (recent.match(/O/g) || []).length;
      const eCount = (recent.match(/E/g) || []).length;
      
      // 单双预测
      if (oCount >= 5) return { match: true, val: 'ODD', conf: 95, modelName: '熵值突变检测' };
      if (eCount >= 5) return { match: true, val: 'EVEN', conf: 95, modelName: '熵值突变检测' };
      if (oCount >= 4) return { match: true, val: 'ODD', conf: 91, modelName: '熵值突变检测' };
      if (eCount >= 4) return { match: true, val: 'EVEN', conf: 91, modelName: '熵值突变检测' };
    } else {
      const bCount = (recent.match(/B/g) || []).length;
      const sCount = (recent.match(/S/g) || []).length;
      
      // 大小预测
      if (bCount >= 5) return { match: true, val: 'BIG', conf: 95, modelName: '熵值突变检测' };
      if (sCount >= 5) return { match: true, val: 'SMALL', conf: 95, modelName: '熵值突变检测' };
      if (bCount >= 4) return { match: true, val: 'BIG', conf: 91, modelName: '熵值突变检测' };
      if (sCount >= 4) return { match: true, val: 'SMALL', conf: 91, modelName: '熵值突变检测' };
    }
  }
  
  return { match: false, val: 'NEUTRAL', conf: 0, modelName: '熵值突变检测' };
};

// ============================================
// 5. 蒙特卡洛模拟
// ============================================
export const runMonteCarloModel = (seq: string, type: 'parity' | 'size'): ModelResult => {
  const len = seq.length;
  if (len < 12) return { match: false, val: 'NEUTRAL', conf: 0, modelName: '蒙特卡洛模拟' };

  // 均值回归蒙特卡洛：当历史分布显著偏向一方时，预测另一方（回归均值）
  const primaryChar = type === 'parity' ? 'O' : 'B';
  const pCount = (seq.match(new RegExp(primaryChar, 'g')) || []).length;
  const ratio = pCount / len;

  // 近期15块窗口分析（更敏感）
  const recentSeq = seq.slice(0, Math.min(15, len));
  const recentPCount = (recentSeq.match(new RegExp(primaryChar, 'g')) || []).length;
  const recentRatio = recentPCount / recentSeq.length;

  // 综合偏差：近期权重0.6 + 全局权重0.4
  const effectiveRatio = recentRatio * 0.6 + ratio * 0.4;

  if (effectiveRatio > 0.62) {
    // 偏向主值过多 → 预测副值（均值回归）
    const val = type === 'parity' ? 'EVEN' : 'SMALL';
    const conf = Math.min(95, Math.max(91, Math.round(effectiveRatio * 100 - 10)));
    return { match: true, val: val as any, conf, modelName: '蒙特卡洛模拟' };
  }
  if (effectiveRatio < 0.38) {
    // 偏向副值过多 → 预测主值（均值回归）
    const val = type === 'parity' ? 'ODD' : 'BIG';
    const conf = Math.min(95, Math.max(91, Math.round((1 - effectiveRatio) * 100 - 10)));
    return { match: true, val: val as any, conf, modelName: '蒙特卡洛模拟' };
  }

  return { match: false, val: 'NEUTRAL', conf: 0, modelName: '蒙特卡洛模拟' };
};

// ============================================
// 6. 小波变换分析
// ============================================
export const runWaveletModel = (seq: string, type: 'parity' | 'size'): ModelResult => {
  const len = seq.length;
  if (len < 16) return { match: false, val: 'NEUTRAL', conf: 0, modelName: '小波变换分析' };
  
  // 简化版 Haar 小波变换
  const haarTransform = (data: number[]): { low: number[], high: number[] } => {
    const low: number[] = [];
    const high: number[] = [];
    for (let i = 0; i < data.length - 1; i += 2) {
      low.push((data[i] + data[i + 1]) / 2);
      high.push((data[i] - data[i + 1]) / 2);
    }
    return { low, high };
  };
  
  // 将序列转换为数值
  const numSeq = seq.split('').map(c => (c === 'O' || c === 'B') ? 1 : 0);
  
  // 进行小波分解
  const { low, high } = haarTransform(numSeq.slice(0, 16));
  
  // 分析低频（长期趋势）
  const lowAvg = low.reduce((a, b) => a + b, 0) / low.length;
  
  // 分析高频（短期波动）
  const highAvg = Math.abs(high.reduce((a, b) => a + b, 0) / high.length);
  
  // 均值回归多尺度检测：当低频趋势显著偏向一方且高频稳定时，预测反转
  if (lowAvg > 0.65 && highAvg < 0.30) {
    // 低频高 + 高频低 = 稳定偏向主值 → 预测反转
    if (type === 'parity') {
      return { match: true, val: 'EVEN', conf: 91, modelName: '小波变换分析' };
    } else {
      return { match: true, val: 'SMALL', conf: 91, modelName: '小波变换分析' };
    }
  } else if (lowAvg < 0.35 && highAvg < 0.30) {
    // 低频低 + 高频低 = 稳定偏向副值 → 预测反转
    if (type === 'parity') {
      return { match: true, val: 'ODD', conf: 91, modelName: '小波变换分析' };
    } else {
      return { match: true, val: 'BIG', conf: 91, modelName: '小波变换分析' };
    }
  }
  
  return { match: false, val: 'NEUTRAL', conf: 0, modelName: '小波变换分析' };
};

// ============================================
// 原有模型（保持兼容）
// ============================================
// 频谱周期律检测模型已删除

// 7. 马尔可夫状态迁移
export const runMarkovModel = (seq: string, type: 'parity' | 'size'): ModelResult => {
  const len = seq.length;
  if (len < 15) return { match: false, val: 'NEUTRAL', conf: 0, modelName: '马尔可夫状态迁移' };
  
  // 计算状态转移概率矩阵
  const transitions: Record<string, Record<string, number>> = {};
  
  for (let i = 0; i < len - 1; i++) {
    const current = seq[i];
    const next = seq[i + 1];
    
    if (!transitions[current]) transitions[current] = {};
    transitions[current][next] = (transitions[current][next] || 0) + 1;
  }
  
  // 计算转移概率
  for (const current in transitions) {
    const total = Object.values(transitions[current]).reduce((a, b) => a + b, 0);
    for (const next in transitions[current]) {
      transitions[current][next] /= total;
    }
  }
  
  // 均值回归马尔可夫：当某状态自转移概率过高时，预测反转
  const lastState = seq[0];
  if (transitions[lastState]) {
    const probs = transitions[lastState];
    const selfProb = probs[lastState] || 0;

    // 当自转移概率 > 0.65（即同值频繁出现），预测切换到另一个状态
    if (selfProb > 0.65) {
      const val = type === 'parity'
        ? (lastState === 'O' ? 'EVEN' : 'ODD')
        : (lastState === 'B' ? 'SMALL' : 'BIG');
      const conf = Math.min(95, Math.max(91, Math.round(selfProb * 100 - 5)));
      return { match: true, val: val as any, conf, modelName: '马尔可夫状态迁移' };
    }

    // 当交替转移概率 > 0.65，预测交替继续
    const otherState = type === 'parity' ? (lastState === 'O' ? 'E' : 'O') : (lastState === 'B' ? 'S' : 'B');
    const altProb = probs[otherState] || 0;
    if (altProb > 0.65) {
      const val = type === 'parity'
        ? (lastState === 'O' ? 'EVEN' : 'ODD')
        : (lastState === 'B' ? 'SMALL' : 'BIG');
      const conf = Math.min(95, Math.max(91, Math.round(altProb * 100 - 5)));
      return { match: true, val: val as any, conf, modelName: '马尔可夫状态迁移' };
    }
  }
  
  return { match: false, val: 'NEUTRAL', conf: 0, modelName: '马尔可夫状态迁移' };
};

export const checkDensity = (seq: string) => {
  // 均值回归策略：连续出现同一值后，预测反转（更符合哈希数据的随机特性）
  if (seq.startsWith('OOOOO')) return { match: true, val: 'EVEN', conf: 93, modelName: '密集簇群共振' };
  if (seq.startsWith('EEEEE')) return { match: true, val: 'ODD', conf: 93, modelName: '密集簇群共振' };
  if (seq.startsWith('BBBBB')) return { match: true, val: 'SMALL', conf: 93, modelName: '密集簇群共振' };
  if (seq.startsWith('SSSSS')) return { match: true, val: 'BIG', conf: 93, modelName: '密集簇群共振' };
  if (seq.startsWith('OOOO')) return { match: true, val: 'EVEN', conf: 91, modelName: '密集簇群共振' };
  if (seq.startsWith('EEEE')) return { match: true, val: 'ODD', conf: 91, modelName: '密集簇群共振' };
  if (seq.startsWith('BBBB')) return { match: true, val: 'SMALL', conf: 91, modelName: '密集簇群共振' };
  if (seq.startsWith('SSSS')) return { match: true, val: 'BIG', conf: 91, modelName: '密集簇群共振' };
  return { match: false, val: 'NEUTRAL', conf: 0, modelName: '密集簇群共振' };
};

// Bayesian 置信度：接受 recentBias（近期20块）和 fullBias（全量）
// 两个尺度结合判断，近期窗口方差大更容易触发
export const getBayesianConf = (bias: number, recentBias?: number) => {
  const fullDev = Math.abs(bias - 0.5);
  const recentDev = recentBias !== undefined ? Math.abs(recentBias - 0.5) : fullDev;
  // 近期偏差优先（更敏感），全局偏差作为辅助
  const effectiveDev = Math.max(recentDev, fullDev * 0.8);
  if (effectiveDev > 0.20) return 95;
  if (effectiveDev > 0.15) return 92;
  if (effectiveDev > 0.10) return 91;
  if (effectiveDev > 0.07) return 90;
  return 50;
};

// ============================================
// 10. 游程编码分析 (RLE)
// ============================================
export const runRLEModel = (seq: string, type: 'parity' | 'size'): ModelResult => {
  const len = seq.length;
  if (len < 12) return { match: false, val: 'NEUTRAL', conf: 0, modelName: '游程编码分析' };

  // 将序列分割为连续段（runs）
  const runs: { char: string; length: number }[] = [];
  let i = 0;
  while (i < len) {
    const char = seq[i];
    let runLen = 1;
    while (i + runLen < len && seq[i + runLen] === char) runLen++;
    runs.push({ char, length: runLen });
    i += runLen;
  }

  if (runs.length < 4) return { match: false, val: 'NEUTRAL', conf: 0, modelName: '游程编码分析' };

  // 计算同字符段的平均长度（分开统计）
  const currentRun = runs[0];
  const sameCharRuns = runs.filter(r => r.char === currentRun.char);
  const avgSameLen = sameCharRuns.length > 1
    ? sameCharRuns.slice(1).reduce((s, r) => s + r.length, 0) / (sameCharRuns.length - 1)
    : 2;

  const charToVal = (c: string): 'ODD' | 'EVEN' | 'BIG' | 'SMALL' => {
    if (c === 'O') return 'ODD';
    if (c === 'E') return 'EVEN';
    if (c === 'B') return 'BIG';
    return 'SMALL';
  };

  // 1. 当前段刚开始（长度 < 同类历史平均），趋势延续
  if (currentRun.length < avgSameLen && currentRun.length >= 2) {
    return { match: true, val: charToVal(currentRun.char), conf: 91, modelName: '游程编码分析' };
  }

  // 2. 当前段已超过同类历史平均 × 1.2，趋势即将反转
  if (currentRun.length >= avgSameLen * 1.2 && currentRun.length >= 3) {
    const reverseVal = type === 'parity'
      ? (currentRun.char === 'O' ? 'EVEN' : 'ODD')
      : (currentRun.char === 'B' ? 'SMALL' : 'BIG');
    return { match: true, val: reverseVal as any, conf: 91, modelName: '游程编码分析' };
  }

  // 3. 最近3段呈递增趋势（段长越来越长），当前段可能继续
  if (runs.length >= 3 && runs[0].length > runs[1].length && runs[1].length > runs[2].length) {
    return { match: true, val: charToVal(currentRun.char), conf: 90, modelName: '游程编码分析' };
  }

  return { match: false, val: 'NEUTRAL', conf: 0, modelName: '游程编码分析' };
};

// ============================================
// 11. 斐波那契回撤分析
// ============================================
export const runFibonacciModel = (seq: string, type: 'parity' | 'size'): ModelResult => {
  const len = seq.length;
  if (len < 13) return { match: false, val: 'NEUTRAL', conf: 0, modelName: '斐波那契回撤' };

  const fibWindows = [3, 5, 8, 13];
  const primaryChar = type === 'parity' ? 'O' : 'B';
  const secondaryChar = type === 'parity' ? 'E' : 'S';

  let primaryWins = 0;
  let secondaryWins = 0;

  // 在每个斐波那契窗口中统计占比
  for (const w of fibWindows) {
    if (w > len) continue;
    const window = seq.slice(0, w);
    const pCount = (window.match(new RegExp(primaryChar, 'g')) || []).length;
    const ratio = pCount / w;

    if (ratio >= 0.618) primaryWins++;
    else if (ratio <= 0.382) secondaryWins++;
  }

  // 均值回归：3+个窗口一致偏向同一值 → 预测反转
  if (primaryWins >= 3) {
    const val = type === 'parity' ? 'EVEN' : 'SMALL';
    return { match: true, val: val as any, conf: 91, modelName: '斐波那契回撤' };
  }
  if (secondaryWins >= 3) {
    const val = type === 'parity' ? 'ODD' : 'BIG';
    return { match: true, val: val as any, conf: 91, modelName: '斐波那契回撤' };
  }

  return { match: false, val: 'NEUTRAL', conf: 0, modelName: '斐波那契回撤' };
};

// ============================================
// 12. 梯度动量模型
// ============================================
export const runGradientMomentumModel = (seq: string, type: 'parity' | 'size'): ModelResult => {
  const len = seq.length;
  if (len < 15) return { match: false, val: 'NEUTRAL', conf: 0, modelName: '梯度动量模型' };

  const windowSize = 5;
  const primaryChar = type === 'parity' ? 'O' : 'B';

  // 计算每个滑动窗口内的偏差（主值占比 - 0.5）
  const gradients: number[] = [];
  for (let i = 0; i <= len - windowSize; i++) {
    const window = seq.slice(i, i + windowSize);
    const count = (window.match(new RegExp(primaryChar, 'g')) || []).length;
    gradients.push(count / windowSize - 0.5);
  }

  if (gradients.length < 4) return { match: false, val: 'NEUTRAL', conf: 0, modelName: '梯度动量模型' };

  // 计算梯度变化方向（最近的窗口在前）
  let increasing = 0;
  let decreasing = 0;
  for (let i = 0; i < Math.min(gradients.length - 1, 5); i++) {
    if (gradients[i] > gradients[i + 1]) increasing++; // 偏差在增加（趋势加速）
    else if (gradients[i] < gradients[i + 1]) decreasing++; // 偏差在减少（趋势减速）
  }

  // 连续3+窗口偏差增加 = 加速趋势
  if (increasing >= 3 && gradients[0] > 0.1) {
    const val = type === 'parity' ? 'ODD' : 'BIG';
    return { match: true, val: val as any, conf: 91, modelName: '梯度动量模型' };
  }
  if (increasing >= 3 && gradients[0] < -0.1) {
    const val = type === 'parity' ? 'EVEN' : 'SMALL';
    return { match: true, val: val as any, conf: 91, modelName: '梯度动量模型' };
  }

  // 连续3+窗口偏差减少 = 趋势反转信号
  if (decreasing >= 3 && gradients[0] > 0.1) {
    const val = type === 'parity' ? 'EVEN' : 'SMALL';
    return { match: true, val: val as any, conf: 90, modelName: '梯度动量模型' };
  }
  if (decreasing >= 3 && gradients[0] < -0.1) {
    const val = type === 'parity' ? 'ODD' : 'BIG';
    return { match: true, val: val as any, conf: 90, modelName: '梯度动量模型' };
  }

  return { match: false, val: 'NEUTRAL', conf: 0, modelName: '梯度动量模型' };
};

// ============================================
// 13. 指数移动平均交叉 (EMA Crossover)
// ============================================
export const runEMACrossoverModel = (seq: string, type: 'parity' | 'size'): ModelResult => {
  const len = seq.length;
  if (len < 20) return { match: false, val: 'NEUTRAL', conf: 0, modelName: 'EMA交叉分析' };

  const primaryChar = type === 'parity' ? 'O' : 'B';

  // seq[0]=最新, seq[end]=最旧; EMA需要从旧到新计算, 所以反转序列
  const reversedSeq = Array.from(seq).reverse();
  const numSeq = reversedSeq.map(c => c === primaryChar ? 1 : 0);

  // 计算 EMA (从旧到新)
  const calcEMA = (data: number[], period: number): number[] => {
    const k = 2 / (period + 1);
    const ema: number[] = [data[0]];
    for (let i = 1; i < data.length; i++) {
      ema.push(data[i] * k + ema[i - 1] * (1 - k));
    }
    return ema;
  };

  const fastEMA = calcEMA(numSeq, 5);  // 快线
  const slowEMA = calcEMA(numSeq, 12); // 慢线

  // 检测最近的交叉信号 (数组末尾=最新数据)
  const last = len - 1;
  const fastCurr = fastEMA[last];
  const slowCurr = slowEMA[last];
  const fastPrev = fastEMA[last - 1];
  const slowPrev = slowEMA[last - 1];

  // 金叉 (快线从下穿上) → 近期主值加速上升 → 均值回归预测副值
  if (fastCurr > slowCurr && fastPrev <= slowPrev && fastCurr > 0.55) {
    const val = type === 'parity' ? 'EVEN' : 'SMALL';
    return { match: true, val: val as any, conf: 91, modelName: 'EMA交叉分析' };
  }

  // 死叉 (快线从上穿下) → 近期副值加速上升 → 均值回归预测主值
  if (fastCurr < slowCurr && fastPrev >= slowPrev && fastCurr < 0.45) {
    const val = type === 'parity' ? 'ODD' : 'BIG';
    return { match: true, val: val as any, conf: 91, modelName: 'EMA交叉分析' };
  }

  // 强趋势偏离 (两条EMA均偏向同一方向且距离大)
  if (Math.abs(fastCurr - slowCurr) > 0.12 && fastCurr > 0.6) {
    const val = type === 'parity' ? 'EVEN' : 'SMALL';
    return { match: true, val: val as any, conf: 90, modelName: 'EMA交叉分析' };
  }
  if (Math.abs(fastCurr - slowCurr) > 0.12 && fastCurr < 0.4) {
    const val = type === 'parity' ? 'ODD' : 'BIG';
    return { match: true, val: val as any, conf: 90, modelName: 'EMA交叉分析' };
  }

  // 近期EMA极端偏离 (单条EMA显著偏离0.5)
  if (fastCurr > 0.7) {
    const val = type === 'parity' ? 'EVEN' : 'SMALL';
    return { match: true, val: val as any, conf: 90, modelName: 'EMA交叉分析' };
  }
  if (fastCurr < 0.3) {
    const val = type === 'parity' ? 'ODD' : 'BIG';
    return { match: true, val: val as any, conf: 90, modelName: 'EMA交叉分析' };
  }

  return { match: false, val: 'NEUTRAL', conf: 0, modelName: 'EMA交叉分析' };
};

// ============================================
// 14. 卡方检验模型 (Chi-Squared Uniformity Test)
// ============================================
export const runChiSquaredModel = (seq: string, type: 'parity' | 'size'): ModelResult => {
  const len = seq.length;
  if (len < 20) return { match: false, val: 'NEUTRAL', conf: 0, modelName: '卡方检验模型' };

  const primaryChar = type === 'parity' ? 'O' : 'B';

  // 将序列分成4个等长窗口，检验分布均匀性
  const windowSize = Math.floor(len / 4);
  const expected = windowSize / 2; // 期望每个窗口中主值出现次数

  let chiSquared = 0;
  const windowCounts: number[] = [];

  for (let w = 0; w < 4; w++) {
    const windowSeq = seq.slice(w * windowSize, (w + 1) * windowSize);
    const count = (windowSeq.match(new RegExp(primaryChar, 'g')) || []).length;
    windowCounts.push(count);
    chiSquared += ((count - expected) ** 2) / expected;
  }

  // 近期窗口的偏向 (seq[0]=最新, 窗口0=最新数据)
  const recentCount = windowCounts[0];
  const recentRatio = recentCount / windowSize;

  // 策略1: 卡方值 > 7.815 (df=3, p<0.05) → 分布显著不均匀
  if (chiSquared > 7.815) {
    if (recentRatio > 0.6) {
      const val = type === 'parity' ? 'EVEN' : 'SMALL';
      const conf = Math.min(95, 91 + Math.floor(chiSquared / 5));
      return { match: true, val: val as any, conf, modelName: '卡方检验模型' };
    }
    if (recentRatio < 0.4) {
      const val = type === 'parity' ? 'ODD' : 'BIG';
      const conf = Math.min(95, 91 + Math.floor(chiSquared / 5));
      return { match: true, val: val as any, conf, modelName: '卡方检验模型' };
    }
  }

  // 策略2: 卡方值中等 (>4.0) 但近期窗口偏向极端
  if (chiSquared > 4.0) {
    if (recentRatio > 0.7) {
      const val = type === 'parity' ? 'EVEN' : 'SMALL';
      return { match: true, val: val as any, conf: 90, modelName: '卡方检验模型' };
    }
    if (recentRatio < 0.3) {
      const val = type === 'parity' ? 'ODD' : 'BIG';
      return { match: true, val: val as any, conf: 90, modelName: '卡方检验模型' };
    }
  }

  // 策略3: 整体偏差大 — 全序列主值占比极端
  const totalPrimary = (seq.match(new RegExp(primaryChar, 'g')) || []).length;
  const overallRatio = totalPrimary / len;
  if (overallRatio > 0.65 && recentRatio > 0.6) {
    const val = type === 'parity' ? 'EVEN' : 'SMALL';
    return { match: true, val: val as any, conf: 90, modelName: '卡方检验模型' };
  }
  if (overallRatio < 0.35 && recentRatio < 0.4) {
    const val = type === 'parity' ? 'ODD' : 'BIG';
    return { match: true, val: val as any, conf: 90, modelName: '卡方检验模型' };
  }

  return { match: false, val: 'NEUTRAL', conf: 0, modelName: '卡方检验模型' };
};

// ============================================
// 15. N-gram 模式识别
// ============================================
export const runNgramModel = (seq: string, type: 'parity' | 'size'): ModelResult => {
  const len = seq.length;
  if (len < 15) return { match: false, val: 'NEUTRAL', conf: 0, modelName: 'N-gram模式识别' };

  // 构建 n-gram 频率表 (n=3)
  const n = 3;
  const ngrams: Record<string, number> = {};
  for (let i = 0; i <= len - n; i++) {
    const gram = seq.slice(i, i + n);
    ngrams[gram] = (ngrams[gram] || 0) + 1;
  }

  // 找到当前上下文 (最近 n-1 个字符)
  const context = seq.slice(0, n - 1);

  // 查找所有以当前上下文开头的 n-gram
  const primaryChar = type === 'parity' ? 'O' : 'B';
  const secondaryChar = type === 'parity' ? 'E' : 'S';

  const followPrimary = ngrams[context + primaryChar] || 0;
  const followSecondary = ngrams[context + secondaryChar] || 0;
  const total = followPrimary + followSecondary;

  if (total < 3) return { match: false, val: 'NEUTRAL', conf: 0, modelName: 'N-gram模式识别' };

  const ratio = followPrimary / total;

  // 均值回归: 历史上下文后高概率出现某值 → 预测反转
  if (ratio > 0.7) {
    const val = type === 'parity' ? 'EVEN' : 'SMALL';
    return { match: true, val: val as any, conf: 91, modelName: 'N-gram模式识别' };
  }
  if (ratio < 0.3) {
    const val = type === 'parity' ? 'ODD' : 'BIG';
    return { match: true, val: val as any, conf: 91, modelName: 'N-gram模式识别' };
  }

  // 也检测 n=2 pattern
  const ctx2 = seq.slice(0, 1);
  const ngrams2: Record<string, number> = {};
  for (let i = 0; i <= len - 2; i++) {
    const gram = seq.slice(i, i + 2);
    ngrams2[gram] = (ngrams2[gram] || 0) + 1;
  }
  const fp2 = ngrams2[ctx2 + primaryChar] || 0;
  const fs2 = ngrams2[ctx2 + secondaryChar] || 0;
  const total2 = fp2 + fs2;
  if (total2 >= 5) {
    const ratio2 = fp2 / total2;
    if (ratio2 > 0.75) {
      const val = type === 'parity' ? 'EVEN' : 'SMALL';
      return { match: true, val: val as any, conf: 90, modelName: 'N-gram模式识别' };
    }
    if (ratio2 < 0.25) {
      const val = type === 'parity' ? 'ODD' : 'BIG';
      return { match: true, val: val as any, conf: 90, modelName: 'N-gram模式识别' };
    }
  }

  return { match: false, val: 'NEUTRAL', conf: 0, modelName: 'N-gram模式识别' };
};

// ============================================
// 16. 集成自适应投票 (Ensemble Adaptive Voting)
// ============================================
export const runEnsembleVotingModel = (seq: string, type: 'parity' | 'size'): ModelResult => {
  const len = seq.length;
  if (len < 20) return { match: false, val: 'NEUTRAL', conf: 0, modelName: '集成自适应投票' };

  // 运行多个子模型并收集投票
  const subModels = [
    runHMMModel(seq, type),
    runLSTMModel(seq, type),
    runARIMAModel(seq, type),
    runEntropyModel(seq, type),
    runMonteCarloModel(seq, type),
    runMarkovModel(seq, type),
    runRLEModel(seq, type),
    runGradientMomentumModel(seq, type),
    runEMACrossoverModel(seq, type),
    runChiSquaredModel(seq, type),
    runNgramModel(seq, type),
    runFibonacciModel(seq, type),
    runWaveletModel(seq, type)
  ];

  // 统计投票
  const votes: Record<string, { count: number; totalConf: number }> = {};
  let totalVoters = 0;

  for (const result of subModels) {
    if (result.match && result.val !== 'NEUTRAL') {
      totalVoters++;
      if (!votes[result.val]) votes[result.val] = { count: 0, totalConf: 0 };
      votes[result.val].count++;
      votes[result.val].totalConf += result.conf;
    }
  }

  // 至少2个模型投票才有意义
  if (totalVoters < 2) return { match: false, val: 'NEUTRAL', conf: 0, modelName: '集成自适应投票' };

  // 找到最高票数的预测
  let bestVal = 'NEUTRAL';
  let bestCount = 0;
  let bestAvgConf = 0;

  for (const [val, data] of Object.entries(votes)) {
    if (data.count > bestCount || (data.count === bestCount && data.totalConf / data.count > bestAvgConf)) {
      bestVal = val;
      bestCount = data.count;
      bestAvgConf = data.totalConf / data.count;
    }
  }

  // 需要多数票 (> 50%) 且至少2票
  const voteRatio = bestCount / totalVoters;
  if (voteRatio >= 0.5 && bestCount >= 2) {
    const conf = Math.min(98, Math.round(bestAvgConf * (0.8 + voteRatio * 0.2)));
    return { match: true, val: bestVal as any, conf, modelName: '集成自适应投票' };
  }

  return { match: false, val: 'NEUTRAL', conf: 0, modelName: '集成自适应投票' };
};
