FROM node:22-slim

ENV TZ=Asia/Shanghai
ENV PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma
# bcrypt 原生预编译包走国内镜像（GitHub Releases 在国内不稳定），并装编译工具链兜底
ENV npm_config_bcrypt_binary_host_mirror=https://registry.npmmirror.com/-/binary/bcrypt

# 换国内 Debian 源后安装 openssl（消除 Prisma libssl 检测告警）+ 编译工具链（bcrypt 兜底）
RUN sed -i 's|deb.debian.org|mirrors.tencent.com|g; s|security.debian.org|mirrors.tencent.com|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null; \
    apt-get update && apt-get install -y --no-install-recommends openssl python3 make g++ && rm -rf /var/lib/apt/lists/* && openssl version

RUN corepack enable && corepack prepare pnpm@10.21.0 --activate

WORKDIR /app

# 依赖层（先装，利用构建缓存）：pnpm workspace 只装 api 及其依赖
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
RUN pnpm config set registry https://registry.npmmirror.com \
  && pnpm install --filter @iplat/api... --frozen-lockfile

# 应用层：构建产物 + prisma schema/migrations/seed + 模板资产
COPY apps/api ./apps/api
RUN pnpm --filter @iplat/api exec prisma generate

WORKDIR /app/apps/api
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/main.js"]
