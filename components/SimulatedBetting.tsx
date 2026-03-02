
import React, { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import { BlockData, IntervalRule } from '../types';
import { 
  Gamepad2, Wallet, TrendingUp, History, CheckCircle2, XCircle, 
  Trash2, Clock, Settings2, PlayCircle, StopCircle, RefreshCw, 
  ChevronDown, ChevronUp, AlertTriangle, Target, ArrowRight, Percent, BarChart4,
  Plus, Layers, Activity, PauseCircle, Power, TrendingDown, BrainCircuit, ShieldAlert,
  ZoomIn, X, Maximize2, MoveHorizontal, Sparkles, Scale, Trophy, Shuffle, BarChart2, Flame
} from 'lucide-react';
import {
  loadBalance,
  debouncedSaveBalance,
  loadBetRecords,
  saveBetRecords,
  loadBetTasks,
  debouncedSaveBetTasks,
  loadBetConfig,
  debouncedSaveBetConfig,
  loadGlobalMetrics,
  debouncedSaveGlobalMetrics
} from '../services/bettingApi';
import {
  runHMMModel, runLSTMModel, runARIMAModel, runEntropyModel,
  runMonteCarloModel, runWaveletModel, runMarkovModel, checkDensity as checkDensityModel,
  getBayesianConf as getBayesianConfModel, runRLEModel, runFibonacciModel,
  runGradientMomentumModel, runEMACrossoverModel, runChiSquaredModel,
  runNgramModel, runEnsembleVotingModel
} from '../utils/aiModels';

interface SimulatedBettingProps {
  allBlocks: BlockData[];
  rules: IntervalRule[];
}

const FRONTEND_VERSION = 'v5.1';

// ---------------------- TYPES ----------------------

type BetType = 'PARITY' | 'SIZE';
type BetTarget = 'ODD' | 'EVEN' | 'BIG' | 'SMALL';
type StrategyType = 'MANUAL' | 'MARTINGALE' | 'DALEMBERT' | 'FLAT' | 'FIBONACCI' | 'PAROLI' | '1326' | 'CUSTOM' | 'AI_KELLY';
type AutoTargetMode = 'FIXED' | 'RANDOM' | 'FOLLOW_LAST' | 'REVERSE_LAST' | 'GLOBAL_TREND_DRAGON' | 'GLOBAL_BEAD_DRAGON' | 'AI_PREDICTION' | 'GLOBAL_AI_FULL_SCAN' | 'FOLLOW_RECENT_TREND' | 'FOLLOW_RECENT_TREND_REVERSE' | 'DRAGON_FOLLOW' | 'DRAGON_REVERSE'
  // v5.1 新增
  | 'AI_MODEL_SELECT'       // 选择特定模型预测
  | 'AI_WINRATE_TRIGGER'    // 胜率触发投注
  | 'BEAD_DRAGON_FOLLOW'    // 单规则珠盘长龙顺势
  | 'BEAD_DRAGON_REVERSE'   // 单规则珠盘长龙反势
  | 'RULE_TREND_DRAGON'     // 单/多规则走势长龙
  | 'RULE_BEAD_DRAGON'      // 单/多规则珠盘长龙
  // v5.2 新增
  | 'OSCILLATION_REVERSE'   // 振荡反转：连续N次相同后反向下注
  | 'PATTERN_MATCH'         // 模式匹配：历史模式匹配预测
  // Legacy modes (backward compatibility - auto-migrated on load)
  | 'FIXED_ODD' | 'FIXED_EVEN' | 'FIXED_BIG' | 'FIXED_SMALL' | 'RANDOM_PARITY' | 'RANDOM_SIZE';

interface BetRecord {
  id: string;
  taskId?: string; // ID of the auto-task (if auto)
  taskName?: string; // Name of the auto-task
  timestamp: number;
  ruleId: string;
  ruleName: string;
  targetHeight: number;
  betType: BetType;
  prediction: BetTarget;
  amount: number;
  odds: number;
  status: 'PENDING' | 'WIN' | 'LOSS';
  payout: number;
  resultVal?: string;
  strategyLabel?: string;
  balanceAfter: number;
}

interface SimConfig {
  initialBalance: number;
  odds: number;
  stopLoss: number;
  takeProfit: number;
  stopLossPercent?: number;   // 百分比止损 (例: 20 = 亏损20%本金时停止)
  takeProfitPercent?: number; // 百分比止盈 (例: 50 = 盈利50%本金时停止)
  baseBet: number;
}

// 可用模型列表
const AI_MODEL_LIST = [
  { id: 'hmm', name: '隐马尔可夫' },
  { id: 'lstm', name: 'LSTM时序' },
  { id: 'arima', name: 'ARIMA' },
  { id: 'entropy', name: '熵值突变' },
  { id: 'montecarlo', name: '蒙特卡洛' },
  { id: 'wavelet', name: '小波变换' },
  { id: 'markov', name: '马尔可夫' },
  { id: 'density', name: '密集簇群' },
  { id: 'bayesian', name: '贝叶斯' },
  { id: 'rle', name: '游程编码' },
  { id: 'fibonacci', name: '斐波那契' },
  { id: 'gradient', name: '梯度动量' },
  { id: 'ema', name: 'EMA交叉' },
  { id: 'chisquared', name: '卡方检验' },
  { id: 'ngram', name: 'N-gram' },
  { id: 'ensemble', name: '集成投票' },
];

interface StrategyConfig {
  type: StrategyType;
  autoTarget: AutoTargetMode;
  targetType: 'PARITY' | 'SIZE';
  multiplier: number;
  maxCycle: number;
  step: number;
  minStreak: number;
  targetSelections?: BetTarget[]; // Multi-select: which targets to bet on (单/双/大/小)
  customSequence?: number[]; // Added for Custom Strategy
  kellyFraction?: number; // 0.1 to 1.0
  trendWindow?: number; // Added for FOLLOW_RECENT_TREND (e.g. 5, 6, 4)
  dragonEndStreak?: number; // Dragon follow/reverse: stop betting after this streak count
  // v5.1: AI模型选择
  selectedModels?: string[];  // 选中的模型ID列表
  // v5.1: 胜率触发
  winRateWindow?: number;   // 近N期 (10, 20, 30)
  winRateTrigger?: number;  // 触发阈值% (20, 30)
  winRateStop?: number;     // 停止阈值% (50, 60)
  // v5.1: 多规则选择
  selectedRuleIds?: string[];  // 选中的规则ID列表 (用于 RULE_TREND_DRAGON, RULE_BEAD_DRAGON)
  // v5.2: 振荡反转参数
  oscillationCount?: number;    // 连续N次相同后反向下注 (默认3)
  // v5.2: 模式匹配参数
  patternLength?: number;       // 匹配模式长度 (默认4)
  patternMinMatch?: number;     // 最小匹配次数 (默认3)
}

interface StrategyState {
  consecutiveLosses: number;
  currentBetAmount: number;
  sequenceIndex: number;
}

// NEW: Interface for a single auto-betting task
interface AutoTask {
  id: string;
  name: string;
  createTime: number;
  ruleId: string; // The rule this task follows (e.g., 3s, 6s)
  config: StrategyConfig; // Snapshot of strategy config
  baseBet: number; // Snapshot of base bet
  state: StrategyState; // Runtime state (martingale progress, etc.)
  isActive: boolean;
  betMode: 'SIMULATED' | 'REAL'; // 模拟下注 or 真实下注(通过插件)
  // 区块范围限制
  blockRangeEnabled?: boolean;
  blockStart?: number;
  blockEnd?: number;
  // 时间范围限制
  timeRangeEnabled?: boolean;
  timeStart?: string; // ISO datetime string (e.g., '2026-02-23T10:00:00')
  timeEnd?: string;   // ISO datetime string
  dailyScheduleEnabled?: boolean;
  dailyStart?: string; // HH:MM format (e.g., '10:00')
  dailyEnd?: string;   // HH:MM format
  // v5.1: 胜率触发任务的运行时状态
  aiWinRateActive?: boolean; // 胜率达到触发阈值后变为true, 达到停止阈值后变为false
  recentPredictions?: { correct: boolean; timestamp: number }[]; // 近期预测结果
  // v5.1-fix: 影子预测 - 持续追踪模型预测准确率（无论是否投注）
  shadowPrediction?: { targetHeight: number; prediction: BetTarget; betType: BetType };
  stats: {
    wins: number;
    losses: number;
    profit: number;
    maxProfit: number; // Highest profit reached
    maxLoss: number;   // Lowest profit reached (Max Drawdown)
    totalBetAmount: number; // Total volume wagered
    peakProfit: number; // High water mark for profit (for drawdown calc)
    maxDrawdown: number; // Max drawdown amount
  };
}

interface GlobalMetrics {
  peakBalance: number;
  maxDrawdown: number;
}

interface ChartPoint {
  value: number;
  timestamp: number;
  label?: string;
}

// ---------------------- CONSTANTS & HELPERS ----------------------

const STRATEGY_LABELS: Record<string, string> = {
  'MANUAL': '手动下注',
  'FLAT': '平注策略',
  'MARTINGALE': '马丁格尔',
  'DALEMBERT': '达朗贝尔',
  'FIBONACCI': '斐波那契',
  'PAROLI': '帕罗利',
  '1326': '1-3-2-6',
  'CUSTOM': '自定义倍投',
  'AI_KELLY': 'AI 动态凯利'
};

const FIB_SEQ = [1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610];
const SEQ_1326 = [1, 3, 2, 6];

const getNextTargetHeight = (currentHeight: number, step: number, startBlock: number) => {
  const offset = startBlock || 0;
  if (step <= 1) return currentHeight + 1;
  const diff = currentHeight - offset;
  const nextMultiplier = Math.floor(diff / step) + 1;
  const nextHeight = offset + (nextMultiplier * step);
  return nextHeight > currentHeight ? nextHeight : nextHeight + step;
};

// Helper: Get blocks belonging to a specific Bead Road Row
const getBeadRowBlocks = (blocks: BlockData[], rule: IntervalRule, rowIdx: number) => {
    const epoch = rule.startBlock || 0;
    const interval = rule.value;
    const rows = rule.beadRows || 6;
    
    return blocks.filter(b => {
        // Alignment check first
        if(rule.value > 1) {
            if(rule.startBlock > 0 && b.height < rule.startBlock) return false;
            if(rule.startBlock > 0 && (b.height - rule.startBlock) % rule.value !== 0) return false;
            if(rule.startBlock === 0 && b.height % rule.value !== 0) return false;
        }
        
        const h = b.height;
        const logicalIdx = Math.floor((h - epoch) / interval);
        return (logicalIdx % rows) === rowIdx;
    }).sort((a, b) => b.height - a.height);
};

// Helper: AI Analysis (Embedded from AIPrediction logic for self-containment)
const runAIAnalysis = (blocks: BlockData[], rule: IntervalRule) => {
  const checkAlignment = (h: number) => {
    if (rule.value <= 1) return true;
    if (rule.startBlock > 0) return h >= rule.startBlock && (h - rule.startBlock) % rule.value === 0;
    return h % rule.value === 0;
  };

  const ruleBlocks = blocks.filter(b => checkAlignment(b.height)).slice(0, 80);
  if (ruleBlocks.length < 24) return { shouldPredict: false, nextP: null, confP: 0, nextS: null, confS: 0 };

  const pSeq = ruleBlocks.slice(0, 12).map(b => b.type === 'ODD' ? 'O' : 'E').join('');
  const sSeq = ruleBlocks.slice(0, 12).map(b => b.sizeType === 'BIG' ? 'B' : 'S').join('');
  const oddCount = ruleBlocks.filter(b => b.type === 'ODD').length;
  const bigCount = ruleBlocks.filter(b => b.sizeType === 'BIG').length;
  const pBias = (oddCount / ruleBlocks.length);
  const sBias = (bigCount / ruleBlocks.length);

  let nextP: 'ODD'|'EVEN'|null = null;
  let confP = 50;
  let nextS: 'BIG'|'SMALL'|null = null;
  let confS = 50;

  const getBayesianConf = (bias: number) => {
    const deviation = Math.abs(bias - 0.5);
    if (deviation > 0.18) return 94;
    if (deviation > 0.12) return 88;
    return 50;
  };

  const checkPeriodicity = (seq: string) => {
    if (seq.startsWith('OEOEOE') || seq.startsWith('EOEOEO')) return { match: true, val: seq[0] === 'O' ? 'EVEN' : 'ODD', conf: 93 };
    if (seq.startsWith('OOEEOO') || seq.startsWith('EEOOEE')) return { match: true, val: seq[0] === 'O' ? 'EVEN' : 'ODD', conf: 91 };
    if (seq.startsWith('BSBSBS') || seq.startsWith('SBSBSB')) return { match: true, val: seq[0] === 'B' ? 'SMALL' : 'BIG', conf: 93 };
    if (seq.startsWith('BBSSBB') || seq.startsWith('SSBBSS')) return { match: true, val: seq[0] === 'B' ? 'SMALL' : 'BIG', conf: 91 };
    return { match: false, val: null, conf: 0 };
  };

  const checkDensity = (seq: string) => {
    if (seq.startsWith('OOOO')) return { match: true, val: 'ODD', conf: 95 }; 
    if (seq.startsWith('EEEE')) return { match: true, val: 'EVEN', conf: 95 };
    if (seq.startsWith('BBBB')) return { match: true, val: 'BIG', conf: 95 };
    if (seq.startsWith('SSSS')) return { match: true, val: 'SMALL', conf: 95 };
    return { match: false, val: null, conf: 0 };
  };

  const pPeriod = checkPeriodicity(pSeq);
  const pDensity = checkDensity(pSeq);
  const pBayesConf = getBayesianConf(pBias);

  if (pPeriod.match) { nextP = pPeriod.val as any; confP = pPeriod.conf; }
  else if (pDensity.match) { nextP = pDensity.val as any; confP = pDensity.conf; }
  else if (pBayesConf > 90) { nextP = pBias > 0.5 ? 'EVEN' : 'ODD'; confP = pBayesConf; }

  const sPeriod = checkPeriodicity(sSeq);
  const sDensity = checkDensity(sSeq);
  const sBayesConf = getBayesianConf(sBias);

  if (sPeriod.match) { nextS = sPeriod.val as any; confS = sPeriod.conf; }
  else if (sDensity.match) { nextS = sDensity.val as any; confS = sDensity.conf; }
  else if (sBayesConf > 90) { nextS = sBias > 0.5 ? 'SMALL' : 'BIG'; confS = sBayesConf; }

  // OPTIMIZATION: Enforce Single Best Result (Mutual Exclusion)
  // Ensure we only output the one result with the highest confidence
  if (confP > confS) {
      nextS = null;
      confS = 0;
  } else if (confS > confP) {
      nextP = null;
      confP = 0;
  } else {
      // Tie-breaker: if both equal and valid, default to Parity; if invalid, clear both
      if (confP >= 90) {
          nextS = null;
          confS = 0;
      } else {
          nextP = null; confP = 0;
          nextS = null; confS = 0;
      }
  }

  const entropy = Math.round(Math.random() * 20 + 10);
  const shouldPredict = (confP >= 92 || confS >= 92) && entropy < 40;

  return { shouldPredict, nextP, confP, nextS, confS };
};

// v5.1: 根据选中的模型ID运行分析
const MODEL_RUNNERS: Record<string, (seq: string, type: 'parity' | 'size') => { match: boolean; val: string; conf: number; modelName: string }> = {
  hmm: runHMMModel,
  lstm: runLSTMModel,
  arima: runARIMAModel,
  entropy: runEntropyModel,
  montecarlo: runMonteCarloModel,
  wavelet: runWaveletModel,
  markov: runMarkovModel,
  rle: runRLEModel,
  fibonacci: runFibonacciModel,
  gradient: runGradientMomentumModel,
  ema: runEMACrossoverModel,
  chisquared: runChiSquaredModel,
  ngram: runNgramModel,
  ensemble: runEnsembleVotingModel,
  density: (seq, type) => {
    const r = checkDensityModel(seq);
    return r;
  },
  bayesian: (seq, type) => {
    const primaryChar = type === 'parity' ? 'O' : 'B';
    const count = (seq.match(new RegExp(primaryChar, 'g')) || []).length;
    const bias = count / seq.length;
    const conf = getBayesianConfModel(bias);
    if (conf > 90) {
      const val = bias > 0.5 ? (type === 'parity' ? 'EVEN' : 'SMALL') : (type === 'parity' ? 'ODD' : 'BIG');
      return { match: true, val, conf, modelName: '贝叶斯后验推理' };
    }
    return { match: false, val: 'NEUTRAL', conf: 0, modelName: '贝叶斯后验推理' };
  },
};

const runSelectedModelsAnalysis = (blocks: BlockData[], rule: IntervalRule, selectedModelIds: string[]) => {
  const checkAlignment = (h: number) => {
    if (rule.value <= 1) return true;
    if (rule.startBlock > 0) return h >= rule.startBlock && (h - rule.startBlock) % rule.value === 0;
    return h % rule.value === 0;
  };
  const ruleBlocks = blocks.filter(b => checkAlignment(b.height)).slice(0, 80);
  if (ruleBlocks.length < 24) return { shouldPredict: false, nextP: null as BetTarget | null, confP: 0, nextS: null as BetTarget | null, confS: 0, models: [] as string[] };

  const pSeq = ruleBlocks.slice(0, 40).map(b => b.type === 'ODD' ? 'O' : 'E').join('');
  const sSeq = ruleBlocks.slice(0, 40).map(b => b.sizeType === 'BIG' ? 'B' : 'S').join('');

  const candidates: { type: 'parity' | 'size'; val: BetTarget; conf: number; model: string }[] = [];

  for (const modelId of selectedModelIds) {
    const runner = MODEL_RUNNERS[modelId];
    if (!runner) continue;

    const pResult = runner(pSeq, 'parity');
    if (pResult.match && (pResult.val === 'ODD' || pResult.val === 'EVEN')) {
      candidates.push({ type: 'parity', val: pResult.val as BetTarget, conf: pResult.conf, model: pResult.modelName });
    }
    const sResult = runner(sSeq, 'size');
    if (sResult.match && (sResult.val === 'BIG' || sResult.val === 'SMALL')) {
      candidates.push({ type: 'size', val: sResult.val as BetTarget, conf: sResult.conf, model: sResult.modelName });
    }
  }

  const pCands = candidates.filter(c => c.type === 'parity').sort((a, b) => b.conf - a.conf);
  const sCands = candidates.filter(c => c.type === 'size').sort((a, b) => b.conf - a.conf);

  const bestP = pCands[0];
  const bestS = sCands[0];
  const confP = bestP ? bestP.conf : 0;
  const confS = bestS ? bestS.conf : 0;
  const shouldPredict = confP >= 90 || confS >= 90;

  return {
    shouldPredict,
    nextP: bestP ? bestP.val : null,
    confP,
    nextS: bestS ? bestS.val : null,
    confS,
    models: candidates.map(c => c.model)
  };
};

// New Helper for path generation to reuse between main and mini charts
const generateChartPath = (
  data: ChartPoint[], 
  width: number, 
  height: number, 
  padding: { top: number, right: number, bottom: number, left: number },
  hidePoints = false
) => {
  if (data.length < 2) return { path: '', area: '', points: [], xTicks: [], yTicks: [], scales: null };

  const graphW = Math.max(0, width - padding.left - padding.right);
  const graphH = Math.max(0, height - padding.top - padding.bottom);

  const times = data.map(d => d.timestamp);
  const values = data.map(d => d.value);
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);

  const timeRange = maxTime - minTime || 1;
  const valRange = maxVal - minVal || 1; 
  const effectiveValRange = valRange === 0 ? 100 : valRange;
  const effectiveMinVal = valRange === 0 ? minVal - 50 : minVal;

  const getX = (t: number) => padding.left + ((t - minTime) / timeRange) * graphW;
  const getY = (v: number) => (height - padding.bottom) - ((v - effectiveMinVal) / effectiveValRange) * graphH;

  const pathD = data.map((d, i) => {
     const x = getX(d.timestamp);
     const y = getY(d.value);
     return `${i===0?'M':'L'} ${x} ${y}`;
  }).join(' ');

  const areaD = `${pathD} L ${getX(maxTime)} ${height - padding.bottom} L ${getX(minTime)} ${height - padding.bottom} Z`;

  // Ticks
  const xTicks = [];
  const tickCountX = 6;
  for(let i=0; i<=tickCountX; i++) {
     const t = minTime + (timeRange * (i/tickCountX));
     xTicks.push({ val: t, x: getX(t) });
  }

  const yTicks = [];
  const tickCountY = 5;
  for(let i=0; i<=tickCountY; i++) {
     const v = effectiveMinVal + (effectiveValRange * (i/tickCountY));
     yTicks.push({ val: v, y: getY(v) });
  }

  const pointCoords = hidePoints ? [] : data.map(d => ({
      x: getX(d.timestamp),
      y: getY(d.value),
      data: d
  }));

  return { path: pathD, area: areaD, xTicks, yTicks, points: pointCoords, scales: { getX, getY, minTime, maxTime } };
};

// Simplified SVG Chart for small view
const BalanceChart = ({ data, width, height }: { data: number[], width: number, height: number }) => {
  if (data.length < 2) return <div className="flex items-center justify-center h-full text-gray-300 text-xs font-medium">暂无足够数据</div>;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const padding = (max - min) * 0.1 || 10;
  const plotMin = min - padding;
  const plotMax = max + padding;
  const range = plotMax - plotMin || 1;
  const points = data.map((val, idx) => {
    const x = (idx / (data.length - 1)) * width;
    const y = height - ((val - plotMin) / range) * height;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <defs>
        <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6366f1" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline fill="none" stroke="#6366f1" strokeWidth="2" points={points} strokeLinecap="round" strokeLinejoin="round" />
      <polygon fill="url(#chartGradient)" points={`${0},${height} ${points} ${width},${height}`} opacity="0.5" />
      {data.length > 0 && (
        <circle cx={width} cy={height - ((data[data.length - 1] - plotMin) / range) * height} r="4" fill="#fff" stroke="#6366f1" strokeWidth="2" />
      )}
    </svg>
  );
};

// Updated DetailedChart with Brush
const DetailedChart = ({ data, onClose }: { data: ChartPoint[], onClose: () => void }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const miniMapRef = useRef<HTMLDivElement>(null);
  const [mainDims, setMainDims] = useState({ w: 0, h: 0 });
  const [miniDims, setMiniDims] = useState({ w: 0, h: 0 });
  
  // Selection range: [startPercentage, endPercentage] (0.0 to 1.0)
  const [range, setRange] = useState<[number, number]>([0, 1]);
  const dragInfo = useRef<{ startX: number; startRange: [number, number]; mode: 'left' | 'right' | 'move' } | null>(null);

  useEffect(() => {
    if (containerRef.current) {
      const ro = new ResizeObserver(entries => {
        for (let entry of entries) setMainDims({ w: entry.contentRect.width, h: entry.contentRect.height });
      });
      ro.observe(containerRef.current);
      return () => ro.disconnect();
    }
  }, []);

  useEffect(() => {
    if (miniMapRef.current) {
      const ro = new ResizeObserver(entries => {
        for (let entry of entries) setMiniDims({ w: entry.contentRect.width, h: entry.contentRect.height });
      });
      ro.observe(miniMapRef.current);
      return () => ro.disconnect();
    }
  }, []);

  // Filter data
  const totalPoints = data.length;
  // If we have very few points, don't filter too aggressively
  const safeRange = [range[0], Math.max(range[0] + 0.01, range[1])];
  const startIndex = Math.floor(safeRange[0] * (totalPoints - 1));
  const endIndex = Math.ceil(safeRange[1] * (totalPoints - 1));
  const filteredData = data.slice(startIndex, endIndex + 1);

  // Formatting
  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}`;
  };

  // Mouse Handlers for Brush
  const handleMouseDown = (e: React.MouseEvent, mode: 'left' | 'right' | 'move') => {
    e.preventDefault();
    e.stopPropagation();
    dragInfo.current = { startX: e.clientX, startRange: [...range] as [number, number], mode };
    document.body.style.cursor = mode === 'move' ? 'grabbing' : 'col-resize';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragInfo.current || !miniMapRef.current) return;
    const { startX, startRange, mode } = dragInfo.current;
    const rect = miniMapRef.current.getBoundingClientRect();
    const deltaX = e.clientX - startX;
    const deltaPercent = deltaX / rect.width;

    let newRange = [...startRange] as [number, number];
    const MIN_GAP = 0.05; // 5% minimum zoom window

    if (mode === 'move') {
      const span = startRange[1] - startRange[0];
      let start = startRange[0] + deltaPercent;
      let end = start + span;
      
      if (start < 0) { start = 0; end = span; }
      if (end > 1) { end = 1; start = 1 - span; }
      
      newRange = [start, end];
    } else if (mode === 'left') {
      newRange[0] = Math.max(0, Math.min(startRange[1] - MIN_GAP, startRange[0] + deltaPercent));
    } else if (mode === 'right') {
      newRange[1] = Math.min(1, Math.max(startRange[0] + MIN_GAP, startRange[1] + deltaPercent));
    }
    
    setRange(newRange);
  }, []);

  const handleMouseUp = useCallback(() => {
    dragInfo.current = null;
    document.body.style.cursor = '';
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  }, [handleMouseMove]);

  // Chart Graphics
  const mainChart = useMemo(() => 
    generateChartPath(filteredData, mainDims.w, mainDims.h, { top: 40, right: 40, bottom: 40, left: 60 }),
    [filteredData, mainDims]
  );

  const miniChart = useMemo(() => 
    generateChartPath(data, miniDims.w, miniDims.h, { top: 5, right: 0, bottom: 5, left: 0 }, true),
    [data, miniDims]
  );

  return (
    <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col p-6 animate-in zoom-in-95 relative border border-gray-100">
        <button onClick={onClose} className="absolute top-6 right-6 p-2 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors z-20">
            <X className="w-6 h-6 text-gray-500" />
        </button>
        <div className="mb-2 shrink-0">
            <h3 className="text-2xl font-black text-gray-900 flex items-center">
                <Activity className="w-6 h-6 mr-3 text-indigo-600" />
                资金池盈亏趋势详单
            </h3>
            <p className="text-sm text-gray-400 font-bold mt-1 pl-1">
                区间: {filteredData.length > 0 ? formatTime(filteredData[0].timestamp) : '--'} - {filteredData.length > 0 ? formatTime(filteredData[filteredData.length-1].timestamp) : '--'} 
                <span className="mx-2">|</span> 
                点数: {filteredData.length}
            </p>
        </div>

        {/* MAIN CHART */}
        <div className="flex-1 w-full relative overflow-hidden mb-4" ref={containerRef}>
            {mainDims.w > 0 && mainChart.path && (
                <svg width={mainDims.w} height={mainDims.h} className="overflow-visible">
                    {mainChart.yTicks.map(tick => (
                        <React.Fragment key={tick.val}>
                            <line x1={60} y1={tick.y} x2={mainDims.w - 40} y2={tick.y} stroke="#f1f5f9" strokeWidth="1" strokeDasharray="4 4" />
                            <text x={48} y={tick.y + 4} textAnchor="end" className="text-[10px] font-bold fill-gray-400 select-none">${tick.val.toFixed(0)}</text>
                        </React.Fragment>
                    ))}
                    {mainChart.xTicks.map(tick => (
                        <React.Fragment key={tick.val}>
                            <line x1={tick.x} y1={40} x2={tick.x} y2={mainDims.h - 40} stroke="#f1f5f9" strokeWidth="1" strokeDasharray="4 4" />
                            <text x={tick.x} y={mainDims.h - 15} textAnchor="middle" className="text-[10px] font-bold fill-gray-400 select-none">{formatTime(tick.val)}</text>
                        </React.Fragment>
                    ))}
                    <path d={mainChart.area} fill="url(#mainGradient)" opacity="0.1" />
                    <defs>
                        <linearGradient id="mainGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#4f46e5" stopOpacity="0.8" />
                            <stop offset="100%" stopColor="#4f46e5" stopOpacity="0" />
                        </linearGradient>
                    </defs>
                    <path d={mainChart.path} fill="none" stroke="#4f46e5" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                    {mainChart.points.map((p, i) => (
                        <circle key={i} cx={p.x} cy={p.y} r="3" fill="white" stroke="#4f46e5" strokeWidth="2" className="hover:r-6 transition-all cursor-crosshair">
                            <title>{`Time: ${new Date(p.data.timestamp).toLocaleTimeString()}\nBalance: $${p.data.value.toFixed(2)}\nLabel: ${p.data.label}`}</title>
                        </circle>
                    ))}
                </svg>
            )}
        </div>

        {/* MINI MAP & BRUSH */}
        <div className="h-20 shrink-0 w-full relative select-none" ref={miniMapRef}>
            {/* Background Chart */}
            <div className="absolute inset-0 bg-gray-50 rounded-lg overflow-hidden border border-gray-100">
                {miniDims.w > 0 && miniChart.path && (
                    <svg width={miniDims.w} height={miniDims.h} className="overflow-visible block">
                        <path d={miniChart.area} fill="#e2e8f0" />
                        <path d={miniChart.path} fill="none" stroke="#94a3b8" strokeWidth="1" />
                    </svg>
                )}
            </div>

            {/* Brush Overlay */}
            {miniDims.w > 0 && (
                <div className="absolute inset-0">
                    {/* Unselected Left */}
                    <div 
                        className="absolute top-0 bottom-0 left-0 bg-gray-900/10 backdrop-blur-[1px] border-r border-gray-300"
                        style={{ width: `${range[0] * 100}%` }}
                    ></div>
                    
                    {/* Unselected Right */}
                    <div 
                        className="absolute top-0 bottom-0 right-0 bg-gray-900/10 backdrop-blur-[1px] border-l border-gray-300"
                        style={{ width: `${(1 - range[1]) * 100}%` }}
                    ></div>

                    {/* Active Window */}
                    <div 
                        className="absolute top-0 bottom-0 group cursor-grab active:cursor-grabbing hover:bg-indigo-500/5 transition-colors"
                        style={{ left: `${range[0] * 100}%`, width: `${(range[1] - range[0]) * 100}%` }}
                        onMouseDown={(e) => handleMouseDown(e, 'move')}
                    >
                        {/* Drag Handle Left */}
                        <div 
                            className="absolute top-0 bottom-0 -left-1.5 w-3 cursor-col-resize flex items-center justify-center z-10 hover:scale-110 active:scale-110 transition-transform"
                            onMouseDown={(e) => handleMouseDown(e, 'left')}
                        >
                            <div className="w-1.5 h-8 bg-indigo-500 rounded-full shadow-md"></div>
                        </div>

                        {/* Top/Bottom Borders */}
                        <div className="absolute top-0 left-0 right-0 h-0.5 bg-indigo-500/50"></div>
                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500/50"></div>

                        {/* Center Drag Indicator */}
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <MoveHorizontal className="w-4 h-4 text-indigo-400" />
                        </div>

                        {/* Drag Handle Right */}
                        <div 
                            className="absolute top-0 bottom-0 -right-1.5 w-3 cursor-col-resize flex items-center justify-center z-10 hover:scale-110 active:scale-110 transition-transform"
                            onMouseDown={(e) => handleMouseDown(e, 'right')}
                        >
                            <div className="w-1.5 h-8 bg-indigo-500 rounded-full shadow-md"></div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    </div>
  );
};

// ---------------------- MAIN COMPONENT ----------------------

const SimulatedBetting: React.FC<SimulatedBettingProps> = ({ allBlocks, rules }) => {
  
  // 数据加载状态
  const [isLoadingData, setIsLoadingData] = useState(true);
  
  // 1. GLOBAL BALANCE & BETS - 从后端加载
  const [balance, setBalance] = useState<number>(10000);

  const [bets, setBets] = useState<BetRecord[]>([]);
  
  const [config, setConfig] = useState<SimConfig>({
    initialBalance: 10000,
    odds: 1.96,
    stopLoss: 0,
    takeProfit: 0,
    baseBet: 100
  });

  const [globalMetrics, setGlobalMetrics] = useState<GlobalMetrics>({
    peakBalance: 10000,
    maxDrawdown: 0
  });

  const [showFullChart, setShowFullChart] = useState(false);

  // 2. MULTI-TASK STATE - 从后端加载
  const [tasks, setTasks] = useState<AutoTask[]>([]);

  // 3. DRAFT CONFIG (For creating new tasks)
  const [draftName, setDraftName] = useState('我的托管策略');
  const [draftRuleId, setDraftRuleId] = useState<string>(rules[0]?.id || '');
  const [draftConfig, setDraftConfig] = useState<StrategyConfig>({
      type: 'FLAT',
      autoTarget: 'FIXED',
      targetType: 'PARITY',
      targetSelections: ['ODD'],
      multiplier: 2.0,
      maxCycle: 10,
      step: 10,
      minStreak: 1,
      customSequence: [1, 2, 4, 8, 17], // Default custom sequence
      kellyFraction: 0.2, // Default 20%
      trendWindow: 5,
      dragonEndStreak: 5
  });
  const [customSeqText, setCustomSeqText] = useState('1, 2, 4, 8, 17');
  // 自定义倍投序列 保存/加载/删除
  const [savedSequences, setSavedSequences] = useState<{name: string; sequence: number[]}[]>([]);
  const [seqSaveName, setSeqSaveName] = useState('');
  const [draftBetMode, setDraftBetMode] = useState<'SIMULATED' | 'REAL'>('SIMULATED');
  const [pluginReady, setPluginReady] = useState(false);
  const [realBalance, setRealBalance] = useState<number | null>(null);
  const [realBalancePeak, setRealBalancePeak] = useState<number | null>(null);
  const [realBalanceMaxDD, setRealBalanceMaxDD] = useState(0);
  const [chartFilterTaskId, setChartFilterTaskId] = useState<string>('all');
  // 区块范围 draft
  const [draftBlockRangeEnabled, setDraftBlockRangeEnabled] = useState(false);
  const [draftBlockStart, setDraftBlockStart] = useState<number>(0);
  const [draftBlockEnd, setDraftBlockEnd] = useState<number>(0);
  // 时间范围 draft
  const [draftTimeRangeEnabled, setDraftTimeRangeEnabled] = useState(false);
  const [draftTimeStart, setDraftTimeStart] = useState('');
  const [draftTimeEnd, setDraftTimeEnd] = useState('');
  const [draftDailyScheduleEnabled, setDraftDailyScheduleEnabled] = useState(false);
  const [draftDailyStart, setDraftDailyStart] = useState('10:00');
  const [draftDailyEnd, setDraftDailyEnd] = useState('10:10');

  const [activeManualRuleId, setActiveManualRuleId] = useState<string>(rules[0]?.id || '');
  const [showConfig, setShowConfig] = useState(true);

  // 修复: 当rules加载/变化时，确保draftRuleId和activeManualRuleId有效值
  useEffect(() => {
    if (rules.length > 0) {
      setDraftRuleId(prev => {
        if (!prev || !rules.find(r => r.id === prev)) return rules[0].id;
        return prev;
      });
      setActiveManualRuleId(prev => {
        if (!prev || !rules.find(r => r.id === prev)) return rules[0].id;
        return prev;
      });
    }
  }, [rules]);

  // 加载保存的自定义倍投序列
  useEffect(() => {
    try {
      const stored = localStorage.getItem('haxi-custom-sequences');
      if (stored) setSavedSequences(JSON.parse(stored));
    } catch { /* ignore */ }
  }, []);

  // ==================== 插件通信 ====================
  // 检测插件是否就绪 + 监听真实下注结果
  useEffect(() => {
    // 检测插件
    const checkPlugin = () => {
      document.dispatchEvent(new CustomEvent('haxi-query-ready'));
    };
    const updateRealBalance = (bal: number) => {
      setRealBalance(bal);
      setRealBalancePeak(prev => {
        const newPeak = prev == null ? bal : Math.max(prev, bal);
        // 更新最大回撤
        const dd = newPeak - bal;
        setRealBalanceMaxDD(prevDD => Math.max(prevDD, dd));
        return newPeak;
      });
    };

    const onReady = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.ready) {
        setPluginReady(true);
        if (detail.balance != null && typeof detail.balance === 'number') updateRealBalance(detail.balance);
      }
    };
    // 余额响应
    const onBalance = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.balance != null && typeof detail.balance === 'number') updateRealBalance(detail.balance);
    };
    // 下注结果响应
    const onBetResult = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;
      console.log('[SimBetting] 收到插件下注结果:', detail);
      if (detail.balanceAfter !== null && detail.balanceAfter !== undefined && typeof detail.balanceAfter === 'number') {
        updateRealBalance(detail.balanceAfter);
      }
    };

    document.addEventListener('haxi-ready-result', onReady);
    document.addEventListener('haxi-balance-result', onBalance);
    document.addEventListener('haxi-bet-result', onBetResult);
    // 首次检测 + 定期检测
    checkPlugin();
    const timer = setInterval(checkPlugin, 10000);
    // 定期查询余额 (每5秒)
    const queryBalance = () => {
      document.dispatchEvent(new CustomEvent('haxi-query-balance'));
    };
    const balanceTimer = setInterval(queryBalance, 5000);

    return () => {
      document.removeEventListener('haxi-ready-result', onReady);
      document.removeEventListener('haxi-balance-result', onBalance);
      document.removeEventListener('haxi-bet-result', onBetResult);
      clearInterval(timer);
      clearInterval(balanceTimer);
    };
  }, []);

  // Derived Values
  const manualRule = useMemo(() => rules.find(r => r.id === activeManualRuleId) || rules[0], [rules, activeManualRuleId]);
  
  // PREPARE CHART DATA (With Timestamps)
  const chartData: ChartPoint[] = useMemo(() => {
    let settled = bets.filter(b => b.status !== 'PENDING');
    // 按任务筛选
    if (chartFilterTaskId !== 'all') {
      settled = settled.filter(b => b.taskId === chartFilterTaskId);
    }
    const reversed = [...settled].reverse();
    const startTime = reversed.length > 0 ? reversed[0].timestamp - 1000 : Date.now();
    const initialPoint: ChartPoint = { value: config.initialBalance, timestamp: startTime, label: 'Initial' };

    // 如果筛选了单个任务，计算该任务的累计盈亏曲线
    if (chartFilterTaskId !== 'all') {
      let cumProfit = config.initialBalance;
      const points = reversed.map(b => {
        const betProfit = b.status === 'WIN' ? (b.payout - b.amount) : -b.amount;
        cumProfit += betProfit;
        return { value: cumProfit, timestamp: b.timestamp, label: `#${b.targetHeight}` };
      });
      return [initialPoint, ...points];
    }

    const points = reversed.map(b => ({
        value: b.balanceAfter,
        timestamp: b.timestamp,
        label: `#${b.targetHeight}`
    }));
    return [initialPoint, ...points];
  }, [bets, config.initialBalance, chartFilterTaskId]);

  const pendingBets = useMemo(() => bets.filter(b => b.status === 'PENDING'), [bets]);
  const settledBets = useMemo(() => bets.filter(b => b.status !== 'PENDING'), [bets]);

  // 从后端加载所有下注数据
  useEffect(() => {
    const loadAllData = async () => {
      setIsLoadingData(true);
      try {
        console.log('[下注] 🔄 开始从 Redis 加载数据...');
        
        // 并行加载所有数据
        const [balanceData, recordsData, tasksData, configData, metricsData] = await Promise.all([
          loadBalance(),
          loadBetRecords(5000),
          loadBetTasks(),
          loadBetConfig(),
          loadGlobalMetrics()
        ]);

        if (balanceData !== null) {
          setBalance(balanceData);
          console.log('[下注] ✅ 账户余额已加载:', balanceData);
        }
        
        if (recordsData && recordsData.length > 0) {
          setBets(recordsData);
          console.log('[下注] ✅ 下注记录已加载:', recordsData.length, '条');
        }
        
        if (tasksData && tasksData.length > 0) {
          // Migration support: ensure new fields exist
          const migratedTasks = tasksData.map((t: AutoTask) => {
            // 迁移旧 FIXED_* / RANDOM_* 模式到新合并模式
            let autoTarget = t.config.autoTarget;
            let targetSelections = t.config.targetSelections;
            if (!targetSelections) {
              if (autoTarget === 'FIXED_ODD') { autoTarget = 'FIXED'; targetSelections = ['ODD']; }
              else if (autoTarget === 'FIXED_EVEN') { autoTarget = 'FIXED'; targetSelections = ['EVEN']; }
              else if (autoTarget === 'FIXED_BIG') { autoTarget = 'FIXED'; targetSelections = ['BIG']; }
              else if (autoTarget === 'FIXED_SMALL') { autoTarget = 'FIXED'; targetSelections = ['SMALL']; }
              else if (autoTarget === 'RANDOM_PARITY') { autoTarget = 'RANDOM'; targetSelections = ['ODD', 'EVEN']; }
              else if (autoTarget === 'RANDOM_SIZE') { autoTarget = 'RANDOM'; targetSelections = ['BIG', 'SMALL']; }
              else { targetSelections = ['ODD', 'EVEN', 'BIG', 'SMALL']; } // Default: all targets
            }
            return {
              ...t,
              betMode: t.betMode || 'SIMULATED',
              stats: {
                ...t.stats,
                maxProfit: t.stats.maxProfit ?? 0,
                maxLoss: t.stats.maxLoss ?? 0,
                totalBetAmount: t.stats.totalBetAmount ?? 0,
                peakProfit: t.stats.peakProfit ?? Math.max(0, t.stats.profit),
                maxDrawdown: t.stats.maxDrawdown ?? 0
              },
              config: {
                ...t.config,
                autoTarget,
                targetSelections,
                trendWindow: t.config.trendWindow || 5
              }
            };
          });
          setTasks(migratedTasks);
          console.log('[下注] ✅ 托管任务已加载:', migratedTasks.length, '个');
        }
        
        if (configData) {
          setConfig(configData);
          console.log('[下注] ✅ 下注配置已加载');
        }
        
        if (metricsData) {
          setGlobalMetrics(metricsData);
          console.log('[下注] ✅ 全局指标已加载');
        }

        console.log('[下注] ✅ 从 Redis 加载数据成功');
      } catch (error) {
        console.error('[下注] ❌ 加载数据失败:', error);
        console.log('[下注] ℹ️ 使用默认数据');
      } finally {
        setIsLoadingData(false);
      }
    };

    loadAllData();
  }, []);

  // 余额变化时保存到后端
  useEffect(() => {
    if (!isLoadingData) {
      debouncedSaveBalance(balance);
    }
  }, [balance, isLoadingData]);

  // 下注记录变化时保存到后端（只保存最新的记录）
  useEffect(() => {
    if (!isLoadingData && bets.length > 0) {
      const latestBet = bets[0];
      if (latestBet && latestBet.status !== 'PENDING') {
        saveBetRecords([latestBet]).catch(err => 
          console.error('[下注] 保存记录失败:', err)
        );
      }
    }
  }, [bets, isLoadingData]);

  // 配置变化时保存到后端
  useEffect(() => {
    if (!isLoadingData) {
      debouncedSaveBetConfig(config);
    }
  }, [config, isLoadingData]);

  // 任务变化时保存到后端
  useEffect(() => {
    if (!isLoadingData) {
      debouncedSaveBetTasks(tasks);
    }
  }, [tasks, isLoadingData]);

  // 全局指标变化时保存到后端
  useEffect(() => {
    if (!isLoadingData) {
      debouncedSaveGlobalMetrics(globalMetrics);
    }
  }, [globalMetrics, isLoadingData]);

  // --- LOGIC HELPERS ---

  const checkRuleAlignment = useCallback((height: number, rule: IntervalRule) => {
    if (rule.value <= 1) return true;
    if (rule.startBlock > 0) return height >= rule.startBlock && (height - rule.startBlock) % rule.value === 0;
    return height % rule.value === 0;
  }, []);

  const calculateStreak = useCallback((blocks: BlockData[], type: BetType) => {
    if (blocks.length === 0) return { val: null, count: 0 };
    const key = type === 'PARITY' ? 'type' : 'sizeType';
    const firstVal = blocks[0][key];
    let count = 0;
    for (const b of blocks) {
      if (b[key] === firstVal) count++;
      else break;
    }
    return { val: firstVal, count };
  }, []);

  // Helper to generate task badge
  const getTaskBadgeContent = (task: AutoTask, rule?: IntervalRule) => {
    if (task.config.autoTarget === 'GLOBAL_AI_FULL_SCAN') return { text: 'AI 全域扫描', color: 'bg-indigo-100 text-indigo-600' };
    if (task.config.autoTarget.startsWith('GLOBAL')) return { text: '全域扫描', color: 'bg-amber-100 text-amber-600' };
    if (task.config.autoTarget === 'AI_PREDICTION') return { text: 'AI 单规托管', color: 'bg-purple-100 text-purple-600' };
    if (task.config.autoTarget === 'AI_MODEL_SELECT') return { text: `模型精选(${(task.config.selectedModels || []).length})`, color: 'bg-violet-100 text-violet-600' };
    if (task.config.autoTarget === 'AI_WINRATE_TRIGGER') return { text: `胜率触发 ${task.config.winRateTrigger||30}%→${task.config.winRateStop||60}%`, color: 'bg-cyan-100 text-cyan-600' };
    if (task.config.autoTarget === 'RULE_TREND_DRAGON') return { text: `规则走势龙(${(task.config.selectedRuleIds || []).length}规)`, color: 'bg-amber-100 text-amber-600' };
    if (task.config.autoTarget === 'RULE_BEAD_DRAGON') return { text: `规则珠盘龙(${(task.config.selectedRuleIds || []).length}规)`, color: 'bg-amber-100 text-amber-600' };
    if (task.config.autoTarget === 'OSCILLATION_REVERSE') return { text: `振荡反转(${task.config.oscillationCount || 3}连)`, color: 'bg-sky-100 text-sky-600' };
    if (task.config.autoTarget === 'PATTERN_MATCH') return { text: `模式匹配(${task.config.patternLength || 4}期)`, color: 'bg-fuchsia-100 text-fuchsia-600' };

    const ruleLabel = rule?.label || '未知规则';
    const targetLabels: Record<string, string> = { ODD: '单', EVEN: '双', BIG: '大', SMALL: '小' };
    const tsArr = task.config.targetSelections || [];
    const tsStr = tsArr.length >= 4 ? '全部' : tsArr.map(x => targetLabels[x] || x).join('');
    let detail = '';

    switch(task.config.autoTarget) {
        case 'FIXED': detail = `定投[${tsStr}]`; break;
        case 'FIXED_ODD': detail = '定投单'; break;
        case 'FIXED_EVEN': detail = '定投双'; break;
        case 'FIXED_BIG': detail = '定投大'; break;
        case 'FIXED_SMALL': detail = '定投小'; break;
        case 'FOLLOW_LAST': detail = `跟上期[${tsStr}]`; break;
        case 'REVERSE_LAST': detail = `反上期[${tsStr}]`; break;
        case 'RANDOM': detail = `随机[${tsStr}]`; break;
        case 'RANDOM_PARITY': detail = '随机单双'; break;
        case 'RANDOM_SIZE': detail = '随机大小'; break;
        case 'FOLLOW_RECENT_TREND': detail = `顺势N=${task.config.trendWindow || 5}[${tsStr}]`; break;
        case 'FOLLOW_RECENT_TREND_REVERSE': detail = `反势N=${task.config.trendWindow || 5}[${tsStr}]`; break;
        case 'DRAGON_FOLLOW': detail = `龙顺势[${tsStr}]`; break;
        case 'DRAGON_REVERSE': detail = `龙反势[${tsStr}]`; break;
        default: detail = '自定义';
    }

    return { text: `${ruleLabel} · ${detail}`, color: 'bg-slate-100 text-slate-600' };
  };

  // --- CORE ACTIONS ---

  const placeBet = useCallback((
    targetHeight: number, 
    type: BetType, 
    target: BetTarget, 
    amount: number, 
    source: 'MANUAL' | 'AUTO',
    rule: IntervalRule,
    taskId?: string,
    taskName?: string,
    strategyType?: string
  ) => {
    const isDuplicate = bets.some(b => 
      b.targetHeight === targetHeight && 
      b.ruleId === rule.id && 
      (source === 'MANUAL' ? !b.taskId : b.taskId === taskId)
    );
    
    if (isDuplicate) return false;

    const newBet: BetRecord = {
      id: Date.now().toString() + Math.random().toString().slice(2, 6),
      timestamp: Date.now(),
      ruleId: rule.id,
      ruleName: rule.label,
      targetHeight,
      betType: type,
      prediction: target,
      amount,
      odds: config.odds,
      status: 'PENDING',
      payout: 0,
      strategyLabel: strategyType || 'MANUAL',
      balanceAfter: 0, // Calculated on settlement
      taskId,
      taskName
    };

    setBalance(prev => prev - amount);
    setBets(prev => [newBet, ...prev]);
    return true;
  }, [bets, config.odds]);

  const createTask = () => {
    const newTask: AutoTask = {
      id: Date.now().toString(),
      name: draftName || `托管任务 ${tasks.length + 1}`,
      createTime: Date.now(),
      ruleId: draftRuleId,
      config: { ...draftConfig },
      baseBet: config.baseBet,
      state: {
        consecutiveLosses: 0,
        currentBetAmount: draftConfig.type === 'CUSTOM' && draftConfig.customSequence ? config.baseBet * draftConfig.customSequence[0] : config.baseBet,
        sequenceIndex: 0
      },
      isActive: false, // Default to paused
      betMode: draftBetMode,
      // 区块范围
      blockRangeEnabled: draftBlockRangeEnabled,
      blockStart: draftBlockStart,
      blockEnd: draftBlockEnd,
      // 时间范围
      timeRangeEnabled: draftTimeRangeEnabled,
      timeStart: draftTimeStart,
      timeEnd: draftTimeEnd,
      dailyScheduleEnabled: draftDailyScheduleEnabled,
      dailyStart: draftDailyStart,
      dailyEnd: draftDailyEnd,
      // v5.1: 胜率触发运行时
      aiWinRateActive: false,
      recentPredictions: [],
      stats: {
        wins: 0,
        losses: 0,
        profit: 0,
        maxProfit: 0,
        maxLoss: 0,
        totalBetAmount: 0,
        peakProfit: 0,
        maxDrawdown: 0
      }
    };
    setTasks(prev => [...prev, newTask]);
    // Reset draft name
    setDraftName(`托管任务 ${tasks.length + 2}`);
  };

  const toggleTask = (taskId: string) => {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, isActive: !t.isActive } : t));
  };

  const startAllTasks = useCallback(() => {
    setTasks(prev => prev.map(t => ({ ...t, isActive: true })));
  }, []);

  const stopAllTasks = useCallback(() => {
    setTasks(prev => prev.map(t => ({ ...t, isActive: false })));
  }, []);

  const deleteAllTasks = useCallback(() => {
    setTasks([]);
  }, []);

  const deleteTask = (taskId: string) => {
    setTasks(prev => prev.filter(t => t.id !== taskId));
  };

  // 重置单个任务统计 (不删除任务)
  const resetTask = (taskId: string) => {
    setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      return {
        ...t,
        state: {
          currentBetAmount: t.baseBet * ((t.config.type === 'CUSTOM' && t.config.customSequence) ? t.config.customSequence[0] : 1),
          consecutiveLosses: 0,
          sequenceIndex: 0
        },
        stats: { wins: 0, losses: 0, profit: 0, maxProfit: 0, maxLoss: 0, totalBetAmount: 0, peakProfit: 0, maxDrawdown: 0 }
      };
    }));
  };

  // 编辑已停止的任务 (加载配置到编辑器)
  const editTask = (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || task.isActive) return; // 只能编辑已停止的任务
    setDraftName(task.name);
    setDraftRuleId(task.ruleId);
    setDraftConfig({ ...task.config });
    setDraftBetMode(task.betMode || 'SIMULATED');
    setDraftBlockRangeEnabled(!!task.blockRangeEnabled);
    setDraftBlockStart(task.blockStart || 0);
    setDraftBlockEnd(task.blockEnd || 0);
    setDraftTimeRangeEnabled(!!task.timeRangeEnabled);
    setDraftTimeStart(task.timeStart || '');
    setDraftTimeEnd(task.timeEnd || '');
    setDraftDailyScheduleEnabled(!!task.dailyScheduleEnabled);
    setDraftDailyStart(task.dailyStart || '10:00');
    setDraftDailyEnd(task.dailyEnd || '10:10');
    if (task.config.type === 'CUSTOM' && task.config.customSequence) {
      setCustomSeqText(task.config.customSequence.join(', '));
    }
    setShowConfig(true);
    // 删除旧任务 (用户会通过编辑器重新创建)
    setTasks(prev => prev.filter(t => t.id !== taskId));
  };

  // Fixed Reset Account: Immediate action, no confirmation dialog
  const resetAccount = useCallback((e?: React.MouseEvent) => {
    if (e) {
       e.preventDefault();
       e.stopPropagation();
    }
    
    // Defaults
    const defaults = {
      initialBalance: 10000,
      odds: 1.96, // CHANGED: Default odds 1.96
      stopLoss: 0,
      takeProfit: 0,
      baseBet: 100
    };

    // 1. Reset States
    setBalance(defaults.initialBalance);
    setConfig(defaults);
    setBets([]);
    // 保留托管任务但重置统计数据（下注金额、盈亏、最大盈利等）
    setTasks(prev => prev.map(t => ({
      ...t,
      isActive: false,
      state: {
        currentBetAmount: t.baseBet * ((t.config.type === 'CUSTOM' && t.config.customSequence) ? t.config.customSequence[0] : 1),
        consecutiveLosses: 0,
        sequenceIndex: 0
      },
      aiWinRateActive: false,
      recentPredictions: [],
      stats: { wins: 0, losses: 0, profit: 0, maxProfit: 0, maxLoss: 0, totalBetAmount: 0, peakProfit: 0, maxDrawdown: 0 }
    })));
    setGlobalMetrics({ peakBalance: defaults.initialBalance, maxDrawdown: 0 });

    // 2. Save to backend immediately
    debouncedSaveBalance(defaults.initialBalance);
    saveBetRecords([]);
    debouncedSaveGlobalMetrics({ peakBalance: defaults.initialBalance, maxDrawdown: 0 });
    debouncedSaveBetConfig(defaults);
  }, []);

  // --- THE MULTI-THREAD ENGINE ---
  useEffect(() => {
    if (allBlocks.length === 0) return;

    // We need to handle updates in a single pass to avoid race conditions with balance/bets
    let currentBalance = balance;
    let betsChanged = false;
    let tasksChanged = false;
    let metricsChanged = false;

    // Metrics temporary tracking
    let tempPeak = globalMetrics.peakBalance;
    let tempMaxDD = globalMetrics.maxDrawdown;
    
    const nextTasks = [...tasks]; // Clone for mutation
    
    // 1. SETTLE PENDING BETS & UPDATE TASK STATES
    const updatedBets = bets.map(bet => {
      if (bet.status === 'PENDING') {
        const targetBlock = allBlocks.find(b => b.height === bet.targetHeight);
        if (targetBlock) {
          betsChanged = true;
          let isWin = false;
          let resultVal = '';

          if (bet.betType === 'PARITY') {
            isWin = targetBlock.type === bet.prediction;
            resultVal = targetBlock.type === 'ODD' ? '单' : '双';
          } else {
            isWin = targetBlock.sizeType === bet.prediction;
            resultVal = targetBlock.sizeType === 'BIG' ? '大' : '小';
          }

          const payout = isWin ? bet.amount * bet.odds : 0;
          currentBalance += payout; // Add winnings (initial deduction already happened)

          // Global Drawdown Calculation
          if (currentBalance > tempPeak) {
             tempPeak = currentBalance;
          }
          const currentDD = tempPeak - currentBalance;
          if (currentDD > tempMaxDD) {
             tempMaxDD = currentDD;
             metricsChanged = true;
          }
          
          // Identify which task owns this bet and update its state
          if (bet.taskId) {
            const taskIndex = nextTasks.findIndex(t => t.id === bet.taskId);
            if (taskIndex !== -1) {
              tasksChanged = true;
              const task = nextTasks[taskIndex];
              
              // Update Stats
              const sessionProfit = (isWin ? payout : 0) - bet.amount;
              const newTotalProfit = task.stats.profit + sessionProfit;

              task.stats.wins += isWin ? 1 : 0;
              task.stats.losses += isWin ? 0 : 1;
              task.stats.profit = newTotalProfit;
              
              // Update Max/Min Records & Total Bet
              task.stats.maxProfit = Math.max(task.stats.maxProfit, newTotalProfit);
              task.stats.maxLoss = Math.min(task.stats.maxLoss, newTotalProfit);
              task.stats.totalBetAmount = (task.stats.totalBetAmount || 0) + bet.amount;

              // v5.1-fix: 胜率触发的预测准确率现在通过影子预测(shadowPrediction)持续追踪
              // 不再在此处追踪，避免与影子预测重复计数

              // Task Drawdown Calculation
              task.stats.peakProfit = Math.max(task.stats.peakProfit, newTotalProfit);
              const taskDD = task.stats.peakProfit - newTotalProfit;
              task.stats.maxDrawdown = Math.max(task.stats.maxDrawdown, taskDD);

              // Update Strategy State (Martingale, etc.)
              // AI_KELLY is stateless regarding sequences, it recalculates each time based on balance/confidence
              if (task.config.type !== 'AI_KELLY') {
                  let { currentBetAmount, consecutiveLosses, sequenceIndex } = task.state;
                  
                  switch (task.config.type) {
                    case 'MARTINGALE':
                      if (!isWin) {
                        const nextLosses = consecutiveLosses + 1;
                        if (nextLosses >= task.config.maxCycle) {
                          currentBetAmount = task.baseBet; // Reset
                          consecutiveLosses = 0;
                        } else {
                          currentBetAmount *= task.config.multiplier;
                          consecutiveLosses = nextLosses;
                        }
                      } else {
                        currentBetAmount = task.baseBet;
                        consecutiveLosses = 0;
                      }
                      break;
                    case 'DALEMBERT':
                       if (!isWin) {
                          currentBetAmount += task.config.step;
                          consecutiveLosses++;
                       } else {
                          currentBetAmount -= task.config.step;
                          if(currentBetAmount < task.baseBet) currentBetAmount = task.baseBet;
                          consecutiveLosses = 0;
                       }
                       break;
                    case 'FIBONACCI':
                       if (!isWin) {
                          sequenceIndex = Math.min(sequenceIndex + 1, FIB_SEQ.length - 1);
                       } else {
                          sequenceIndex = Math.max(0, sequenceIndex - 2);
                       }
                       currentBetAmount = task.baseBet * FIB_SEQ[sequenceIndex];
                       break;
                    case 'PAROLI':
                       if(isWin) {
                          sequenceIndex++;
                          if(sequenceIndex >= 3) {
                             sequenceIndex = 0;
                             currentBetAmount = task.baseBet;
                          } else {
                             currentBetAmount *= 2;
                          }
                       } else {
                          sequenceIndex = 0;
                          currentBetAmount = task.baseBet;
                       }
                       break;
                    case '1326':
                       if(isWin) {
                          sequenceIndex++;
                          if(sequenceIndex >= SEQ_1326.length) {
                             sequenceIndex = 0;
                             currentBetAmount = task.baseBet;
                          } else {
                             currentBetAmount = task.baseBet * SEQ_1326[sequenceIndex];
                          }
                       } else {
                          sequenceIndex = 0;
                          currentBetAmount = task.baseBet;
                       }
                       break;
                    case 'CUSTOM':
                        const cSeq = task.config.customSequence || [1];
                        if (!isWin) {
                           // Loss: move to next multiplier
                           if (sequenceIndex + 1 >= cSeq.length) {
                              sequenceIndex = 0; // End of sequence, reset
                           } else {
                              sequenceIndex++;
                           }
                        } else {
                           // Win: reset to start
                           sequenceIndex = 0;
                        }
                        currentBetAmount = task.baseBet * cSeq[sequenceIndex];
                        break;
                    default:
                       currentBetAmount = task.baseBet;
                  }
                  // Apply State
                  task.state = { currentBetAmount: Math.floor(currentBetAmount), consecutiveLosses, sequenceIndex };
              } else {
                  // For AI_KELLY, we can reset state to base just to keep it clean, though we calculate dynamically
                  task.state = { currentBetAmount: task.baseBet, consecutiveLosses: 0, sequenceIndex: 0 };
              }
            }
          }

          return { ...bet, status: isWin ? 'WIN' : 'LOSS', payout, resultVal, balanceAfter: currentBalance } as BetRecord;
        }
      }
      return bet;
    });

    // 2. PROCESS ACTIVE TASKS (PLACE NEW BETS)
    const finalBets = [...updatedBets];
    
    // Check stop loss/take profit globally? Or per task? 
    // Usually global balance check for protection
    const profit = currentBalance - config.initialBalance;
    const profitPct = config.initialBalance > 0 ? (profit / config.initialBalance) * 100 : 0;
    const globalStop = (config.takeProfit > 0 && profit >= config.takeProfit)
      || (config.stopLoss > 0 && profit <= -config.stopLoss)
      || (config.takeProfitPercent && config.takeProfitPercent > 0 && profitPct >= config.takeProfitPercent)
      || (config.stopLossPercent && config.stopLossPercent > 0 && profitPct <= -config.stopLossPercent);

    if (!globalStop) {
      const currentBlockHeight = allBlocks[0]?.height || 0;
      const now = Date.now();

      // 真实下注合并队列: 同一目标(单/双/大/小)的多任务下注金额合并为一次执行
      const realBetMergeMap = new Map<BetTarget, {
        totalAmount: number;
        blockHeight: number;
        betType: BetType;
        contributions: { taskId: string; taskName: string; amount: number; ruleId: string; }[];
      }>();
      const addToRealBetMerge = (target: BetTarget, amount: number, blockHeight: number, betType: BetType, taskId: string, taskName: string, ruleId: string) => {
        const existing = realBetMergeMap.get(target);
        if (existing) {
          existing.totalAmount += amount;
          existing.contributions.push({ taskId, taskName, amount, ruleId });
        } else {
          realBetMergeMap.set(target, {
            totalAmount: amount,
            blockHeight,
            betType,
            contributions: [{ taskId, taskName, amount, ruleId }]
          });
        }
      };

      nextTasks.forEach(task => {
        if (!task.isActive) return;
        // Basic bankruptcy check (for non-kelly, or kelly min)
        if (currentBalance < task.baseBet) {
          task.isActive = false; // Stop if bankrupt
          tasksChanged = true;
          return;
        }

        // 区块范围检查: 超出范围时自动停止任务
        if (task.blockRangeEnabled && task.blockStart && task.blockEnd) {
          if (currentBlockHeight < task.blockStart) return; // 还没开始
          if (currentBlockHeight > task.blockEnd) {
            task.isActive = false; // 超出范围，自动停止
            tasksChanged = true;
            return;
          }
        }

        // 时间范围检查
        if (task.timeRangeEnabled && task.timeStart && task.timeEnd) {
          const startMs = new Date(task.timeStart).getTime();
          const endMs = new Date(task.timeEnd).getTime();
          if (now < startMs) return; // 还没到开始时间
          if (now > endMs) {
            task.isActive = false; // 超出时间范围，自动停止
            tasksChanged = true;
            return;
          }
        }

        // 每日定时检查 (支持跨午夜, 如 23:00~01:00)
        if (task.dailyScheduleEnabled && task.dailyStart && task.dailyEnd) {
          const nowDate = new Date();
          const [sh, sm] = task.dailyStart.split(':').map(Number);
          const [eh, em] = task.dailyEnd.split(':').map(Number);
          const nowMinutes = nowDate.getHours() * 60 + nowDate.getMinutes();
          const startMinutes = sh * 60 + sm;
          const endMinutes = eh * 60 + em;
          if (endMinutes > startMinutes) {
            // 正常时段 (如 10:00~22:00)
            if (nowMinutes < startMinutes || nowMinutes > endMinutes) return;
          } else {
            // 跨午夜时段 (如 23:00~01:00)
            if (nowMinutes < startMinutes && nowMinutes > endMinutes) return;
          }
        }

        // GLOBAL FULL AI SCAN MODE
        if (task.config.autoTarget === 'GLOBAL_AI_FULL_SCAN') {
            const hasPending = finalBets.some(b => b.taskId === task.id && b.status === 'PENDING');
            if (hasPending) return;

            let bestCandidate = {
                confidence: 0,
                rule: null as IntervalRule | null,
                type: 'PARITY' as BetType,
                target: 'ODD' as BetTarget,
                height: 0,
                desc: ''
            };

            // 根据targetSelections过滤可用的下注类型
            const scanTS = task.config.targetSelections || ['ODD', 'EVEN', 'BIG', 'SMALL'];
            const scanHasParity = scanTS.some(t => t === 'ODD' || t === 'EVEN');
            const scanHasSize = scanTS.some(t => t === 'BIG' || t === 'SMALL');

            // Scan ALL rules
            rules.forEach(rule => {
                const analysis = runAIAnalysis(allBlocks, rule);
                if (!analysis.shouldPredict) return;

                const nextH = getNextTargetHeight(allBlocks[0].height, rule.value, rule.startBlock);

                // Parity Check (仅当用户选择了单/双目标时)
                if (scanHasParity && analysis.nextP && scanTS.includes(analysis.nextP as BetTarget) && analysis.confP > bestCandidate.confidence) {
                     bestCandidate = {
                         confidence: analysis.confP,
                         rule,
                         type: 'PARITY',
                         target: analysis.nextP as BetTarget,
                         height: nextH,
                         desc: `(AI全域 P:${analysis.confP}%)`
                     };
                }
                // Size Check (仅当用户选择了大/小目标时)
                if (scanHasSize && analysis.nextS && scanTS.includes(analysis.nextS as BetTarget) && analysis.confS > bestCandidate.confidence) {
                     bestCandidate = {
                         confidence: analysis.confS,
                         rule,
                         type: 'SIZE',
                         target: analysis.nextS as BetTarget,
                         height: nextH,
                         desc: `(AI全域 S:${analysis.confS}%)`
                     };
                }
            });

            // Threshold for Global Scan: stricter than usual
            if (bestCandidate.rule && bestCandidate.confidence >= 94) {
                 // Check if we already have this exact bet in finalBets (from other tasks or previous cycle logic)
                 const isDupe = finalBets.some(b => b.targetHeight === bestCandidate.height && b.ruleId === bestCandidate.rule!.id && b.taskId === task.id);
                 if (!isDupe) {
                      let amount = Math.floor(task.state.currentBetAmount);
                      
                      // AI KELLY CALCULATION
                      if (task.config.type === 'AI_KELLY') {
                          const b_odds = config.odds - 1;
                          const p = bestCandidate.confidence / 100; // Probability
                          const q = 1 - p;
                          const f = (b_odds * p - q) / b_odds; // Kelly Formula
                          
                          if (f > 0) {
                              const fraction = task.config.kellyFraction || 0.2;
                              amount = Math.floor(currentBalance * f * fraction);
                          } else {
                              amount = config.baseBet; // Fallback or 0
                          }
                          // Clamp amount
                          amount = Math.max(config.baseBet, amount);
                          amount = Math.min(amount, currentBalance);
                      }

                      const newBet: BetRecord = {
                          id: Date.now().toString() + Math.random().toString().slice(2, 6) + task.id,
                          taskId: task.id,
                          taskName: `${task.name} ${bestCandidate.desc}`,
                          timestamp: Date.now(),
                          ruleId: bestCandidate.rule.id,
                          ruleName: bestCandidate.rule.label,
                          targetHeight: bestCandidate.height,
                          betType: bestCandidate.type,
                          prediction: bestCandidate.target,
                          amount,
                          odds: config.odds,
                          status: 'PENDING',
                          payout: 0,
                          strategyLabel: task.config.type,
                          balanceAfter: 0
                      };
                      // 真实下注: 加入合并队列 (GLOBAL_AI_FULL_SCAN)
                      if (task.betMode === 'REAL') {
                        addToRealBetMerge(bestCandidate.target, amount, bestCandidate.height, bestCandidate.type, task.id, task.name, bestCandidate.rule!.id);
                      }

                      currentBalance -= amount;
                      finalBets.unshift(newBet);
                      betsChanged = true;
                 }
            }
            return;
        }

        // GLOBAL TASKS: Scan all rules
        if (task.config.autoTarget.startsWith('GLOBAL') && task.config.autoTarget !== 'GLOBAL_AI_FULL_SCAN') {
            // Check if this task already has a pending bet (Strict sequential betting)
            const hasPending = finalBets.some(b => b.taskId === task.id && b.status === 'PENDING');
            if (hasPending) return;

            let bestCandidate = { streak: 0, rule: null as IntervalRule | null, type: 'PARITY' as BetType, target: 'ODD' as BetTarget, height: 0, desc: '' };

            rules.forEach(rule => {
                if (task.config.autoTarget === 'GLOBAL_TREND_DRAGON') {
                    const ruleBlocks = allBlocks.filter(b => checkRuleAlignment(b.height, rule));
                    if (ruleBlocks.length === 0) return;
                    
                    const nextH = getNextTargetHeight(allBlocks[0].height, rule.value, rule.startBlock);
                    
                    // Parity
                    const pStreak = calculateStreak(ruleBlocks, 'PARITY');
                    if (pStreak.count > bestCandidate.streak) {
                        bestCandidate = { streak: pStreak.count, rule, type: 'PARITY', target: pStreak.val as BetTarget, height: nextH, desc: `(走势${pStreak.count}连)` };
                    }
                    // Size
                    const sStreak = calculateStreak(ruleBlocks, 'SIZE');
                    if (sStreak.count > bestCandidate.streak) {
                        bestCandidate = { streak: sStreak.count, rule, type: 'SIZE', target: sStreak.val as BetTarget, height: nextH, desc: `(走势${sStreak.count}连)` };
                    }

                } else if (task.config.autoTarget === 'GLOBAL_BEAD_DRAGON') {
                    const rows = rule.beadRows || 6;
                    for(let r=0; r<rows; r++) {
                         const rowBlocks = getBeadRowBlocks(allBlocks, rule, r);
                         if (rowBlocks.length === 0) continue;
                         
                         // Check Parity
                         const pStreak = calculateStreak(rowBlocks, 'PARITY');
                         if (pStreak.count > bestCandidate.streak) {
                             const lastH = rowBlocks[0].height;
                             const nextH = lastH + (rule.value * rows); // Physics of bead road
                             if (nextH > allBlocks[0].height) {
                                 bestCandidate = { streak: pStreak.count, rule, type: 'PARITY', target: pStreak.val as BetTarget, height: nextH, desc: `(珠盘R${r+1} ${pStreak.count}连)` };
                             }
                         }
                         // Check Size
                         const sStreak = calculateStreak(rowBlocks, 'SIZE');
                         if (sStreak.count > bestCandidate.streak) {
                             const lastH = rowBlocks[0].height;
                             const nextH = lastH + (rule.value * rows);
                             if (nextH > allBlocks[0].height) {
                                 bestCandidate = { streak: sStreak.count, rule, type: 'SIZE', target: sStreak.val as BetTarget, height: nextH, desc: `(珠盘R${r+1} ${sStreak.count}连)` };
                             }
                         }
                    }
                }
            });

            // If we found a candidate satisfying min streak
            if (bestCandidate.streak >= task.config.minStreak && bestCandidate.rule) {
                // Double check if we already have this exact bet in finalBets (from other tasks or previous cycle logic)
                const isDupe = finalBets.some(b => b.targetHeight === bestCandidate.height && b.ruleId === bestCandidate.rule!.id && b.taskId === task.id);
                if (!isDupe) {
                     let amount = Math.floor(task.state.currentBetAmount);
                     
                     // AI KELLY CALCULATION (Fallback for non-AI targets)
                     if (task.config.type === 'AI_KELLY') {
                          // Assume a moderate confidence for following dragons (e.g., 60%)
                          const confidence = 60;
                          const b_odds = config.odds - 1;
                          const p = confidence / 100;
                          const q = 1 - p;
                          const f = (b_odds * p - q) / b_odds;
                          
                          if (f > 0) {
                              const fraction = task.config.kellyFraction || 0.2;
                              amount = Math.floor(currentBalance * f * fraction);
                          } else {
                              amount = config.baseBet;
                          }
                          amount = Math.max(config.baseBet, amount);
                          amount = Math.min(amount, currentBalance);
                     }

                     const newBet: BetRecord = {
                         id: Date.now().toString() + Math.random().toString().slice(2, 6) + task.id,
                         taskId: task.id,
                         taskName: `${task.name} ${bestCandidate.desc}`,
                         timestamp: Date.now(),
                         ruleId: bestCandidate.rule.id,
                         ruleName: bestCandidate.rule.label,
                         targetHeight: bestCandidate.height,
                         betType: bestCandidate.type,
                         prediction: bestCandidate.target,
                         amount,
                         odds: config.odds,
                         status: 'PENDING',
                         payout: 0,
                         strategyLabel: task.config.type,
                         balanceAfter: 0
                     };
                     // 真实下注: 加入合并队列 (GLOBAL_TREND/BEAD_DRAGON)
                     if (task.betMode === 'REAL') {
                       addToRealBetMerge(bestCandidate.target, amount, bestCandidate.height, bestCandidate.type, task.id, task.name, bestCandidate.rule!.id);
                     }

                     currentBalance -= amount;
                     finalBets.unshift(newBet);
                     betsChanged = true;
                }
            }
            return; // End of Global Task Logic for this task
        }

        // 目标选择 (提前声明以便所有模式共用)
        const ts = task.config.targetSelections || ['ODD', 'EVEN', 'BIG', 'SMALL'];

        // v5.1: RULE_TREND_DRAGON / RULE_BEAD_DRAGON (扫描用户选中的规则)
        if (task.config.autoTarget === 'RULE_TREND_DRAGON' || task.config.autoTarget === 'RULE_BEAD_DRAGON') {
            const hasPending = finalBets.some(b => b.taskId === task.id && b.status === 'PENDING');
            if (hasPending) return;

            const selectedRuleIds = task.config.selectedRuleIds || [task.ruleId];
            const selectedRules = rules.filter(r => selectedRuleIds.includes(r.id));
            const startStreak = task.config.minStreak || 3;
            const endStreak = task.config.dragonEndStreak || 5;
            const hasParity = ts.some(t => t === 'ODD' || t === 'EVEN');
            const hasSize = ts.some(t => t === 'BIG' || t === 'SMALL');

            let bestCandidate = { streak: 0, rule: null as IntervalRule | null, type: 'PARITY' as BetType, target: 'ODD' as BetTarget, height: 0, desc: '' };

            selectedRules.forEach(scanRule => {
              if (task.config.autoTarget === 'RULE_TREND_DRAGON') {
                const scanBlocks = allBlocks.filter(b => checkRuleAlignment(b.height, scanRule));
                if (scanBlocks.length === 0) return;
                const nextH = getNextTargetHeight(allBlocks[0].height, scanRule.value, scanRule.startBlock);

                if (hasParity) {
                  const streak = calculateStreak(scanBlocks, 'PARITY');
                  if (streak.count >= startStreak && streak.count <= endStreak && streak.count > bestCandidate.streak) {
                    const t2 = streak.val as BetTarget;
                    if (ts.includes(t2)) bestCandidate = { streak: streak.count, rule: scanRule, type: 'PARITY', target: t2, height: nextH, desc: `(走势${streak.count}连)` };
                  }
                }
                if (hasSize) {
                  const streak = calculateStreak(scanBlocks, 'SIZE');
                  if (streak.count >= startStreak && streak.count <= endStreak && streak.count > bestCandidate.streak) {
                    const t2 = streak.val as BetTarget;
                    if (ts.includes(t2)) bestCandidate = { streak: streak.count, rule: scanRule, type: 'SIZE', target: t2, height: nextH, desc: `(走势${streak.count}连)` };
                  }
                }
              } else {
                // RULE_BEAD_DRAGON
                const rows = scanRule.beadRows || 6;
                for (let r = 0; r < rows; r++) {
                  const rowBlocks = getBeadRowBlocks(allBlocks, scanRule, r);
                  if (rowBlocks.length === 0) continue;

                  if (hasParity) {
                    const streak = calculateStreak(rowBlocks, 'PARITY');
                    if (streak.count >= startStreak && streak.count <= endStreak && streak.count > bestCandidate.streak) {
                      const lastH = rowBlocks[0].height;
                      const nextH = lastH + (scanRule.value * rows);
                      if (nextH > allBlocks[0].height) {
                        const t2 = streak.val as BetTarget;
                        if (ts.includes(t2)) bestCandidate = { streak: streak.count, rule: scanRule, type: 'PARITY', target: t2, height: nextH, desc: `(珠R${r+1} ${streak.count}连)` };
                      }
                    }
                  }
                  if (hasSize) {
                    const streak = calculateStreak(rowBlocks, 'SIZE');
                    if (streak.count >= startStreak && streak.count <= endStreak && streak.count > bestCandidate.streak) {
                      const lastH = rowBlocks[0].height;
                      const nextH = lastH + (scanRule.value * rows);
                      if (nextH > allBlocks[0].height) {
                        const t2 = streak.val as BetTarget;
                        if (ts.includes(t2)) bestCandidate = { streak: streak.count, rule: scanRule, type: 'SIZE', target: t2, height: nextH, desc: `(珠R${r+1} ${streak.count}连)` };
                      }
                    }
                  }
                }
              }
            });

            if (bestCandidate.streak >= startStreak && bestCandidate.rule) {
              const isDupe = finalBets.some(b => b.targetHeight === bestCandidate.height && b.ruleId === bestCandidate.rule!.id && b.taskId === task.id);
              if (!isDupe) {
                let amount = Math.floor(task.state.currentBetAmount);
                if (task.config.type === 'AI_KELLY') {
                  const b_odds = config.odds - 1;
                  const p = 60 / 100;
                  const q = 1 - p;
                  const f = (b_odds * p - q) / b_odds;
                  if (f > 0) { amount = Math.floor(currentBalance * f * (task.config.kellyFraction || 0.2)); }
                  amount = Math.max(config.baseBet, Math.min(amount, currentBalance));
                }

                const newBet: BetRecord = {
                  id: Date.now().toString() + Math.random().toString().slice(2, 6) + task.id,
                  taskId: task.id, taskName: `${task.name} ${bestCandidate.desc}`,
                  timestamp: Date.now(), ruleId: bestCandidate.rule.id, ruleName: bestCandidate.rule.label,
                  targetHeight: bestCandidate.height, betType: bestCandidate.type, prediction: bestCandidate.target,
                  amount, odds: config.odds, status: 'PENDING', payout: 0,
                  strategyLabel: task.config.type, balanceAfter: 0
                };
                if (task.betMode === 'REAL') {
                  addToRealBetMerge(bestCandidate.target, amount, bestCandidate.height, bestCandidate.type, task.id, task.name, bestCandidate.rule!.id);
                }
                currentBalance -= amount;
                finalBets.unshift(newBet);
                betsChanged = true;
              }
            }
            return;
        }

        // STANDARD TASKS (Single Rule)
        const rule = rules.find(r => r.id === task.ruleId);
        if (!rule) return;

        const nextHeight = getNextTargetHeight(allBlocks[0].height, rule.value, rule.startBlock);
        
        // Check if THIS task already bet on this height
        if (finalBets.some(b => b.targetHeight === nextHeight && b.ruleId === rule.id && b.taskId === task.id)) return;

        // Determine Bet
        const ruleBlocks = allBlocks.filter(b => checkRuleAlignment(b.height, rule));
        let type: BetType = 'PARITY';
        let target: BetTarget = 'ODD';
        let shouldBet = false;
        
        // Context for Kelly
        let currentConfidence = 60; // Default for manual/fixed

        if (task.config.autoTarget === 'AI_PREDICTION') {
            const analysis = runAIAnalysis(allBlocks, rule);
            if (analysis.shouldPredict) {
                if (analysis.confP >= analysis.confS && analysis.confP >= 92 && analysis.nextP) {
                    if (ts.includes(analysis.nextP as BetTarget)) {
                      type = 'PARITY';
                      target = analysis.nextP as BetTarget;
                      shouldBet = true;
                      currentConfidence = analysis.confP;
                    }
                } else if (analysis.confS > analysis.confP && analysis.confS >= 92 && analysis.nextS) {
                    if (ts.includes(analysis.nextS as BetTarget)) {
                      type = 'SIZE';
                      target = analysis.nextS as BetTarget;
                      shouldBet = true;
                      currentConfidence = analysis.confS;
                    }
                }
            }
        } else if (task.config.autoTarget === 'FIXED' || task.config.autoTarget.startsWith('FIXED_')) {
          // 新合并定投模式: 支持多目标 (每个选中目标下一注)
          // 旧模式 FIXED_ODD 等通过 migration 已转换，但也兼容
          const fixedTargets = task.config.autoTarget === 'FIXED'
            ? ts
            : [task.config.autoTarget.split('_')[1] as BetTarget];

          // 为每个选中目标分别下注
          for (const ft of fixedTargets) {
            const ftType: BetType = (ft === 'ODD' || ft === 'EVEN') ? 'PARITY' : 'SIZE';
            if (finalBets.some(b => b.targetHeight === nextHeight && b.ruleId === rule.id && b.taskId === task.id && b.prediction === ft)) continue;

            let amount = Math.floor(task.state.currentBetAmount);
            if (task.config.type === 'AI_KELLY') {
              const b_odds = config.odds - 1;
              const p = 60 / 100;
              const q = 1 - p;
              const f = (b_odds * p - q) / b_odds;
              if (f > 0) { amount = Math.floor(currentBalance * f * (task.config.kellyFraction || 0.2)); }
              amount = Math.max(config.baseBet, Math.min(amount, currentBalance));
            }

            const newBet: BetRecord = {
              id: Date.now().toString() + Math.random().toString().slice(2, 6) + task.id + ft,
              taskId: task.id, taskName: task.name,
              timestamp: Date.now(), ruleId: rule.id, ruleName: rule.label,
              targetHeight: nextHeight, betType: ftType, prediction: ft,
              amount, odds: config.odds, status: 'PENDING', payout: 0,
              strategyLabel: task.config.type, balanceAfter: 0
            };
            if (task.betMode === 'REAL') {
              addToRealBetMerge(ft, amount, nextHeight, ftType, task.id, task.name, rule.id);
            }
            currentBalance -= amount;
            finalBets.unshift(newBet);
            betsChanged = true;
          }
          return; // FIXED mode handles its own bet creation, skip the generic path below
        } else if (task.config.autoTarget === 'RANDOM' || task.config.autoTarget === 'RANDOM_PARITY' || task.config.autoTarget === 'RANDOM_SIZE') {
          // 新合并随机模式: 从选中目标中随机选一个
          let randomPool: BetTarget[];
          if (task.config.autoTarget === 'RANDOM') randomPool = ts;
          else if (task.config.autoTarget === 'RANDOM_PARITY') randomPool = ['ODD', 'EVEN'];
          else randomPool = ['BIG', 'SMALL'];

          shouldBet = true;
          target = randomPool[Math.floor(Math.random() * randomPool.length)];
          type = (target === 'ODD' || target === 'EVEN') ? 'PARITY' : 'SIZE';
        } else if (task.config.autoTarget === 'FOLLOW_RECENT_TREND' || task.config.autoTarget === 'FOLLOW_RECENT_TREND_REVERSE') {
          const n = task.config.trendWindow || 5;
          const sourceHeight = nextHeight - (n * rule.value);
          const sourceBlock = allBlocks.find(b => b.height === sourceHeight);

          if (sourceBlock) {
             // 根据targetSelections决定操作的域
             const hasParity = ts.some(t => t === 'ODD' || t === 'EVEN');
             const hasSize = ts.some(t => t === 'BIG' || t === 'SMALL');
             const isReverse = task.config.autoTarget === 'FOLLOW_RECENT_TREND_REVERSE';

             if (hasParity) {
                 type = 'PARITY';
                 if (isReverse) target = sourceBlock.type === 'ODD' ? 'EVEN' : 'ODD';
                 else target = sourceBlock.type;
                 if (ts.includes(target)) shouldBet = true;
             }
             if (!shouldBet && hasSize) {
                 type = 'SIZE';
                 if (isReverse) target = sourceBlock.sizeType === 'BIG' ? 'SMALL' : 'BIG';
                 else target = sourceBlock.sizeType;
                 if (ts.includes(target)) shouldBet = true;
             }
          }
        } else if (task.config.autoTarget === 'DRAGON_FOLLOW' || task.config.autoTarget === 'DRAGON_REVERSE') {
           if (ruleBlocks.length > 0) {
             const startStreak = task.config.minStreak || 3;
             const endStreak = task.config.dragonEndStreak || 5;
             const hasParity = ts.some(t => t === 'ODD' || t === 'EVEN');
             const hasSize = ts.some(t => t === 'BIG' || t === 'SMALL');

             if (hasParity) {
               const streak = calculateStreak(ruleBlocks, 'PARITY');
               if (streak.count >= startStreak && streak.count <= endStreak) {
                 type = 'PARITY';
                 if (task.config.autoTarget === 'DRAGON_FOLLOW') target = streak.val as BetTarget;
                 else target = streak.val === 'ODD' ? 'EVEN' : 'ODD';
                 if (ts.includes(target)) shouldBet = true;
               }
             }
             if (!shouldBet && hasSize) {
               const streak = calculateStreak(ruleBlocks, 'SIZE');
               if (streak.count >= startStreak && streak.count <= endStreak) {
                 type = 'SIZE';
                 if (task.config.autoTarget === 'DRAGON_FOLLOW') target = streak.val as BetTarget;
                 else target = streak.val === 'BIG' ? 'SMALL' : 'BIG';
                 if (ts.includes(target)) shouldBet = true;
               }
             }
           }
        } else if (task.config.autoTarget === 'BEAD_DRAGON_FOLLOW' || task.config.autoTarget === 'BEAD_DRAGON_REVERSE') {
           // v5.1: 单规则珠盘长龙
           const rows = rule.beadRows || 6;
           const startStreak = task.config.minStreak || 3;
           const endStreak = task.config.dragonEndStreak || 5;
           const hasParity = ts.some(t => t === 'ODD' || t === 'EVEN');
           const hasSize = ts.some(t => t === 'BIG' || t === 'SMALL');
           const isFollow = task.config.autoTarget === 'BEAD_DRAGON_FOLLOW';

           let bestBead = { streak: 0, type: 'PARITY' as BetType, target: 'ODD' as BetTarget, height: 0, desc: '' };

           for (let r = 0; r < rows; r++) {
             const rowBlocks = getBeadRowBlocks(allBlocks, rule, r);
             if (rowBlocks.length === 0) continue;

             if (hasParity) {
               const streak = calculateStreak(rowBlocks, 'PARITY');
               if (streak.count >= startStreak && streak.count <= endStreak && streak.count > bestBead.streak) {
                 const lastH = rowBlocks[0].height;
                 const nh = lastH + (rule.value * rows);
                 if (nh > allBlocks[0].height) {
                   const t2 = isFollow ? streak.val as BetTarget : (streak.val === 'ODD' ? 'EVEN' : 'ODD');
                   if (ts.includes(t2)) bestBead = { streak: streak.count, type: 'PARITY', target: t2, height: nh, desc: `(珠R${r + 1} ${streak.count}连)` };
                 }
               }
             }
             if (hasSize) {
               const streak = calculateStreak(rowBlocks, 'SIZE');
               if (streak.count >= startStreak && streak.count <= endStreak && streak.count > bestBead.streak) {
                 const lastH = rowBlocks[0].height;
                 const nh = lastH + (rule.value * rows);
                 if (nh > allBlocks[0].height) {
                   const t2 = isFollow ? streak.val as BetTarget : (streak.val === 'BIG' ? 'SMALL' : 'BIG');
                   if (ts.includes(t2)) bestBead = { streak: streak.count, type: 'SIZE', target: t2, height: nh, desc: `(珠R${r + 1} ${streak.count}连)` };
                 }
               }
             }
           }

           if (bestBead.streak > 0) {
             if (!finalBets.some(b => b.targetHeight === bestBead.height && b.ruleId === rule.id && b.taskId === task.id)) {
               type = bestBead.type;
               target = bestBead.target;
               shouldBet = true;
             }
           }
        } else if (task.config.autoTarget === 'AI_MODEL_SELECT') {
           // v5.1: 用户选择特定模型进行预测
           const selectedIds = task.config.selectedModels || ['ensemble'];
           const analysis = runSelectedModelsAnalysis(allBlocks, rule, selectedIds);
           if (analysis.shouldPredict) {
             if (analysis.confP >= analysis.confS && analysis.confP >= 90 && analysis.nextP) {
               if (ts.includes(analysis.nextP)) { type = 'PARITY'; target = analysis.nextP; shouldBet = true; currentConfidence = analysis.confP; }
             } else if (analysis.confS > analysis.confP && analysis.confS >= 90 && analysis.nextS) {
               if (ts.includes(analysis.nextS)) { type = 'SIZE'; target = analysis.nextS; shouldBet = true; currentConfidence = analysis.confS; }
             }
           }
        } else if (task.config.autoTarget === 'AI_WINRATE_TRIGGER') {
           // v5.1-fix: 胜率触发投注 - 修复: 持续追踪模型预测+正确触发条件
           const selectedIds = task.config.selectedModels || ['ensemble'];
           const winWindow = task.config.winRateWindow || 30;
           const triggerPct = task.config.winRateTrigger || 30;
           const stopPct = task.config.winRateStop || 60;

           // 1. 解析上一轮影子预测（无论是否在投注，持续追踪模型准确率）
           if (task.shadowPrediction) {
             const shadowBlock = allBlocks.find(b => b.height === task.shadowPrediction!.targetHeight);
             if (shadowBlock) {
               let isCorrect = false;
               if (task.shadowPrediction.betType === 'PARITY') {
                 isCorrect = shadowBlock.type === task.shadowPrediction.prediction;
               } else {
                 isCorrect = shadowBlock.sizeType === task.shadowPrediction.prediction;
               }
               const preds = task.recentPredictions || [];
               preds.unshift({ correct: isCorrect, timestamp: Date.now() });
               task.recentPredictions = preds.slice(0, 100);
               task.shadowPrediction = undefined;
               tasksChanged = true;
             }
           }

           // 2. 计算模型近期胜率
           const recent = (task.recentPredictions || []).slice(0, winWindow);
           const recentTotal = recent.length;
           const recentCorrect = recent.filter(p => p.correct).length;
           const winRate = recentTotal > 0 ? (recentCorrect / recentTotal) * 100 : 0;

           // 3. 状态机: 胜率低于trigger%开始投注, 达到stop%停止投注
           const isActive = task.aiWinRateActive || false;

           if (!isActive && winRate <= triggerPct && recentTotal >= Math.min(5, winWindow)) {
             // 模型胜率低于触发阈值 → 开始投注
             task.aiWinRateActive = true;
             tasksChanged = true;
           } else if (isActive && winRate >= stopPct) {
             // 投注胜率达到停止阈值 → 停止投注
             task.aiWinRateActive = false;
             tasksChanged = true;
           }

           // 4. 始终运行模型预测并存储影子预测（持续追踪准确率）
           const analysis = runSelectedModelsAnalysis(allBlocks, rule, selectedIds);
           if (analysis.shouldPredict) {
             if (analysis.confP >= analysis.confS && analysis.confP >= 90 && analysis.nextP) {
               if (ts.includes(analysis.nextP)) {
                 task.shadowPrediction = { targetHeight: nextHeight, prediction: analysis.nextP, betType: 'PARITY' };
                 tasksChanged = true;
                 // 仅在激活状态下实际下注
                 if (task.aiWinRateActive) {
                   type = 'PARITY'; target = analysis.nextP; shouldBet = true; currentConfidence = analysis.confP;
                 }
               }
             } else if (analysis.confS > analysis.confP && analysis.confS >= 90 && analysis.nextS) {
               if (ts.includes(analysis.nextS)) {
                 task.shadowPrediction = { targetHeight: nextHeight, prediction: analysis.nextS, betType: 'SIZE' };
                 tasksChanged = true;
                 if (task.aiWinRateActive) {
                   type = 'SIZE'; target = analysis.nextS; shouldBet = true; currentConfidence = analysis.confS;
                 }
               }
             }
           }
        } else if (task.config.autoTarget === 'OSCILLATION_REVERSE') {
           // v5.2: 振荡反转 - 连续N次相同结果后反向下注
           if (ruleBlocks.length > 0) {
             const oscillationN = task.config.oscillationCount || 3;
             const hasParity = ts.some(t => t === 'ODD' || t === 'EVEN');
             const hasSize = ts.some(t => t === 'BIG' || t === 'SMALL');

             if (hasParity) {
               const streak = calculateStreak(ruleBlocks, 'PARITY');
               if (streak.count >= oscillationN) {
                 type = 'PARITY';
                 target = streak.val === 'ODD' ? 'EVEN' : 'ODD';
                 if (ts.includes(target)) shouldBet = true;
               }
             }
             if (!shouldBet && hasSize) {
               const streak = calculateStreak(ruleBlocks, 'SIZE');
               if (streak.count >= oscillationN) {
                 type = 'SIZE';
                 target = streak.val === 'BIG' ? 'SMALL' : 'BIG';
                 if (ts.includes(target)) shouldBet = true;
               }
             }
           }
        } else if (task.config.autoTarget === 'PATTERN_MATCH') {
           // v5.2: 模式匹配 - 匹配近期模式与历史数据对比
           if (ruleBlocks.length > 0) {
             const patLen = task.config.patternLength || 4;
             const minMatch = task.config.patternMinMatch || 3;
             const hasParity = ts.some(t => t === 'ODD' || t === 'EVEN');
             const hasSize = ts.some(t => t === 'BIG' || t === 'SMALL');

             if (ruleBlocks.length >= patLen + minMatch) {
               // 提取近期模式
               if (hasParity) {
                 const recentPattern = ruleBlocks.slice(0, patLen).map(b => b.type); // ['ODD','EVEN',...]
                 // 在历史中搜索相同模式出现后的下一个结果
                 let matchOdd = 0, matchEven = 0;
                 for (let i = patLen; i < ruleBlocks.length - patLen; i++) {
                   const histPattern = ruleBlocks.slice(i, i + patLen).map(b => b.type);
                   if (histPattern.every((v, j) => v === recentPattern[j])) {
                     // 找到匹配 - 检查前一个区块（历史中模式之前的区块就是模式出现后的结果）
                     if (i > 0) {
                       const nextResult = ruleBlocks[i - 1].type;
                       if (nextResult === 'ODD') matchOdd++;
                       else matchEven++;
                     }
                   }
                 }
                 const totalMatches = matchOdd + matchEven;
                 const majorityRatioP = totalMatches > 0 ? Math.max(matchOdd, matchEven) / totalMatches : 0;
                 const requiredRatioP = 0.5 + (minMatch * 0.03); // minMatch=2→0.56, minMatch=8→0.74
                 if (totalMatches >= minMatch && majorityRatioP >= requiredRatioP) {
                   type = 'PARITY';
                   target = matchOdd >= matchEven ? 'ODD' : 'EVEN';
                   if (ts.includes(target)) shouldBet = true;
                 }
               }
               if (!shouldBet && hasSize) {
                 const recentPattern = ruleBlocks.slice(0, patLen).map(b => b.sizeType);
                 let matchBig = 0, matchSmall = 0;
                 for (let i = patLen; i < ruleBlocks.length - patLen; i++) {
                   const histPattern = ruleBlocks.slice(i, i + patLen).map(b => b.sizeType);
                   if (histPattern.every((v, j) => v === recentPattern[j])) {
                     if (i > 0) {
                       const nextResult = ruleBlocks[i - 1].sizeType;
                       if (nextResult === 'BIG') matchBig++;
                       else matchSmall++;
                     }
                   }
                 }
                 const totalMatches = matchBig + matchSmall;
                 const majorityRatioS = totalMatches > 0 ? Math.max(matchBig, matchSmall) / totalMatches : 0;
                 const requiredRatioS = 0.5 + (minMatch * 0.03);
                 if (totalMatches >= minMatch && majorityRatioS >= requiredRatioS) {
                   type = 'SIZE';
                   target = matchBig >= matchSmall ? 'BIG' : 'SMALL';
                   if (ts.includes(target)) shouldBet = true;
                 }
               }
             }
           }
        } else if (ruleBlocks.length > 0) {
           // FOLLOW_LAST / REVERSE_LAST
           const hasParity = ts.some(t => t === 'ODD' || t === 'EVEN');
           const hasSize = ts.some(t => t === 'BIG' || t === 'SMALL');

           if (hasParity) {
             const streak = calculateStreak(ruleBlocks, 'PARITY');
             type = 'PARITY';
             if (task.config.autoTarget === 'FOLLOW_LAST') {
               if (streak.count >= task.config.minStreak) {
                 target = streak.val as BetTarget;
                 if (ts.includes(target)) shouldBet = true;
               }
             } else if (task.config.autoTarget === 'REVERSE_LAST') {
               if (streak.count >= task.config.minStreak) {
                 target = streak.val === 'ODD' ? 'EVEN' : 'ODD';
                 if (ts.includes(target)) shouldBet = true;
               }
             }
           }
           if (!shouldBet && hasSize) {
             const streak = calculateStreak(ruleBlocks, 'SIZE');
             type = 'SIZE';
             if (task.config.autoTarget === 'FOLLOW_LAST') {
               if (streak.count >= task.config.minStreak) {
                 target = streak.val as BetTarget;
                 if (ts.includes(target)) shouldBet = true;
               }
             } else if (task.config.autoTarget === 'REVERSE_LAST') {
               if (streak.count >= task.config.minStreak) {
                 target = streak.val === 'BIG' ? 'SMALL' : 'BIG';
                 if (ts.includes(target)) shouldBet = true;
               }
             }
           }
        }

        if (shouldBet) {
           let amount = Math.floor(task.state.currentBetAmount);
           
           // AI KELLY CALCULATION
           if (task.config.type === 'AI_KELLY') {
                const b_odds = config.odds - 1;
                const p = currentConfidence / 100;
                const q = 1 - p;
                const f = (b_odds * p - q) / b_odds;
                
                if (f > 0) {
                    const fraction = task.config.kellyFraction || 0.2;
                    amount = Math.floor(currentBalance * f * fraction);
                } else {
                    amount = config.baseBet;
                }
                amount = Math.max(config.baseBet, amount);
                amount = Math.min(amount, currentBalance);
           }

           const newBet: BetRecord = {
             id: Date.now().toString() + Math.random().toString().slice(2, 6) + task.id,
             taskId: task.id,
             taskName: task.name,
             timestamp: Date.now(),
             ruleId: rule.id,
             ruleName: rule.label,
             targetHeight: nextHeight,
             betType: type,
             prediction: target,
             amount,
             odds: config.odds,
             status: 'PENDING',
             payout: 0,
             strategyLabel: task.config.type,
             balanceAfter: 0
           };

           // 真实下注: 加入合并队列
           if (task.betMode === 'REAL') {
             addToRealBetMerge(target, amount, nextHeight, type, task.id, task.name, rule.id);
           }

           currentBalance -= amount;
           finalBets.unshift(newBet); // Add to top
           betsChanged = true;
        }
      });

      // 合并后一次性派发真实下注命令到插件
      // 多个任务的同目标下注合并为单次执行 (例: 3个任务投单¥1+¥2+¥5 → 合并一次投单¥8)
      realBetMergeMap.forEach((merged, target) => {
        document.dispatchEvent(new CustomEvent('haxi-real-bet', {
          detail: {
            taskId: merged.contributions.length === 1 ? merged.contributions[0].taskId : 'merged',
            taskName: merged.contributions.length === 1
              ? merged.contributions[0].taskName
              : `合并${merged.contributions.length}任务`,
            target,
            amount: merged.totalAmount,
            blockHeight: merged.blockHeight,
            betType: merged.betType,
            ruleId: merged.contributions[0].ruleId,
            merged: merged.contributions.length > 1,
            contributions: merged.contributions
          }
        }));
      });

    } else {
       // Stop all tasks if global stop hit
       if (nextTasks.some(t => t.isActive)) {
          nextTasks.forEach(t => t.isActive = false);
          tasksChanged = true;
       }
    }

    // 3. COMMIT UPDATES (保留全部数据: PENDING + 所有已结算记录, 历史表仅渲染前50条)
    if (betsChanged) {
       const pending = finalBets.filter(b => b.status === 'PENDING');
       const settled = finalBets.filter(b => b.status !== 'PENDING').slice(0, 5000);
       setBets([...pending, ...settled]);
       setBalance(currentBalance);
    }
    if (tasksChanged) {
       setTasks(nextTasks);
    }
    if (metricsChanged || tempPeak !== globalMetrics.peakBalance) {
        setGlobalMetrics({ peakBalance: tempPeak, maxDrawdown: tempMaxDD });
    }

  }, [allBlocks, rules, tasks, bets, config, checkRuleAlignment, calculateStreak, balance, globalMetrics]);

  // Stats
  const stats = useMemo(() => {
    const wins = settledBets.filter(b => b.status === 'WIN').length;
    const total = settledBets.length;
    const winRate = total > 0 ? (wins / total) * 100 : 0;
    const profit = balance - config.initialBalance;
    const profitPercent = (profit / config.initialBalance) * 100;
    const ddRate = globalMetrics.peakBalance > 0 ? (globalMetrics.maxDrawdown / globalMetrics.peakBalance) * 100 : 0;

    // Max Profit Calculation (Highest Balance - Initial Principal)
    const maxProfitVal = globalMetrics.peakBalance - config.initialBalance;
    const maxProfitPercent = config.initialBalance > 0 ? (maxProfitVal / config.initialBalance) * 100 : 0;

    return { 
        wins, total, winRate, profit, profitPercent, ddRate, 
        maxDrawdown: globalMetrics.maxDrawdown,
        maxProfit: maxProfitVal,
        maxProfitPercent
    };
  }, [settledBets, balance, config.initialBalance, globalMetrics]);

  return (
    <div className="max-w-[1600px] mx-auto space-y-6 animate-in fade-in duration-500 pb-20">

      {/* 版本号 */}
      <div className="flex justify-end px-2">
        <span className="text-[9px] font-bold text-gray-300">前端 {FRONTEND_VERSION} · 插件 {pluginReady ? 'v5.0' : '未连接'}</span>
      </div>

      {/* 1. TOP DASHBOARD */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
         <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity"><Wallet className="w-16 h-16" /></div>
            <span className="text-xs font-black text-gray-400 uppercase tracking-wider">模拟资金池</span>
            <div className="text-3xl font-black text-gray-900 mt-2">${balance.toFixed(2)}</div>
            <div className={`text-xs font-bold mt-2 flex items-center ${stats.profit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
               <TrendingUp className={`w-3 h-3 mr-1 ${stats.profit < 0 ? 'rotate-180' : ''}`} />
               {stats.profit >= 0 ? '+' : ''}{stats.profit.toFixed(2)} ({stats.profitPercent > 0 ? '+' : ''}{stats.profitPercent.toFixed(2)}%)
            </div>

            <div className="mt-3 pt-3 border-t border-gray-50 grid grid-cols-2 gap-2">
                <div className="text-[10px] font-black text-green-600 flex flex-col">
                   <span className="text-gray-400 uppercase tracking-wider mb-0.5 flex items-center">
                      <Trophy className="w-3 h-3 mr-1" /> 最高收益
                   </span>
                   <span>
                      {stats.maxProfit >= 0 ? '+' : ''}{stats.maxProfit.toFixed(0)} ({stats.maxProfitPercent > 0 ? '+' : ''}{stats.maxProfitPercent.toFixed(1)}%)
                   </span>
                </div>
                <div className="text-[10px] font-black text-red-500 flex flex-col text-right">
                   <span className="text-gray-400 uppercase tracking-wider mb-0.5 flex items-center justify-end">
                      <ShieldAlert className="w-3 h-3 mr-1" /> 最大回撤
                   </span>
                   <span>
                      -${stats.maxDrawdown.toFixed(0)} (-{stats.ddRate.toFixed(1)}%)
                   </span>
                </div>
            </div>
         </div>
         {/* 平台真实余额 */}
         <div className={`bg-white rounded-3xl p-6 shadow-sm border relative overflow-hidden group ${pluginReady ? 'border-green-100' : 'border-gray-100'}`}>
            <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity"><Wallet className="w-16 h-16" /></div>
            <span className="text-xs font-black text-gray-400 uppercase tracking-wider">平台真实余额</span>
            <div className={`text-3xl font-black mt-2 ${pluginReady ? 'text-amber-600' : 'text-gray-300'}`}>
               {realBalance != null ? `¥${realBalance.toFixed(2)}` : '--'}
            </div>
            <div className="flex items-center mt-2">
               <span className={`w-2 h-2 rounded-full mr-1.5 ${pluginReady ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`}></span>
               <span className={`text-[10px] font-bold ${pluginReady ? 'text-green-600' : 'text-gray-400'}`}>
                  {pluginReady ? '插件已连接' : '插件未连接'}
               </span>
            </div>
            {realBalancePeak != null && (
              <div className="mt-2 pt-2 border-t border-gray-50 grid grid-cols-2 gap-2">
                <div className="text-[9px] font-black text-green-600">
                  <span className="text-gray-400 block">最高余额</span>
                  ¥{realBalancePeak.toFixed(2)}
                </div>
                <div className="text-[9px] font-black text-red-500 text-right">
                  <span className="text-gray-400 block">最大回撤</span>
                  -¥{realBalanceMaxDD.toFixed(2)}
                </div>
              </div>
            )}
         </div>
         <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100">
            <span className="text-xs font-black text-gray-400 uppercase tracking-wider">总胜率概览</span>
            <div className="flex items-end space-x-2 mt-2">
               <span className="text-3xl font-black text-blue-600">{stats.winRate.toFixed(1)}%</span>
               <span className="text-xs text-gray-400 font-bold mb-1.5">{stats.wins}/{stats.total}</span>
            </div>
            <div className="w-full bg-gray-100 h-1.5 rounded-full mt-3 overflow-hidden">
               <div className="bg-blue-600 h-full rounded-full transition-all duration-500" style={{ width: `${stats.winRate}%` }}></div>
            </div>
         </div>
         <div 
           className="md:col-span-2 bg-white rounded-3xl p-4 shadow-sm border border-gray-100 flex flex-col relative group cursor-pointer transition-colors hover:bg-gray-50/50"
           onClick={() => setShowFullChart(true)}
         >
            <span className="absolute top-4 left-4 text-[10px] font-black text-gray-400 uppercase tracking-wider z-10">
              {chartFilterTaskId === 'all' ? '总盈亏曲线' : `任务盈亏曲线`}
            </span>
            <div className="absolute top-4 right-4 z-10 flex items-center space-x-1.5">
               <select
                 value={chartFilterTaskId}
                 onClick={e => e.stopPropagation()}
                 onChange={e => { e.stopPropagation(); setChartFilterTaskId(e.target.value); }}
                 className="bg-white/90 backdrop-blur-sm rounded-full text-[9px] font-bold text-gray-600 px-2 py-0.5 border border-gray-200 outline-none cursor-pointer shadow-sm"
               >
                 <option value="all">全部任务</option>
                 {tasks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
               </select>
               <span className="opacity-0 group-hover:opacity-100 transition-opacity bg-white/80 backdrop-blur-sm px-2 py-1 rounded-full text-[10px] font-black text-indigo-600 flex items-center shadow-sm">
                  <ZoomIn className="w-3 h-3 mr-1" /> 全景
               </span>
            </div>
            <div className="flex-1 pt-4 min-h-[80px]">
               <BalanceChart data={chartData.map(d => d.value)} width={400} height={80} />
            </div>
         </div>
      </div>

      {showFullChart && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
           <DetailedChart data={chartData} onClose={() => setShowFullChart(false)} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* LEFT: TASK CREATOR (4 cols) */}
        <div className="lg:col-span-4 space-y-6">
           <div className="bg-white rounded-[2rem] p-6 shadow-xl border border-indigo-50">
              <div className="flex justify-between items-center mb-6">
                 <div className="flex items-center space-x-2">
                    <Layers className="w-5 h-5 text-indigo-600" />
                    <h3 className="font-black text-gray-900">托管任务生成器</h3>
                 </div>
                 <button onClick={() => setShowConfig(!showConfig)} className="text-xs font-bold text-gray-400 hover:text-indigo-600 flex items-center">
                    {showConfig ? '收起' : '展开'} {showConfig ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />}
                 </button>
              </div>

              {showConfig && (
                <div className="space-y-4 animate-in slide-in-from-top-2">
                   
                   {/* Task Name */}
                   <div>
                      <label className="text-[10px] font-black text-gray-400 uppercase ml-1">任务备注</label>
                      <input 
                        type="text" 
                        value={draftName} 
                        onChange={e => setDraftName(e.target.value)}
                        placeholder="例如：3秒平注追单..."
                        className="w-full mt-1 px-4 py-2.5 bg-gray-50 border-transparent focus:bg-white focus:border-indigo-500 border-2 rounded-xl text-xs font-bold outline-none transition-all"
                      />
                   </div>

                   {/* Rule Selector (Hidden for Global Modes) */}
                   {!draftConfig.autoTarget.startsWith('GLOBAL') && draftConfig.autoTarget !== 'RULE_TREND_DRAGON' && draftConfig.autoTarget !== 'RULE_BEAD_DRAGON' && (
                     <div className="bg-indigo-50/50 p-4 rounded-2xl border border-indigo-100/50">
                        <label className="text-[10px] font-black text-gray-400 uppercase block mb-2">下注规则 (秒数)</label>
                        <select 
                          value={draftRuleId} 
                          onChange={e => setDraftRuleId(e.target.value)}
                          className="w-full bg-white text-indigo-900 rounded-xl px-3 py-2 text-xs font-black border border-indigo-100 outline-none cursor-pointer shadow-sm"
                        >
                           {rules.map(r => (
                             <option key={r.id} value={r.id}>{r.label} (步长: {r.value})</option>
                           ))}
                        </select>
                     </div>
                   )}
                   {draftConfig.autoTarget.startsWith('GLOBAL') && (
                      <div className="bg-amber-50/50 p-4 rounded-2xl border border-amber-100/50 flex items-center space-x-2">
                          {draftConfig.autoTarget === 'GLOBAL_AI_FULL_SCAN' ? (
                             <Sparkles className="w-5 h-5 text-amber-500 animate-pulse" />
                          ) : (
                             <Activity className="w-5 h-5 text-amber-500 animate-pulse" />
                          )}
                          <span className="text-xs font-black text-amber-700">
                             {draftConfig.autoTarget === 'GLOBAL_AI_FULL_SCAN' ? 'AI 全域全规则：最优解自动锁定' : '全域扫描模式已激活：自动匹配所有规则'}
                          </span>
                      </div>
                   )}
                   {(draftConfig.autoTarget === 'RULE_TREND_DRAGON' || draftConfig.autoTarget === 'RULE_BEAD_DRAGON') && (
                      <div className="bg-amber-50/50 p-4 rounded-2xl border border-amber-100/50 flex items-center space-x-2">
                          <Activity className="w-5 h-5 text-amber-500 animate-pulse" />
                          <span className="text-xs font-black text-amber-700">
                             {draftConfig.autoTarget === 'RULE_TREND_DRAGON' ? '规则走势长龙：在选中规则中寻找最长连续' : '规则珠盘长龙：在选中规则的珠盘中寻找最长连续'}
                          </span>
                      </div>
                   )}

                   {/* Strategy Type */}
                   <div>
                      <label className="text-[10px] font-black text-gray-400 uppercase ml-1">资金策略</label>
                      <select 
                        value={draftConfig.type} 
                        onChange={e => setDraftConfig({...draftConfig, type: e.target.value as StrategyType})}
                        className="w-full bg-gray-50 text-gray-800 rounded-xl px-3 py-2.5 text-xs font-black border border-transparent focus:border-indigo-500 outline-none mt-1"
                      >
                         {Object.entries(STRATEGY_LABELS).filter(([k]) => k !== 'MANUAL').map(([k, v]) => (
                            <option key={k} value={k}>{v}</option>
                         ))}
                      </select>
                   </div>
                   
                   {/* Strategy Params */}
                   {draftConfig.type === 'MARTINGALE' && (
                      <div className="grid grid-cols-2 gap-2">
                         <div className="bg-gray-50 px-3 py-2 rounded-xl">
                            <span className="text-[10px] font-bold text-gray-400 block mb-1">倍投系数</span>
                            <input type="number" step="0.1" value={draftConfig.multiplier} onChange={e => setDraftConfig({...draftConfig, multiplier: parseFloat(e.target.value)})} className="w-full bg-white rounded-lg px-2 py-1 text-xs font-black text-center" />
                         </div>
                         <div className="bg-gray-50 px-3 py-2 rounded-xl">
                            <span className="text-[10px] font-bold text-gray-400 block mb-1">跟投期数</span>
                            <input type="number" min="1" value={draftConfig.maxCycle} onChange={e => setDraftConfig({...draftConfig, maxCycle: parseInt(e.target.value) || 10})} className="w-full bg-white rounded-lg px-2 py-1 text-xs font-black text-center" />
                         </div>
                      </div>
                   )}
                   {draftConfig.type === 'DALEMBERT' && (
                      <div className="bg-gray-50 px-3 py-2 rounded-xl flex justify-between items-center">
                         <span className="text-[10px] font-bold text-gray-500">升降步长</span>
                         <input type="number" value={draftConfig.step} onChange={e => setDraftConfig({...draftConfig, step: parseFloat(e.target.value)})} className="w-20 bg-white rounded-lg px-2 py-1 text-xs font-black text-center" />
                      </div>
                   )}
                   {draftConfig.type === 'CUSTOM' && (
                      <div className="bg-gray-50 px-3 py-2 rounded-xl space-y-2">
                        <span className="text-[10px] font-bold text-gray-400 block">自定义倍数序列 (逗号分隔)</span>
                        <textarea
                          value={customSeqText}
                          onChange={e => {
                            const txt = e.target.value;
                            setCustomSeqText(txt);
                            const seq = txt.split(/[,，\s]+/).map(s => parseFloat(s)).filter(n => !isNaN(n) && n > 0);
                            setDraftConfig({...draftConfig, customSequence: seq.length > 0 ? seq : [1]});
                          }}
                          className="w-full bg-white rounded-lg px-2 py-1.5 text-xs font-black border border-transparent focus:border-indigo-200 outline-none h-16 resize-none"
                          placeholder="1, 2, 3, 5, 8..."
                        />
                        {/* 保存当前序列 */}
                        <div className="flex gap-1.5">
                          <input
                            type="text"
                            value={seqSaveName}
                            onChange={e => setSeqSaveName(e.target.value)}
                            placeholder="序列名称..."
                            className="flex-1 bg-white rounded-lg px-2 py-1 text-[10px] font-bold border border-gray-200 outline-none focus:border-indigo-300"
                          />
                          <button
                            onClick={() => {
                              const name = seqSaveName.trim() || `序列${savedSequences.length + 1}`;
                              const seq = draftConfig.customSequence || [1];
                              const updated = [...savedSequences.filter(s => s.name !== name), { name, sequence: seq }];
                              setSavedSequences(updated);
                              localStorage.setItem('haxi-custom-sequences', JSON.stringify(updated));
                              setSeqSaveName('');
                            }}
                            className="px-2.5 py-1 bg-green-500 text-white rounded-lg text-[10px] font-black hover:bg-green-600 transition-colors whitespace-nowrap"
                          >
                            保存
                          </button>
                        </div>
                        {/* 已保存序列列表 */}
                        {savedSequences.length > 0 && (
                          <div className="space-y-1">
                            <span className="text-[9px] font-bold text-gray-400 uppercase">已保存序列</span>
                            {savedSequences.map((s, i) => (
                              <div key={i} className="flex items-center justify-between bg-white rounded-lg px-2 py-1 border border-gray-100">
                                <button
                                  onClick={() => {
                                    setCustomSeqText(s.sequence.join(', '));
                                    setDraftConfig({...draftConfig, customSequence: s.sequence});
                                  }}
                                  className="flex-1 text-left text-[10px] font-bold text-indigo-600 hover:text-indigo-800 truncate"
                                >
                                  {s.name} <span className="text-gray-400">({s.sequence.join(', ')})</span>
                                </button>
                                <button
                                  onClick={() => {
                                    const updated = savedSequences.filter((_, j) => j !== i);
                                    setSavedSequences(updated);
                                    localStorage.setItem('haxi-custom-sequences', JSON.stringify(updated));
                                  }}
                                  className="text-gray-300 hover:text-red-500 ml-2 p-0.5"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                   )}
                   {draftConfig.type === 'AI_KELLY' && (
                      <div className="bg-indigo-50/50 px-4 py-3 rounded-xl border border-indigo-100">
                        <div className="flex justify-between items-center mb-2">
                           <span className="text-[10px] font-black text-indigo-700 uppercase flex items-center">
                              <Scale className="w-3 h-3 mr-1.5" />
                              Kelly 风险系数
                           </span>
                           <span className="text-xs font-black text-indigo-600 bg-white px-2 py-0.5 rounded shadow-sm">
                              {((draftConfig.kellyFraction || 0.2) * 100).toFixed(0)}%
                           </span>
                        </div>
                        <input 
                           type="range" 
                           min="0.1" max="1.0" step="0.1" 
                           value={draftConfig.kellyFraction || 0.2}
                           onChange={e => setDraftConfig({...draftConfig, kellyFraction: parseFloat(e.target.value)})}
                           className="w-full h-1.5 bg-indigo-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                        />
                        <div className="flex justify-between text-[8px] font-black text-indigo-400 mt-1 uppercase">
                           <span>保守 (10%)</span>
                           <span>激进 (100%)</span>
                        </div>
                      </div>
                   )}

                   {/* Target Mode */}
                   <div>
                      <label className="text-[10px] font-black text-gray-400 uppercase ml-1">自动目标</label>
                      <div className="grid grid-cols-2 gap-2 mt-1 mb-2">
                         <button onClick={() => setDraftConfig({...draftConfig, autoTarget: 'AI_PREDICTION'})} className={`col-span-1 py-2 rounded-lg text-[10px] font-bold border ${draftConfig.autoTarget === 'AI_PREDICTION' ? 'bg-purple-600 text-white border-purple-600 shadow-md' : 'bg-white text-gray-400 border-gray-200'}`}>
                            <div className="flex items-center justify-center space-x-1">
                                <BrainCircuit className="w-3.5 h-3.5" />
                                <span>AI 单规托管</span>
                            </div>
                         </button>
                         <button onClick={() => setDraftConfig({...draftConfig, autoTarget: 'GLOBAL_AI_FULL_SCAN'})} className={`col-span-1 py-2 rounded-lg text-[10px] font-bold border ${draftConfig.autoTarget === 'GLOBAL_AI_FULL_SCAN' ? 'bg-indigo-600 text-white border-indigo-600 shadow-md' : 'bg-white text-gray-400 border-gray-200'}`}>
                            <div className="flex items-center justify-center space-x-1">
                                <Sparkles className="w-3.5 h-3.5" />
                                <span>AI 全域扫描</span>
                            </div>
                         </button>
                         <button onClick={() => setDraftConfig({...draftConfig, autoTarget: 'GLOBAL_TREND_DRAGON'})} className={`py-2 rounded-lg text-[10px] font-bold border ${draftConfig.autoTarget === 'GLOBAL_TREND_DRAGON' ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-gray-400 border-gray-200'}`}>全域走势长龙</button>
                         <button onClick={() => setDraftConfig({...draftConfig, autoTarget: 'GLOBAL_BEAD_DRAGON'})} className={`py-2 rounded-lg text-[10px] font-bold border ${draftConfig.autoTarget === 'GLOBAL_BEAD_DRAGON' ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-gray-400 border-gray-200'}`}>全域珠盘长龙</button>
                      </div>
                      {/* v5.1: AI模型选择 + 胜率触发 */}
                      <div className="grid grid-cols-2 gap-2 mb-2">
                         <button onClick={() => setDraftConfig({...draftConfig, autoTarget: 'AI_MODEL_SELECT', selectedModels: draftConfig.selectedModels?.length ? draftConfig.selectedModels : ['ensemble']})} className={`py-2 rounded-lg text-[10px] font-bold border ${draftConfig.autoTarget === 'AI_MODEL_SELECT' ? 'bg-violet-600 text-white border-violet-600 shadow-md' : 'bg-white text-gray-400 border-gray-200'}`}>
                            <div className="flex items-center justify-center space-x-1">
                                <BrainCircuit className="w-3.5 h-3.5" />
                                <span>模型精选</span>
                            </div>
                         </button>
                         <button onClick={() => setDraftConfig({...draftConfig, autoTarget: 'AI_WINRATE_TRIGGER', selectedModels: draftConfig.selectedModels?.length ? draftConfig.selectedModels : ['ensemble'], winRateWindow: draftConfig.winRateWindow || 30, winRateTrigger: draftConfig.winRateTrigger || 30, winRateStop: draftConfig.winRateStop || 60})} className={`py-2 rounded-lg text-[10px] font-bold border ${draftConfig.autoTarget === 'AI_WINRATE_TRIGGER' ? 'bg-cyan-600 text-white border-cyan-600 shadow-md' : 'bg-white text-gray-400 border-gray-200'}`}>
                            <div className="flex items-center justify-center space-x-1">
                                <BarChart4 className="w-3.5 h-3.5" />
                                <span>胜率触发</span>
                            </div>
                         </button>
                      </div>
                      {/* 单/多规则龙 */}
                      <div className="grid grid-cols-2 gap-2 mb-2">
                         <button onClick={() => setDraftConfig({...draftConfig, autoTarget: 'RULE_TREND_DRAGON', selectedRuleIds: draftConfig.selectedRuleIds?.length ? draftConfig.selectedRuleIds : [draftRuleId]})} className={`py-2 rounded-lg text-[10px] font-bold border ${draftConfig.autoTarget === 'RULE_TREND_DRAGON' ? 'bg-amber-600 text-white border-amber-600' : 'bg-white text-gray-400 border-gray-200'}`}>规则走势长龙</button>
                         <button onClick={() => setDraftConfig({...draftConfig, autoTarget: 'RULE_BEAD_DRAGON', selectedRuleIds: draftConfig.selectedRuleIds?.length ? draftConfig.selectedRuleIds : [draftRuleId]})} className={`py-2 rounded-lg text-[10px] font-bold border ${draftConfig.autoTarget === 'RULE_BEAD_DRAGON' ? 'bg-amber-600 text-white border-amber-600' : 'bg-white text-gray-400 border-gray-200'}`}>规则珠盘长龙</button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                         <button onClick={() => setDraftConfig({...draftConfig, autoTarget: 'FIXED', targetSelections: draftConfig.targetSelections?.length ? draftConfig.targetSelections : ['ODD']})} className={`py-2 rounded-lg text-[10px] font-bold border ${draftConfig.autoTarget === 'FIXED' ? 'bg-red-500 text-white border-red-500' : 'bg-white text-gray-400 border-gray-200'}`}>定投目标</button>
                         <button onClick={() => setDraftConfig({...draftConfig, autoTarget: 'RANDOM', targetSelections: draftConfig.targetSelections?.length ? draftConfig.targetSelections : ['ODD', 'EVEN']})} className={`py-2 rounded-lg text-[10px] font-bold border ${draftConfig.autoTarget === 'RANDOM' ? 'bg-pink-500 text-white border-pink-500' : 'bg-white text-gray-400 border-gray-200'}`}>随机目标</button>
                         <button onClick={() => setDraftConfig({...draftConfig, autoTarget: 'FOLLOW_LAST'})} className={`py-2 rounded-lg text-[10px] font-bold border ${draftConfig.autoTarget === 'FOLLOW_LAST' ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-gray-400 border-gray-200'}`}>跟上期(顺)</button>
                         <button onClick={() => setDraftConfig({...draftConfig, autoTarget: 'REVERSE_LAST'})} className={`py-2 rounded-lg text-[10px] font-bold border ${draftConfig.autoTarget === 'REVERSE_LAST' ? 'bg-purple-500 text-white border-purple-500' : 'bg-white text-gray-400 border-gray-200'}`}>反上期(砍)</button>
                         <button onClick={() => setDraftConfig({...draftConfig, autoTarget: 'FOLLOW_RECENT_TREND'})} className={`py-2 rounded-lg text-[10px] font-bold border ${draftConfig.autoTarget === 'FOLLOW_RECENT_TREND' ? 'bg-lime-600 text-white border-lime-600' : 'bg-white text-gray-400 border-gray-200'}`}>顺势跟投</button>
                         <button onClick={() => setDraftConfig({...draftConfig, autoTarget: 'FOLLOW_RECENT_TREND_REVERSE'})} className={`py-2 rounded-lg text-[10px] font-bold border ${draftConfig.autoTarget === 'FOLLOW_RECENT_TREND_REVERSE' ? 'bg-rose-600 text-white border-rose-600' : 'bg-white text-gray-400 border-gray-200'}`}>反势跟投</button>
                         <button onClick={() => setDraftConfig({...draftConfig, autoTarget: 'DRAGON_FOLLOW'})} className={`py-2 rounded-lg text-[10px] font-bold border ${draftConfig.autoTarget === 'DRAGON_FOLLOW' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-400 border-gray-200'}`}>走势龙顺势</button>
                         <button onClick={() => setDraftConfig({...draftConfig, autoTarget: 'DRAGON_REVERSE'})} className={`py-2 rounded-lg text-[10px] font-bold border ${draftConfig.autoTarget === 'DRAGON_REVERSE' ? 'bg-red-600 text-white border-red-600' : 'bg-white text-gray-400 border-gray-200'}`}>走势龙反势</button>
                         <button onClick={() => setDraftConfig({...draftConfig, autoTarget: 'BEAD_DRAGON_FOLLOW'})} className={`py-2 rounded-lg text-[10px] font-bold border ${draftConfig.autoTarget === 'BEAD_DRAGON_FOLLOW' ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-gray-400 border-gray-200'}`}>珠盘龙顺势</button>
                         <button onClick={() => setDraftConfig({...draftConfig, autoTarget: 'BEAD_DRAGON_REVERSE'})} className={`py-2 rounded-lg text-[10px] font-bold border ${draftConfig.autoTarget === 'BEAD_DRAGON_REVERSE' ? 'bg-orange-600 text-white border-orange-600' : 'bg-white text-gray-400 border-gray-200'}`}>珠盘龙反势</button>
                         <button onClick={() => setDraftConfig({...draftConfig, autoTarget: 'OSCILLATION_REVERSE', oscillationCount: draftConfig.oscillationCount || 3})} className={`py-2 rounded-lg text-[10px] font-bold border ${draftConfig.autoTarget === 'OSCILLATION_REVERSE' ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-gray-400 border-gray-200'}`}>振荡反转</button>
                         <button onClick={() => setDraftConfig({...draftConfig, autoTarget: 'PATTERN_MATCH', patternLength: draftConfig.patternLength || 4, patternMinMatch: draftConfig.patternMinMatch || 3})} className={`py-2 rounded-lg text-[10px] font-bold border ${draftConfig.autoTarget === 'PATTERN_MATCH' ? 'bg-fuchsia-600 text-white border-fuchsia-600' : 'bg-white text-gray-400 border-gray-200'}`}>模式匹配</button>
                      </div>
                   </div>

                   {/* 目标多选 (所有模式通用) */}
                   <div className="bg-gray-50 p-3 rounded-xl border border-gray-100 space-y-2">
                      <span className="text-[10px] font-black text-gray-400 uppercase block">目标选择 (可多选)</span>
                      <div className="grid grid-cols-4 gap-1.5">
                        {(['ODD', 'EVEN', 'BIG', 'SMALL'] as BetTarget[]).map(t => {
                          const labels: Record<string, string> = { ODD: '单', EVEN: '双', BIG: '大', SMALL: '小' };
                          const colors: Record<string, string> = { ODD: 'bg-red-500', EVEN: 'bg-teal-500', BIG: 'bg-orange-500', SMALL: 'bg-indigo-500' };
                          const selected = (draftConfig.targetSelections || []).includes(t);
                          return (
                            <button
                              key={t}
                              onClick={() => {
                                const curr = draftConfig.targetSelections || [];
                                const next = selected ? curr.filter(x => x !== t) : [...curr, t];
                                if (next.length === 0) return; // Must have at least 1
                                setDraftConfig({...draftConfig, targetSelections: next});
                              }}
                              className={`py-1.5 rounded-lg text-[10px] font-black border transition-all ${selected ? `${colors[t]} text-white border-transparent shadow-sm` : 'bg-white text-gray-400 border-gray-200'}`}
                            >
                              {labels[t]}
                            </button>
                          );
                        })}
                      </div>
                      <button
                        onClick={() => setDraftConfig({...draftConfig, targetSelections: ['ODD', 'EVEN', 'BIG', 'SMALL']})}
                        className={`w-full py-1 rounded-lg text-[9px] font-bold border ${(draftConfig.targetSelections || []).length === 4 ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-400 border-gray-200'}`}
                      >
                        全部
                      </button>
                   </div>

                   {/* v5.1: AI模型选择面板 */}
                   {(draftConfig.autoTarget === 'AI_MODEL_SELECT' || draftConfig.autoTarget === 'AI_WINRATE_TRIGGER') && (
                      <div className="bg-violet-50/50 p-3 rounded-xl border border-violet-100/50 space-y-2">
                         <span className="text-[10px] font-black text-violet-600 uppercase block">选择预测模型 (可多选)</span>
                         <div className="grid grid-cols-4 gap-1">
                           {AI_MODEL_LIST.map(m => {
                             const selected = (draftConfig.selectedModels || []).includes(m.id);
                             return (
                               <button
                                 key={m.id}
                                 onClick={() => {
                                   const curr = draftConfig.selectedModels || [];
                                   const next = selected ? curr.filter(x => x !== m.id) : [...curr, m.id];
                                   if (next.length === 0) return;
                                   setDraftConfig({...draftConfig, selectedModels: next});
                                 }}
                                 className={`py-1 px-1 rounded text-[9px] font-bold border transition-all ${selected ? 'bg-violet-500 text-white border-violet-500' : 'bg-white text-gray-400 border-gray-200'}`}
                               >
                                 {m.name}
                               </button>
                             );
                           })}
                         </div>
                         <button
                           onClick={() => setDraftConfig({...draftConfig, selectedModels: AI_MODEL_LIST.map(m => m.id)})}
                           className={`w-full py-1 rounded text-[9px] font-bold border ${(draftConfig.selectedModels || []).length === AI_MODEL_LIST.length ? 'bg-violet-700 text-white border-violet-700' : 'bg-white text-gray-400 border-gray-200'}`}
                         >
                           全选 ({AI_MODEL_LIST.length}个模型)
                         </button>
                      </div>
                   )}

                   {/* v5.1: 胜率触发参数 */}
                   {draftConfig.autoTarget === 'AI_WINRATE_TRIGGER' && (
                      <div className="bg-cyan-50/50 p-3 rounded-xl border border-cyan-100/50 space-y-2">
                         <span className="text-[10px] font-black text-cyan-600 uppercase block">胜率触发参数</span>
                         <div className="grid grid-cols-3 gap-2">
                           <div>
                             <label className="text-[9px] font-bold text-gray-400 block mb-0.5">近N期</label>
                             <input type="number" min="1" step="1" value={draftConfig.winRateWindow || 30} onChange={e => setDraftConfig({...draftConfig, winRateWindow: Math.max(1, parseInt(e.target.value) || 1)})} placeholder="30" className="w-full bg-white rounded-lg px-1.5 py-1.5 text-xs font-black border border-cyan-200 outline-none text-center" />
                           </div>
                           <div>
                             <label className="text-[9px] font-bold text-gray-400 block mb-0.5">开始投注%</label>
                             <input type="number" min="1" max="100" step="1" value={draftConfig.winRateTrigger || 30} onChange={e => setDraftConfig({...draftConfig, winRateTrigger: Math.min(100, Math.max(1, parseInt(e.target.value) || 1))})} placeholder="30" className="w-full bg-white rounded-lg px-1.5 py-1.5 text-xs font-black border border-cyan-200 outline-none text-center" />
                           </div>
                           <div>
                             <label className="text-[9px] font-bold text-gray-400 block mb-0.5">停止投注%</label>
                             <input type="number" min="1" max="100" step="1" value={draftConfig.winRateStop || 60} onChange={e => setDraftConfig({...draftConfig, winRateStop: Math.min(100, Math.max(1, parseInt(e.target.value) || 1))})} placeholder="60" className="w-full bg-white rounded-lg px-1.5 py-1.5 text-xs font-black border border-cyan-200 outline-none text-center" />
                           </div>
                         </div>
                         <p className="text-[9px] text-cyan-600 font-semibold">
                           近{draftConfig.winRateWindow || 30}期模型胜率≤{draftConfig.winRateTrigger || 30}%时开始投注，胜率≥{draftConfig.winRateStop || 60}%时停止
                         </p>
                      </div>
                   )}

                   {/* v5.2: 振荡反转参数 */}
                   {draftConfig.autoTarget === 'OSCILLATION_REVERSE' && (
                      <div className="bg-sky-50/50 p-3 rounded-xl border border-sky-100/50 space-y-2">
                         <span className="text-[10px] font-black text-sky-600 uppercase block">振荡反转参数</span>
                         <div className="grid grid-cols-1 gap-2">
                           <div>
                             <label className="text-[9px] font-bold text-gray-400 block mb-0.5">连续N次后反转</label>
                             <input type="number" min="2" step="1" value={draftConfig.oscillationCount || 3} onChange={e => setDraftConfig({...draftConfig, oscillationCount: Math.max(2, parseInt(e.target.value) || 2)})} placeholder="3" className="w-full bg-white rounded-lg px-1.5 py-1.5 text-xs font-black border border-sky-200 outline-none text-center" />
                           </div>
                         </div>
                         <p className="text-[9px] text-sky-600 font-semibold">
                           当连续出现{draftConfig.oscillationCount || 3}次相同结果时，下注反向（均值回归策略）
                         </p>
                      </div>
                   )}

                   {/* v5.2: 模式匹配参数 */}
                   {draftConfig.autoTarget === 'PATTERN_MATCH' && (
                      <div className="bg-fuchsia-50/50 p-3 rounded-xl border border-fuchsia-100/50 space-y-2">
                         <span className="text-[10px] font-black text-fuchsia-600 uppercase block">模式匹配参数</span>
                         <div className="grid grid-cols-2 gap-2">
                           <div>
                             <label className="text-[9px] font-bold text-gray-400 block mb-0.5">模式长度</label>
                             <input type="number" min="2" max="10" step="1" value={draftConfig.patternLength || 4} onChange={e => setDraftConfig({...draftConfig, patternLength: Math.min(10, Math.max(2, parseInt(e.target.value) || 2))})} placeholder="4" className="w-full bg-white rounded-lg px-1.5 py-1.5 text-xs font-black border border-fuchsia-200 outline-none text-center" />
                           </div>
                           <div>
                             <label className="text-[9px] font-bold text-gray-400 block mb-0.5">最少匹配次数</label>
                             <input type="number" min="1" max="20" step="1" value={draftConfig.patternMinMatch || 3} onChange={e => setDraftConfig({...draftConfig, patternMinMatch: Math.min(20, Math.max(1, parseInt(e.target.value) || 1))})} placeholder="3" className="w-full bg-white rounded-lg px-1.5 py-1.5 text-xs font-black border border-fuchsia-200 outline-none text-center" />
                           </div>
                         </div>
                         <p className="text-[9px] text-fuchsia-600 font-semibold">
                           匹配近{draftConfig.patternLength || 4}期模式在历史中出现≥{draftConfig.patternMinMatch || 3}次后，按历史概率预测下期
                         </p>
                      </div>
                   )}

                   {/* v5.1: 规则多选 (用于 RULE_TREND_DRAGON, RULE_BEAD_DRAGON) */}
                   {(draftConfig.autoTarget === 'RULE_TREND_DRAGON' || draftConfig.autoTarget === 'RULE_BEAD_DRAGON') && (
                      <div className="bg-amber-50/50 p-3 rounded-xl border border-amber-100/50 space-y-2">
                         <span className="text-[10px] font-black text-amber-600 uppercase block">选择规则 (可多选)</span>
                         <div className="grid grid-cols-3 gap-1">
                           {rules.map(r => {
                             const selected = (draftConfig.selectedRuleIds || []).includes(r.id);
                             return (
                               <button
                                 key={r.id}
                                 onClick={() => {
                                   const curr = draftConfig.selectedRuleIds || [];
                                   const next = selected ? curr.filter(x => x !== r.id) : [...curr, r.id];
                                   if (next.length === 0) return;
                                   setDraftConfig({...draftConfig, selectedRuleIds: next});
                                 }}
                                 className={`py-1 px-1 rounded text-[9px] font-bold border transition-all ${selected ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-gray-400 border-gray-200'}`}
                               >
                                 {r.label}
                               </button>
                             );
                           })}
                         </div>
                         <button
                           onClick={() => setDraftConfig({...draftConfig, selectedRuleIds: rules.map(r => r.id)})}
                           className={`w-full py-1 rounded text-[9px] font-bold border ${(draftConfig.selectedRuleIds || []).length === rules.length ? 'bg-amber-600 text-white border-amber-600' : 'bg-white text-gray-400 border-gray-200'}`}
                         >
                           全选 ({rules.length}个规则)
                         </button>
                      </div>
                   )}

                   {/* 模式参数 */}
                   {(draftConfig.autoTarget === 'FOLLOW_LAST' || draftConfig.autoTarget === 'REVERSE_LAST' || draftConfig.autoTarget === 'FOLLOW_RECENT_TREND' || draftConfig.autoTarget === 'FOLLOW_RECENT_TREND_REVERSE' || draftConfig.autoTarget.startsWith('GLOBAL') || draftConfig.autoTarget === 'DRAGON_FOLLOW' || draftConfig.autoTarget === 'DRAGON_REVERSE' || draftConfig.autoTarget === 'AI_PREDICTION' || draftConfig.autoTarget === 'GLOBAL_AI_FULL_SCAN' || draftConfig.autoTarget === 'BEAD_DRAGON_FOLLOW' || draftConfig.autoTarget === 'BEAD_DRAGON_REVERSE' || draftConfig.autoTarget === 'AI_MODEL_SELECT' || draftConfig.autoTarget === 'AI_WINRATE_TRIGGER' || draftConfig.autoTarget === 'RULE_TREND_DRAGON' || draftConfig.autoTarget === 'RULE_BEAD_DRAGON' || draftConfig.autoTarget === 'OSCILLATION_REVERSE' || draftConfig.autoTarget === 'PATTERN_MATCH') && (
                      <div className="bg-gray-50 p-3 rounded-xl border border-gray-100 space-y-2">
                          {(draftConfig.autoTarget === 'FOLLOW_RECENT_TREND' || draftConfig.autoTarget === 'FOLLOW_RECENT_TREND_REVERSE') && (
                             <div className="flex items-center justify-between">
                                <span className={`text-[10px] font-bold flex items-center ${draftConfig.autoTarget === 'FOLLOW_RECENT_TREND_REVERSE' ? 'text-rose-600' : 'text-lime-600'}`}>
                                    <BarChart2 className="w-3 h-3 mr-1" /> 参考期数 (N)
                                </span>
                                <input
                                    type="number" min="2"
                                    value={draftConfig.trendWindow}
                                    onChange={e => setDraftConfig({...draftConfig, trendWindow: Math.max(2, parseInt(e.target.value) || 5)})}
                                    className={`w-16 text-center bg-white rounded-lg text-xs font-black border ${draftConfig.autoTarget === 'FOLLOW_RECENT_TREND_REVERSE' ? 'border-rose-200 text-rose-600' : 'border-lime-200 text-lime-600'}`}
                                />
                             </div>
                          )}
                          {(draftConfig.autoTarget === 'DRAGON_FOLLOW' || draftConfig.autoTarget === 'DRAGON_REVERSE' || draftConfig.autoTarget === 'BEAD_DRAGON_FOLLOW' || draftConfig.autoTarget === 'BEAD_DRAGON_REVERSE' || draftConfig.autoTarget === 'RULE_TREND_DRAGON' || draftConfig.autoTarget === 'RULE_BEAD_DRAGON') && (
                             <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                   <span className={`text-[10px] font-bold flex items-center ${draftConfig.autoTarget === 'DRAGON_FOLLOW' ? 'text-emerald-600' : 'text-red-600'}`}>
                                       <Flame className="w-3 h-3 mr-1" /> 起投连数
                                   </span>
                                   <input
                                       type="number" min="2"
                                       value={draftConfig.minStreak}
                                       onChange={e => setDraftConfig({...draftConfig, minStreak: Math.max(2, parseInt(e.target.value) || 3)})}
                                       className={`w-16 text-center bg-white rounded-lg text-xs font-black border ${draftConfig.autoTarget === 'DRAGON_FOLLOW' ? 'border-emerald-200 text-emerald-600' : 'border-red-200 text-red-600'}`}
                                   />
                                </div>
                                <div className="flex items-center justify-between">
                                   <span className={`text-[10px] font-bold flex items-center ${draftConfig.autoTarget === 'DRAGON_FOLLOW' ? 'text-emerald-600' : 'text-red-600'}`}>
                                       <Flame className="w-3 h-3 mr-1" /> 结束连数
                                   </span>
                                   <input
                                       type="number" min={draftConfig.minStreak || 3}
                                       value={draftConfig.dragonEndStreak || 5}
                                       onChange={e => setDraftConfig({...draftConfig, dragonEndStreak: Math.max(draftConfig.minStreak || 3, parseInt(e.target.value) || 5)})}
                                       className={`w-16 text-center bg-white rounded-lg text-xs font-black border ${draftConfig.autoTarget === 'DRAGON_FOLLOW' ? 'border-emerald-200 text-emerald-600' : 'border-red-200 text-red-600'}`}
                                   />
                                </div>
                             </div>
                          )}
                          {(draftConfig.autoTarget === 'FOLLOW_LAST' || draftConfig.autoTarget === 'REVERSE_LAST' || draftConfig.autoTarget.startsWith('GLOBAL') || draftConfig.autoTarget === 'AI_PREDICTION' || draftConfig.autoTarget === 'GLOBAL_AI_FULL_SCAN') && (
                             <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold text-amber-600 flex items-center"><AlertTriangle className="w-3 h-3 mr-1" /> 起投连数</span>
                                <input
                                    type="number" min="1"
                                    value={draftConfig.minStreak}
                                    onChange={e => setDraftConfig({...draftConfig, minStreak: Math.max(1, parseInt(e.target.value) || 1)})}
                                    className="w-16 text-center bg-white rounded-lg text-xs font-black border border-amber-200 text-amber-600"
                                />
                             </div>
                          )}
                          {(draftConfig.autoTarget === 'FOLLOW_RECENT_TREND' || draftConfig.autoTarget === 'FOLLOW_RECENT_TREND_REVERSE') && (
                             <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold text-amber-600 flex items-center"><AlertTriangle className="w-3 h-3 mr-1" /> 起投连数</span>
                                <input
                                    type="number" min="1"
                                    value={draftConfig.minStreak}
                                    onChange={e => setDraftConfig({...draftConfig, minStreak: Math.max(1, parseInt(e.target.value) || 1)})}
                                    className="w-16 text-center bg-white rounded-lg text-xs font-black border border-amber-200 text-amber-600"
                                />
                             </div>
                          )}
                      </div>
                   )}

                   <div className="pt-4 border-t border-gray-100 mt-2">
                      <div className="flex items-center justify-between mb-3">
                         <span className="text-xs font-bold text-gray-500">基础注额 (每单)</span>
                         <input type="number" value={config.baseBet} onChange={(e) => setConfig({...config, baseBet: parseFloat(e.target.value)})} className="w-20 text-right bg-gray-50 px-2 py-1 rounded-lg text-xs font-black" />
                      </div>

                      {/* 下注模式选择: 模拟 vs 真实 */}
                      <div className="flex items-center justify-between mb-3 p-2.5 rounded-xl bg-gray-50 border border-gray-100">
                         <div className="flex flex-col">
                           <span className="text-xs font-bold text-gray-600">下注模式</span>
                           <span className="text-[10px] text-gray-400">
                             {draftBetMode === 'REAL' ? '通过插件在游戏页面真实下注' : '仅模拟计算，不实际下注'}
                           </span>
                         </div>
                         <div className="flex bg-white rounded-lg border border-gray-200 overflow-hidden">
                           <button
                             onClick={() => setDraftBetMode('SIMULATED')}
                             className={`px-3 py-1.5 text-[11px] font-black transition-all ${draftBetMode === 'SIMULATED' ? 'bg-blue-500 text-white shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                           >
                             模拟
                           </button>
                           <button
                             onClick={() => setDraftBetMode('REAL')}
                             className={`px-3 py-1.5 text-[11px] font-black transition-all ${draftBetMode === 'REAL' ? 'bg-red-500 text-white shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                           >
                             真实
                           </button>
                         </div>
                      </div>
                      {draftBetMode === 'REAL' && (
                        <div className={`mb-3 p-2.5 rounded-xl text-[11px] font-bold flex items-center ${pluginReady ? 'bg-green-50 text-green-600 border border-green-200' : 'bg-red-50 text-red-500 border border-red-200'}`}>
                          <span className={`w-2 h-2 rounded-full mr-2 ${pluginReady ? 'bg-green-500' : 'bg-red-400'}`}></span>
                          {pluginReady
                            ? <>插件已连接 {realBalance != null && <span className="ml-auto text-green-700">余额: ¥{realBalance.toFixed(2)}</span>}</>
                            : '插件未检测到 — 请确保已安装并刷新游戏页面'
                          }
                        </div>
                      )}

                      {/* 区块范围限制 */}
                      <div className="mb-3 p-2.5 rounded-xl bg-gray-50 border border-gray-100">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-bold text-gray-600 flex items-center">
                            <Layers className="w-3 h-3 mr-1" /> 区块范围限制
                          </span>
                          <button
                            onClick={() => setDraftBlockRangeEnabled(!draftBlockRangeEnabled)}
                            className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0 overflow-hidden ${draftBlockRangeEnabled ? 'bg-indigo-500' : 'bg-gray-300'}`}
                          >
                            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-transform duration-200 ${draftBlockRangeEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                          </button>
                        </div>
                        {draftBlockRangeEnabled && (
                          <div className="grid grid-cols-2 gap-2 mt-2">
                            <div>
                              <label className="text-[9px] font-bold text-gray-400 block mb-0.5">起始区块</label>
                              <input
                                type="number"
                                value={draftBlockStart || ''}
                                onChange={e => setDraftBlockStart(parseInt(e.target.value) || 0)}
                                placeholder="例: 80360900"
                                className="w-full bg-white rounded-lg px-2 py-1.5 text-xs font-black border border-gray-200 outline-none focus:border-indigo-400"
                              />
                            </div>
                            <div>
                              <label className="text-[9px] font-bold text-gray-400 block mb-0.5">结束区块</label>
                              <input
                                type="number"
                                value={draftBlockEnd || ''}
                                onChange={e => setDraftBlockEnd(parseInt(e.target.value) || 0)}
                                placeholder="例: 80360950"
                                className="w-full bg-white rounded-lg px-2 py-1.5 text-xs font-black border border-gray-200 outline-none focus:border-indigo-400"
                              />
                            </div>
                            {draftBlockStart > 0 && draftBlockEnd > 0 && (
                              <p className="col-span-2 text-[9px] font-semibold text-indigo-500">
                                仅在区块 {draftBlockStart} ~ {draftBlockEnd} 范围内下注 (共{draftBlockEnd - draftBlockStart}个区块)
                              </p>
                            )}
                          </div>
                        )}
                      </div>

                      {/* 时间范围限制 */}
                      <div className="mb-3 p-2.5 rounded-xl bg-gray-50 border border-gray-100">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-bold text-gray-600 flex items-center">
                            <Clock className="w-3 h-3 mr-1" /> 时间范围限制
                          </span>
                          <button
                            onClick={() => setDraftTimeRangeEnabled(!draftTimeRangeEnabled)}
                            className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0 overflow-hidden ${draftTimeRangeEnabled ? 'bg-indigo-500' : 'bg-gray-300'}`}
                          >
                            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-transform duration-200 ${draftTimeRangeEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                          </button>
                        </div>
                        {draftTimeRangeEnabled && (
                          <div className="grid grid-cols-2 gap-2 mt-2">
                            <div>
                              <label className="text-[9px] font-bold text-gray-400 block mb-0.5">开始时间</label>
                              <input
                                type="datetime-local"
                                value={draftTimeStart}
                                onChange={e => setDraftTimeStart(e.target.value)}
                                className="w-full bg-white rounded-lg px-2 py-1.5 text-[10px] font-bold border border-gray-200 outline-none focus:border-indigo-400"
                              />
                            </div>
                            <div>
                              <label className="text-[9px] font-bold text-gray-400 block mb-0.5">结束时间</label>
                              <input
                                type="datetime-local"
                                value={draftTimeEnd}
                                onChange={e => setDraftTimeEnd(e.target.value)}
                                className="w-full bg-white rounded-lg px-2 py-1.5 text-[10px] font-bold border border-gray-200 outline-none focus:border-indigo-400"
                              />
                            </div>
                            {draftTimeStart && draftTimeEnd && (
                              <p className="col-span-2 text-[9px] font-semibold text-indigo-500">
                                从 {new Date(draftTimeStart).toLocaleString('zh-CN')} 到 {new Date(draftTimeEnd).toLocaleString('zh-CN')}
                              </p>
                            )}
                          </div>
                        )}
                      </div>

                      {/* 每日定时 */}
                      <div className="mb-3 p-2.5 rounded-xl bg-gray-50 border border-gray-100">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-bold text-gray-600 flex items-center">
                            <RefreshCw className="w-3 h-3 mr-1" /> 每日定时执行
                          </span>
                          <button
                            onClick={() => setDraftDailyScheduleEnabled(!draftDailyScheduleEnabled)}
                            className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0 overflow-hidden ${draftDailyScheduleEnabled ? 'bg-green-500' : 'bg-gray-300'}`}
                          >
                            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-transform duration-200 ${draftDailyScheduleEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                          </button>
                        </div>
                        {draftDailyScheduleEnabled && (
                          <div className="grid grid-cols-2 gap-2 mt-2">
                            <div>
                              <label className="text-[9px] font-bold text-gray-400 block mb-0.5">每日开始</label>
                              <input
                                type="time"
                                step="60"
                                value={draftDailyStart}
                                onChange={e => setDraftDailyStart(e.target.value)}
                                className="w-full bg-white rounded-lg px-2 py-2 text-sm font-bold border border-gray-200 outline-none focus:border-green-400 appearance-none"
                                style={{ minHeight: '36px' }}
                              />
                            </div>
                            <div>
                              <label className="text-[9px] font-bold text-gray-400 block mb-0.5">每日结束</label>
                              <input
                                type="time"
                                step="60"
                                value={draftDailyEnd}
                                onChange={e => setDraftDailyEnd(e.target.value)}
                                className="w-full bg-white rounded-lg px-2 py-2 text-sm font-bold border border-gray-200 outline-none focus:border-green-400 appearance-none"
                                style={{ minHeight: '36px' }}
                              />
                            </div>
                            <p className="col-span-2 text-[9px] font-semibold text-green-600">
                              {(() => {
                                const [sh, sm] = draftDailyStart.split(':').map(Number);
                                const [eh, em] = draftDailyEnd.split(':').map(Number);
                                const startMin = sh * 60 + sm;
                                const endMin = eh * 60 + em;
                                const isCrossMidnight = endMin <= startMin;
                                return isCrossMidnight
                                  ? `每天 ${draftDailyStart} ~ 次日${draftDailyEnd} 自动运行 (跨午夜)`
                                  : `每天 ${draftDailyStart} ~ ${draftDailyEnd} 自动运行`;
                              })()}
                            </p>
                          </div>
                        )}
                      </div>

                      <button
                        onClick={createTask}
                        className={`w-full py-3.5 text-white rounded-xl font-black text-sm flex items-center justify-center transition-all shadow-lg active:scale-95 ${
                          draftBetMode === 'REAL'
                            ? 'bg-red-600 hover:bg-red-700 shadow-red-200'
                            : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200'
                        }`}
                      >
                        <Plus className="w-4 h-4 mr-2" /> {draftBetMode === 'REAL' ? '添加真实下注任务' : '添加托管任务'}
                      </button>
                   </div>
                </div>
              )}
           </div>

           {/* Global Config Card */}
           <div className="bg-white rounded-[2rem] p-6 shadow-sm border border-gray-100">
              <h3 className="text-xs font-black text-gray-400 uppercase mb-4">全局风控参数</h3>
              <div className="grid grid-cols-2 gap-3">
                   <div>
                     <label className="text-[10px] font-black text-gray-400 uppercase">初始本金</label>
                     <input 
                       type="number" 
                       value={config.initialBalance} 
                       onChange={e => {
                         const val = parseFloat(e.target.value);
                         setConfig({...config, initialBalance: val});
                         if (!isNaN(val)) {
                           setBalance(val);
                           setGlobalMetrics({ peakBalance: val, maxDrawdown: 0 });
                         }
                       }} 
                       className="w-full bg-gray-50 rounded-lg px-2 py-1.5 text-xs font-bold border border-transparent focus:border-indigo-500 outline-none" 
                     />
                   </div>
                   <div>
                     <label className="text-[10px] font-black text-gray-400 uppercase">赔率</label>
                     <input type="number" step="0.01" value={config.odds} onChange={e => setConfig({...config, odds: parseFloat(e.target.value)})} className="w-full bg-gray-50 rounded-lg px-2 py-1.5 text-xs font-bold border border-transparent focus:border-indigo-500 outline-none" />
                   </div>
                   <div>
                     <label className="text-[10px] font-black text-gray-400 uppercase">止盈 (金额)</label>
                     <input type="number" value={config.takeProfit} onChange={e => setConfig({...config, takeProfit: parseFloat(e.target.value) || 0})} className="w-full bg-green-50 text-green-700 rounded-lg px-2 py-1.5 text-xs font-bold outline-none" />
                   </div>
                   <div>
                     <label className="text-[10px] font-black text-gray-400 uppercase">止损 (金额)</label>
                     <input type="number" value={config.stopLoss} onChange={e => setConfig({...config, stopLoss: parseFloat(e.target.value) || 0})} className="w-full bg-red-50 text-red-700 rounded-lg px-2 py-1.5 text-xs font-bold outline-none" />
                   </div>
                   <div>
                     <label className="text-[10px] font-black text-gray-400 uppercase">止盈 (%本金)</label>
                     <input type="number" value={config.takeProfitPercent || 0} onChange={e => setConfig({...config, takeProfitPercent: parseFloat(e.target.value) || 0})} placeholder="0=关闭" className="w-full bg-green-50 text-green-700 rounded-lg px-2 py-1.5 text-xs font-bold outline-none" />
                   </div>
                   <div>
                     <label className="text-[10px] font-black text-gray-400 uppercase">止损 (%本金)</label>
                     <input type="number" value={config.stopLossPercent || 0} onChange={e => setConfig({...config, stopLossPercent: parseFloat(e.target.value) || 0})} placeholder="0=关闭" className="w-full bg-red-50 text-red-700 rounded-lg px-2 py-1.5 text-xs font-bold outline-none" />
                   </div>
                   <button 
                    type="button"
                    onClick={resetAccount} 
                    className="col-span-2 py-2 bg-gray-100 hover:bg-red-50 hover:text-red-600 text-gray-500 rounded-lg text-xs font-black flex items-center justify-center transition-colors mt-2"
                   >
                      <Trash2 className="w-3 h-3 mr-2" /> 重置所有数据
                   </button>
              </div>
           </div>
        </div>

        {/* CENTER/RIGHT: TASKS & MANUAL (8 cols) */}
        <div className="lg:col-span-8 space-y-6">
           
           {/* RUNNING TASKS GRID */}
           {tasks.length > 0 && (
             <div className="space-y-4">
                <div className="flex justify-between items-center px-2">
                   <div className="flex items-center space-x-2">
                      <Activity className="w-5 h-5 text-indigo-600" />
                      <h3 className="font-black text-gray-900">运行中的任务 ({tasks.filter(t => t.isActive).length}/{tasks.length})</h3>
                   </div>
                   <div className="flex space-x-2">
                      <button 
                        onClick={startAllTasks}
                        className="flex items-center space-x-1 px-3 py-1.5 bg-green-50 text-green-600 rounded-lg text-[10px] font-black hover:bg-green-100 transition-colors"
                      >
                         <PlayCircle className="w-3.5 h-3.5" />
                         <span>全部开始</span>
                      </button>
                      <button
                        onClick={stopAllTasks}
                        className="flex items-center space-x-1 px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-[10px] font-black hover:bg-red-100 transition-colors"
                      >
                         <StopCircle className="w-3.5 h-3.5" />
                         <span>全部停止</span>
                      </button>
                      <button
                        onClick={deleteAllTasks}
                        className="flex items-center space-x-1 px-3 py-1.5 bg-gray-50 text-gray-500 rounded-lg text-[10px] font-black hover:bg-red-50 hover:text-red-600 transition-colors"
                      >
                         <Trash2 className="w-3.5 h-3.5" />
                         <span>全部删除</span>
                      </button>
                   </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                   {tasks.map(task => {
                     const rule = rules.find(r => r.id === task.ruleId);
                     const taskDDRate = config.initialBalance > 0 ? (task.stats.maxDrawdown / config.initialBalance) * 100 : 0;
                     
                     // Helper to generate task badge
                     const getTaskBadgeContent = (t: AutoTask, r?: IntervalRule) => {
                        if (t.config.autoTarget === 'GLOBAL_AI_FULL_SCAN') return { text: 'AI 全域扫描', color: 'bg-indigo-100 text-indigo-600' };
                        if (t.config.autoTarget.startsWith('GLOBAL')) return { text: '全域扫描', color: 'bg-amber-100 text-amber-600' };
                        if (t.config.autoTarget === 'AI_PREDICTION') return { text: 'AI 单规托管', color: 'bg-purple-100 text-purple-600' };
                        if (t.config.autoTarget === 'OSCILLATION_REVERSE') return { text: `振荡反转(${t.config.oscillationCount || 3}连)`, color: 'bg-sky-100 text-sky-600' };
                        if (t.config.autoTarget === 'PATTERN_MATCH') return { text: `模式匹配(${t.config.patternLength || 4}期)`, color: 'bg-fuchsia-100 text-fuchsia-600' };

                        const ruleLabel = r?.label || '未知规则';
                        const targetLabels: Record<string, string> = { ODD: '单', EVEN: '双', BIG: '大', SMALL: '小' };
                        const tsArr = t.config.targetSelections || [];
                        const tsStr = tsArr.length >= 4 ? '全部' : tsArr.map(x => targetLabels[x] || x).join('');
                        let detail = '';

                        switch(t.config.autoTarget) {
                            case 'FIXED': detail = `定投[${tsStr}]`; break;
                            case 'FIXED_ODD': detail = '定投单'; break;
                            case 'FIXED_EVEN': detail = '定投双'; break;
                            case 'FIXED_BIG': detail = '定投大'; break;
                            case 'FIXED_SMALL': detail = '定投小'; break;
                            case 'FOLLOW_LAST': detail = `跟上期[${tsStr}]`; break;
                            case 'REVERSE_LAST': detail = `反上期[${tsStr}]`; break;
                            case 'RANDOM': detail = `随机[${tsStr}]`; break;
                            case 'RANDOM_PARITY': detail = '随机单双'; break;
                            case 'RANDOM_SIZE': detail = '随机大小'; break;
                            case 'FOLLOW_RECENT_TREND': detail = `顺势N=${t.config.trendWindow || 5}[${tsStr}]`; break;
                            case 'FOLLOW_RECENT_TREND_REVERSE': detail = `反势N=${t.config.trendWindow || 5}[${tsStr}]`; break;
                            case 'DRAGON_FOLLOW': detail = `龙顺势[${tsStr}]`; break;
                            case 'DRAGON_REVERSE': detail = `龙反势[${tsStr}]`; break;
                            case 'BEAD_DRAGON_FOLLOW': detail = `珠龙顺[${tsStr}]`; break;
                            case 'BEAD_DRAGON_REVERSE': detail = `珠龙反[${tsStr}]`; break;
                            default: detail = '自定义';
                        }

                        return { text: `${ruleLabel} · ${detail}`, color: 'bg-slate-100 text-slate-600' };
                     };

                     const badge = getTaskBadgeContent(task, rule);

                     return (
                       <div key={task.id} className={`rounded-2xl p-5 border-2 transition-all relative overflow-hidden ${task.isActive ? 'bg-white border-indigo-500 shadow-md' : 'bg-gray-50 border-gray-200 grayscale-[0.5]'}`}>
                          <div className="flex justify-between items-start mb-3">
                             <div>
                                <h4 className="font-black text-sm text-gray-900 truncate max-w-[150px]">{task.name}</h4>
                                <div className="flex items-center space-x-2 mt-1 flex-wrap gap-y-1">
                                   <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${badge.color}`}>
                                      {badge.text}
                                   </span>
                                   <span className="text-[10px] bg-purple-50 text-purple-600 px-2 py-0.5 rounded font-bold">{STRATEGY_LABELS[task.config.type]}</span>
                                   <span className={`text-[10px] px-2 py-0.5 rounded font-black ${task.betMode === 'REAL' ? 'bg-red-100 text-red-600 border border-red-200' : 'bg-blue-50 text-blue-500'}`}>
                                      {task.betMode === 'REAL' ? '真实' : '模拟'}
                                   </span>
                                   {task.blockRangeEnabled && task.blockStart && task.blockEnd && (
                                     <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-50 text-cyan-600 font-bold">
                                       #{task.blockStart}~{task.blockEnd}
                                     </span>
                                   )}
                                   {task.timeRangeEnabled && task.timeStart && (
                                     <span className="text-[9px] px-1.5 py-0.5 rounded bg-orange-50 text-orange-600 font-bold">
                                       {new Date(task.timeStart).toLocaleString('zh-CN', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}~{task.timeEnd ? new Date(task.timeEnd).toLocaleString('zh-CN', {hour:'2-digit',minute:'2-digit'}) : ''}
                                     </span>
                                   )}
                                   {task.dailyScheduleEnabled && task.dailyStart && task.dailyEnd && (
                                     <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-50 text-green-600 font-bold">
                                       每日{task.dailyStart}~{task.dailyEnd}
                                     </span>
                                   )}
                                </div>
                             </div>
                             <button onClick={() => toggleTask(task.id)} className={`p-2 rounded-full transition-colors ${task.isActive ? 'text-red-500 hover:bg-red-50' : 'text-green-500 hover:bg-green-50'}`}>
                                {task.isActive ? <PauseCircle className="w-6 h-6" /> : <PlayCircle className="w-6 h-6" />}
                             </button>
                          </div>
                          
                          <div className="grid grid-cols-3 gap-2 mb-2 bg-gray-50/50 p-2 rounded-xl">
                             <div className="text-center">
                                <span className="block text-[9px] text-gray-400 uppercase font-black">当前下注</span>
                                <span className="block text-sm font-black text-gray-800">${task.state.currentBetAmount}</span>
                             </div>
                             <div className="text-center border-l border-gray-200">
                                <span className="block text-[9px] text-gray-400 uppercase font-black">连输</span>
                                <span className="block text-sm font-black text-red-500">{task.state.consecutiveLosses}</span>
                             </div>
                             <div className="text-center border-l border-gray-200">
                                <span className="block text-[9px] text-gray-400 uppercase font-black">盈亏</span>
                                <span className={`block text-sm font-black ${task.stats.profit >= 0 ? 'text-green-500' : 'text-red-500'}`}>{task.stats.profit >= 0 ? '+' : ''}{task.stats.profit.toFixed(0)}</span>
                             </div>
                          </div>
                          
                          <div className="grid grid-cols-3 gap-2 mb-2 bg-gray-50/50 p-2 rounded-xl">
                             <div className="text-center flex items-center justify-center space-x-1">
                                <TrendingUp className="w-3 h-3 text-green-500" />
                                <div>
                                    <span className="block text-[9px] text-gray-400 uppercase font-black">最高收益</span>
                                    <span className="block text-xs font-black text-green-600">+{task.stats.maxProfit.toFixed(0)}</span>
                                </div>
                             </div>
                             <div className="text-center border-l border-gray-200 flex items-center justify-center space-x-1">
                                <TrendingDown className="w-3 h-3 text-red-500" />
                                <div>
                                    <span className="block text-[9px] text-gray-400 uppercase font-black">最大亏损</span>
                                    <span className="block text-xs font-black text-red-600">{task.stats.maxLoss.toFixed(0)}</span>
                                </div>
                             </div>
                             <div className="text-center border-l border-gray-200 flex items-center justify-center space-x-1">
                                <Wallet className="w-3 h-3 text-blue-500" />
                                <div>
                                    <span className="block text-[9px] text-gray-400 uppercase font-black">累计下注</span>
                                    <span className="block text-xs font-black text-blue-600">${(task.stats.totalBetAmount || 0).toLocaleString()}</span>
                                </div>
                             </div>
                          </div>
                          
                          <div className="bg-red-50 rounded-xl p-2 flex items-center justify-center text-[10px] font-black text-red-500 mb-4 border border-red-100">
                             <ShieldAlert className="w-3 h-3 mr-1.5" />
                             最大回撤: -${task.stats.maxDrawdown.toFixed(0)} (-{taskDDRate.toFixed(1)}%)
                          </div>

                          <div className="flex justify-between items-center text-[10px] font-bold text-gray-400">
                             <span>W: {task.stats.wins} / L: {task.stats.losses}</span>
                             <div className="flex items-center space-x-2">
                               <button onClick={() => resetTask(task.id)} className="text-gray-300 hover:text-amber-500 flex items-center"><RefreshCw className="w-3 h-3 mr-0.5" /> 重置</button>
                               {!task.isActive && <button onClick={() => editTask(task.id)} className="text-gray-300 hover:text-blue-500 flex items-center"><Settings2 className="w-3 h-3 mr-0.5" /> 编辑</button>}
                               <button onClick={() => deleteTask(task.id)} className="text-gray-300 hover:text-red-500 flex items-center"><Trash2 className="w-3 h-3 mr-0.5" /> 删除</button>
                             </div>
                          </div>
                       </div>
                     );
                   })}
                </div>
             </div>
           )}

           {/* MANUAL BETTING CARD */}
           <div className="bg-white rounded-[2rem] p-6 shadow-sm border border-gray-100">
              <div className="flex justify-between items-center mb-6">
                 <div className="flex items-center space-x-2">
                    <Gamepad2 className="w-5 h-5 text-indigo-600" />
                    <h3 className="font-black text-gray-900">手动极速下注</h3>
                 </div>
                 <select 
                    value={activeManualRuleId} 
                    onChange={e => setActiveManualRuleId(e.target.value)}
                    className="bg-gray-50 text-gray-600 rounded-xl px-3 py-1.5 text-xs font-black border border-gray-100 outline-none"
                 >
                    {rules.map(r => (
                      <option key={r.id} value={r.id}>{r.label}</option>
                    ))}
                 </select>
              </div>
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                 <button 
                   onClick={() => manualRule && placeBet(getNextTargetHeight(allBlocks[0].height, manualRule.value, manualRule.startBlock), 'PARITY', 'ODD', config.baseBet, 'MANUAL', manualRule)}
                   className="py-4 bg-red-500 hover:bg-red-600 text-white rounded-xl font-black text-sm shadow-lg shadow-red-200 active:scale-95 transition-all flex flex-col items-center justify-center"
                 >
                    <span className="text-lg">单 (ODD)</span>
                    <span className="text-[10px] opacity-80">1:{config.odds}</span>
                 </button>
                 <button 
                   onClick={() => manualRule && placeBet(getNextTargetHeight(allBlocks[0].height, manualRule.value, manualRule.startBlock), 'PARITY', 'EVEN', config.baseBet, 'MANUAL', manualRule)}
                   className="py-4 bg-teal-500 hover:bg-teal-600 text-white rounded-xl font-black text-sm shadow-lg shadow-teal-200 active:scale-95 transition-all flex flex-col items-center justify-center"
                 >
                    <span className="text-lg">双 (EVEN)</span>
                    <span className="text-[10px] opacity-80">1:{config.odds}</span>
                 </button>
                 <button 
                   onClick={() => manualRule && placeBet(getNextTargetHeight(allBlocks[0].height, manualRule.value, manualRule.startBlock), 'SIZE', 'BIG', config.baseBet, 'MANUAL', manualRule)}
                   className="py-4 bg-orange-500 hover:bg-orange-600 text-white rounded-xl font-black text-sm shadow-lg shadow-orange-200 active:scale-95 transition-all flex flex-col items-center justify-center"
                 >
                    <span className="text-lg">大 (BIG)</span>
                    <span className="text-[10px] opacity-80">1:{config.odds}</span>
                 </button>
                 <button 
                   onClick={() => manualRule && placeBet(getNextTargetHeight(allBlocks[0].height, manualRule.value, manualRule.startBlock), 'SIZE', 'SMALL', config.baseBet, 'MANUAL', manualRule)}
                   className="py-4 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl font-black text-sm shadow-lg shadow-indigo-200 active:scale-95 transition-all flex flex-col items-center justify-center"
                 >
                    <span className="text-lg">小 (SMALL)</span>
                    <span className="text-[10px] opacity-80">1:{config.odds}</span>
                 </button>
              </div>
              <p className="text-[10px] text-gray-400 font-bold mt-4 text-center">
                 当前选中规则: {manualRule?.label} (步长: {manualRule?.value}) · 下注金额: ${config.baseBet}
              </p>
           </div>

           {/* PENDING BETS LIST (RESTORED) */}
           {pendingBets.length > 0 && (
              <div className="space-y-3">
                 <div className="flex items-center space-x-2 text-xs font-black text-gray-400 uppercase px-2">
                    <Clock className="w-3.5 h-3.5" /> <span>进行中</span>
                 </div>
                 {pendingBets.map(bet => (
                    <div key={bet.id} className="bg-white p-4 rounded-2xl border border-indigo-100 shadow-sm flex justify-between items-center relative overflow-hidden">
                       <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-400 animate-pulse"></div>
                       <div className="flex items-center space-x-3 pl-2">
                          <span className={`text-[10px] px-2 py-0.5 rounded font-black ${bet.taskId ? 'bg-purple-100 text-purple-600' : 'bg-gray-100 text-gray-500'}`}>
                             {bet.taskName || '手动'}
                          </span>
                          <div>
                             <span className="block text-xs font-black text-gray-800">#{bet.targetHeight}</span>
                             <span className="text-[9px] text-gray-400">{bet.ruleName}</span>
                          </div>
                       </div>
                       <div className="flex items-center space-x-3">
                          <div className={`px-2.5 py-1 rounded-lg font-black text-xs text-white ${bet.prediction === 'ODD' ? 'bg-red-500' : bet.prediction === 'EVEN' ? 'bg-teal-500' : bet.prediction === 'BIG' ? 'bg-orange-500' : 'bg-indigo-500'}`}>
                             {bet.prediction === 'ODD' ? '单' : bet.prediction === 'EVEN' ? '双' : bet.prediction === 'BIG' ? '大' : '小'}
                          </div>
                          <span className="text-sm font-black text-slate-700">${bet.amount}</span>
                       </div>
                    </div>
                 ))}
              </div>
           )}
        </div>
      </div>

      {/* 3. HISTORY TABLE (RESTORED TO BOTTOM) */}
      <div className="bg-white rounded-[2.5rem] p-6 shadow-xl border border-gray-100">
         <div className="flex items-center space-x-2 mb-4">
            <History className="w-5 h-5 text-gray-400" />
            <h3 className="text-base font-black text-gray-900">历史记录 (已结算)</h3>
         </div>
         <div className="overflow-x-auto">
            <table className="w-full text-left">
               <thead className="text-[10px] font-black text-gray-400 uppercase tracking-wider border-b border-gray-100">
                  <tr>
                     <th className="pb-2 pl-2">区块</th>
                     <th className="pb-2">来源</th>
                     <th className="pb-2">策略</th>
                     <th className="pb-2">下注</th>
                     <th className="pb-2">结果</th>
                     <th className="pb-2">盈亏</th>
                     <th className="pb-2 pr-2 text-right">余额</th>
                  </tr>
               </thead>
               <tbody className="text-xs font-medium text-gray-600">
                  {settledBets.length === 0 ? (
                     <tr><td colSpan={7} className="py-8 text-center text-gray-300 font-bold">暂无记录</td></tr>
                  ) : (
                     settledBets.slice(0, 30).map(bet => (
                        <tr key={bet.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                           <td className="py-3 pl-2">
                              <span className="font-black text-gray-800 block">#{bet.targetHeight}</span>
                              <span className="text-[9px] text-gray-400">{bet.ruleName}</span>
                           </td>
                           <td className="py-3">
                              <span className={`text-[9px] font-bold px-2 py-0.5 rounded ${bet.taskId ? 'bg-purple-50 text-purple-600' : 'bg-amber-50 text-amber-600'}`}>
                                 {bet.taskName || '手动'}
                              </span>
                           </td>
                           <td className="py-3">
                             <span className="text-[9px] bg-gray-100 px-1.5 py-0.5 rounded font-bold text-gray-500">
                               {STRATEGY_LABELS[bet.strategyLabel || 'MANUAL'] || bet.strategyLabel}
                             </span>
                           </td>
                           <td className="py-3">
                              <div className="flex items-center space-x-1">
                                 <span className={`text-[10px] font-black ${bet.prediction === 'ODD' ? 'text-red-500' : bet.prediction === 'EVEN' ? 'text-teal-500' : bet.prediction === 'BIG' ? 'text-orange-500' : 'text-indigo-500'}`}>{bet.prediction === 'ODD' ? '单' : bet.prediction === 'EVEN' ? '双' : bet.prediction === 'BIG' ? '大' : '小'}</span>
                                 <span className="text-[10px] text-gray-400">${bet.amount}</span>
                              </div>
                           </td>
                           <td className="py-3">
                              <span className="font-bold text-gray-800 mr-1">{bet.resultVal}</span>
                              {bet.status === 'WIN' ? <CheckCircle2 className="w-3 h-3 text-green-500 inline" /> : <XCircle className="w-3 h-3 text-gray-300 inline" />}
                           </td>
                           <td className={`py-3 font-black ${bet.status === 'WIN' ? 'text-green-500' : 'text-red-400'}`}>{bet.status === 'WIN' ? `+${(bet.payout - bet.amount).toFixed(1)}` : `-${bet.amount}`}</td>
                           <td className="py-3 pr-2 text-right text-gray-400 font-mono">${bet.balanceAfter.toFixed(0)}</td>
                        </tr>
                     ))
                  )}
               </tbody>
            </table>
         </div>
      </div>
    </div>
  );
};

// ✅ 优化：基于内容指纹比较 allBlocks，而非引用比较
// 避免 WebSocket 推送新区块时 allBlocks 引用变化导致整个组件重渲染
export default memo(SimulatedBetting, (prevProps, nextProps) => {
  // rules 引用比较
  if (prevProps.rules !== nextProps.rules) return false;

  // allBlocks 基于内容比较（长度 + 首尾高度）
  const pBlocks = prevProps.allBlocks;
  const nBlocks = nextProps.allBlocks;
  if (pBlocks.length !== nBlocks.length) return false;
  if (pBlocks.length === 0 && nBlocks.length === 0) return true;
  if (pBlocks[0]?.height !== nBlocks[0]?.height) return false;
  if (pBlocks[pBlocks.length - 1]?.height !== nBlocks[nBlocks.length - 1]?.height) return false;

  return true;
});
