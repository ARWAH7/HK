# 🚀 部署指南

## 📋 目录
- [本地开发](#本地开发)
- [生产部署](#生产部署)
- [Docker 部署](#docker-部署)
- [云平台部署](#云平台部署)
- [故障排查](#故障排查)

---

## 🖥️ 本地开发

### Windows 用户

#### 推荐方式
```cmd
npm run start:full
```

#### 手动启动
```cmd
# 终端 1: 启动后端
cd backend
npm run dev

# 终端 2: 启动前端
npm run dev
```

### Linux/Mac 用户

#### 推荐方式
```bash
npm run start:full
```

#### 手动启动
```bash
# 终端 1: 启动后端
cd backend && npm run dev

# 终端 2: 启动前端
npm run dev
```

### 访问地址
- 前端: http://localhost:5173
- 后端 API: http://localhost:3001
- 健康检查: http://localhost:3001/health
- WebSocket: ws://localhost:8080

---

## 🌐 生产部署

### 方式 1: 传统部署

#### 1. 构建前端
```bash
npm run build
```

#### 2. 配置环境变量
```bash
# backend/.env
NODE_ENV=production
API_PORT=3001
WS_PORT=8080
ALCHEMY_API_KEY=your_production_key
```

#### 3. 启动后端（会自动服务前端）
```bash
cd backend
npm start
```

#### 4. 使用 PM2 守护进程（推荐）
```bash
# 安装 PM2
npm install -g pm2

# 启动应用
cd backend
pm2 start dist/index.js --name hash-master

# 查看状态
pm2 status

# 查看日志
pm2 logs hash-master

# 开机自启
pm2 startup
pm2 save
```

### 方式 2: Nginx 反向代理

#### 1. 安装 Nginx
```bash
# Ubuntu/Debian
sudo apt update
sudo apt install nginx

# CentOS/RHEL
sudo yum install nginx
```

#### 2. 配置 Nginx
使用项目根目录的 `nginx.conf` 文件：

```bash
sudo cp nginx.conf /etc/nginx/nginx.conf
sudo nginx -t  # 测试配置
sudo systemctl restart nginx
```

#### 3. 配置 SSL（可选）
```bash
# 使用 Let's Encrypt
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

---

## 🐳 Docker 部署

### 前置要求
- Docker >= 20.10
- Docker Compose >= 2.0

### 快速启动

#### 1. 配置环境变量
```bash
# 创建 .env 文件
echo "ALCHEMY_API_KEY=your_key_here" > backend/.env
```

#### 2. 启动容器
```bash
docker-compose up -d
```

#### 3. 查看日志
```bash
docker-compose logs -f
```

#### 4. 停止服务
```bash
docker-compose down
```

### 自定义构建

#### 仅构建前端
```bash
docker build -t hash-master-frontend .
docker run -p 80:80 hash-master-frontend
```

#### 仅构建后端
```bash
cd backend
docker build -t hash-master-backend .
docker run -p 3001:3001 -p 8080:8080 -e ALCHEMY_API_KEY=your_key hash-master-backend
```

---

## ☁️ 云平台部署

### Vercel（前端）

#### 1. 安装 Vercel CLI
```bash
npm install -g vercel
```

#### 2. 部署
```bash
vercel --prod
```

#### 3. 配置环境变量
在 Vercel 控制台设置：
- `VITE_API_URL` (后端地址)

### Heroku（后端）

#### 1. 创建应用
```bash
heroku create hash-master-backend
```

#### 2. 配置环境变量
```bash
heroku config:set ALCHEMY_API_KEY=your_key
heroku config:set NODE_ENV=production
```

#### 3. 部署
```bash
git subtree push --prefix backend heroku main
```

### Railway（全栈）

#### 1. 连接 GitHub 仓库
访问 https://railway.app 并连接仓库

#### 2. 配置环境变量
在 Railway 控制台设置所有必需的环境变量

#### 3. 自动部署
推送到 GitHub 即可自动部署

### AWS EC2

#### 1. 启动实例
- 选择 Ubuntu 22.04 LTS
- 实例类型: t2.micro（免费套餐）
- 安全组: 开放 80, 443, 3001, 8080 端口

#### 2. 连接并安装依赖
```bash
ssh -i your-key.pem ubuntu@your-ec2-ip

# 安装 Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# 安装 Nginx
sudo apt install -y nginx

# 安装 PM2
sudo npm install -g pm2
```

#### 3. 部署应用
```bash
# 克隆代码
git clone your-repo-url
cd hash-master-5.0

# 安装依赖
npm run install:all

# 构建前端
npm run build

# 配置环境变量
cp .env.example .env.local
cp backend/.env.example backend/.env
# 编辑配置文件...

# 启动后端
cd backend
pm2 start dist/index.js --name hash-master
pm2 save
pm2 startup

# 配置 Nginx
sudo cp ../nginx.conf /etc/nginx/nginx.conf
sudo systemctl restart nginx
```

---

## 🔧 故障排查

### 问题 1: 端口被占用
```bash
# Windows
netstat -ano | findstr :5173
taskkill /PID <PID> /F

# Linux/Mac
lsof -ti:5173 | xargs kill -9
```

### 问题 2: 依赖安装失败
```bash
# 清除缓存
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
```

### 问题 3: API 请求失败
- 检查后端是否启动: `curl http://localhost:3001/health`
- 检查 API Key 是否配置
- 查看浏览器控制台错误
- 检查 CORS 配置

### 问题 4: Docker 容器无法启动
```bash
# 查看日志
docker-compose logs backend
docker-compose logs frontend

# 重新构建
docker-compose build --no-cache
docker-compose up -d
```

### 问题 5: Nginx 502 错误
- 检查后端是否运行
- 检查 Nginx 配置: `sudo nginx -t`
- 查看 Nginx 日志: `sudo tail -f /var/log/nginx/error.log`

---

## 📊 性能优化

### 前端优化
- 启用 Gzip 压缩
- 使用 CDN 加速静态资源
- 启用浏览器缓存
- 代码分割和懒加载

### 后端优化
- 使用 Redis 缓存
- 启用集群模式
- 配置负载均衡
- 数据库连接池

### 示例: PM2 集群模式
```bash
pm2 start dist/index.js -i max --name hash-master-cluster
```

---

## 🔒 安全建议

1. **使用 HTTPS**
   - 配置 SSL 证书
   - 强制 HTTPS 重定向

2. **环境变量保护**
   - 不要提交 `.env` 文件
   - 使用密钥管理服务

3. **API 安全**
   - 启用速率限制
   - 添加 API 认证
   - 配置 CORS 白名单

4. **服务器加固**
   - 配置防火墙
   - 定期更新系统
   - 使用非 root 用户运行

---

## 📞 获取帮助

- 📖 查看 [backend/README.md](./backend/README.md)
- 🐛 提交 Issue
- 💬 加入社区讨论

---

**© 2026 HashMaster Team**
