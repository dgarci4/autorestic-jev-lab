// Backup failure triage with Jev.
// Input: the full output of a failed `autorestic backup`.
// Output (stdout): one JSON line with the typed diagnosis and the action to take.
//
// usage: node jev/triage.mjs --location <loc> --exit <rc> --log <file>
import { readFileSync } from 'node:fs';
import { experimental_evaluate as evaluate } from 'ai';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);

const raw = readFileSync(args.log, 'utf8');
// Keep the tail of the log (where the error is) and cap its size:
// Jev has a 32k-token context and needs no more than this to decide.
const lines = raw.split('\n');
const tail = lines.slice(-80).join('\n').slice(-12000);

const state = {
  tool: 'autorestic 1.8.3 on top of restic 0.19.1',
  location: args.location,
  exit_code: Number(args.exit),
  // 124 = the wrapper killed the run on timeout while restic was retrying
  timed_out: Number(args.exit) === 124,
  output_tail: tail,
};

const t0 = performance.now();
const result = await evaluate({
  model: 'typesafe-ai/jev',
  state,
  questions: {
    cause: {
      type: 'choice',
      instructions: 'Most likely root cause of the backup failure according to output_tail.',
      criteria: {
        locked: 'The repository is locked by another process (lock, "already locked", unlock).',
        backend_unreachable: 'The backend cannot be reached: connection refused, timeout, DNS, server down, 5xx.',
        auth: 'Wrong repository password, key not found, credentials rejected, 401/403.',
        disk_full: 'Out of space, quota exceeded, repository size limit, "no space left", 507, "insufficient storage".',
        permissions: 'Source files that cannot be read due to permissions (permission denied) or a missing source directory.',
        repo_corrupt: 'Damaged or incomplete repository: missing config/index, "not a repository", "unable to open config", invalid data.',
        config_error: 'autorestic configuration error: unknown location or backend, invalid YAML, bad flags.',
        unknown: 'Does not match any of the above.',
      },
    },
    // The first version asked "will an immediate retry work?" and Jev answered 0.23 with
    // the backend down: correct, but useless for deciding. The useful question is whether
    // the cause is transient, not whether an immediate retry will succeed.
    transient: {
      type: 'boolean',
      instructions: 'Is the cause of the failure transient in nature (service or network temporarily down, lock held by another process, timeout) and likely to resolve itself within minutes without anyone changing anything?',
      criteria: {
        true: 'Temporary backend outage, network issue, timeout, repository locked by another process',
        false: 'Wrong password, disk full, permissions, damaged repository, configuration error',
      },
    },
    needs_human: {
      type: 'boolean',
      instructions: 'Does a person need to intervene to fix the root cause?',
    },
    urgency: {
      type: 'score',
      instructions: 'Operational urgency of the failure for a platform team.',
      criteria: [
        'Low: transient, will resolve itself or on the next cycle',
        'Medium: review during the working day',
        'High: review today, backups are not being taken',
        'Critical: possible data loss or unusable backups, act now',
      ],
    },
  },
});
const ms = Math.round(performance.now() - t0);

const a = result.answers;
// Policy: from typed diagnosis to action. Deliberately simple and explicit.
// Retrying is cheap, so lock and backend-down always retry; Jev decides the cause
// and the escalation level, not whether a retry is worth it.
// (With "connection refused" Jev gives transient ~0.3: a defensible judgement, a dead
// service rarely comes back on its own. That is why the retry is not gated on it.)
let action;
if (a.cause.choice === 'locked') action = 'unlock_and_retry';
else if (a.cause.choice === 'backend_unreachable') action = 'retry_later';
else if (a.urgency.score >= 2.5 || (a.urgency.score >= 2 && a.needs_human.probability >= 0.7)) action = 'alert_critical';
else action = 'alert';

const decision = {
  location: args.location,
  exit_code: state.exit_code,
  cause: a.cause.choice,
  cause_probabilities: a.cause.probabilities,
  transient: a.transient.probability,
  needs_human: a.needs_human.probability,
  urgency: a.urgency.score,
  urgency_probabilities: a.urgency.probabilities,
  confidence: result.providerMetadata?.typesafe?.confidence,
  action,
  jev_ms: ms,
  tokens: result.usage.totalTokens,
  cost_usd: result.providerMetadata?.gateway?.cost,
};
console.log(JSON.stringify(decision));
