// React/TypeScript-specific rule validators

export const reactValidators = [
  {
    id: 'react/no-any',
    lang: 'js',
    check(content, file) {
      if (!file.endsWith('.ts') && !file.endsWith('.tsx')) return [];
      const violations = [];
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/:\s*any\b/.test(lines[i]) && !/\/\/\s*kinet:allow/.test(lines[i])) {
          violations.push({ rule: 'react/no-any', severity: 'warning', line: i + 1, message: 'Explicit `any` type weakens type safety', suggestion: 'Use `unknown` and narrow the type, or define a proper interface' });
        }
      }
      return violations;
    },
  },
  {
    id: 'react/no-inline-styles',
    lang: 'js',
    check(content, file) {
      if (!file.endsWith('.tsx') && !file.endsWith('.jsx')) return [];
      const violations = [];
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/style=\{\{/.test(lines[i]) && !/kinet:allow/.test(lines[i])) {
          violations.push({ rule: 'react/no-inline-styles', severity: 'warning', line: i + 1, message: 'Inline styles — use CSS classes or design tokens', suggestion: 'Move to a CSS module, Tailwind class, or styled component' });
        }
      }
      return violations;
    },
  },
  {
    id: 'react/no-useeffect-deps-missing',
    lang: 'js',
    check(content, file) {
      if (!file.endsWith('.tsx') && !file.endsWith('.jsx') && !file.endsWith('.ts') && !file.endsWith('.js')) return [];
      const violations = [];
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        // Detect useEffect with empty array when function body references outer vars — heuristic only
        if (/useEffect\(.*\[\]\)/.test(lines[i])) {
          violations.push({ rule: 'react/no-useeffect-deps-missing', severity: 'warning', line: i + 1, message: 'useEffect with empty deps array — verify no dependencies are missing', suggestion: 'Use eslint-plugin-react-hooks exhaustive-deps to verify' });
        }
      }
      return violations;
    },
  },
  {
    id: 'react/key-in-lists',
    lang: 'js',
    check(content, file) {
      if (!file.endsWith('.tsx') && !file.endsWith('.jsx')) return [];
      const violations = [];
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/\.map\(/.test(lines[i]) && !lines[i].includes('key=')) {
          // Only flag if the next few lines don't have a key prop
          const block = lines.slice(i, i + 5).join('\n');
          if (!block.includes('key=')) {
            violations.push({ rule: 'react/key-in-lists', severity: 'warning', line: i + 1, message: 'Array.map() rendering without `key` prop detected nearby', suggestion: 'Add a stable, unique `key` prop to each mapped element' });
          }
        }
      }
      return violations;
    },
  },
  {
    id: 'react/no-direct-dom-mutation',
    lang: 'js',
    check(content, file) {
      if (!file.endsWith('.tsx') && !file.endsWith('.jsx')) return [];
      const violations = [];
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/document\.querySelector|getElementById|innerHTML\s*=/.test(lines[i])) {
          violations.push({ rule: 'react/no-direct-dom-mutation', severity: 'error', line: i + 1, message: 'Direct DOM manipulation in a React component', suggestion: 'Use refs (useRef) or React state instead' });
        }
      }
      return violations;
    },
  },
  {
    id: 'react/services-not-in-components',
    lang: 'js',
    check(content, file) {
      if (!file.includes('/components/') && !file.includes('/pages/')) return [];
      const violations = [];
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/fetch\(|axios\.(get|post|put|delete|patch)\(/.test(lines[i])) {
          violations.push({ rule: 'react/services-not-in-components', severity: 'warning', line: i + 1, message: 'Direct HTTP call in a component — move to services/ or a custom hook', suggestion: 'Extract to src/services/ or a custom hook in src/hooks/' });
        }
      }
      return violations;
    },
  },
];
