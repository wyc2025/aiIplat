#!/usr/bin/env bash
# iplat 一键部署/更新脚本（供 GitHub Actions 通过 SSH 调用，也可手工执行）
# 用法：/opt/iplat/deploy.sh [产物包路径] [--no-build]
set -euo pipefail

APP_DIR=/opt/iplat
PKG="${1:-/tmp/iplat-app.tgz}"
NO_BUILD="${2:-}"
cd "$APP_DIR"

echo '[1/6] 备份当前 API 构建产物'
rm -rf /tmp/_bak_dist
[ -d apps/api/dist ] && cp -a apps/api/dist /tmp/_bak_dist && echo 'backup ok'

echo '[2/6] 解压新产物'
tar -xzf "$PKG" -C "$APP_DIR"
echo 'extracted'

echo '[3/6] 构建镜像'
if [ "$NO_BUILD" = '--no-build' ]; then echo 'skip build'; else docker compose build api; fi

echo '[4/6] 数据库迁移（幂等）'
docker compose run --rm --entrypoint sh api -c 'cd /app/apps/api && npx prisma migrate deploy'

echo '[5/6] 重启服务'
docker compose up -d api nginx

echo '[6/6] 健康检查'
OK=0
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1/api/docs || true)
  if [ "$code" = '200' ]; then echo "healthy: /api/docs -> $code"; OK=1; break; fi
  sleep 3
done
if [ "$OK" != '1' ]; then
  echo 'health check failed, rolling back dist'
  rm -rf apps/api/dist
  [ -d /tmp/_bak_dist ] && cp -a /tmp/_bak_dist apps/api/dist
  docker compose up -d api
  exit 1
fi

docker ps --filter name=iplat --format '{{.Names}} {{.Status}}'
echo 'deploy done'
