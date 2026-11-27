#!/usr/bin/env bash
# Liming 平板装机：在 DSH Go 的终端里（打开一个对话 → 全部功能 → 终端）运行
#   apt-get update && apt-get install -y curl && curl -fsSL https://tablet.liming-work.com/setup.sh | bash
# 装好随本机引擎启停的 WorkBuddy 网关和插件；再让平板上的 AI 能操作两台云电脑 li、li2：
# 装 InstaBox 命令行和 ib（按机器选账号的 key），存两把 key（li2、li 所在账号各一把，只要 machines:read 和 machines:write），
# 在 li2、li 上装好浏览器命令行、检查 Antigravity 登录状态。
# 脚本里不含任何密钥；key 只存平板 ~/.config/liming/instabox/（权限 600），只经环境变量交给 instabox。可以重复运行。
#   --dry-run  只列出要做的事    --skip-li  不接 li
# 说明：https://github.com/yux91803-hobo/tablet-setup 的 README；设计见 docs/superpowers/specs/2026-11-27-crew-design.md
set +x
set -euo pipefail

BASE=${LIMING_BASE:-https://tablet.liming-work.com}
HOME_DIR=${HOME:-/root}
GW_DIR=${LIMING_GW_DIR:-/root/workbuddy-gateway}
PLUGIN_DIR=${LIMING_PLUGIN_DIR:-/root/liming-gateway}
KEY_DIR=${LIMING_IB_DIR:-$HOME_DIR/.config/liming/instabox}
BIN_DIR=${LIMING_BIN_DIR:-/usr/local/bin}
OLD_CLOUD_PLUGIN_DIR=${LIMING_OLD_CLOUD_PLUGIN_DIR:-/root/liming-cloud}
OLD_CLOUD_DIR=${LIMING_OLD_CLOUD_DIR:-$HOME_DIR/.liming-cloud}
INSTABOX=${LIMING_INSTABOX:-instabox}
NPM=${LIMING_NPM:-npm}
DSH=${LIMING_DSH:-dsh}
APT=${LIMING_APT:-apt-get}
TTY=${LIMING_TTY:-/dev/tty}
INSTABOX_VERSION=0.8.407
PLAYWRIGHT_CLI_VERSION=0.1.25
VERSION=v2.0.8
# 原版发布包的大小和 SHA-256，2026-11-25 在 li 上核对过（与 releases/SHA256SUMS.v2.0.8 一致）。
ZIP_SIZE=${LIMING_ZIP_SIZE:-22962873}
ZIP_SHA256=${LIMING_ZIP_SHA256:-b322c73b9a18f09c6560bff0e4b748e9acdc26272c339b4f5fce2413bb500cc6}
REMOTE_ZIP=/data/workbuddy-gateway/releases/workbuddy2api-hub-$VERSION.zip
WORK=''
GATEWAY_FILES='package.json cordis.patch.yml lib/index.js lib/gateway.js'
HAVE=''          # 有能用的 key 的机器
OLD_REMOVED=0    # 清掉过以前的云端任务插件

say() { printf '%s\n' "$*"; }
say_err() { printf '%s\n' "$*" >&2; }
die() { say_err "装机没完成：$*"; exit 1; }

trim() {
  local s=${1//$'\r'/}
  s=${s#"${s%%[![:space:]]*}"}
  printf '%s' "${s%"${s##*[![:space:]]}"}"
}

# 用某台所在账号的 key 跑 instabox（key 只放环境变量，不进参数）
ibx() {
  local m=$1; shift
  INSTABOX_API_KEY=$(cat "$KEY_DIR/$m.key") "$INSTABOX" "$@"
}

# 读一把 key（不回显、不打印）；直接回车返回 1（跳过，或保留原来的）。
ask_key() {
  local m=$1 have=$2 line=''
  printf '%s' "粘贴 $m 所在账号的 InstaBox key（后台 API keys 新建，只勾 machines:read 和 machines:write，别勾删除；直接回车$([ "$have" = 1 ] && echo 保留原来的 || echo 跳过)）：" >&2
  IFS= read -rs line <&3 || true
  printf '\n' >&2
  line=$(trim "$line")
  [ -n "$line" ] || return 1
  printf '%s' "$line"
}

# 这把 key 看得到这台机器吗（instabox get 只读，不会叫醒机器）
check_key() {
  local m=$1 key=$2 out
  out=$(INSTABOX_API_KEY="$key" "$INSTABOX" get "$m" --json 2>/dev/null) || return 1
  printf '%s' "$out" | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if isinstance(d, dict) and d.get("name") == sys.argv[1] else 1)' "$m"
}

save_key() {
  local m=$1 key=$2
  mkdir -p "$KEY_DIR"; chmod 700 "$KEY_DIR"
  ( umask 077; printf '%s\n' "$key" > "$KEY_DIR/.$m.key.tmp" )
  chmod 600 "$KEY_DIR/.$m.key.tmp"
  mv -f "$KEY_DIR/.$m.key.tmp" "$KEY_DIR/$m.key"
}

# 逐台问 key：核对看得到这台才存；填错了再问，三次不对就先不接这台（原来有能用的 key 就照旧用）。
setup_keys() {
  local m have key tries ok
  for m in "$@"; do
    have=0; [ -s "$KEY_DIR/$m.key" ] && have=1
    ok=0; tries=0
    while [ "$tries" -lt 3 ]; do
      tries=$((tries + 1))
      if ! key=$(ask_key "$m" "$have"); then
        if [ "$have" = 1 ]; then
          if check_key "$m" "$(cat "$KEY_DIR/$m.key")"; then ok=1; else say_err "$m 原来的 key 用不了了（可能被吊销了），这次先不接 $m"; fi
        fi
        break
      fi
      if check_key "$m" "$key"; then save_key "$m" "$key"; ok=1; break; fi
      say_err "看不到 $m：这把 key 不是 $m 所在账号的，或者没勾 machines:read。请重新粘贴。"
    done
    key=''
    if [ "$ok" = 1 ]; then HAVE="$HAVE $m"; fi
  done
  HAVE=${HAVE# }
}

ensure_instabox() {
  command -v "$INSTABOX" >/dev/null 2>&1 && return 0
  say "安装 InstaBox 命令行（instabox@$INSTABOX_VERSION）……"
  "$NPM" i -g "instabox@$INSTABOX_VERSION" </dev/null >/dev/null 2>&1 || true
  command -v "$INSTABOX" >/dev/null 2>&1 && return 0
  die "装了 InstaBox 命令行还是找不到 instabox：npm 的全局目录不在 PATH 里（用 npm prefix -g 看是哪个目录），把它下面的 bin 加进 PATH 再运行"
}

# 下载一个文件；内容里要有 marker，开头不能是「<」（网站对不存在的路径会回首页 HTML）。失败时不留文件。
fetch_file() {
  local url=$1 dest=$2 marker=$3 part first
  part="$dest.part.$$"
  if ! curl -fsSL --retry 2 --connect-timeout 20 -o "$part" "$url" 2>/dev/null; then
    rm -f "$part"; say_err "下载失败：$url"; return 1
  fi
  first=$(head -c 512 "$part" | tr -d '[:space:]' | cut -c1)
  if [ "$first" = '<' ] || ! grep -qF -- "$marker" "$part"; then
    rm -f "$part"; say_err "下载到的不是要的文件（可能是网站首页）：$url"; return 1
  fi
  mv -f "$part" "$dest"
}

verify_zip() {
  local f=$1 size sum
  size=$(wc -c < "$f" | tr -d '[:space:]')
  if [ "$size" != "$ZIP_SIZE" ]; then say_err "网关安装包大小不对（$size 字节，应为 $ZIP_SIZE）"; return 1; fi
  sum=$(sha256sum "$f" | cut -d' ' -f1)
  if [ "$sum" != "$ZIP_SHA256" ]; then say_err "网关安装包校验不对，没有安装"; return 1; fi
}

# 校验通过才解压：先解到临时目录、核对，再换成 $VERSION；accounts、usage、logs 只建不动。
install_gateway() {
  local zip=$1 stage d
  verify_zip "$zip" || return 1
  mkdir -p "$GW_DIR"
  stage=$(mktemp -d "$GW_DIR/.stage.XXXXXX")
  if ! python3 -m zipfile -e "$zip" "$stage" >/dev/null 2>&1 || [ ! -f "$stage/wb-proxy/wb_proxy.py" ]; then
    rm -rf "$stage"; say_err "网关安装包解不开，或里面没有 wb-proxy/wb_proxy.py"; return 1
  fi
  chmod +x "$stage"/wb-proxy/bin/wb-tls-bridge-* "$stage"/wb-proxy/*.sh 2>/dev/null || true
  rm -rf "${GW_DIR:?}/$VERSION"
  mkdir -p "$GW_DIR/$VERSION"
  mv "$stage/wb-proxy" "$GW_DIR/$VERSION/wb-proxy"
  rm -rf "$stage"
  ln -sfn "$VERSION/wb-proxy" "$GW_DIR/current"
  for d in accounts usage logs; do mkdir -p "$GW_DIR/$d"; chmod 700 "$GW_DIR/$d"; done
}

# 网关没装就经 InstaBox 从 li2 取安装包（取不到再从 li 取），核对后装上。
ensure_gateway() {
  local m
  if [ -f "$GW_DIR/current/wb_proxy.py" ]; then say "网关已经装好（$GW_DIR/current），不再下载。"; return 0; fi
  for m in $HAVE; do
    say "从 $m 取网关安装包（约 22 MB）……"
    rm -f "$WORK/gw.zip"
    if ibx "$m" pull "$m" "$REMOTE_ZIP" "$WORK/gw.zip" </dev/null >/dev/null 2>&1 && [ -s "$WORK/gw.zip" ] && verify_zip "$WORK/gw.zip" 2>/dev/null; then
      install_gateway "$WORK/gw.zip" || return 1
      say "网关装好了：$GW_DIR/current"
      return 0
    fi
    say "$m 上取不到。"
  done
  say_err "两台上都取不到网关安装包（$REMOTE_ZIP）"
  return 1
}

# 插件文件每次都更新（本地路径安装是链接目录，重启引擎就用上新的）；只在第一次挂进 web 配置。
install_plugin() {
  local src=$1 dest=$2 files=$3 f
  for f in $files; do mkdir -p "$(dirname "$dest/$f")"; cp -f "$src/$f" "$dest/$f"; done
  if [ ! -f "$dest/.added" ]; then
    "$DSH" plugin --profile web add "$dest" </dev/null || { say_err "插件挂不上，看上面 dsh 的报错"; return 1; }
    : > "$dest/.added"
  fi
}

# 以前（#227）装过的云端任务插件：卸掉，删掉插件目录和 ~/.liming-cloud（旧的 SSH 令牌、只读 key 和台账）。
cleanup_old_tablet() {
  [ -d "$OLD_CLOUD_PLUGIN_DIR" ] || [ -d "$OLD_CLOUD_DIR" ] || return 0
  if [ -d "$OLD_CLOUD_PLUGIN_DIR" ]; then "$DSH" plugin --profile web remove liming-cloud </dev/null >/dev/null 2>&1 || true; fi
  rm -rf "$OLD_CLOUD_PLUGIN_DIR" "$OLD_CLOUD_DIR"
  OLD_REMOVED=1
}

install_tools() {
  mkdir -p "$BIN_DIR"
  cp -f "$WORK/ib.sh" "$BIN_DIR/ib.tmp"; chmod 755 "$BIN_DIR/ib.tmp"; mv -f "$BIN_DIR/ib.tmp" "$BIN_DIR/ib"
}

# 在云电脑上跑的准备脚本（经 instabox exec --stdin 送过去）。每一项各自报一行「LMC 项 结果」，一项失败不影响别的项。
# 只装浏览器命令行，以及检查 Antigravity 装没装、登没登录。不碰账号和令牌。
remote_script() {
  local machine=$1
  printf 'set +x\nLIMING_MACHINE=%q\nPLAYWRIGHT_CLI_VERSION=%q\n' "$machine" "$PLAYWRIGHT_CLI_VERSION"
  cat <<'END'
set -u
umask 077
st() { printf 'LMC %s %s\n' "$1" "$2"; }
# 1. 浏览器命令行（Playwright CLI）和它的 Chromium
if ! command -v playwright-cli >/dev/null 2>&1; then npm i -g "@playwright/cli@$PLAYWRIGHT_CLI_VERSION" </dev/null >/dev/null 2>&1 || true; fi
if command -v playwright-cli >/dev/null 2>&1 && playwright-cli install-browser chromium </dev/null >/dev/null 2>&1; then st browser ok; else st browser failed; fi
# 2. Antigravity（两台都用）：只看装没装、登没登录；账号由站长自己在那台上登
if [ -x "$HOME/.local/bin/agy" ] || command -v agy >/dev/null 2>&1; then
  if [ -s "$HOME/.gemini/antigravity-cli/antigravity-oauth-token" ]; then st antigravity ok; else st antigravity logged-out; fi
else
  st antigravity none
fi
echo "LMC done"
END
}

# 在一台上跑准备脚本，输出「准备好了…」或「没准备好…」一句（不中断整个装机）。
remote_setup() {
  local m=$1 out val notes=''
  if ! out=$(remote_script "$m" | ibx "$m" exec "$m" --stdin --timeout 600 -- bash -s 2>&1) \
     || ! printf '%s\n' "$out" | grep -q '^LMC done$'; then
    case "$out" in
      *cool*) val='在冷却';;
      *missing_scope*|*permission*|*forbidden*) val='key 没有写权限（要勾 machines:write）';;
      *) val='连不上或没跑完';;
    esac
    printf '%s：没准备好（%s），稍后再跑一次装机脚本\n' "$m" "$val"
    return 0
  fi
  lmc() { printf '%s\n' "$out" | sed -n "s/^LMC $1 //p" | tail -n 1; }
  [ "$(lmc browser)" = ok ] || notes="$notes；浏览器命令行没装好，稍后重跑"
  case "$(lmc antigravity)" in
    logged-out) notes="$notes；Antigravity 还没登录";;
    none) notes="$notes；没装 Antigravity";;
  esac
  printf '%s：准备好了%s\n' "$m" "$notes"
}

ensure_packages() {
  local missing=() pair
  for pair in python3:python3 curl:curl sha256sum:coreutils; do
    command -v "${pair%%:*}" >/dev/null 2>&1 || missing+=("${pair##*:}")
  done
  [ ${#missing[@]} -eq 0 ] && return 0
  say "安装 ${missing[*]}……"
  { "$APT" update && "$APT" install -y ca-certificates "${missing[@]}"; } </dev/null >/dev/null || die "装不上 ${missing[*]}"
}

dry_run_plan() {
  say "--dry-run：只列出要做的事，什么都没改。"
  say "1. 检查 dsh；缺 python3、curl 才装；没有 InstaBox 命令行就 npm i -g instabox@$INSTABOX_VERSION。"
  say "2. 从 $BASE 下载网关插件和 ib。"
  say "3. 问 li2$([ "$1" = 1 ] || echo '、li') 所在账号的 InstaBox key（只要 machines:read 和 machines:write），用 instabox get 核对后存到 $KEY_DIR（权限 600）。"
  say "4. 网关没装就从 li2（不行再从 li）取安装包 $REMOTE_ZIP，核对大小和 SHA-256 后解到 $GW_DIR；插件放到 $PLUGIN_DIR，第一次装时挂进 web 配置。"
  say "5. 以前装过云端任务插件（$OLD_CLOUD_PLUGIN_DIR、$OLD_CLOUD_DIR）就卸掉删掉。"
  say "6. 装 ib 到 $BIN_DIR/ib。"
  say "7. 在每台云电脑上：装浏览器命令行 @playwright/cli@$PLAYWRIGHT_CLI_VERSION 和 Chromium；看 Antigravity 装没装、登没登录。"
}

summary() {
  local line
  say ""
  say "装好了。"
  say "· 网关：$GW_DIR/current（$VERSION），日志在 $GW_DIR/logs/；插件 $PLUGIN_DIR"
  say "· ib：$BIN_DIR/ib"
  [ "$OLD_REMOVED" = 1 ] && say "· 旧的云端任务插件已删掉（平板上的旧令牌、旧 key 一起删了；InstaBox 后台那几把旧 key 可以吊销）"
  while IFS= read -r line; do [ -n "$line" ] && say "· $line"; done <<<"$1"
  cat <<'EOF'

以后直接在聊天里让 AI 用云电脑，比如「看看 li2 上 /data/workspace 里有什么」「在 li 上编译这个工程」
「在 li2 上打开某个网页帮我查」。
想看云上的浏览器：在 InstaBox 网页打开那台机器的 Computer 页签。

第一次装时还要在 App 里：
1. 设置 › 本机引擎 › 重启。网关会跟着引擎起来。
2. 浏览器打开 http://127.0.0.1:8788 ，用 admin 登录，先在设置里改密码，再加网关账号，然后在「设置 → API Key」新建一把 key。
3. 设置 › 模型 › 添加渠道：兼容协议 Responses，Base URL http://127.0.0.1:8788/v1，API Key 填上一步的 key；获取模型，勾 deepseek-v4.1-flash、glm-5.4、kimi-k3.1-pro。
4. 设置 › 手机操控：打开开关，开无障碍和通知。
5. 新开一个对话，新装的配置才会生效。

别做：别点「重置运行环境」（会删掉网关、账号和这里存的 key；真重置了就再跑一次这个脚本）。
EOF
}

main() {
  local dry=0 skip_li=0 arg m results=''
  for arg in "$@"; do
    case "$arg" in
      --dry-run) dry=1;;
      --skip-li) skip_li=1;;
      -h|--help) sed -n '2,10p' "$0" 2>/dev/null || true; return 0;;
      *) die "不认识的参数：$arg";;
    esac
  done
  if [ "$dry" = 1 ]; then dry_run_plan "$skip_li"; return 0; fi
  command -v "$DSH" >/dev/null 2>&1 || die "没找到 dsh：先在 DSH Go 里装好本机运行环境，再在 App 的终端里运行"
  [ "$(uname -m)" = aarch64 ] || say "提示：这台是 $(uname -m)，平板上应是 aarch64。"
  ensure_packages
  ensure_instabox
  exec 3<"$TTY" || die "读不到终端（$TTY）：请在 App 的终端里运行"
  WORK=$(mktemp -d)
  trap 'rm -rf "$WORK"' EXIT
  say "下载插件和配置……"
  mkdir -p "$WORK/plugin/lib"
  fetch_file "$BASE/liming-gateway/package.json" "$WORK/plugin/package.json" '"name": "liming-gateway"' || die "插件没下载下来"
  fetch_file "$BASE/liming-gateway/cordis.patch.yml" "$WORK/plugin/cordis.patch.yml" 'liming-gateway' || die "插件没下载下来"
  fetch_file "$BASE/liming-gateway/lib/index.js" "$WORK/plugin/lib/index.js" 'liming-gateway' || die "插件没下载下来"
  fetch_file "$BASE/liming-gateway/lib/gateway.js" "$WORK/plugin/lib/gateway.js" 'createSupervisor' || die "插件没下载下来"
  fetch_file "$BASE/ib.sh" "$WORK/ib.sh" 'LIMING_IB_DIR' || die "ib 没下载下来"

  if [ "$skip_li" = 1 ]; then setup_keys li2; else setup_keys li2 li; fi
  [ -n "$HAVE" ] || die "至少要一把 InstaBox key：在 InstaBox 后台 API keys 新建，只勾 machines:read 和 machines:write（别勾删除），再运行这个脚本"
  ensure_gateway || die "网关没装上"
  install_plugin "$WORK/plugin" "$PLUGIN_DIR" "$GATEWAY_FILES" || die "插件没装上"
  cleanup_old_tablet
  install_tools
  for m in li2 li; do
    [ "$m" = li ] && [ "$skip_li" = 1 ] && continue
    case " $HAVE " in
      *" $m "*) say "准备 $m（睡着的话要先叫醒，可能要等一会儿）……"; results="$results$(remote_setup "$m")"$'\n';;
      *) results="$results$m：没接（以后想接，重跑这个脚本时粘贴 $m 所在账号的 key）"$'\n';;
    esac
  done
  summary "$results"
}

if [ "${LIMING_SETUP_LIB:-0}" != 1 ]; then main "$@"; fi
