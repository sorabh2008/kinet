import { join, relative, extname } from 'path';
import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from 'fs';
import { glob } from 'glob';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUILTIN_RULES_DIR = join(__dirname, '../../templates/rules');

export class RulesEngine {
  constructor(kinetDir) {
    this.kinetDir = kinetDir;
    this.rulesDir = join(kinetDir, 'rules');
  }

  async install(stack, customRuleIds = []) {
    mkdirSync(this.rulesDir, { recursive: true });

    const toInstall = ['common', stack];
    if (stack === 'fullstack') toInstall.push('react', 'java');
    for (const id of customRuleIds) toInstall.push(id);

    for (const id of toInstall) {
      const src = join(BUILTIN_RULES_DIR, `${id}.md`);
      const dst = join(this.rulesDir, `${id}.md`);
      if (existsSync(src) && !existsSync(dst)) {
        writeFileSync(dst, readFileSync(src, 'utf8'));
      }
    }

    // Write rule index
    this._writeIndex(toInstall);
  }

  getSummary() {
    const indexPath = join(this.rulesDir, 'index.json');
    if (!existsSync(indexPath)) return [];
    try {
      const index = JSON.parse(readFileSync(indexPath, 'utf8'));
      return index.rules || [];
    } catch {
      return [];
    }
  }

  async validate(cwd, opts = {}) {
    const report = { violations: [], warnings: [], fixed: [], scanned: 0 };

    const validators = await this._loadValidators();
    const allFiles = await glob('**/*.{ts,tsx,js,jsx,java}', {
      cwd,
      ignore: ['node_modules/**', '.kinet/**', 'dist/**', 'target/**', 'build/**'],
    });

    report.scanned = allFiles.length;

    for (const relFile of allFiles) {
      const absFile = join(cwd, relFile);
      const content = readFileSafe(absFile);
      if (!content) continue;

      const ext = extname(relFile);
      const lang = ['.ts', '.tsx', '.js', '.jsx'].includes(ext) ? 'js' : 'java';

      for (const validator of validators) {
        if (validator.lang && validator.lang !== lang) continue;

        const results = validator.check(content, relFile, { cwd });
        for (const result of results) {
          const entry = { file: relFile, ...result };
          if (result.severity === 'error') {
            if (opts.autoFix && result.fix) {
              const fixed = result.fix(content);
              writeFileSync(absFile, fixed);
              report.fixed.push({ file: relFile, rule: result.rule });
            } else {
              report.violations.push(entry);
            }
          } else {
            report.warnings.push(entry);
          }
        }
      }
    }

    return report;
  }

  async _loadValidators() {
    const { reactValidators } = await import('./validators/react.js');
    const { javaValidators } = await import('./validators/java.js');
    const { commonValidators } = await import('./validators/common.js');
    return [...commonValidators, ...reactValidators, ...javaValidators];
  }

  _writeIndex(ruleIds) {
    const rules = ruleIds.flatMap(id => {
      const path = join(this.rulesDir, `${id}.md`);
      if (!existsSync(path)) return [];
      const content = readFileSync(path, 'utf8');
      return parseRulesFromMarkdown(id, content);
    });

    writeFileSync(
      join(this.rulesDir, 'index.json'),
      JSON.stringify({ rules, updatedAt: new Date().toISOString() }, null, 2),
    );
  }
}

function parseRulesFromMarkdown(id, md) {
  // Extract rule definitions from markdown headers
  const rules = [];
  const sections = md.split(/^## /m).filter(Boolean);
  for (const section of sections) {
    const lines = section.trim().split('\n');
    const name = lines[0]?.trim();
    if (!name || name === 'Overview') continue;
    const description = lines.slice(1).find(l => l.trim())?.trim() || '';
    const scopeMatch = md.match(/\*\*Applies to:\*\* ([^\n]+)/);
    rules.push({
      id: `${id}/${name.toLowerCase().replace(/\s+/g, '-')}`,
      name,
      description,
      scope: scopeMatch?.[1] || id,
    });
  }
  return rules;
}

function readFileSafe(path) {
  try { return readFileSync(path, 'utf8'); } catch { return null; }
}
