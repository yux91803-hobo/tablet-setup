#!/bin/sh
# ib：用 li、li2 各自所在 InstaBox 账号的 key 跑 InstaBox 命令行（两台在两个账号里）。装机脚本装成 /usr/local/bin/ib。
# 用法和 instabox 一样，只是把 instabox 换成 ib：
#   ib exec li2 -- 'ls -la'      ib agent prompt li --provider codex --cwd /data/workspace/x "任务"
# 参数里第一个是 li 或 li2（或以 li:、li2: 开头）的，就用那台所在账号的 key；一个都没有（比如 ib ls）就两个账号各跑一次。
# key 在 ~/.config/liming/instabox/<机器>.key（装机脚本写的，权限 600），只经环境变量交给 instabox，不进参数、不打印。
set -eu
DIR=${LIMING_IB_DIR:-${HOME:-/root}/.config/liming/instabox}
IB=${LIMING_INSTABOX:-instabox}
MACHINES='li2 li'

# 参数里第一个机器名
pick() {
  for a in "$@"; do
    for m in $MACHINES; do
      case "$a" in "$m"|"$m":*) printf '%s' "$m"; return 0;; esac
    done
  done
  return 1
}

# 把这台的 key 放进环境变量（在调用它的子 shell 或 exec 前）；没有就报错返回 2
load_key() {
  f="$DIR/$1.key"
  if [ ! -r "$f" ]; then
    echo "ib：没有 $1 的 key（$f），在平板上重跑一次装机脚本" >&2
    return 2
  fi
  INSTABOX_API_KEY=$(cat "$f")
  export INSTABOX_API_KEY
}

if m=$(pick "$@"); then
  load_key "$m" || exit 2
  exec "$IB" "$@"
fi

# 看帮助、版本：随便用一个账号跑一次
case "${1:-}" in
  help|-h|--help|version|--version|-v)
    for m in $MACHINES; do [ -r "$DIR/$m.key" ] && { load_key "$m"; exec "$IB" "$@"; }; done
    exec "$IB" "$@";;
esac
for a in "$@"; do case "$a" in -h|--help) for m in $MACHINES; do [ -r "$DIR/$m.key" ] && { load_key "$m"; exec "$IB" "$@"; }; done; exec "$IB" "$@";; esac; done

# 没写机器名：有 key 的账号各跑一次
rc=0 ran=0
for m in $MACHINES; do
  [ -r "$DIR/$m.key" ] || continue
  ran=1
  echo "== $m =="
  ( load_key "$m" && exec "$IB" "$@" ) || rc=$?
done
if [ "$ran" = 0 ]; then
  echo "ib：一把 key 都没有（$DIR），在平板上重跑一次装机脚本" >&2
  exit 2
fi
exit "$rc"
