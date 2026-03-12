
import React, { useMemo, memo, useCallback, useState, useEffect, useRef } from 'react';
import { BlockData, IntervalRule, FollowedPattern, DragonStatRecord } from '../types';
import { Info, ChevronRight, Grid3X3, BarChart3, Heart, Star, Filter, Play, Square, Trash2, ChevronDown, ChevronUp, Activity } from 'lucide-react';
import { loadDragonStats, saveDragonStats, debouncedSaveDragonStats, flushDragonStatsSave, clearDragonStats as clearDragonStatsAPI } from '../services/dragonStatsApi';

interface DragonListProps {
  allBlocks: BlockData[];
  rules: IntervalRule[];
  followedPatterns: FollowedPattern[];
  onToggleFollow: (pattern: FollowedPattern) => void;
  onJumpToChart?: (ruleId: string, type: 'parity' | 'size', mode: 'trend' | 'bead') => void;
}

interface DragonInfo {
  ruleId: string;
  ruleName: string;
  type: 'parity' | 'size';
  mode: 'trend' | 'bead';
  value: string;
  rawType: 'ODD' | 'EVEN' | 'BIG' | 'SMALL';
  count: number;
  color: string;
  threshold: number;
  nextHeight: number;
  rowId?: number;
}

type DragonFilter = 'ALL' | 'ODD' | 'EVEN' | 'BIG' | 'SMALL';

const RAW_TYPE_LABEL: Record<string, string> = { ODD: '单', EVEN: '双', BIG: '大', SMALL: '小' };
const RAW_TYPE_COLOR: Record<string, string> = { ODD: 'text-red-600', EVEN: 'text-blue-600', BIG: 'text-amber-600', SMALL: 'text-emerald-600' };
const RAW_TYPE_BG: Record<string, string> = { ODD: 'bg-red-50', EVEN: 'bg-blue-50', BIG: 'bg-amber-50', SMALL: 'bg-emerald-50' };
const RAW_TYPES = ['ODD', 'EVEN', 'BIG', 'SMALL'] as const;


interface SingleJumpInfo {
  ruleId: string;
  ruleName: string;
  mode: 'trend' | 'bead';
  type: 'parity' | 'size';
  count: number;
  sequenceLabel: string;
}

const DragonList: React.FC<DragonListProps> = memo(({ allBlocks, rules, followedPatterns, onToggleFollow, onJumpToChart }) => {
  const [activeFilter, setActiveFilter] = useState<DragonFilter>('ALL');
  const [isTracking, setIsTracking] = useState(false);
  const [dragonRecords, setDragonRecords] = useState<DragonStatRecord[]>([]);
  const [showStats, setShowStats] = useState(false);
  const prevFingerprintRef = useRef<string>('');
  const prevActiveKeysRef = useRef<Set<string>>(new Set());
  const isInitializedRef = useRef(false);

  // Stats panel filters
  const [statsRuleFilter, setStatsRuleFilter] = useState<string>('ALL');
  const [statsTypeFilter, setStatsTypeFilter] = useState<DragonFilter>('ALL');
  const [statsModeFilter, setStatsModeFilter] = useState<'ALL' | 'trend' | 'bead'>('ALL');

  // Dragon list rule filter (for dragon cards)
  const [dragonRuleFilter, setDragonRuleFilter] = useState<string>('ALL');

  // Load saved stats on mount
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const saved = await loadDragonStats();
        if (!mounted) return;
        if (saved) {
          if (saved.records) setDragonRecords(saved.records);
          if (saved.isTracking) {
            setIsTracking(saved.isTracking);
            // 默认保持收起状态，不自动展开
          }
        }
      } catch (e) {
        console.error('[DragonList] 加载统计失败:', e);
      } finally {
        isInitializedRef.current = true;
      }
    };
    load();
    return () => { mounted = false; };
  }, []);

  // ═══════ 1. Compute ALL dragons (unfiltered) — used for tracking ═══════
  const { allTrendDragons, allBeadRowDragons, allSingleJumpSignals } = useMemo(() => {
    const trendResults: DragonInfo[] = [];
    const beadResults: DragonInfo[] = [];
    const singleJumpResults: SingleJumpInfo[] = [];

    if (allBlocks.length === 0) return { allTrendDragons: [], allBeadRowDragons: [], allSingleJumpSignals: [] };

    rules.forEach(rule => {
      const epoch = rule.startBlock || 0;
      const interval = rule.value;
      const rows = rule.beadRows || 6;

      const checkAlignment = (height: number) => {
        if (interval <= 1) return true;
        if (epoch > 0) {
          return height >= epoch && (height - epoch) % interval === 0;
        }
        return height % interval === 0;
      };

      const filtered = allBlocks.filter(b => checkAlignment(b.height)).sort((a, b) => b.height - a.height);
      if (filtered.length === 0) return;

      const threshold = rule.dragonThreshold || 3;
      const latestHeight = filtered[0].height;
      const nextHeight = latestHeight + interval;

      const calculateStreak = (key: 'type' | 'sizeType') => {
        let count = 0;
        const firstVal = filtered[0][key];
        for (const b of filtered) {
          if (b[key] === firstVal) count++;
          else break;
        }
        return { value: firstVal, count };
      };

      const addTrendDragon = (type: 'parity' | 'size', streak: any) => {
        const info: DragonInfo = {
          ruleId: rule.id,
          ruleName: rule.label,
          type,
          mode: 'trend',
          rawType: streak.value,
          value: type === 'parity' ? (streak.value === 'ODD' ? '单' : '双') : (streak.value === 'BIG' ? '大' : '小'),
          count: streak.count,
          color: streak.value === 'ODD' || streak.value === 'BIG' ? (type === 'parity' ? 'var(--color-odd)' : 'var(--color-big)') : (type === 'parity' ? 'var(--color-even)' : 'var(--color-small)'),
          threshold,
          nextHeight
        };
        if (streak.count >= threshold) trendResults.push(info);
      };

      addTrendDragon('parity', calculateStreak('type'));
      addTrendDragon('size', calculateStreak('sizeType'));

      const calculateSingleJump = (items: BlockData[], key: 'type' | 'sizeType') => {
        if (items.length < 2) return 0;
        let count = 1;
        for (let i = 1; i < items.length; i++) {
          if (items[i][key] !== items[i - 1][key]) count++;
          else break;
        }
        return count;
      };

      const parityJump = calculateSingleJump(filtered, 'type');
      const sizeJump = calculateSingleJump(filtered, 'sizeType');
      if (parityJump >= threshold) {
        singleJumpResults.push({ ruleId: rule.id, ruleName: rule.label, mode: 'trend', type: 'parity', count: parityJump, sequenceLabel: '单双单跳' });
      }
      if (sizeJump >= threshold) {
        singleJumpResults.push({ ruleId: rule.id, ruleName: rule.label, mode: 'trend', type: 'size', count: sizeJump, sequenceLabel: '大小单跳' });
      }

      // Bead Row Dragons
      for (let r = 0; r < rows; r++) {
        const rowItems = filtered.filter(b => {
          const logicalIdx = Math.floor((b.height - epoch) / interval);
          return (logicalIdx % rows) === r;
        });

        if (rowItems.length === 0) continue;

        const calcRowStreak = (key: 'type' | 'sizeType') => {
          let count = 0;
          const firstVal = rowItems[0][key];
          for (const b of rowItems) {
            if (b[key] === firstVal) count++;
            else break;
          }
          return { value: firstVal, count };
        };

        const rpStreak = calcRowStreak('type');
        const rsStreak = calcRowStreak('sizeType');
        const rowNextHeight = rowItems[0].height + (interval * rows);

        const addBeadDragon = (type: 'parity' | 'size', streak: any) => {
          const info: DragonInfo = {
            ruleId: rule.id,
            ruleName: rule.label,
            type,
            mode: 'bead',
            rawType: streak.value,
            value: type === 'parity' ? (streak.value === 'ODD' ? '单' : '双') : (streak.value === 'BIG' ? '大' : '小'),
            count: streak.count,
            color: streak.value === 'ODD' || streak.value === 'BIG' ? (type === 'parity' ? 'var(--color-odd)' : 'var(--color-big)') : (type === 'parity' ? 'var(--color-even)' : 'var(--color-small)'),
            threshold,
            nextHeight: rowNextHeight,
            rowId: r + 1
          };
          if (streak.count >= threshold) beadResults.push(info);
        };

        addBeadDragon('parity', rpStreak);
        addBeadDragon('size', rsStreak);

        const rowParityJump = (() => {
          if (rowItems.length < 2) return 0;
          let c = 1;
          for (let i = 1; i < rowItems.length; i++) {
            if (rowItems[i].type !== rowItems[i - 1].type) c++;
            else break;
          }
          return c;
        })();
        const rowSizeJump = (() => {
          if (rowItems.length < 2) return 0;
          let c = 1;
          for (let i = 1; i < rowItems.length; i++) {
            if (rowItems[i].sizeType !== rowItems[i - 1].sizeType) c++;
            else break;
          }
          return c;
        })();
        if (rowParityJump >= threshold) {
          singleJumpResults.push({ ruleId: rule.id, ruleName: rule.label, mode: 'bead', type: 'parity', count: rowParityJump, sequenceLabel: `珠盘单双单跳(第${r + 1}行)` });
        }
        if (rowSizeJump >= threshold) {
          singleJumpResults.push({ ruleId: rule.id, ruleName: rule.label, mode: 'bead', type: 'size', count: rowSizeJump, sequenceLabel: `珠盘大小单跳(第${r + 1}行)` });
        }
      }
    });

    return {
      allTrendDragons: trendResults.sort((a, b) => b.count - a.count),
      allBeadRowDragons: beadResults.sort((a, b) => b.count - a.count),
      allSingleJumpSignals: singleJumpResults.sort((a, b) => b.count - a.count)
    };
  }, [allBlocks, rules]);

  // ═══════ 2. Filtered dragons for display ═══════
  const { trendDragons, beadRowDragons, followedResults, singleJumpSignals } = useMemo(() => {
    const filterFn = (d: DragonInfo) => {
      if (activeFilter !== 'ALL' && d.rawType !== activeFilter) return false;
      if (dragonRuleFilter !== 'ALL' && d.ruleId !== dragonRuleFilter) return false;
      return true;
    };

    const watchResults: DragonInfo[] = [];
    for (const d of [...allTrendDragons, ...allBeadRowDragons]) {
      const isFollowed = followedPatterns.find(fp =>
        fp.ruleId === d.ruleId && fp.type === d.type && fp.mode === d.mode && fp.rowId === d.rowId
      );
      if (isFollowed && filterFn(d)) watchResults.push(d);
    }

    return {
      trendDragons: allTrendDragons.filter(filterFn),
      beadRowDragons: allBeadRowDragons.filter(filterFn),
      followedResults: watchResults.sort((a, b) => b.count - a.count),
      singleJumpSignals: allSingleJumpSignals.filter(s => dragonRuleFilter === 'ALL' || s.ruleId === dragonRuleFilter)
    };
  }, [allTrendDragons, allBeadRowDragons, allSingleJumpSignals, followedPatterns, activeFilter, dragonRuleFilter]);

  // ═══════ 3. Dragon tracking — uses UNFILTERED data ═══════
  // 核心改进：区分"新出现的龙"和"持续存在的龙"
  // 新出现的龙总是创建新记录，持续的龙只更新最高连出
  useEffect(() => {
    if (!isTracking || !isInitializedRef.current) return;

    const allDragons = [...allTrendDragons, ...allBeadRowDragons];
    const fingerprint = allDragons.map(d =>
      `${d.ruleId}|${d.type}|${d.mode}|${d.rowId || ''}|${d.rawType}|${d.count}`
    ).sort().join(';;');

    if (fingerprint === prevFingerprintRef.current) return;
    prevFingerprintRef.current = fingerprint;

    const prevKeys = prevActiveKeysRef.current;
    const currentKeys = new Set<string>();

    setDragonRecords(prev => {
      const updated = [...prev];

      for (const dragon of allDragons) {
        const key = `${dragon.ruleId}|${dragon.type}|${dragon.mode}|${dragon.rowId || ''}|${dragon.rawType}`;
        currentKeys.add(key);

        if (prevKeys.has(key)) {
          // 龙在上次扫描中已存在 → 这是持续的龙，只更新最高连出
          const existing = updated.filter(r =>
            `${r.ruleId}|${r.type}|${r.mode}|${r.rowId || ''}|${r.rawType}` === key
          ).sort((a, b) => b.timestamp - a.timestamp)[0];

          if (existing && dragon.count > existing.streakLength) {
            existing.streakLength = dragon.count;
            existing.timestamp = Date.now();
          }
        } else {
          // 龙是新出现的（上次扫描中不存在）→ 总是创建新记录
          updated.push({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            timestamp: Date.now(),
            ruleId: dragon.ruleId,
            ruleName: dragon.ruleName,
            type: dragon.type,
            mode: dragon.mode,
            rawType: dragon.rawType,
            streakLength: dragon.count,
            rowId: dragon.rowId
          });
        }
      }

      debouncedSaveDragonStats({ records: updated, isTracking: true });
      return updated;
    });

    prevActiveKeysRef.current = currentKeys;
  }, [allTrendDragons, allBeadRowDragons, isTracking]);

  // ═══════ 4. Statistics calculations (with stats filters) ═══════
  const statsData = useMemo(() => {
    if (dragonRecords.length === 0) return null;

    // Apply stats filters
    let filtered = dragonRecords;
    if (statsRuleFilter !== 'ALL') {
      filtered = filtered.filter(r => r.ruleId === statsRuleFilter);
    }
    if (statsTypeFilter !== 'ALL') {
      filtered = filtered.filter(r => r.rawType === statsTypeFilter);
    }
    if (statsModeFilter !== 'ALL') {
      filtered = filtered.filter(r => r.mode === statsModeFilter);
    }

    if (filtered.length === 0) return { byStreak: {} as Record<string, Record<number, number>>, byRule: {} as Record<string, any>, minStreak: 3, maxStreak: 3, total: dragonRecords.length, filteredTotal: 0 };

    // Compute global min/max streak
    let minStreak = Infinity;
    let maxStreak = 0;
    for (const rec of filtered) {
      if (rec.streakLength < minStreak) minStreak = rec.streakLength;
      if (rec.streakLength > maxStreak) maxStreak = rec.streakLength;
    }

    // byStreak: rawType → { streakLength → count }
    const byStreak: Record<string, Record<number, number>> = {};
    for (const t of RAW_TYPES) byStreak[t] = {};

    // byRule: ruleId → { ruleName, minStreak, maxStreak, byType: { rawType → { streakLength → count } } }
    const byRule: Record<string, {
      ruleName: string;
      minStreak: number;
      maxStreak: number;
      total: number;
      byType: Record<string, Record<number, number>>;
    }> = {};

    for (const rec of filtered) {
      // byStreak
      byStreak[rec.rawType][rec.streakLength] = (byStreak[rec.rawType][rec.streakLength] || 0) + 1;

      // byRule
      if (!byRule[rec.ruleId]) {
        byRule[rec.ruleId] = {
          ruleName: rec.ruleName,
          minStreak: rec.streakLength,
          maxStreak: rec.streakLength,
          total: 0,
          byType: {}
        };
        for (const t of RAW_TYPES) byRule[rec.ruleId].byType[t] = {};
      }
      const rd = byRule[rec.ruleId];
      rd.total++;
      if (rec.streakLength < rd.minStreak) rd.minStreak = rec.streakLength;
      if (rec.streakLength > rd.maxStreak) rd.maxStreak = rec.streakLength;
      rd.byType[rec.rawType][rec.streakLength] = (rd.byType[rec.rawType][rec.streakLength] || 0) + 1;
    }

    return { byStreak, byRule, minStreak, maxStreak, total: dragonRecords.length, filteredTotal: filtered.length };
  }, [dragonRecords, statsRuleFilter, statsTypeFilter, statsModeFilter]);

  // ═══════ Handlers ═══════
  const handleStartTracking = useCallback(() => {
    isInitializedRef.current = true;
    setIsTracking(true);
    setShowStats(true);
    prevFingerprintRef.current = '';
    prevActiveKeysRef.current = new Set(); // 清空，使所有当前龙被视为新出现
    // 开始时立即保存状态
    saveDragonStats({ records: dragonRecords, isTracking: true });
  }, [dragonRecords]);

  const handleStopTracking = useCallback(() => {
    setIsTracking(false);
    // 停止时立即保存（非防抖），确保状态不会因页面切换而丢失
    flushDragonStatsSave(); // 先取消任何待处理的防抖保存
    saveDragonStats({ records: dragonRecords, isTracking: false });
  }, [dragonRecords]);

  const handleClearStats = useCallback(async () => {
    if (!window.confirm('确定要清除所有长龙统计数据吗？')) return;
    setDragonRecords([]);
    prevFingerprintRef.current = '';
    prevActiveKeysRef.current = new Set();
    flushDragonStatsSave(); // 取消任何待处理的防抖保存
    await clearDragonStatsAPI();
  }, []);

  // ═══════ Dragon Card ═══════
  const renderDragonCard = useCallback((dragon: DragonInfo, index: number, isFollowedView: boolean = false) => {
    const isFollowed = !!followedPatterns.find(fp =>
      fp.ruleId === dragon.ruleId &&
      fp.type === dragon.type &&
      fp.mode === dragon.mode &&
      fp.rowId === dragon.rowId
    );

    const handleFollowClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggleFollow({
        ruleId: dragon.ruleId,
        type: dragon.type,
        mode: dragon.mode,
        rowId: dragon.rowId
      });
    };

    const handleCardClick = () => {
      if (onJumpToChart) {
        onJumpToChart(dragon.ruleId, dragon.type, dragon.mode);
      }
    };

    return (
      <div
        key={`${dragon.ruleName}-${dragon.type}-${dragon.mode}-${dragon.rowId || 't'}-${index}-${isFollowedView ? 'v' : 'm'}`}
        onClick={handleCardClick}
        className={`group relative bg-white rounded-2xl p-4 border transition-all duration-300 cursor-pointer ${
          dragon.count >= 5 ? 'border-amber-200 shadow-md ring-1 ring-amber-100' : 'border-gray-100 hover:shadow-lg'
        } ${isFollowedView ? 'border-blue-100 bg-blue-50/10' : ''}`}
      >
        <div className="flex justify-between items-start mb-3">
          <div className="flex flex-col">
            <span className="px-2 py-0.5 bg-gray-50 rounded-lg text-[9px] font-black text-gray-400 uppercase tracking-tighter border border-gray-100 inline-block w-fit">
              {dragon.ruleName}
            </span>
            {dragon.rowId && (
              <span className="mt-1 ml-0.5 text-[8px] font-black text-indigo-500 uppercase">
                珠盘第 {dragon.rowId} 行
              </span>
            )}
          </div>
          <div className="flex items-center space-x-2">
             <button
                onClick={handleFollowClick}
                className={`p-1.5 rounded-full transition-all active:scale-90 ${
                  isFollowed ? 'text-red-500 bg-red-50' : 'text-gray-300 hover:text-gray-400 hover:bg-gray-100'
                }`}
             >
                <Heart className={`w-4 h-4 ${isFollowed ? 'fill-current' : ''}`} />
             </button>
             <span className="text-[9px] font-black text-gray-400 uppercase">实时</span>
          </div>
        </div>

        <div className="flex items-end justify-between border-b border-gray-200/50 pb-4 mb-4">
          <div>
            <div className="flex items-center space-x-2">
              <div
                style={{ backgroundColor: dragon.color }}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-base font-black shadow-md"
              >
                {dragon.value}
              </div>
              <div className="flex flex-col">
                <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest leading-none mb-1">
                  {dragon.type === 'parity' ? '单双' : '大小'}
                </span>
                <span className="text-xl font-black text-gray-800 leading-none">
                  {dragon.value}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-col items-end">
            <span className="text-[9px] font-black text-gray-400 uppercase mb-0.5">连出</span>
            <div className="flex items-baseline space-x-0.5">
              <span className="text-3xl font-black tabular-nums" style={{ color: dragon.color }}>{dragon.count}</span>
              <span className="text-[10px] font-black text-gray-400">期</span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-[8px] font-black text-gray-400 uppercase tracking-wider">预期区块</span>
            <span className="text-xs font-black text-blue-600 tabular-nums flex items-center">
              {dragon.nextHeight}
              <ChevronRight className="w-2.5 h-2.5 ml-0.5" />
            </span>
          </div>
          <div className="px-1.5 py-0.5 bg-gray-50 rounded-md border border-gray-100 text-[8px] font-black text-gray-300 uppercase">
            {dragon.mode === 'trend' ? '走势' : '珠盘'}
          </div>
        </div>

        {dragon.count >= 8 && (
          <div className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[8px] font-black px-1.5 py-0.5 rounded-md shadow-md rotate-12 animate-bounce uppercase">
            大龙
          </div>
        )}
      </div>
    );
  }, [followedPatterns, onToggleFollow, onJumpToChart]);

  const FilterButton = ({ type, label }: { type: DragonFilter, label: string }) => (
    <button
      onClick={() => setActiveFilter(type)}
      className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider transition-all border-2 ${
        activeFilter === type
          ? 'bg-blue-600 text-white border-blue-600 shadow-md'
          : 'bg-white text-gray-400 border-gray-100 hover:bg-gray-50'
      }`}
    >
      {label}
    </button>
  );

  // ═══════ Stats Streak Table renderer ═══════
  const renderStreakTable = (
    byType: Record<string, Record<number, number>>,
    min: number,
    max: number,
    showTypes: readonly string[] = RAW_TYPES
  ) => {
    const cols = Array.from({ length: max - min + 1 }, (_, i) => min + i);
    return (
      <div className="overflow-x-auto -mx-1">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b-2 border-gray-200">
              <th className="text-left py-2 px-3 text-sm font-bold text-gray-500 whitespace-nowrap sticky left-0 bg-gray-50 z-10 min-w-[60px]">类型</th>
              {cols.map(n => (
                <th key={n} className="py-2 px-2 text-sm font-bold text-gray-500 text-center whitespace-nowrap min-w-[48px]">{n}连</th>
              ))}
              <th className="py-2 px-3 text-sm font-bold text-gray-500 text-center whitespace-nowrap min-w-[56px]">合计</th>
            </tr>
          </thead>
          <tbody>
            {showTypes.map(rawType => {
              const typeData = byType[rawType] || {};
              let rowTotal = 0;
              for (const n of cols) rowTotal += (typeData[n] || 0);
              return (
                <tr key={rawType} className="border-b border-gray-100 hover:bg-white/80 transition-colors">
                  <td className={`py-2.5 px-3 font-bold text-sm whitespace-nowrap sticky left-0 bg-gray-50 z-10 ${RAW_TYPE_COLOR[rawType]}`}>
                    {RAW_TYPE_LABEL[rawType]}({rawType})
                  </td>
                  {cols.map(n => {
                    const val = typeData[n] || 0;
                    return (
                      <td key={n} className="py-2.5 px-2 text-center tabular-nums text-sm font-semibold">
                        {val > 0 ? (
                          <span className={`inline-block min-w-[28px] px-1.5 py-0.5 rounded-md ${RAW_TYPE_BG[rawType]} ${RAW_TYPE_COLOR[rawType]} font-bold`}>
                            {val}
                          </span>
                        ) : (
                          <span className="text-gray-300">0</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="py-2.5 px-3 text-center tabular-nums text-sm font-bold text-gray-700">
                    {rowTotal}
                  </td>
                </tr>
              );
            })}
            {/* Total row */}
            <tr className="border-t-2 border-gray-200 bg-white/60">
              <td className="py-2.5 px-3 font-bold text-sm text-gray-600 sticky left-0 bg-gray-50 z-10">合计</td>
              {cols.map(n => {
                let colTotal = 0;
                for (const t of showTypes) colTotal += ((byType[t] || {})[n] || 0);
                return (
                  <td key={n} className="py-2.5 px-2 text-center tabular-nums text-sm font-bold text-gray-600">
                    {colTotal > 0 ? colTotal : <span className="text-gray-300">0</span>}
                  </td>
                );
              })}
              <td className="py-2.5 px-3 text-center tabular-nums text-sm font-black text-gray-800">
                {(() => { let t = 0; for (const rt of showTypes) for (const n of cols) t += ((byType[rt] || {})[n] || 0); return t; })()}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  };

  // Determine which rawTypes to show (based on stats filter)
  const visibleRawTypes = statsTypeFilter === 'ALL' ? RAW_TYPES : [statsTypeFilter] as const;

  // Unique rules in records (for rule filter dropdown) — sorted by step value
  const recordedRules = useMemo(() => {
    const map = new Map<string, string>();
    for (const rec of dragonRecords) {
      if (!map.has(rec.ruleId)) map.set(rec.ruleId, rec.ruleName);
    }
    return Array.from(map.entries()).sort((a, b) => {
      const ruleA = rules.find(r => r.id === a[0]);
      const ruleB = rules.find(r => r.id === b[0]);
      return (ruleA?.value || 0) - (ruleB?.value || 0);
    });
  }, [dragonRecords, rules]);

  return (
    <div className="space-y-10">
      {/* ═══════ Dragon Statistics Panel (Top) ═══════ */}
      <section className="bg-white rounded-[2.5rem] p-6 md:p-8 shadow-xl border border-gray-100">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-6 gap-4">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-violet-50 rounded-2xl">
              <Activity className="w-6 h-6 text-violet-500" />
            </div>
            <div>
              <h2 className="text-xl font-black text-gray-900">长龙统计面板</h2>
              <p className="text-sm text-gray-400 font-bold">
                {isTracking ? (
                  <span className="text-green-500">● 统计进行中</span>
                ) : (
                  <span className="text-gray-400">○ 统计已停止</span>
                )}
                <span className="ml-2">已记录 {dragonRecords.length} 条</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {!isTracking ? (
              <button
                onClick={handleStartTracking}
                className="px-5 py-2.5 rounded-xl text-sm font-bold transition-all bg-green-500 text-white hover:bg-green-600 shadow-sm flex items-center space-x-2"
              >
                <Play className="w-4 h-4" />
                <span>开始统计</span>
              </button>
            ) : (
              <button
                onClick={handleStopTracking}
                className="px-5 py-2.5 rounded-xl text-sm font-bold transition-all bg-orange-500 text-white hover:bg-orange-600 shadow-sm flex items-center space-x-2"
              >
                <Square className="w-4 h-4" />
                <span>停止统计</span>
              </button>
            )}
            <button
              onClick={handleClearStats}
              className="px-5 py-2.5 rounded-xl text-sm font-bold transition-all bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 flex items-center space-x-2"
            >
              <Trash2 className="w-4 h-4" />
              <span>清除</span>
            </button>
            <button
              onClick={() => setShowStats(!showStats)}
              className="px-5 py-2.5 rounded-xl text-sm font-bold transition-all bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100 flex items-center space-x-2"
            >
              {showStats ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              <span>{showStats ? '收起' : '展开'}</span>
            </button>
          </div>
        </div>

        {/* ── 统计筛选 — 始终显示，不受展开/收起影响 ── */}
        {dragonRecords.length > 0 && (
          <div className="bg-violet-50/50 rounded-2xl p-4 border border-violet-100 space-y-3 mb-6">
            <div className="flex items-center space-x-2 mb-1">
              <Filter className="w-4 h-4 text-violet-400" />
              <span className="text-sm font-bold text-violet-600">统计筛选</span>
            </div>

            <div className="flex flex-col md:flex-row gap-3 md:gap-6">
              {/* Rule Filter */}
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-500 whitespace-nowrap">规则:</span>
                <select
                  value={statsRuleFilter}
                  onChange={e => setStatsRuleFilter(e.target.value)}
                  className="text-sm font-semibold bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-400 min-w-[120px]"
                >
                  <option value="ALL">全部规则</option>
                  {recordedRules.map(([id, name]) => (
                    <option key={id} value={id}>{name}</option>
                  ))}
                </select>
              </div>

              {/* Type Filter */}
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-500 whitespace-nowrap">类型:</span>
                <div className="flex gap-1 flex-wrap">
                  {(['ALL', 'ODD', 'EVEN', 'BIG', 'SMALL'] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => setStatsTypeFilter(t)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${
                        statsTypeFilter === t
                          ? 'bg-violet-600 text-white shadow-sm'
                          : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      {t === 'ALL' ? '全部' : RAW_TYPE_LABEL[t]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Mode Filter */}
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-500 whitespace-nowrap">龙类:</span>
                <div className="flex gap-1">
                  {(['ALL', 'trend', 'bead'] as const).map(m => (
                    <button
                      key={m}
                      onClick={() => setStatsModeFilter(m)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${
                        statsModeFilter === m
                          ? 'bg-violet-600 text-white shadow-sm'
                          : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      {m === 'ALL' ? '全部' : m === 'trend' ? '走势龙' : '珠盘龙'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── 按连出长度 — always visible when data exists ── */}
        {statsData && statsData.filteredTotal > 0 && (
          <div className="bg-gray-50 rounded-2xl p-5 border border-gray-100 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-black text-gray-700">按连出长度</h3>
              <span className="text-sm text-gray-400 font-semibold">
                {statsData.filteredTotal} 条记录 · {statsData.minStreak}连 ~ {statsData.maxStreak}连
              </span>
            </div>
            {renderStreakTable(statsData.byStreak, statsData.minStreak, statsData.maxStreak, visibleRawTypes)}
          </div>
        )}

        {/* ── Collapsible: 按采样规则 ── */}
        {showStats && (
          <>
            {statsData && statsData.filteredTotal > 0 ? (
              <div className="bg-gray-50 rounded-2xl p-5 border border-gray-100">
                <h3 className="text-base font-black text-gray-700 mb-4">按采样规则</h3>
                {Object.keys(statsData.byRule).length === 0 ? (
                  <p className="text-sm text-gray-400 font-semibold text-center py-6">暂无数据</p>
                ) : (
                  <div className="space-y-5">
                    {Object.entries(statsData.byRule).sort((a, b) => {
                      const rA = rules.find(r => r.id === a[0]);
                      const rB = rules.find(r => r.id === b[0]);
                      return (rA?.value || 0) - (rB?.value || 0);
                    }).map(([ruleId, ruleData]) => {
                      let ruleTotal = 0;
                      for (const t of visibleRawTypes) {
                        const td = ruleData.byType[t] || {};
                        for (const k in td) ruleTotal += td[Number(k)];
                      }
                      return (
                        <div key={ruleId} className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm">
                          <div className="flex items-center justify-between mb-3">
                            <h4 className="text-base font-black text-gray-800">{ruleData.ruleName}</h4>
                            <span className="text-sm text-gray-400 font-semibold">
                              共 {ruleData.total} 条 · {ruleData.minStreak}连 ~ {ruleData.maxStreak}连
                            </span>
                          </div>
                          {renderStreakTable(ruleData.byType, ruleData.minStreak, ruleData.maxStreak, visibleRawTypes)}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div className="py-14 text-center">
                <Activity className="w-12 h-12 mx-auto mb-4 text-gray-200" />
                <p className="text-base font-bold text-gray-400">
                  {dragonRecords.length === 0
                    ? '暂无统计数据，点击"开始统计"后数据将在此展示'
                    : '当前筛选条件下无匹配数据，请调整筛选器'
                  }
                </p>
                {dragonRecords.length > 0 && (
                  <button
                    onClick={() => { setStatsRuleFilter('ALL'); setStatsTypeFilter('ALL'); setStatsModeFilter('ALL'); }}
                    className="mt-3 px-4 py-2 rounded-lg text-sm font-bold bg-violet-50 text-violet-600 border border-violet-200 hover:bg-violet-100 transition-all"
                  >
                    重置筛选条件
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </section>


      {singleJumpSignals.length > 0 && (
        <section className="bg-amber-50/60 rounded-[2rem] p-5 border border-amber-200 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-amber-600" />
            <h3 className="text-sm font-black text-amber-700">单跳提醒（走势 + 珠盘）</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {singleJumpSignals.slice(0, 8).map((s, idx) => (
              <div key={`${s.ruleId}-${s.mode}-${s.type}-${idx}`} className="bg-white rounded-xl px-3 py-2 border border-amber-100 flex justify-between items-center">
                <div>
                  <p className="text-xs font-black text-gray-800">{s.ruleName} · {s.sequenceLabel}</p>
                  <p className="text-[10px] text-gray-500 font-bold">{s.mode === 'trend' ? '走势' : '珠盘'} 连续交替</p>
                </div>
                <span className="text-lg font-black text-amber-600">{s.count}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ═══════ Dragon List Filter Bar ═══════ */}
      <div className="flex flex-col md:flex-row items-center justify-between bg-white/60 backdrop-blur-md rounded-[2rem] p-4 px-8 border border-white shadow-sm gap-4">
        <div className="flex items-center space-x-3">
          <Filter className="w-4 h-4 text-gray-400" />
          <span className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em]">龙榜筛选器</span>
        </div>
        <div className="flex flex-wrap justify-center gap-2 items-center">
          {/* Rule filter dropdown */}
          <select
            value={dragonRuleFilter}
            onChange={e => setDragonRuleFilter(e.target.value)}
            className="px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider border-2 border-gray-100 bg-white text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-400"
          >
            <option value="ALL">全部规则</option>
            {rules.map(r => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </select>
          <FilterButton type="ALL" label="全部类型" />
          <FilterButton type="ODD" label="单 (ODD)" />
          <FilterButton type="EVEN" label="双 (EVEN)" />
          <FilterButton type="BIG" label="大 (BIG)" />
          <FilterButton type="SMALL" label="小 (SMALL)" />
        </div>
      </div>

      <section className="bg-white/80 backdrop-blur-md rounded-[2.5rem] p-8 shadow-xl border border-blue-50">
        <div className="flex items-center justify-between mb-8 px-2">
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-red-50 rounded-2xl">
              <Heart className="w-6 h-6 text-red-500 fill-current" />
            </div>
            <div>
              <h2 className="text-xl md:text-2xl font-black text-gray-900">我的关注</h2>
              <p className="text-xs text-gray-400 font-bold uppercase tracking-wider mt-1">
                实时追踪核心规则走势 · 已关注 {followedPatterns.length} 项 {activeFilter !== 'ALL' && `(已应用筛选: ${activeFilter})`}
              </p>
            </div>
          </div>
        </div>

        {followedResults.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 bg-gray-50/50 rounded-3xl border border-dashed border-gray-200">
            <div className="bg-white p-4 rounded-full shadow-sm mb-4">
               <Star className="w-8 h-8 text-gray-200" />
            </div>
            <p className="text-gray-400 font-black text-xs uppercase tracking-widest text-center px-6">
               {activeFilter === 'ALL' ? '目前还没有关注任何趋势' : `目前没有匹配筛选条件的关注项`}<br/>
               <span className="text-[10px] opacity-60 mt-1 block">点击下方长龙卡片上的爱心图标即可快速添加</span>
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
            {followedResults.map((dragon, idx) => renderDragonCard(dragon, idx, true))}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 items-start">
        <div className="bg-white rounded-[2.5rem] p-8 shadow-xl border border-gray-100 flex flex-col min-h-[500px]">
          <div className="flex items-center space-x-3 mb-8 px-1">
            <div className="p-2.5 bg-amber-50 rounded-2xl">
              <BarChart3 className="w-6 h-6 text-amber-500" />
            </div>
            <div>
              <h2 className="text-xl font-black text-gray-900">1. 单双/大小走势长龙</h2>
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                基于各采样步长的最新序列连出提醒
              </p>
            </div>
          </div>

          {trendDragons.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center bg-gray-50/50 rounded-3xl border border-dashed border-gray-200 py-24">
              <Info className="w-6 h-6 text-gray-300 mb-2" />
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                暂无匹配筛选条件的序列长龙
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {trendDragons.map((d, i) => renderDragonCard(d, i))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-[2.5rem] p-8 shadow-xl border border-gray-100 flex flex-col min-h-[500px]">
          <div className="flex items-center space-x-3 mb-8 px-1">
            <div className="p-2.5 bg-indigo-50 rounded-2xl">
              <Grid3X3 className="w-6 h-6 text-indigo-500" />
            </div>
            <div>
              <h2 className="text-xl font-black text-gray-900">2. 珠盘路行级长龙</h2>
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                基于珠盘路左右横向行的连出提醒
              </p>
            </div>
          </div>

          {beadRowDragons.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center bg-gray-50/50 rounded-3xl border border-dashed border-gray-200 py-24">
              <Info className="w-6 h-6 text-gray-300 mb-2" />
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                 暂无匹配筛选条件的珠盘行龙
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {beadRowDragons.map((d, i) => renderDragonCard(d, i))}
            </div>
          )}
        </div>
      </div>

      <div className="p-6 bg-blue-50/50 rounded-[2.5rem] border border-blue-100/50 flex items-start space-x-5">
         <div className="p-3 bg-blue-100 rounded-2xl shrink-0 shadow-sm">
           <Info className="w-5 h-5 text-blue-500" />
         </div>
         <div className="space-y-1">
           <p className="text-xs text-blue-600 font-black uppercase tracking-wider">
             长龙关注与提醒逻辑说明：
           </p>
           <ul className="text-[11px] text-blue-600/80 font-medium space-y-1 list-disc pl-4">
             <li><strong>物理对齐</strong>：珠盘路行提醒严格采用 (高度 - 偏移) / 步长 % 行数 的物理逻辑，确保与盘面显示的行号 100% 一致。</li>
             <li><strong>智能跳转</strong>：直接点击任何长龙卡片，系统将为您切换至对应规则的实战分析界面。</li>
             <li><strong>多维筛选</strong>：使用顶部的筛选器可以快速定位特定结果。</li>
             <li><strong>动态高亮</strong>：当关注项连出数较多时卡片会有特殊视觉提示。</li>
             <li><strong>统计面板</strong>：点击"开始统计"后，系统将自动记录所有出现的长龙，统计面板支持规则、类型、龙类三维筛选。</li>
           </ul>
         </div>
      </div>
    </div>
  );
});

DragonList.displayName = 'DragonList';

// ✅ 优化：基于内容指纹比较 allBlocks，减少缓存合并后的不必要重渲染
export default memo(DragonList, (prevProps, nextProps) => {
  // 引用比较（不会频繁变化的 props）
  if (prevProps.rules !== nextProps.rules) return false;
  if (prevProps.followedPatterns !== nextProps.followedPatterns) return false;
  if (prevProps.onToggleFollow !== nextProps.onToggleFollow) return false;
  if (prevProps.onJumpToChart !== nextProps.onJumpToChart) return false;

  // allBlocks 基于内容比较（长度 + 首尾高度）
  const pBlocks = prevProps.allBlocks;
  const nBlocks = nextProps.allBlocks;
  if (pBlocks.length !== nBlocks.length) return false;
  if (pBlocks.length === 0 && nBlocks.length === 0) return true;
  if (pBlocks[0]?.height !== nBlocks[0]?.height) return false;
  if (pBlocks[pBlocks.length - 1]?.height !== nBlocks[nBlocks.length - 1]?.height) return false;

  return true;
});
