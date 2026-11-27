#!/usr/bin/env bash
# crew：平板上的 DSH 操控 li、li2 上常驻 Antigravity（hcom）的命令。
# 装机脚本装成 /usr/local/bin/crew。设计见 docs/superpowers/specs/2026-11-27-crew-design.md。
# 退出码：
#   0 成功  2 用法错误  3 未做首次设置或停在条款页  4 停在信任目录页且未同意
#   5 冷却中  6 没有 crew agent  7 当前没有等审批操作  8 等待超时  9 远端出错或画面认不出
set -euo pipefail

IB=${LIMING_IB:-ib}
STATE_DIR=${LIMING_CREW_STATE:-${HOME:-/root}/.config/liming/crew}
REMOTE_TIMEOUT=${LIMING_CREW_REMOTE_TIMEOUT:-60}

say_err() { printf '%s\n' "$*" >&2; }
die_usage() { say_err "crew 用法错误：$*"; exit 2; }

check_machine() {
  case "${1:-}" in
    li|li2) return 0 ;;
    *) die_usage "机器名只认 li 或 li2，收到：${1:-（空）}" ;;
  esac
}

is_uint() {
  case "${1:-}" in
    ''|*[!0-9]*) return 1 ;;
    *) return 0 ;;
  esac
}

atomic_write() {
  local dest=$1 content=$2 dir tmp
  dir=$(dirname "$dest")
  mkdir -p "$dir"
  tmp="$dest.tmp.$$"
  printf '%s' "$content" > "$tmp"
  mv -f "$tmp" "$dest"
}

# 远端执行统一入口：总是把 ~/.local/bin 放到 PATH 前面（agy、hcom 在那里）
remote() {
  local m=$1 cmd=$2 t=${3:-$REMOTE_TIMEOUT}
  "$IB" exec "$m" --timeout "$t" -- "export PATH=\"\$HOME/.local/bin:\$PATH\"; $cmd"
}

# 查单台机器的 InstaBox 状态（不 exec、不叫醒），输出一行 JSON
get_machine_info() {
  local m=$1 raw=''
  if raw=$("$IB" get "$m" --json 2>/dev/null); then
    printf '%s' "$raw" | python3 -c '
import datetime, json, sys
m = sys.argv[1]
try:
    d = json.load(sys.stdin)
except Exception:
    print(json.dumps({"machine": m, "state": "unknown", "cooldownUntil": None}, ensure_ascii=False))
    sys.exit(0)
if not isinstance(d, dict):
    print(json.dumps({"machine": m, "state": "unknown", "cooldownUntil": None}, ensure_ascii=False))
    sys.exit(0)
now = datetime.datetime.now(datetime.timezone.utc)
cd = d.get("cooldownUntil")
if isinstance(cd, str) and cd.strip():
    try:
        dt = datetime.datetime.fromisoformat(cd.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=datetime.timezone.utc)
        if dt > now:
            print(json.dumps({"machine": m, "state": "cooldown", "cooldownUntil": cd}, ensure_ascii=False))
            sys.exit(0)
    except Exception:
        pass
raw_state = str(d.get("state") or "").lower()
if raw_state == "running":
    st = "running"
elif raw_state == "stopped":
    st = "stopped"
elif raw_state in ("suspended", "paused", "starting"):
    st = "paused"
else:
    st = "unknown"
print(json.dumps({"machine": m, "state": st, "cooldownUntil": None}, ensure_ascii=False))
' "$m"
  else
    python3 -c 'import json,sys; print(json.dumps({"machine": sys.argv[1], "state": "unknown", "cooldownUntil": None}, ensure_ascii=False))' "$m"
  fi
}

# 格式化冷却时间（北京时间 HH:MM）
format_bj_hm() {
  python3 -c '
import datetime, sys
s = sys.argv[1]
try:
    dt = datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    bj = dt.astimezone(datetime.timezone(datetime.timedelta(hours=8)))
    print(bj.strftime("%H:%M"))
except Exception:
    print(s)
' "$1"
}

# 冷却检查：在冷却就报北京时间到几点并退出 5
ensure_not_cooldown() {
  local m=$1 info state cd hm
  info=$(get_machine_info "$m")
  state=$(printf '%s' "$info" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("state","unknown"))')
  if [ "$state" = "cooldown" ]; then
    cd=$(printf '%s' "$info" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("cooldownUntil") or "")')
    hm=$(format_bj_hm "$cd")
    say_err "$m 正在冷却（到 $hm），暂不可用"
    exit 5
  fi
}

# 从 hcom list --json 输出里选出带 crew 标签且未停止的 agent；没有返回空 JSON null
parse_crew_agent() {
  local m=$1
  python3 -c '
import json, os, sys
m, state_dir = sys.argv[1], sys.argv[2]
try:
    items = json.load(sys.stdin)
except Exception:
    print("null")
    sys.exit(0)
if not isinstance(items, list):
    print("null")
    sys.exit(0)
chosen = None
for it in items:
    if not isinstance(it, dict):
        continue
    if it.get("tag") == "crew" and it.get("status") != "stopped":
        chosen = it
        break
if not chosen:
    print("null")
    sys.exit(0)
name = str(chosen.get("name") or "")
base = str(chosen.get("base_name") or "")
if not base:
    base = name[5:] if name.startswith("crew-") else name
remote_url = None
url_file = os.path.join(state_dir, f"{m}.remote-url")
if os.path.isfile(url_file):
    try:
        u = json.load(open(url_file, encoding="utf-8"))
        if isinstance(u, dict) and u.get("name") == name and u.get("url"):
            remote_url = u["url"]
    except Exception:
        pass
if remote_url is None:
    st_file = os.path.join(state_dir, "status.json")
    if os.path.isfile(st_file):
        try:
            st = json.load(open(st_file, encoding="utf-8"))
            for row in st.get("machines") or []:
                ag = row.get("agent") if isinstance(row, dict) else None
                if row.get("machine") == m and isinstance(ag, dict) and ag.get("name") == name and ag.get("remoteUrl"):
                    remote_url = ag["remoteUrl"]
                    break
        except Exception:
            pass
out = {
    "name": name,
    "baseName": base,
    "status": str(chosen.get("status") or ""),
    "context": str(chosen.get("status_context") or ""),
    "detail": str(chosen.get("status_detail") or ""),
    "ageSeconds": int(chosen.get("status_age_seconds") or 0),
    "unread": int(chosen.get("unread_count") or 0),
    "dir": str(chosen.get("directory") or ""),
    "remoteUrl": remote_url,
}
print(json.dumps(out, ensure_ascii=False))
' "$m" "$STATE_DIR"
}

# 找到机器上的 crew agent（找不到退出 6，远端失败退出 9），输出 "name\tbaseName\tstatus"
require_crew_agent() {
  local m=$1 raw parsed
  ensure_not_cooldown "$m"
  if ! raw=$(remote "$m" "hcom list --json" 2>/dev/null); then
    say_err "连不上 $m 或远端 hcom list 失败"
    exit 9
  fi
  parsed=$(printf '%s' "$raw" | parse_crew_agent "$m")
  if [ "$parsed" = "null" ] || [ -z "$parsed" ]; then
    say_err "$m 上没有正在运行的 crew agent"
    exit 6
  fi
  printf '%s' "$parsed"
}

cmd_status() {
  local want_json=0 target='' arg
  for arg in "$@"; do
    case "$arg" in
      --json) want_json=1 ;;
      -*) die_usage "status 不认识的参数：$arg" ;;
      *)
        [ -z "$target" ] || die_usage "status 最多指定一台机器"
        check_machine "$arg"
        target=$arg
        ;;
    esac
  done

  local machines=()
  if [ -n "$target" ]; then
    machines=("$target")
  else
    machines=(li li2)
  fi

  local entries='' m info state raw ag entry
  for m in "${machines[@]}"; do
    info=$(get_machine_info "$m")
    state=$(printf '%s' "$info" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("state","unknown"))')
    ag='null'
    if [ "$state" = "running" ]; then
      if raw=$(remote "$m" "hcom list --json" 2>/dev/null); then
        ag=$(printf '%s' "$raw" | parse_crew_agent "$m")
      fi
    fi
    entry=$(python3 -c '
import json, sys
info = json.loads(sys.argv[1])
ag = json.loads(sys.argv[2])
if isinstance(ag, dict):
    ag = {k: ag[k] for k in ("name", "status", "context", "detail", "ageSeconds", "unread", "dir", "remoteUrl")}
info["agent"] = ag
print(json.dumps(info, ensure_ascii=False))
' "$info" "$ag")
    entries="${entries}${entry}"$'\n'
  done

  local out_json merged_json
  out_json=$(printf '%s' "$entries" | python3 -c '
import datetime, json, sys
rows = [json.loads(l) for l in sys.stdin if l.strip()]
at = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
print(json.dumps({"at": at, "machines": rows}, ensure_ascii=False))
')

  # 写入 $STATE_DIR/status.json：查单台时与已有缓存合并，保证状态条不丢另一台
  merged_json=$(python3 -c '
import json, os, sys
out = json.loads(sys.argv[1])
state_dir = sys.argv[2]
st_file = os.path.join(state_dir, "status.json")
by_m = {}
if len(out["machines"]) < 2 and os.path.isfile(st_file):
    try:
        old = json.load(open(st_file, encoding="utf-8"))
        for row in old.get("machines") or []:
            if isinstance(row, dict) and row.get("machine") in ("li", "li2"):
                by_m[row["machine"]] = row
    except Exception:
        pass
for row in out["machines"]:
    by_m[row["machine"]] = row
ordered = [by_m[m] for m in ("li", "li2") if m in by_m]
print(json.dumps({"at": out["at"], "machines": ordered}, ensure_ascii=False))
' "$out_json" "$STATE_DIR")
  atomic_write "$STATE_DIR/status.json" "${merged_json}"$'\n'

  if [ "$want_json" = 1 ]; then
    printf '%s\n' "$out_json"
    return 0
  fi

  printf '%s' "$out_json" | python3 -c '
import datetime, json, sys
d = json.load(sys.stdin)
def ago(sec):
    s = max(0, int(sec or 0))
    if s < 60: return "刚才"
    if s < 3600: return f"{s // 60} 分钟前"
    return f"{s // 3600} 小时前"
def ctx_label(ctx):
    c = str(ctx or "")
    if c in ("tool:run_command", "tool:Bash"): return "跑命令"
    if c == "tool:read_file": return "读文件"
    if c in ("tool:edit_file", "tool:write_file", "tool:replace_file_content", "tool:multi_replace_file_content"): return "改文件"
    if c.startswith("deliver:"): return "收消息"
    if c.startswith("tool:"): return c[5:]
    return c
def bj_hm(iso):
    try:
        dt = datetime.datetime.fromisoformat(iso.replace("Z", "+00:00"))
        if dt.tzinfo is None: dt = dt.replace(tzinfo=datetime.timezone.utc)
        return dt.astimezone(datetime.timezone(datetime.timedelta(hours=8))).strftime("%H:%M")
    except Exception:
        return str(iso)
for row in d.get("machines") or []:
    m = row["machine"]
    st = row["state"]
    if st == "cooldown":
        cd = row.get("cooldownUntil")
        print(f"{m}：冷却到 {bj_hm(cd)}")
    elif st == "paused":
        print(f"{m}：睡着")
    elif st == "stopped":
        print(f"{m}：已关机")
    elif st == "unknown":
        print(f"{m}：状态未知")
    elif st == "running":
        ag = row.get("agent")
        if not ag:
            print(f"{m}：在线（无 crew agent）")
        else:
            ast = ag.get("status") or ""
            when = ago(ag.get("ageSeconds"))
            if ast == "active":
                cl = ctx_label(ag.get("context"))
                if cl:
                    print(f"{m}：干活中（{cl}）· {when}")
                else:
                    print(f"{m}：干活中 · {when}")
            elif ast == "listening":
                print(f"{m}：空闲 · {when}")
            elif ast == "blocked":
                print(f"{m}：等审批 · {when}")
            else:
                label = ast or "在线"
                print(f"{m}：{label} · {when}")
'
}

cmd_screen() {
  local want_json=0 m='' arg
  for arg in "$@"; do
    case "$arg" in
      --json) want_json=1 ;;
      -*) die_usage "screen 不认识的参数：$arg" ;;
      *)
        [ -z "$m" ] || die_usage "screen 只需指定一台机器"
        check_machine "$arg"
        m=$arg
        ;;
    esac
  done
  [ -n "$m" ] || die_usage "screen 需要指定机器名（li 或 li2）"

  local ag name raw qname
  ag=$(require_crew_agent "$m")
  name=$(printf '%s' "$ag" | python3 -c 'import json,sys; print(json.load(sys.stdin)["name"])')
  printf -v qname '%q' "$name"
  if ! raw=$(remote "$m" "hcom term $qname --json" 2>/dev/null); then
    say_err "读取 $m 终端画面失败"
    exit 9
  fi
  if [ "$want_json" = 1 ]; then
    printf '%s\n' "$raw"
    return 0
  fi
  printf '%s' "$raw" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.stderr.write("终端画面不是有效 JSON\n")
    sys.exit(9)
lines = d.get("lines")
if not isinstance(lines, list):
    sys.stderr.write("终端画面缺少 lines 字段\n")
    sys.exit(9)
for line in lines:
    print(str(line).rstrip(" \t\r"))
'
}

cmd_log() {
  local m='' last=20 since='' mark=0 want_json=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --last)
        [ $# -ge 2 ] || die_usage "--last 需要数字"
        if ! is_uint "$2" || [ "$2" -le 0 ]; then die_usage "--last 应为正整数：$2"; fi
        last=$2; shift 2 ;;
      --since)
        [ $# -ge 2 ] || die_usage "--since 需要事件号"
        is_uint "$2" || die_usage "--since 应为非负整数：$2"
        since=$2; shift 2 ;;
      --mark) mark=1; shift ;;
      --json) want_json=1; shift ;;
      -*) die_usage "log 不认识的参数：$1" ;;
      *)
        [ -z "$m" ] || die_usage "log 只需指定一台机器"
        check_machine "$1"
        m=$1; shift ;;
    esac
  done
  [ -n "$m" ] || die_usage "log 需要指定机器名（li 或 li2）"

  local ag name base sql qsql raw
  ag=$(require_crew_agent "$m")
  name=$(printf '%s' "$ag" | python3 -c 'import json,sys; print(json.load(sys.stdin)["name"])')
  base=$(printf '%s' "$ag" | python3 -c 'import json,sys; print(json.load(sys.stdin)["baseName"])')
  case "$base" in
    ''|*[!A-Za-z0-9_-]*) say_err "远端 agent 名称异常：$base"; exit 9 ;;
  esac

  sql="(instance = '$base' OR (type = 'message' AND (msg_from = '$base' OR EXISTS (SELECT 1 FROM json_each(msg_delivered_to) WHERE value = '$base') OR EXISTS (SELECT 1 FROM json_each(msg_mentions) WHERE value = '$base'))))"
  if [ -n "$since" ]; then
    sql="$sql AND id > $since"
  fi
  printf -v qsql '%q' "$sql"
  if ! raw=$(remote "$m" "hcom events --last $last --sql $qsql" 2>/dev/null); then
    say_err "读取 $m 动作记录失败"
    exit 9
  fi

  if [ "$mark" = 1 ]; then
    local max_id
    max_id=$(printf '%s' "$raw" | python3 -c '
import json, sys
mx = None
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    try:
        ev = json.loads(line)
        i = ev.get("id")
        if isinstance(i, int) and (mx is None or i > mx):
            mx = i
    except Exception:
        pass
if mx is not None:
    print(mx)
')
    if [ -n "$max_id" ]; then
      atomic_write "$STATE_DIR/$m.last-id" "${max_id}"$'\n'
    fi
  fi

  if [ "$want_json" = 1 ]; then
    if [ -n "$raw" ]; then
      printf '%s\n' "$raw"
    fi
    return 0
  fi

  printf '%s' "$raw" | python3 -c '
import datetime, json, sys
agent_name, base_name = sys.argv[1], sys.argv[2]
def bj_hm(ts):
    if not ts: return "--:--"
    try:
        dt = datetime.datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=datetime.timezone.utc)
        return dt.astimezone(datetime.timezone(datetime.timedelta(hours=8))).strftime("%H:%M")
    except Exception:
        return str(ts)[:5]
def one_line(s):
    return " ".join(str(s or "").splitlines()).strip()
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    try:
        ev = json.loads(line)
    except Exception:
        continue
    hm = bj_hm(ev.get("ts"))
    et = ev.get("type")
    data = ev.get("data") or {}
    inst = str(ev.get("instance") or "")
    if et == "message":
        sender = str(data.get("from") or inst)
        text = one_line(data.get("text"))
        if inst in (base_name, agent_name) or sender in (base_name, agent_name):
            mentions = data.get("mentions") or []
            target = mentions[0] if isinstance(mentions, list) and mentions else "dsh"
            print(f"{hm} 发给 {target}：{text}")
        else:
            print(f"{hm} 收到 {sender}：{text}")
    elif et == "status":
        st = str(data.get("status") or "")
        ctx = str(data.get("context") or "")
        det = one_line(data.get("detail"))
        if st == "listening":
            print(f"{hm} 空闲")
        elif st == "blocked":
            print(f"{hm} 等审批：{det}" if det else f"{hm} 等审批")
        elif ctx in ("tool:run_command", "tool:Bash"):
            print(f"{hm} 跑命令：{det}" if det else f"{hm} 跑命令")
        elif ctx == "tool:read_file":
            print(f"{hm} 读文件：{det}" if det else f"{hm} 读文件")
        elif ctx in ("tool:edit_file", "tool:write_file", "tool:replace_file_content", "tool:multi_replace_file_content"):
            print(f"{hm} 改文件：{det}" if det else f"{hm} 改文件")
        elif ctx.startswith("deliver:"):
            print(f"{hm} 收到消息（{ctx[8:]}）")
        elif ctx.startswith("tool:"):
            tn = ctx[5:]
            print(f"{hm} {tn}：{det}" if det else f"{hm} {tn}")
        else:
            print(f"{hm} 干活中：{det}" if det else f"{hm} 干活中")
    elif et == "life":
        act = str(data.get("action") or "")
        if act in ("started", "ready"):
            print(f"{hm} 已启动")
        elif act == "stopped":
            print(f"{hm} 已停止")
        elif act == "launch_blocked":
            print(f"{hm} 启动被卡住")
        else:
            print(f"{hm} 生命周期：{act}")
' "$name" "$base"
}

usage() {
  cat <<'EOF'
用法：crew <子命令> [参数...]
  crew status [li|li2] [--json]
  crew screen <li|li2> [--json]
  crew log <li|li2> [--last N] [--since ID] [--mark] [--json]
EOF
}

main() {
  local sub=${1:-}
  [ -n "$sub" ] || { usage >&2; exit 2; }
  shift
  case "$sub" in
    status) cmd_status "$@" ;;
    screen) cmd_screen "$@" ;;
    log) cmd_log "$@" ;;
    -h|--help|help) usage ;;
    *) die_usage "不认识的子命令：$sub" ;;
  esac
}

main "$@"
