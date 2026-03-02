
export type BlockType = 'ODD' | 'EVEN';
export type SizeType = 'BIG' | 'SMALL';

export interface BlockData {
  height: number;
  hash: string;
  resultValue: number;
  type: BlockType;
  sizeType: SizeType;
  timestamp: string | number; // 支持字符串和 Unix 时间戳
}

export interface IntervalRule {
  id: string;
  label: string;
  value: number;
  startBlock: number; // 0 implies alignment to absolute height
  trendRows: number;  // Grid rows for Trend (Big Road) charts
  beadRows: number;   // Grid rows for Bead Road charts
  dragonThreshold?: number; // Minimum streak to show in dragon list
}

export interface FollowedPattern {
  ruleId: string;
  type: 'parity' | 'size';
  mode: 'trend' | 'bead';
  rowId?: number;
}

export interface AIPredictionResult {
  shouldPredict: boolean; // NEW: AI decides if the signal is strong enough
  nextParity: 'ODD' | 'EVEN' | 'NEUTRAL';
  parityConfidence: number;
  nextSize: 'BIG' | 'SMALL' | 'NEUTRAL';
  sizeConfidence: number;
  analysis: string;
  detectedCycle: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  entropyScore: number; // NEW: Quantitative measure of noise
  targetHeight?: number;
  contributingModels?: string[]; // 所有触发的模型名称列表
}

export interface PredictionHistoryItem extends AIPredictionResult {
  id: string;
  timestamp: number;
  resolved: boolean;
  actualParity?: BlockType;
  actualSize?: SizeType;
  isParityCorrect?: boolean;
  isSizeCorrect?: boolean;
  ruleId?: string;
}

// 长龙统计记录
export interface DragonStatRecord {
  id: string;
  timestamp: number;
  ruleId: string;
  ruleName: string;
  type: 'parity' | 'size';
  mode: 'trend' | 'bead';
  rawType: 'ODD' | 'EVEN' | 'BIG' | 'SMALL';
  streakLength: number;
  rowId?: number;
}

export type IntervalType = number;

export interface GridCell {
  type: BlockType | SizeType | null;
  value?: number;
  blockHeight?: number;
}

// API响应类型
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

// 模型统计类型
export interface ModelStats {
  total: number;
  correct: number;
}

// 下注记录类型
export interface BetRecord {
  id?: string;
  timestamp: number;
  blockHeight: number;
  betAmount: number;
  betType: 'parity' | 'size';
  betChoice: BlockType | SizeType;
  result: 'win' | 'lose' | 'pending';
  payout?: number;
  ruleId?: string;
}

// 下注配置类型
export interface BetConfig {
  id?: string;
  autoBet: boolean;
  betAmount: number;
  maxLoss: number;
  stopWin: number;
  selectedRules: string[];
  selectedModels: string[];
  minConfidence: number;
}

// 托管任务类型
export interface BetTask {
  id?: string;
  ruleId: string;
  modelId: string;
  betType: 'parity' | 'size';
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}
