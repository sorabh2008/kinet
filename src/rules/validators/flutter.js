// Flutter/Dart-specific rule validators

export const flutterValidators = [
  {
    id: 'flutter/no-print-in-production',
    lang: 'dart',
    check(content, file) {
      if (!file.endsWith('.dart')) return [];
      if (file.endsWith('_test.dart')) return [];
      const violations = [];
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/(?<!debug)\bprint\(/.test(lines[i]) && !/\/\/\s*kinet:allow/.test(lines[i])) {
          violations.push({ rule: 'flutter/no-print-in-production', severity: 'warning', line: i + 1, message: 'print() in production code', suggestion: 'Use `debugPrint()` (rate-limited) or a logging package instead' });
        }
      }
      return violations;
    },
  },
  {
    id: 'flutter/no-http-in-widget',
    lang: 'dart',
    check(content, file) {
      if (!file.endsWith('.dart')) return [];
      if (!/extends\s+(Stateless|Stateful)Widget/.test(content)) return [];
      const violations = [];
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/\b(http\.(get|post|put|delete|patch)\(|Dio\(\)\.|client\.(get|post)\()/.test(lines[i]) && !/\/\/\s*kinet:allow/.test(lines[i])) {
          violations.push({ rule: 'flutter/no-http-in-widget', severity: 'warning', line: i + 1, message: 'Direct HTTP call inside a Widget class', suggestion: 'Move network calls to a repository/service class and expose results via a provider/bloc/view-model' });
        }
      }
      return violations;
    },
  },
  {
    id: 'flutter/no-buildcontext-after-async-gap',
    lang: 'dart',
    check(content, file) {
      if (!file.endsWith('.dart')) return [];
      const violations = [];
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/^\s*await\s+/.test(lines[i])) {
          const block = lines.slice(i + 1, i + 6).join('\n');
          if (/\b(Navigator\.of\(context\)|ScaffoldMessenger\.of\(context\)|Theme\.of\(context\)|context\.\w+)/.test(block) && !/if\s*\(\s*!?\s*mounted\s*\)/.test(block)) {
            violations.push({ rule: 'flutter/no-buildcontext-after-async-gap', severity: 'error', line: i + 1, message: 'BuildContext used after an `await` without checking `mounted` first', suggestion: 'Guard with `if (!mounted) return;` before using `context` after an async gap' });
          }
        }
      }
      return violations;
    },
  },
  {
    id: 'flutter/no-empty-catch',
    lang: 'dart',
    check(content, file) {
      if (!file.endsWith('.dart')) return [];
      const violations = [];
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(lines[i]) || (/catch\s*\([^)]*\)\s*\{/.test(lines[i]) && /^\s*\}/.test(lines[i + 1] || ''))) {
          violations.push({ rule: 'flutter/no-empty-catch', severity: 'error', line: i + 1, message: 'Empty catch block silently swallows the error', suggestion: 'Log the error or rethrow — never swallow exceptions silently' });
        }
      }
      return violations;
    },
  },
];
