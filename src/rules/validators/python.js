// Python-specific rule validators

export const pythonValidators = [
  {
    id: 'python/no-bare-except',
    lang: 'python',
    check(content, file) {
      if (!file.endsWith('.py')) return [];
      const violations = [];
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/^\s*except\s*:\s*$/.test(lines[i])) {
          violations.push({ rule: 'python/no-bare-except', severity: 'error', line: i + 1, message: 'Bare `except:` catches everything, including KeyboardInterrupt/SystemExit', suggestion: 'Catch a specific exception type, e.g. `except ValueError:`' });
        }
      }
      return violations;
    },
  },
  {
    id: 'python/no-mutable-default-args',
    lang: 'python',
    check(content, file) {
      if (!file.endsWith('.py')) return [];
      const violations = [];
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/def\s+\w+\([^)]*=\s*(\[\]|\{\}|set\(\))/.test(lines[i])) {
          violations.push({ rule: 'python/no-mutable-default-args', severity: 'error', line: i + 1, message: 'Mutable default argument (list/dict/set) is shared across all calls', suggestion: 'Default to `None` and create the mutable value inside the function body' });
        }
      }
      return violations;
    },
  },
  {
    id: 'python/no-print-in-production',
    lang: 'python',
    check(content, file) {
      if (!file.endsWith('.py')) return [];
      if (file.includes('test_') || file.endsWith('_test.py') || file.includes('/scripts/')) return [];
      const violations = [];
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/^\s*print\(/.test(lines[i]) && !/#\s*kinet:allow/.test(lines[i])) {
          violations.push({ rule: 'python/no-print-in-production', severity: 'warning', line: i + 1, message: 'print() in production code', suggestion: 'Use the `logging` module instead' });
        }
      }
      return violations;
    },
  },
  {
    id: 'python/type-hints-on-public-functions',
    lang: 'python',
    check(content, file) {
      if (!file.endsWith('.py')) return [];
      const violations = [];
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^\s*def\s+([a-zA-Z]\w*)\s*\(([^)]*)\)\s*:/);
        if (!m) continue;
        const [, name, params] = m;
        if (name.startsWith('_')) continue;
        const hasReturnHint = /\)\s*->\s*\S+\s*:/.test(lines[i]);
        const realParams = params.split(',').map(p => p.trim()).filter(p => p && p !== 'self' && p !== 'cls');
        if (!hasReturnHint && realParams.length) {
          violations.push({ rule: 'python/type-hints-on-public-functions', severity: 'warning', line: i + 1, message: `Public function \`${name}\` has no return type hint`, suggestion: 'Add type hints to public function signatures for readability and static analysis' });
        }
      }
      return violations;
    },
  },
  {
    id: 'python/no-sql-string-concat',
    lang: 'python',
    check(content, file) {
      if (!file.endsWith('.py')) return [];
      const violations = [];
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/(execute|executemany)\(\s*(f["']|["'][^"']*["']\s*%|["'][^"']*["']\s*\+)/.test(lines[i])) {
          violations.push({ rule: 'python/no-sql-string-concat', severity: 'error', line: i + 1, message: 'SQL query built via string formatting/concatenation — risk of SQL injection', suggestion: 'Use parameterized queries: cursor.execute(query, (param,))' });
        }
      }
      return violations;
    },
  },
];
