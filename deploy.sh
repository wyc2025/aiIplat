#!/usr/bin/env bash
# iplat 一键部署/更新脚本（供 GitHub Actions 通过 SSH 调用，也可手工执行）
# 用法：/opt/iplat/deploy.sh [产物包路径] [--no-build]
set -euo pipefail

APP_DIR=/opt/iplat
PKG="${1:-/tmp/iplat-app.tgz}"
NO_BUILD="${2:-}"
cd "$APP_DIR"

echo '[1/8] 备份当前 API 构建产物'
rm -rf /tmp/_bak_dist
[ -d apps/api/dist ] && cp -a apps/api/dist /tmp/_bak_dist && echo 'backup ok'

echo '[2/8] 解压新产物'
tar -xzf "$PKG" -C "$APP_DIR"
echo 'extracted'

echo '[3/8] 构建镜像'
if [ "$NO_BUILD" = '--no-build' ]; then echo 'skip build'; else docker compose build api; fi

echo '[4/8] 迁移前数据库备份'
# 存在删列等破坏性迁移时，只回滚 dist 是救不回数据结构的，
# 所以每次跑 migrate deploy 之前先落一份全量快照（压缩，保留最近 7 份）
BAK_DIR=/opt/iplat-db-backups
TS=$(date +%Y%m%d-%H%M%S)
if command -v gzip >/dev/null 2>&1; then
  BAK_FILE="$BAK_DIR/iplat-$TS.sql.gz"
  PACK='gzip'
else
  BAK_FILE="$BAK_DIR/iplat-$TS.sql"
  PACK='cat'
fi
mkdir -p "$BAK_DIR"
# MYSQL_ROOT_PASSWORD 用单引号包住，交给容器内 shell 展开，宿主机不必再配一份明文密码
if ! docker compose exec -T mysql bash -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump -uroot --single-transaction --routines --triggers --events --default-character-set=utf8mb4 iplat' | "$PACK" >"$BAK_FILE"; then
  echo 'backup failed (mysql 容器未运行或无权限), removing partial file'
  rm -f "$BAK_FILE"
  exit 1
fi
if [ ! -s "$BAK_FILE" ]; then
  echo 'backup file is empty, aborting deploy before migration'
  rm -f "$BAK_FILE"
  exit 1
fi
ls -1t "$BAK_DIR"/iplat-*.sql* 2>/dev/null | tail -n +8 | xargs -r rm -f
echo "backup ok: $BAK_FILE ($(du -h "$BAK_FILE" | cut -f1))"
# 回滚：gunzip -c "$BAK_FILE" | docker compose exec -T mysql bash -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot iplat'

echo '[5/8] 数据库迁移（幂等）'
docker compose run --rm --entrypoint sh api -c 'cd /app/apps/api && npx prisma migrate deploy'

echo '[6/8] 菜单/权限种子同步（幂等）'
# seed 按 parentId+name 判重，只补缺失的菜单与权限（新增页面若没同步，前端路由不会注册，
# 直接访问该页会落到 catch-all 404 —— 这正是「站点列表」曾 404 的原因）。
# 失败不阻断本次部署（代码更新仍可生效），但会醒目告警，便于手工重跑。
if ! docker compose run --rm --entrypoint sh api -c 'cd /app/apps/api && npx tsx prisma/seed.ts'; then
  echo '>>> WARN: 种子数据同步失败，菜单/权限可能未更新；手工重跑：'
  echo '>>>       cd /opt/iplat && docker compose run --rm --entrypoint sh api -c "cd /app/apps/api && npx tsx prisma/seed.ts"'
fi

echo '[7/8] 重启服务'
docker compose up -d api nginx

echo '[8/8] 健康检查'
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
