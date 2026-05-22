import { join } from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { RulesEngine } from '../rules/engine.js';
import { KINET_DIR } from '../utils/paths.js';
import { loadConfig } from '../utils/config.js';

export async function runValidate(opts) {
  const cwd = process.cwd();
  const config = loadConfig(cwd);

  if (!config) {
    console.error(chalk.red('KINET not initialised. Run `kinet init` first.'));
    process.exit(1);
  }

  const spinner = ora('Scanning for rule violations...').start();
  const rules = new RulesEngine(join(cwd, KINET_DIR));
  const report = await rules.validate(cwd, { autoFix: opts.fix });
  spinner.stop();

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  printReport(report);

  if (report.violations.length > 0 && !opts.fix) {
    process.exit(1);
  }
}

function printReport(report) {
  const { violations, warnings, fixed, scanned } = report;

  console.log(chalk.cyan(`\n  KINET Validation Report\n`));
  console.log(`  Files scanned: ${scanned}`);

  if (fixed?.length) {
    console.log(`\n  ${chalk.green('Auto-fixed:')} ${fixed.length}`);
    for (const f of fixed) {
      console.log(`  ${chalk.green('✓')} ${f.file}: ${f.rule}`);
    }
  }

  if (warnings.length) {
    console.log(`\n  ${chalk.yellow('Warnings:')} ${warnings.length}`);
    for (const w of warnings) {
      console.log(`  ${chalk.yellow('⚠')}  ${w.file}:${w.line}  ${chalk.dim(w.rule)}`);
      console.log(`     ${w.message}`);
    }
  }

  if (violations.length) {
    console.log(`\n  ${chalk.red('Violations:')} ${violations.length}`);
    for (const v of violations) {
      console.log(`  ${chalk.red('✗')} ${v.file}:${v.line}  ${chalk.bold(v.rule)}`);
      console.log(`     ${v.message}`);
      if (v.suggestion) console.log(`     ${chalk.dim('→ ' + v.suggestion)}`);
    }
    console.log(`\n  Run ${chalk.cyan('kinet validate --fix')} to attempt auto-remediation.\n`);
  } else {
    console.log(`\n  ${chalk.green('✓ No violations found.')}\n`);
  }
}
