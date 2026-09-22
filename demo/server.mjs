// Demo server for the autorestic + Jev lab.
// Serves the single-page UI and a tiny JSON/SSE API that reads logs/ and runs scenarios.
// No dependencies. Start with: npm run demo   (needs AI_GATEWAY_API_KEY in the environment)
import http from 'node:http';
import { readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.DEMO_PORT || 8600);
const LOGS = path.join(LAB, 'logs');

// Catalogue of scenarios: what breaks, where, and the cause Jev is expected to return.
const SCENARIOS = [
  { id: 'backend_down', title: 'Backend down', location: 'docs-remote', expected: 'backend_unreachable',
    breaks: 'rest-server container stopped; comes back after 18 s. Wrapper runs with a 15 s timeout.',
    expect_action: 'retry_later' },
  { id: 'locked', title: 'Foreign lock', location: 'docs-local', expected: 'locked',
    breaks: 'A container on another hostname runs restic check and is paused while holding the exclusive lock.',
    expect_action: 'unlock_and_retry' },
  { id: 'wrong_password', title: 'Wrong repository key', location: 'docs-remote', expected: 'auth',
    breaks: 'The backend key in .autorestic.yml is replaced by a wrong one for the duration of the run.',
    expect_action: 'alert_critical' },
  { id: 'disk_full', title: 'Backend out of space', location: 'docs-small', expected: 'disk_full',
    breaks: 'rest-server-small enforces a 5 MB quota; the data is 15 MB, so the server answers 507.',
    expect_action: 'alert_critical' },
  { id: 'permissions', title: 'Unreadable source file', location: 'docs-local', expected: 'permissions',
    breaks: 'chmod 000 on data/media/photo-1.bin. restic exits 3, autorestic reports an error.',
    expect_action: 'alert' },
  { id: 'repo_corrupt', title: 'Damaged repository', location: 'docs-local', expected: 'repo_corrupt',
    breaks: 'The repository config file is moved away before the backup.',
    expect_action: 'alert' },
  { id: 'config_error', title: 'Invalid configuration', location: 'docs-nope', expected: 'config_error',
    breaks: 'The wrapper is asked to back up a location that does not exist in the YAML.',
    expect_action: 'alert' },
];
const LOCATIONS = ['docs-local', 'docs-remote', 'docs-small'];

let running = null; // { target, startedAt }

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};
const readLines = (file, n = 200) => {
  const p = path.join(LOGS, file);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').filter(Boolean).slice(-n);
};
const safeLogName = (name) => {
  const base = path.basename(String(name || ''));
  return base && base === name && !base.startsWith('.') ? base : null;
};

function containers() {
  try {
    const out = execFileSync('docker', ['ps', '-a', '--filter', 'name=lab-rest', '--format', '{{.Names}}\t{{.State}}'], { encoding: 'utf8' });
    return Object.fromEntries(out.trim().split('\n').filter(Boolean).map((l) => l.split('\t')));
  } catch { return {}; }
}
async function credits() {
  const key = process.env.AI_GATEWAY_API_KEY;
  if (!key) return { error: 'AI_GATEWAY_API_KEY not set' };
  try {
    const r = await fetch('https://ai-gateway.vercel.sh/v1/credits', { headers: { Authorization: `Bearer ${key}` } });
    return await r.json();
  } catch (e) { return { error: String(e) }; }
}

function runTarget(target, res) {
  if (running) { json(res, 409, { error: `already running: ${running.target}` }); return; }
  let cmd, args;
  if (target === 'all') { cmd = 'bash'; args = ['run-all.sh']; }
  else if (target.startsWith('backup:')) {
    const loc = target.slice(7);
    if (!LOCATIONS.includes(loc)) { json(res, 400, { error: 'unknown location' }); return; }
    cmd = 'bash'; args = ['backup.sh', loc];
  } else if (SCENARIOS.some((s) => s.id === target)) { cmd = 'bash'; args = [`scenarios/${target}.sh`]; }
  else { json(res, 400, { error: 'unknown target' }); return; }

  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  running = { target, startedAt: Date.now() };
  send('start', { target, cmd: [cmd, ...args].join(' ') });
  const child = spawn(cmd, args, { cwd: LAB, env: { ...process.env, PATH: `${LAB}/bin:${process.env.PATH}` } });
  const pipe = (stream) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d.toString();
      const parts = buf.split('\n'); buf = parts.pop();
      for (const line of parts) send('line', line);
    });
    stream.on('end', () => { if (buf) send('line', buf); });
  };
  pipe(child.stdout); pipe(child.stderr);
  child.on('close', (code) => {
    running = null;
    send('done', { code, ms: Date.now() - (running?.startedAt ?? Date.now()) });
    res.end();
  });
  res.on('close', () => { if (running && running.target === target && child.exitCode === null) child.kill('SIGTERM'); });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  try {
    if (p === '/' || p === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(readFileSync(path.join(LAB, 'demo', 'index.html')));
    } else if (p === '/api/scenarios') json(res, 200, { scenarios: SCENARIOS, locations: LOCATIONS });
    else if (p === '/api/status') {
      json(res, 200, { containers: containers(), credits: await credits(), running, lab: LAB,
        results: readLines('results.jsonl').length, model: 'typesafe-ai/jev' });
    } else if (p === '/api/results') json(res, 200, readLines('results.jsonl', 500).map((l) => JSON.parse(l)));
    else if (p === '/api/alerts') json(res, 200, readLines('alerts.log', 100));
    else if (p === '/api/hooks') json(res, 200, readLines('hooks.log', 100));
    else if (p === '/api/log') {
      const name = safeLogName(url.searchParams.get('name'));
      if (!name) return json(res, 400, { error: 'bad name' });
      const f = path.join(LOGS, name);
      if (!existsSync(f)) return json(res, 404, { error: 'not found' });
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(readFileSync(f, 'utf8'));
    } else if (p === '/api/run') runTarget(url.searchParams.get('target') || '', res);
    else if (p === '/api/clear' && req.method === 'POST') {
      for (const f of ['results.jsonl', 'alerts.log']) writeFileSync(path.join(LOGS, f), '');
      json(res, 200, { ok: true });
    } else json(res, 404, { error: 'not found' });
  } catch (e) { json(res, 500, { error: String(e) }); }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`autorestic + Jev demo: http://127.0.0.1:${PORT}  (lab: ${LAB})`);
  if (!process.env.AI_GATEWAY_API_KEY) console.log('WARNING: AI_GATEWAY_API_KEY is not set; triage calls will fail');
});
