/**
 * AI 分析引擎 v5.1
 * 整合 16 个模型的核心分析逻辑
 */

import { BlockData, AIPredictionResult, IntervalRule } from '../types';
import {
  runHMMModel,
  runLSTMModel,
  runARIMAModel,
  runEntropyModel,
  runMonteCarloModel,
  runWaveletModel,
  runMarkovModel,
  checkDensity,
  getBayesianConf,
  runRLEModel,
  runFibonacciModel,
  runGradientMomentumModel,
  runEMACrossoverModel,
  runChiSquaredModel,
  runNgramModel,
  runEnsembleVotingModel
} from './aiModels';

interface ModelCandidate {
  type: 'parity' | 'size';
  value: 'ODD' | 'EVEN' | 'BIG' | 'SMALL';
  confidence: number;
  modelName: string;
}

export const getNextAlignedHeight = (currentHeight: number, step: number, startBlock: number) => {
  const offset = startBlock || 0;
  if (step <= 1) return currentHeight + 1;
  const diff = currentHeight - offset;
  const nextMultiplier = Math.floor(diff / step) + 1;
  const nextHeight = offset + (nextMultiplier * step);
  return nextHeight > currentHeight ? nextHeight : nextHeight + step;
};

/**
 * 核心演算逻辑 v5.0：10 模型矩阵
 */
export const runDeepAnalysisV5 = (
  blocks: BlockData[], 
  rule: IntervalRule, 
  targetHeight: number
): AIPredictionResult & { ruleId: string } => {
  
  const checkAlignment = (h: number) => {
    if (rule.value <= 1) return true;
    if (rule.startBlock > 0) return h >= rule.startBlock && (h - rule.startBlock) % rule.value === 0;
    return h % rule.value === 0;
  };

  const ruleBlocks = blocks.filter(b => checkAlignment(b.height)).slice(0, 80);
  
  if (ruleBlocks.length < 24) {
    return {
      shouldPredict: false,
      nextParity: 'NEUTRAL',
      parityConfidence: 0,
      nextSize: 'NEUTRAL',
      sizeConfidence: 0,
      analysis: "数据厚度不足，模型锁定中",
      detectedCycle: "数据采集",
      riskLevel: "HIGH",
      entropyScore: 100,
      ruleId: rule.id
    };
  }

  // 准备序列数据
  const pSeq = ruleBlocks.slice(0, 40).map(b => b.type === 'ODD' ? 'O' : 'E').join('');
  const sSeq = ruleBlocks.slice(0, 40).map(b => b.sizeType === 'BIG' ? 'B' : 'S').join('');
  
  const oddCount = ruleBlocks.filter(b => b.type === 'ODD').length;
  const bigCount = ruleBlocks.filter(b => b.sizeType === 'BIG').length;
  const pBias = oddCount / ruleBlocks.length;
  const sBias = bigCount / ruleBlocks.length;

  // 计算近期20块偏差（方差更大，更容易触发贝叶斯）
  const recent20 = ruleBlocks.slice(0, 20);
  const recentOddCount = recent20.filter(b => b.type === 'ODD').length;
  const recentBigCount = recent20.filter(b => b.sizeType === 'BIG').length;
  const recentPBias = recent20.length > 0 ? recentOddCount / recent20.length : 0.5;
  const recentSBias = recent20.length > 0 ? recentBigCount / recent20.length : 0.5;

  // ============================================
  // 运行所有 12 个模型
  // ============================================
  const candidates: ModelCandidate[] = [];

  // 1. 密集簇群共振
  const pDensity = checkDensity(pSeq);
  if (pDensity.match && (pDensity.val === 'ODD' || pDensity.val === 'EVEN')) {
    candidates.push({ type: 'parity', value: pDensity.val, confidence: pDensity.conf, modelName: pDensity.modelName });
  }

  const sDensity = checkDensity(sSeq);
  if (sDensity.match && (sDensity.val === 'BIG' || sDensity.val === 'SMALL')) {
    candidates.push({ type: 'size', value: sDensity.val, confidence: sDensity.conf, modelName: sDensity.modelName });
  }

  // 2. 贝叶斯后验推理（传入近期偏差）
  const pBayesConf = getBayesianConf(pBias, recentPBias);
  if (pBayesConf > 90) {
    const effectiveBias = Math.abs(recentPBias - 0.5) > Math.abs(pBias - 0.5) ? recentPBias : pBias;
    const val = effectiveBias > 0.5 ? 'EVEN' : 'ODD';
    candidates.push({ type: 'parity', value: val, confidence: pBayesConf, modelName: '贝叶斯后验推理' });
  }

  const sBayesConf = getBayesianConf(sBias, recentSBias);
  if (sBayesConf > 90) {
    const effectiveBias = Math.abs(recentSBias - 0.5) > Math.abs(sBias - 0.5) ? recentSBias : sBias;
    const val = effectiveBias > 0.5 ? 'SMALL' : 'BIG';
    candidates.push({ type: 'size', value: val, confidence: sBayesConf, modelName: '贝叶斯后验推理' });
  }

  // 3. 隐马尔可夫模型
  const hmmP = runHMMModel(pSeq, 'parity');
  if (hmmP.match && (hmmP.val === 'ODD' || hmmP.val === 'EVEN')) {
    candidates.push({ type: 'parity', value: hmmP.val, confidence: hmmP.conf, modelName: hmmP.modelName });
  }

  const hmmS = runHMMModel(sSeq, 'size');
  if (hmmS.match && (hmmS.val === 'BIG' || hmmS.val === 'SMALL')) {
    candidates.push({ type: 'size', value: hmmS.val, confidence: hmmS.conf, modelName: hmmS.modelName });
  }

  // 4. LSTM 时间序列
  const lstmP = runLSTMModel(pSeq, 'parity');
  if (lstmP.match && (lstmP.val === 'ODD' || lstmP.val === 'EVEN')) {
    candidates.push({ type: 'parity', value: lstmP.val, confidence: lstmP.conf, modelName: lstmP.modelName });
  }

  const lstmS = runLSTMModel(sSeq, 'size');
  if (lstmS.match && (lstmS.val === 'BIG' || lstmS.val === 'SMALL')) {
    candidates.push({ type: 'size', value: lstmS.val, confidence: lstmS.conf, modelName: lstmS.modelName });
  }

  // 5. ARIMA 模型
  const arimaP = runARIMAModel(pSeq, 'parity');
  if (arimaP.match && (arimaP.val === 'ODD' || arimaP.val === 'EVEN')) {
    candidates.push({ type: 'parity', value: arimaP.val, confidence: arimaP.conf, modelName: arimaP.modelName });
  }

  const arimaS = runARIMAModel(sSeq, 'size');
  if (arimaS.match && (arimaS.val === 'BIG' || arimaS.val === 'SMALL')) {
    candidates.push({ type: 'size', value: arimaS.val, confidence: arimaS.conf, modelName: arimaS.modelName });
  }

  // 6. 熵值突变检测
  const entropyP = runEntropyModel(pSeq, 'parity');
  if (entropyP.match && (entropyP.val === 'ODD' || entropyP.val === 'EVEN')) {
    candidates.push({ type: 'parity', value: entropyP.val, confidence: entropyP.conf, modelName: entropyP.modelName });
  }

  const entropyS = runEntropyModel(sSeq, 'size');
  if (entropyS.match && (entropyS.val === 'BIG' || entropyS.val === 'SMALL')) {
    candidates.push({ type: 'size', value: entropyS.val, confidence: entropyS.conf, modelName: entropyS.modelName });
  }

  // 7. 蒙特卡洛模拟
  const montecarloP = runMonteCarloModel(pSeq, 'parity');
  if (montecarloP.match && (montecarloP.val === 'ODD' || montecarloP.val === 'EVEN')) {
    candidates.push({ type: 'parity', value: montecarloP.val, confidence: montecarloP.conf, modelName: montecarloP.modelName });
  }

  const montecarloS = runMonteCarloModel(sSeq, 'size');
  if (montecarloS.match && (montecarloS.val === 'BIG' || montecarloS.val === 'SMALL')) {
    candidates.push({ type: 'size', value: montecarloS.val, confidence: montecarloS.conf, modelName: montecarloS.modelName });
  }

  // 8. 小波变换分析
  const waveletP = runWaveletModel(pSeq, 'parity');
  if (waveletP.match && (waveletP.val === 'ODD' || waveletP.val === 'EVEN')) {
    candidates.push({ type: 'parity', value: waveletP.val, confidence: waveletP.conf, modelName: waveletP.modelName });
  }

  const waveletS = runWaveletModel(sSeq, 'size');
  if (waveletS.match && (waveletS.val === 'BIG' || waveletS.val === 'SMALL')) {
    candidates.push({ type: 'size', value: waveletS.val, confidence: waveletS.conf, modelName: waveletS.modelName });
  }

  // 9. 马尔可夫状态迁移
  const markovP = runMarkovModel(pSeq, 'parity');
  if (markovP.match && (markovP.val === 'ODD' || markovP.val === 'EVEN')) {
    candidates.push({ type: 'parity', value: markovP.val, confidence: markovP.conf, modelName: markovP.modelName });
  }

  const markovS = runMarkovModel(sSeq, 'size');
  if (markovS.match && (markovS.val === 'BIG' || markovS.val === 'SMALL')) {
    candidates.push({ type: 'size', value: markovS.val, confidence: markovS.conf, modelName: markovS.modelName });
  }

  // 10. 游程编码分析
  const rleP = runRLEModel(pSeq, 'parity');
  if (rleP.match && (rleP.val === 'ODD' || rleP.val === 'EVEN')) {
    candidates.push({ type: 'parity', value: rleP.val, confidence: rleP.conf, modelName: rleP.modelName });
  }

  const rleS = runRLEModel(sSeq, 'size');
  if (rleS.match && (rleS.val === 'BIG' || rleS.val === 'SMALL')) {
    candidates.push({ type: 'size', value: rleS.val, confidence: rleS.conf, modelName: rleS.modelName });
  }

  // 11. 斐波那契回撤
  const fibP = runFibonacciModel(pSeq, 'parity');
  if (fibP.match && (fibP.val === 'ODD' || fibP.val === 'EVEN')) {
    candidates.push({ type: 'parity', value: fibP.val, confidence: fibP.conf, modelName: fibP.modelName });
  }

  const fibS = runFibonacciModel(sSeq, 'size');
  if (fibS.match && (fibS.val === 'BIG' || fibS.val === 'SMALL')) {
    candidates.push({ type: 'size', value: fibS.val, confidence: fibS.conf, modelName: fibS.modelName });
  }

  // 12. 梯度动量模型
  const gradP = runGradientMomentumModel(pSeq, 'parity');
  if (gradP.match && (gradP.val === 'ODD' || gradP.val === 'EVEN')) {
    candidates.push({ type: 'parity', value: gradP.val, confidence: gradP.conf, modelName: gradP.modelName });
  }

  const gradS = runGradientMomentumModel(sSeq, 'size');
  if (gradS.match && (gradS.val === 'BIG' || gradS.val === 'SMALL')) {
    candidates.push({ type: 'size', value: gradS.val, confidence: gradS.conf, modelName: gradS.modelName });
  }

  // 13. EMA交叉分析
  const emaP = runEMACrossoverModel(pSeq, 'parity');
  if (emaP.match && (emaP.val === 'ODD' || emaP.val === 'EVEN')) {
    candidates.push({ type: 'parity', value: emaP.val, confidence: emaP.conf, modelName: emaP.modelName });
  }

  const emaS = runEMACrossoverModel(sSeq, 'size');
  if (emaS.match && (emaS.val === 'BIG' || emaS.val === 'SMALL')) {
    candidates.push({ type: 'size', value: emaS.val, confidence: emaS.conf, modelName: emaS.modelName });
  }

  // 14. 卡方检验模型
  const chiP = runChiSquaredModel(pSeq, 'parity');
  if (chiP.match && (chiP.val === 'ODD' || chiP.val === 'EVEN')) {
    candidates.push({ type: 'parity', value: chiP.val, confidence: chiP.conf, modelName: chiP.modelName });
  }

  const chiS = runChiSquaredModel(sSeq, 'size');
  if (chiS.match && (chiS.val === 'BIG' || chiS.val === 'SMALL')) {
    candidates.push({ type: 'size', value: chiS.val, confidence: chiS.conf, modelName: chiS.modelName });
  }

  // 15. N-gram模式识别
  const ngramP = runNgramModel(pSeq, 'parity');
  if (ngramP.match && (ngramP.val === 'ODD' || ngramP.val === 'EVEN')) {
    candidates.push({ type: 'parity', value: ngramP.val, confidence: ngramP.conf, modelName: ngramP.modelName });
  }

  const ngramS = runNgramModel(sSeq, 'size');
  if (ngramS.match && (ngramS.val === 'BIG' || ngramS.val === 'SMALL')) {
    candidates.push({ type: 'size', value: ngramS.val, confidence: ngramS.conf, modelName: ngramS.modelName });
  }

  // 16. 集成自适应投票
  const ensembleP = runEnsembleVotingModel(pSeq, 'parity');
  if (ensembleP.match && (ensembleP.val === 'ODD' || ensembleP.val === 'EVEN')) {
    candidates.push({ type: 'parity', value: ensembleP.val, confidence: ensembleP.conf, modelName: ensembleP.modelName });
  }

  const ensembleS = runEnsembleVotingModel(sSeq, 'size');
  if (ensembleS.match && (ensembleS.val === 'BIG' || ensembleS.val === 'SMALL')) {
    candidates.push({ type: 'size', value: ensembleS.val, confidence: ensembleS.conf, modelName: ensembleS.modelName });
  }

  // ============================================
  // 选择最优结果（分别选择单双和大小的最佳模型）
  // ============================================
  if (candidates.length === 0) {
    return {
      shouldPredict: false,
      nextParity: 'NEUTRAL',
      parityConfidence: 0,
      nextSize: 'NEUTRAL',
      sizeConfidence: 0,
      analysis: "所有模型均未达到触发阈值",
      detectedCycle: "观望中",
      riskLevel: "MEDIUM",
      entropyScore: 50,
      ruleId: rule.id
    };
  }

  // 分别找出单双和大小的最佳预测
  const parityCandidates = candidates.filter(c => c.type === 'parity');
  const sizeCandidates = candidates.filter(c => c.type === 'size');

  // 单双最佳
  let nextP: 'ODD' | 'EVEN' | 'NEUTRAL' = 'NEUTRAL';
  let confP = 0;
  let parityModel = '';
  if (parityCandidates.length > 0) {
    parityCandidates.sort((a, b) => b.confidence - a.confidence);
    const bestParity = parityCandidates[0];
    nextP = bestParity.value as 'ODD' | 'EVEN';
    confP = bestParity.confidence;
    parityModel = bestParity.modelName;
  }

  // 大小最佳
  let nextS: 'BIG' | 'SMALL' | 'NEUTRAL' = 'NEUTRAL';
  let confS = 0;
  let sizeModel = '';
  if (sizeCandidates.length > 0) {
    sizeCandidates.sort((a, b) => b.confidence - a.confidence);
    const bestSize = sizeCandidates[0];
    nextS = bestSize.value as 'BIG' | 'SMALL';
    confS = bestSize.confidence;
    sizeModel = bestSize.modelName;
  }

  // 模型共识投票：多模型一致时增强置信度，分歧时降低
  if (parityCandidates.length >= 3) {
    const majorityVal = parityCandidates[0].value;
    const agreeCount = parityCandidates.filter(c => c.value === majorityVal).length;
    if (agreeCount >= 3) confP = Math.min(99, confP + 3);
    else if (agreeCount === 1) confP = Math.max(85, confP - 3);
  }
  if (sizeCandidates.length >= 3) {
    const majorityVal = sizeCandidates[0].value;
    const agreeCount = sizeCandidates.filter(c => c.value === majorityVal).length;
    if (agreeCount >= 3) confS = Math.min(99, confS + 3);
    else if (agreeCount === 1) confS = Math.max(85, confS - 3);
  }

  // 收集所有触发的模型名称（去重）
  const contributingModels = [...new Set(candidates.map(c => c.modelName))];

  // 确定主导模型（用于显示）
  const primaryModel = confP >= confS ? parityModel : sizeModel;
  const maxConf = Math.max(confP, confS);

  // 计算真实 Shannon 熵（0~100 标度）
  const calcShannonEntropy = (seq: string): number => {
    const freq: Record<string, number> = {};
    for (const c of seq) freq[c] = (freq[c] || 0) + 1;
    let h = 0;
    for (const count of Object.values(freq)) {
      const p = count / seq.length;
      if (p > 0) h -= p * Math.log2(p);
    }
    // 二元序列最大熵 = 1.0，缩放到 0~100
    return Math.round(h * 100);
  };
  const entropy = Math.round((calcShannonEntropy(pSeq) + calcShannonEntropy(sSeq)) / 2);
  // 注意：二元序列的 Shannon 熵对于接近 50/50 的哈希数据通常在 95-100 之间
  // 不能用硬阈值（如 < 85）来过滤，否则几乎所有预测都会被阻断
  // 改用模型置信度为主要决策依据，熵值仅用于风险等级评估
  const shouldPredict = confP >= 90 || confS >= 90;

  // 生成分析文本
  let analysis = '';
  if (nextP !== 'NEUTRAL' && nextS !== 'NEUTRAL') {
    if (parityModel === sizeModel) {
      analysis = `${parityModel} 探测到 [${rule.label}] 的哈希流呈显著共振。`;
    } else {
      analysis = `${parityModel} 和 ${sizeModel} 探测到 [${rule.label}] 的哈希流呈显著共振。`;
    }
  } else if (nextP !== 'NEUTRAL') {
    analysis = `${parityModel} 探测到 [${rule.label}] 的单双哈希流呈显著共振。`;
  } else if (nextS !== 'NEUTRAL') {
    analysis = `${sizeModel} 探测到 [${rule.label}] 的大小哈希流呈显著共振。`;
  }

  return {
    shouldPredict,
    nextParity: nextP,
    parityConfidence: Math.min(99, Math.round(confP)),
    nextSize: nextS,
    sizeConfidence: Math.min(99, Math.round(confS)),
    analysis,
    detectedCycle: primaryModel || '观望中',
    riskLevel: entropy < 60 ? 'LOW' : entropy < 85 ? 'MEDIUM' : 'HIGH',
    entropyScore: entropy,
    targetHeight,
    ruleId: rule.id,
    contributingModels
  };
};
