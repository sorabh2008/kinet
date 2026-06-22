// Validators for .env / .env.* files — run regardless of stack

const KEY_VALUE_RE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/;

const SUSPICIOUS_KEY_RE = /(SECRET|TOKEN|API[_-]?KEY|PASSWORD|PRIVATE[_-]?KEY|ACCESS[_-]?KEY|CREDENTIAL|CLIENT[_-]?SECRET|AUTH)/i;

const PLACEHOLDER_RE = /^(changeme|change.?me|replace.?me|your[-_].*|x{3,}|<.*>|\$\{.*\}|example|placeholder|todo|fixme|none|null|undefined|test|dummy)$/i;

const PROVIDER_PATTERNS = [
  { re: /(?:AKIA|ASIA|AROA)[A-Z0-9]{16}/, msg: 'AWS access key pattern detected' },
  { re: /sk_live_[0-9a-zA-Z]{16,}/, msg: 'Stripe live secret key detected' },
  { re: /xox[baprs]-[0-9A-Za-z-]{10,}/, msg: 'Slack token detected' },
  { re: /ghp_[0-9A-Za-z]{36}/, msg: 'GitHub personal access token detected' },
  { re: /-----BEGIN (?:RSA|EC|OPENSSH|PGP) PRIVATE KEY-----/, msg: 'Private key in env file' },
];

export const envValidators = [
  {
    id: 'env/no-secrets-in-env-file',
    lang: 'env',
    check(content, file) {
      if (!isEnvFile(file)) return [];
      const violations = [];
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*#/.test(line) || !line.trim()) continue;

        for (const { re, msg } of PROVIDER_PATTERNS) {
          if (re.test(line)) {
            violations.push({ rule: 'env/no-secrets-in-env-file', severity: 'error', line: i + 1, message: msg, suggestion: 'Remove from the env file and rotate the credential — use a secrets manager or an untracked .env.local' });
          }
        }

        const m = line.match(KEY_VALUE_RE);
        if (!m) continue;
        const [, key, rawValue] = m;
        const value = rawValue.replace(/^["']|["']$/g, '').trim();
        if (!value || PLACEHOLDER_RE.test(value)) continue;
        if (SUSPICIOUS_KEY_RE.test(key) && value.length >= 8) {
          violations.push({ rule: 'env/no-secrets-in-env-file', severity: 'error', line: i + 1, message: `"${key}" looks like a real secret value committed to an env file`, suggestion: 'Move secret values out of tracked env files — use .env.local (gitignored) or a secrets manager' });
        }
      }
      return violations;
    },
  },
  {
    id: 'env/file-should-not-be-tracked',
    lang: 'env',
    check(content, file) {
      if (!isEnvFile(file)) return [];
      if (/\.env\.(example|sample|template)$/.test(file)) return [];
      return [{ rule: 'env/file-should-not-be-tracked', severity: 'warning', line: 1, message: `${file} is an env file — verify it is gitignored and not meant to be committed`, suggestion: 'Add it to .gitignore; commit a .env.example with placeholder values instead' }];
    },
  },
];

function isEnvFile(file) {
  const base = file.split('/').pop();
  return base === '.env' || base.startsWith('.env.');
}
