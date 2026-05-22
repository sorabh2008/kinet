// Validators that apply to both JS/TS and Java files

export const commonValidators = [
  {
    id: 'no-hardcoded-secrets',
    lang: null,
    check(content, file) {
      const violations = [];
      const lines = content.split('\n');
      const patterns = [
        { re: /(?:password|passwd|secret|api.?key|token)\s*[:=]\s*["'][^"']{6,}["']/i, msg: 'Hardcoded secret or credential' },
        { re: /-----BEGIN (?:RSA|EC|OPENSSH) PRIVATE KEY-----/, msg: 'Private key in source code' },
        { re: /(?:AKIA|ASIA|AROA)[A-Z0-9]{16}/, msg: 'AWS access key pattern detected' },
      ];
      for (let i = 0; i < lines.length; i++) {
        for (const { re, msg } of patterns) {
          if (re.test(lines[i])) {
            violations.push({ rule: 'no-hardcoded-secrets', severity: 'error', line: i + 1, message: msg, suggestion: 'Use environment variables or a secrets manager' });
          }
        }
      }
      return violations;
    },
  },
  {
    id: 'no-console-log-prod',
    lang: 'js',
    check(content, file) {
      if (file.includes('.test.') || file.includes('.spec.')) return [];
      const violations = [];
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/console\.(log|debug)\(/.test(lines[i]) && !/\/\/\s*kinet:allow/.test(lines[i])) {
          violations.push({ rule: 'no-console-log-prod', severity: 'warning', line: i + 1, message: 'console.log/debug in production code', suggestion: 'Remove or replace with a structured logger' });
        }
      }
      return violations;
    },
  },
  {
    id: 'no-todo-without-ticket',
    lang: null,
    check(content, file) {
      const violations = [];
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/TODO(?!\s*\[#?\w+[-_]\d+\])/i.test(lines[i])) {
          violations.push({ rule: 'no-todo-without-ticket', severity: 'warning', line: i + 1, message: 'TODO without a ticket reference', suggestion: 'Add a ticket reference: TODO [PROJ-123]' });
        }
      }
      return violations;
    },
  },
];
