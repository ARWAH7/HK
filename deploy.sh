#!/bin/bash

# 哈希分析大师 5.0 - 部署脚本
# 用途：自动化构建和部署前后端应用

set -e

echo "🚀 开始部署哈希分析大师 5.0..."

BACKEND_DIR="backend"

# 颜色定义
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ 未检测到 Node.js，请先安装 Node.js >= 18.0.0${NC}"
    exit 1
fi

echo -e "${BLUE}📦 Node.js 版本: $(node -v)${NC}"

# 1. 安装依赖
echo -e "${BLUE}📥 安装前端依赖...${NC}"
npm install

echo -e "${BLUE}📥 安装后端依赖...${NC}"
cd "$BACKEND_DIR"
npm install
cd ..

# 2. 检查环境变量
if [ ! -f ".env.local" ]; then
    echo -e "${RED}⚠️  未找到 .env.local 文件${NC}"
    echo -e "${BLUE}📝 正在创建示例配置...${NC}"
    cp .env.example .env.local
    echo -e "${GREEN}✅ 请编辑 .env.local 填入您的 API Key${NC}"
fi

if [ ! -f "$BACKEND_DIR/.env" ]; then
    echo -e "${RED}⚠️  未找到 $BACKEND_DIR/.env 文件${NC}"
    echo -e "${BLUE}📝 正在创建示例配置...${NC}"
    cp "$BACKEND_DIR/.env.example" "$BACKEND_DIR/.env"
    echo -e "${GREEN}✅ 请编辑 $BACKEND_DIR/.env 填入您的 API Key${NC}"
fi

# 3. 构建前端
echo -e "${BLUE}🔨 构建前端应用...${NC}"
npm run build

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ 前端构建成功！${NC}"
else
    echo -e "${RED}❌ 前端构建失败${NC}"
    exit 1
fi

# 4. 测试后端
echo -e "${BLUE}🧪 测试后端服务...${NC}"
cd "$BACKEND_DIR"
npm run build

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ 后端构建成功${NC}"
else
    echo -e "${RED}❌ 后端构建失败${NC}"
    exit 1
fi
cd ..

# 5. 部署选项
echo -e "${BLUE}🎯 选择部署方式:${NC}"
echo "1) 开发模式（前后端分离）"
echo "2) 生产模式（后端服务前端静态文件）"
echo "3) 仅构建，不启动"
read -p "请选择 (1-3): " choice

case $choice in
    1)
        echo -e "${GREEN}🚀 启动开发模式...${NC}"
        npm run start:full
        ;;
    2)
        echo -e "${GREEN}🚀 启动生产模式...${NC}"
        cd "$BACKEND_DIR"
        npm run build
        NODE_ENV=production npm start
        ;;
    3)
        echo -e "${GREEN}✅ 构建完成！${NC}"
        echo -e "${BLUE}📂 前端文件位于: ./dist${NC}"
        echo -e "${BLUE}📂 后端文件位于: ./$BACKEND_DIR${NC}"
        ;;
    *)
        echo -e "${RED}❌ 无效选择${NC}"
        exit 1
        ;;
esac

echo -e "${GREEN}🎉 部署完成！${NC}"
