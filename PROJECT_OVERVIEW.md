# 项目阅读笔记（haxi2.0-yunxingqiehuanguizekadun）

## 1. 项目定位
这是一个围绕 **TRON 区块数据** 的分析系统，采用“前端可视化 + 后端实时监听 + Redis 存储”的全栈架构。

- 前端：React + Vite + TypeScript，提供走势图、路珠图、AI 预测、模拟下注等功能。
- 后端：Node.js + TypeScript，监听 TRON 链上区块，提供 REST API 与 WebSocket 推送。
- 存储：Redis（含降级思路，连接失败时有内存备用逻辑提示）。

## 2. 目录与模块速览

### 根目录（前端主应用）
- `App.tsx`：应用核心状态与主页面逻辑，管理规则、主题、区块数据、配置加载与保存。
- `components/`：可视化组件（趋势图、路珠图、数据表、AI 预测、模拟下注等）。
- `services/`：前端 API 封装与配置持久化调用。
- `utils/`：区块拉取、算法分析、辅助方法等。

### `backend/`（后端服务）
- `src/index.ts`：服务入口，启动 Redis 检测、WebSocket、REST API、TRON 监听器。
- `src/api.ts`：REST API，包含区块查询、统计、AI 数据、下注任务与插件相关接口。
- `src/tron-listener.ts`：TRON 链监听与数据写入逻辑。
- `src/websocket.ts`：实时推送服务。
- `src/redis.ts`：Redis 读写封装（区块、统计、配置等）。

## 3. 前端核心特征

1. **多标签工作台**：含 dashboard、单双趋势、大小趋势、路珠图、长龙、AI 预测、模拟下注。
2. **规则体系**：支持自定义采样规则（间隔、起始块、高度过滤等），并可持久化。
3. **性能考虑**：
   - 使用缓存（含 TTL）减少重复请求。
   - 前端配置读写采用防抖，降低频繁写入。
4. **可观测性**：开发环境输出区块更新与内存估算日志，便于排查。

## 4. 后端核心特征

1. **启动流程明确**：先测 Redis，再起 WebSocket、API、监听器。
2. **API 做了动态加载优化**：根据规则与请求条数估算需要加载的原始区块数量，避免固定大批量读取。
3. **实时能力**：WebSocket 推送新块，前端可订阅实时变化。
4. **运维友好**：有 `.env.example`、`docker-compose.yml`、部署与测试说明。

## 5. 运行方式（简要）

### 前端
```bash
npm install
npm run dev
```

### 后端
```bash
cd backend
npm install
npm run dev
```

### Redis（推荐 Docker）
```bash
docker-compose up -d
```

## 6. 当前观察到的注意点

1. 根目录 `package.json` 中的脚本有 `server` 指向 `cd server`，而当前目录结构实际为 `backend/`，可能是历史遗留，建议统一脚本路径。
2. 项目功能较多（AI/下注/插件/图表），建议后续补充一份“模块边界说明文档”，明确每个服务和组件的职责。
3. 若面向多人协作，建议增加统一的 API 文档（OpenAPI 或至少接口清单）。

## 7. 总结

该项目已经具备“数据采集 -> 存储 -> API/WS -> 前端分析展示”的完整链路，功能完整度高，且可继续朝“稳定性、可观测性、文档化”方向提升。
