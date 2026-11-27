// 调本机 crew 命令的轻量封装：支持 stdin、超时、AbortSignal，超时或取消时确保杀掉子进程。
import { spawn } from 'node:child_process';

export async function runCrew(args, opts = {}) {
  const bin = opts.bin || process.env.LIMING_CREW_BIN || 'crew';
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? Math.max(10, opts.timeoutMs) : 15_000;
  const signal = opts.signal || null;

  if (signal?.aborted) {
    return { code: -1, stdout: '', stderr: '已取消', timedOut: false, aborted: true };
  }

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let done = false;
    let timedOut = false;
    let aborted = false;
    let timer = null;
    let killTimer = null;

    const finish = (code) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve({ code, stdout, stderr, timedOut, aborted });
    };

    let child;
    try {
      child = spawn(bin, args, {
        env: opts.env || process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      finish(127);
      return;
    }

    const terminate = () => {
      try { child.kill('SIGTERM'); } catch {}
      killTimer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch {}
      }, 250);
      killTimer.unref?.();
    };

    const onAbort = () => {
      aborted = true;
      terminate();
    };

    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
    timer.unref?.();

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (stdout.length < 512 * 1024) stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 128 * 1024) stderr += chunk;
    });

    child.on('error', (err) => {
      stderr += String(err?.message || err);
      finish(127);
    });
    child.on('close', (code) => {
      finish(typeof code === 'number' ? code : -1);
    });

    try {
      if (opts.stdin != null) child.stdin.write(String(opts.stdin));
      child.stdin.end();
    } catch {}
  });
}

export async function crewJson(args, opts = {}) {
  const res = await runCrew(args, opts);
  if (res.code !== 0) return null;
  try {
    return JSON.parse(res.stdout);
  } catch {
    return null;
  }
}

export async function crewJsonl(args, opts = {}) {
  const res = await runCrew(args, opts);
  if (res.code !== 0) return null;
  const items = [];
  for (const line of res.stdout.split('\n')) {
    const s = line.trim();
    if (!s.startsWith('{')) continue;
    try {
      items.push(JSON.parse(s));
    } catch {}
  }
  return items;
}
