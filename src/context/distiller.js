import { join, relative, extname } from 'path';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { glob } from 'glob';
import yaml from 'js-yaml';

/**
 * Distils key context from a project directory into a structured JSON object.
 * This object drives CLAUDE.md generation and MCP context responses.
 */
export async function distillContext(cwd, stack) {
  const ctx = {
    stack,
    projectName: cwd.split('/').pop(),
    scannedAt: new Date().toISOString(),
    tech: {},
    structure: {},
    patterns: {},
    dependencies: {},
    testing: {},
    ci: {},
  };

  // Run all scanners in parallel
  const [tech, structure, patterns, deps, testing, ci] = await Promise.all([
    scanTech(cwd, stack),
    scanStructure(cwd, stack),
    scanPatterns(cwd, stack),
    scanDependencies(cwd),
    scanTesting(cwd, stack),
    scanCI(cwd),
  ]);

  ctx.tech = tech;
  ctx.structure = structure;
  ctx.patterns = patterns;
  ctx.dependencies = deps;
  ctx.testing = testing;
  ctx.ci = ci;

  return ctx;
}

async function scanTech(cwd, stack) {
  const tech = {};

  if (stack === 'react' || stack === 'fullstack') {
    const pkg = readJsonSafe(join(cwd, 'package.json'));
    if (pkg) {
      tech.nodeVersion = pkg.engines?.node;
      tech.react = pkg.dependencies?.react || pkg.peerDependencies?.react;
      tech.typescript = !!pkg.devDependencies?.typescript || existsSync(join(cwd, 'tsconfig.json'));
      tech.bundler = pkg.devDependencies?.vite ? 'vite'
        : pkg.devDependencies?.webpack ? 'webpack'
        : pkg.scripts?.build?.includes('react-scripts') ? 'cra'
        : 'unknown';
      tech.cssFramework = pkg.dependencies?.tailwindcss ? 'tailwind'
        : pkg.dependencies?.['styled-components'] ? 'styled-components'
        : pkg.dependencies?.['@mui/material'] ? 'mui'
        : 'unknown';
      tech.stateManagement = pkg.dependencies?.['@reduxjs/toolkit'] ? 'redux-toolkit'
        : pkg.dependencies?.zustand ? 'zustand'
        : pkg.dependencies?.jotai ? 'jotai'
        : 'local';
      tech.router = pkg.dependencies?.['react-router-dom'] ? 'react-router'
        : pkg.dependencies?.['@tanstack/router'] ? 'tanstack-router'
        : 'none';
    }
  }

  if (stack === 'java' || stack === 'fullstack') {
    const pom = readFileSafe(join(cwd, 'pom.xml'));
    const gradle = readFileSafe(join(cwd, 'build.gradle')) || readFileSafe(join(cwd, 'build.gradle.kts'));

    if (pom) {
      tech.buildTool = 'maven';
      tech.springBoot = /spring-boot/.test(pom);
      tech.javaVersion = extractXml(pom, 'java.version') || extractXml(pom, 'maven.compiler.source');
    } else if (gradle) {
      tech.buildTool = 'gradle';
      tech.springBoot = /spring-boot/.test(gradle);
    }

    tech.lombok = pom ? /lombok/.test(pom) : false;
    tech.mapstruct = pom ? /mapstruct/.test(pom) : false;
  }

  if (stack === 'python') {
    const pyproject = readFileSafe(join(cwd, 'pyproject.toml'));
    const requirements = readFileSafe(join(cwd, 'requirements.txt'));
    const deps = `${pyproject || ''}\n${requirements || ''}`;

    tech.packageManager = existsSync(join(cwd, 'poetry.lock')) ? 'poetry'
      : existsSync(join(cwd, 'Pipfile')) ? 'pipenv'
      : existsSync(join(cwd, 'requirements.txt')) ? 'pip'
      : 'unknown';
    tech.framework = /\bdjango\b/i.test(deps) ? 'django'
      : /\bfastapi\b/i.test(deps) ? 'fastapi'
      : /\bflask\b/i.test(deps) ? 'flask'
      : 'none';
    tech.orm = /\bsqlalchemy\b/i.test(deps) ? 'sqlalchemy'
      : tech.framework === 'django' ? 'django-orm'
      : 'none';
    tech.pythonVersion = extractToml(pyproject, 'python') || null;
  }

  if (stack === 'salesforce') {
    const sfdxProject = readJsonSafe(join(cwd, 'sfdx-project.json'));
    tech.apiVersion = sfdxProject?.sourceApiVersion || sfdxProject?.packageDirectories?.[0]?.versionNumber || null;
    tech.packageDirectories = (sfdxProject?.packageDirectories || []).map(p => p.path);
    const lwcRoot = findSfdxSubdir(cwd, 'lwc');
    const auraRoot = findSfdxSubdir(cwd, 'aura');
    tech.usesLwc = !!lwcRoot;
    tech.usesAura = !!auraRoot;
  }

  if (stack === 'node') {
    const pkg = readJsonSafe(join(cwd, 'package.json'));
    if (pkg) {
      tech.nodeVersion = pkg.engines?.node;
      tech.typescript = !!pkg.devDependencies?.typescript || existsSync(join(cwd, 'tsconfig.json'));
      tech.packageManager = existsSync(join(cwd, 'pnpm-lock.yaml')) ? 'pnpm'
        : existsSync(join(cwd, 'yarn.lock')) ? 'yarn'
        : 'npm';
      tech.framework = pkg.dependencies?.express ? 'express'
        : pkg.dependencies?.fastify ? 'fastify'
        : pkg.dependencies?.['@nestjs/core'] ? 'nestjs'
        : pkg.dependencies?.koa ? 'koa'
        : 'none';
      tech.orm = pkg.dependencies?.prisma || pkg.dependencies?.['@prisma/client'] ? 'prisma'
        : pkg.dependencies?.sequelize ? 'sequelize'
        : pkg.dependencies?.mongoose ? 'mongoose'
        : pkg.dependencies?.knex ? 'knex'
        : 'none';
    }
  }

  if (stack === 'flutter') {
    const pubspec = readYamlSafe(join(cwd, 'pubspec.yaml'));
    tech.dartSdk = pubspec?.environment?.sdk || null;
    tech.flutterSdk = pubspec?.environment?.flutter || null;
    const deps = { ...(pubspec?.dependencies || {}) };
    tech.stateManagement = deps.flutter_riverpod || deps.riverpod ? 'riverpod'
      : deps.flutter_bloc ? 'bloc'
      : deps.provider ? 'provider'
      : deps.get ? 'getx'
      : 'none';
    tech.nullSafety = !!tech.dartSdk;
  }

  return tech;
}

async function scanStructure(cwd, stack) {
  const structure = {};

  if (stack === 'react' || stack === 'fullstack') {
    const prefix = stack === 'fullstack' ? (existsSync(join(cwd, 'frontend')) ? 'frontend' : 'client') : '';
    const srcRoot = prefix ? join(cwd, prefix, 'src') : join(cwd, 'src');

    structure.reactRoot = prefix || 'root';
    structure.hasComponents = existsSync(join(srcRoot, 'components'));
    structure.hasHooks = existsSync(join(srcRoot, 'hooks'));
    structure.hasPages = existsSync(join(srcRoot, 'pages')) || existsSync(join(srcRoot, 'views'));
    structure.hasServices = existsSync(join(srcRoot, 'services')) || existsSync(join(srcRoot, 'api'));
    structure.hasStore = existsSync(join(srcRoot, 'store')) || existsSync(join(srcRoot, 'redux'));
    structure.hasUtils = existsSync(join(srcRoot, 'utils')) || existsSync(join(srcRoot, 'helpers'));
    structure.hasTypes = existsSync(join(srcRoot, 'types')) || existsSync(join(srcRoot, '@types'));
  }

  if (stack === 'java' || stack === 'fullstack') {
    const javaRoot = findJavaRoot(cwd);
    structure.javaRoot = javaRoot ? relative(cwd, javaRoot) : 'unknown';
    structure.hasController = !!javaRoot && existsSync(join(javaRoot, 'controller'));
    structure.hasService = !!javaRoot && existsSync(join(javaRoot, 'service'));
    structure.hasRepository = !!javaRoot && existsSync(join(javaRoot, 'repository'));
    structure.hasDomain = !!javaRoot && existsSync(join(javaRoot, 'domain'));
    structure.hasDto = !!javaRoot && existsSync(join(javaRoot, 'dto'));
    structure.hasConfig = !!javaRoot && existsSync(join(javaRoot, 'config'));
  }

  if (stack === 'python') {
    const root = existsSync(join(cwd, 'src')) ? join(cwd, 'src') : cwd;
    structure.layout = existsSync(join(cwd, 'src')) ? 'src-layout' : 'flat-layout';
    structure.hasTests = existsSync(join(cwd, 'tests')) || existsSync(join(cwd, 'test'));
    structure.hasManagePy = existsSync(join(cwd, 'manage.py'));
    structure.hasApp = existsSync(join(root, 'app'));
    structure.hasModels = existsSync(join(root, 'models'));
    structure.hasViews = existsSync(join(root, 'views'));
    structure.hasRoutes = existsSync(join(root, 'routes')) || existsSync(join(root, 'api'));
    structure.hasServices = existsSync(join(root, 'services'));
  }

  if (stack === 'salesforce') {
    const sfdxRoot = findSfdxRoot(cwd);
    structure.sfdxRoot = sfdxRoot ? relative(cwd, sfdxRoot) : 'force-app/main/default';
    structure.hasClasses = !!sfdxRoot && existsSync(join(sfdxRoot, 'classes'));
    structure.hasTriggers = !!sfdxRoot && existsSync(join(sfdxRoot, 'triggers'));
    structure.hasLwc = !!sfdxRoot && existsSync(join(sfdxRoot, 'lwc'));
    structure.hasAura = !!sfdxRoot && existsSync(join(sfdxRoot, 'aura'));
    structure.hasObjects = !!sfdxRoot && existsSync(join(sfdxRoot, 'objects'));
    structure.hasFlows = !!sfdxRoot && existsSync(join(sfdxRoot, 'flows'));
  }

  if (stack === 'node') {
    const srcRoot = existsSync(join(cwd, 'src')) ? join(cwd, 'src') : cwd;
    structure.srcRoot = relative(cwd, srcRoot) || 'root';
    structure.hasRoutes = existsSync(join(srcRoot, 'routes'));
    structure.hasControllers = existsSync(join(srcRoot, 'controllers'));
    structure.hasServices = existsSync(join(srcRoot, 'services'));
    structure.hasMiddleware = existsSync(join(srcRoot, 'middleware')) || existsSync(join(srcRoot, 'middlewares'));
    structure.hasModels = existsSync(join(srcRoot, 'models'));
  }

  if (stack === 'flutter') {
    const lib = join(cwd, 'lib');
    structure.hasWidgets = existsSync(join(lib, 'widgets'));
    structure.hasScreens = existsSync(join(lib, 'screens')) || existsSync(join(lib, 'pages'));
    structure.hasModels = existsSync(join(lib, 'models'));
    structure.hasServices = existsSync(join(lib, 'services')) || existsSync(join(lib, 'repositories'));
    structure.hasProviders = existsSync(join(lib, 'providers'));
  }

  return structure;
}

async function scanPatterns(cwd, stack) {
  const patterns = {};

  if (stack === 'react' || stack === 'fullstack') {
    const files = await glob('src/**/*.{ts,tsx,js,jsx}', { cwd, ignore: 'node_modules/**' });
    const sample = files.slice(0, 30).map(f => readFileSafe(join(cwd, f)) || '');
    const code = sample.join('\n');

    patterns.componentStyle = /export default function/.test(code) ? 'function-declaration'
      : /const \w+ = \(\) =>/.test(code) ? 'arrow-function'
      : 'mixed';
    patterns.usesForwardRef = /forwardRef/.test(code);
    patterns.usesContext = /createContext|useContext/.test(code);
    patterns.fetchStrategy = /react-query|useQuery|useMutation/.test(code) ? 'react-query'
      : /swr/.test(code) ? 'swr'
      : /axios/.test(code) ? 'axios'
      : /fetch\(/.test(code) ? 'fetch'
      : 'unknown';
    patterns.errorBoundary = /ErrorBoundary/.test(code);
    patterns.lazyLoading = /React\.lazy|lazy\(/.test(code);
  }

  if (stack === 'java' || stack === 'fullstack') {
    const files = await glob('src/main/java/**/*.java', { cwd, ignore: [] });
    const sample = files.slice(0, 30).map(f => readFileSafe(join(cwd, f)) || '');
    const code = sample.join('\n');

    patterns.architecture = code.includes('@RestController') ? 'rest-api'
      : code.includes('@Controller') ? 'mvc'
      : 'unknown';
    patterns.usesRecords = /record \w+/.test(code);
    patterns.usesStreams = /\.stream\(\)/.test(code);
    patterns.usesOptional = /Optional\./.test(code);
    patterns.exceptionStyle = /GlobalExceptionHandler|ControllerAdvice/.test(code) ? 'global-handler' : 'inline';
    patterns.validationStyle = /jakarta\.validation|javax\.validation/.test(code) ? 'bean-validation' : 'manual';
    patterns.securityFramework = /spring-security|@PreAuthorize|SecurityConfig/.test(code) ? 'spring-security' : 'none';
  }

  if (stack === 'python') {
    const files = await glob('**/*.py', { cwd, ignore: ['venv/**', '.venv/**', '**/__pycache__/**', 'node_modules/**'] });
    const sample = files.slice(0, 30).map(f => readFileSafe(join(cwd, f)) || '');
    const code = sample.join('\n');

    patterns.usesTypeHints = /def \w+\([^)]*:\s*\w+/.test(code) || /->\s*\w+/.test(code);
    patterns.usesDataclasses = /@dataclass/.test(code);
    patterns.usesAsync = /async def/.test(code);
    patterns.usesPydantic = /from pydantic import|BaseModel/.test(code);
    patterns.loggingStyle = /import logging/.test(code) ? 'logging-module' : 'unknown';
  }

  if (stack === 'salesforce') {
    const sfdxRoot = findSfdxRoot(cwd);
    const classFiles = sfdxRoot ? await glob('**/*.cls', { cwd: sfdxRoot }) : [];
    const sample = classFiles.slice(0, 30).map(f => readFileSafe(join(sfdxRoot, f)) || '');
    const code = sample.join('\n');

    patterns.sharingDeclared = /\b(with|without|inherited)\s+sharing\b/.test(code);
    patterns.triggerHandlerPattern = /Handler/.test(code);
    patterns.usesCustomMetadata = /__mdt/.test(code);
    patterns.usesSecurityEnforced = /WITH SECURITY_ENFORCED|stripInaccessible/i.test(code);
  }

  if (stack === 'node') {
    const files = await glob('src/**/*.{ts,js}', { cwd, ignore: 'node_modules/**' });
    const sample = files.slice(0, 30).map(f => readFileSafe(join(cwd, f)) || '');
    const code = sample.join('\n');

    patterns.errorHandlingStyle = /errorHandler|@Catch\(|app\.use\(\s*\(err/.test(code) ? 'centralised-middleware' : 'inline';
    patterns.usesAsyncAwait = /async\s+\(/.test(code) || /async\s+function/.test(code);
    patterns.validationLibrary = /from ['"]zod['"]/.test(code) ? 'zod'
      : /from ['"]joi['"]/.test(code) ? 'joi'
      : /class-validator/.test(code) ? 'class-validator'
      : 'none';
  }

  if (stack === 'flutter') {
    const files = await glob('lib/**/*.dart', { cwd, ignore: ['**/*.g.dart', '**/*.freezed.dart'] });
    const sample = files.slice(0, 30).map(f => readFileSafe(join(cwd, f)) || '');
    const code = sample.join('\n');

    patterns.widgetStyle = /extends\s+StatelessWidget/.test(code) && !/extends\s+StatefulWidget/.test(code) ? 'stateless-preferred'
      : /extends\s+StatefulWidget/.test(code) ? 'mixed-or-stateful'
      : 'unknown';
    patterns.usesConstConstructors = /const\s+\w+\(/.test(code);
    patterns.usesNamedRoutes = /onGenerateRoute|routes:\s*\{/.test(code);
  }

  return patterns;
}

async function scanDependencies(cwd) {
  const deps = {};

  const pkg = readJsonSafe(join(cwd, 'package.json'));
  if (pkg) {
    deps.npm = {
      prod: Object.keys(pkg.dependencies || {}),
      dev: Object.keys(pkg.devDependencies || {}),
    };
  }

  const pom = readFileSafe(join(cwd, 'pom.xml'));
  if (pom) {
    const matches = [...pom.matchAll(/<artifactId>([^<]+)<\/artifactId>/g)];
    deps.maven = matches.map(m => m[1]).filter(Boolean);
  }

  const requirements = readFileSafe(join(cwd, 'requirements.txt'));
  if (requirements) {
    deps.pip = requirements.split('\n')
      .map(l => l.split(/[=<>~!#]/)[0].trim())
      .filter(Boolean);
  }

  const sfdxProject = readJsonSafe(join(cwd, 'sfdx-project.json'));
  if (sfdxProject) {
    deps.sfdxPackages = (sfdxProject.packageDirectories || [])
      .flatMap(p => p.dependencies || [])
      .map(d => d.package)
      .filter(Boolean);
  }

  const pubspec = readYamlSafe(join(cwd, 'pubspec.yaml'));
  if (pubspec) {
    deps.pub = {
      prod: Object.keys(pubspec.dependencies || {}),
      dev: Object.keys(pubspec.dev_dependencies || {}),
    };
  }

  return deps;
}

async function scanTesting(cwd, stack) {
  const testing = {};

  if (stack === 'react' || stack === 'fullstack') {
    const pkg = readJsonSafe(join(cwd, 'package.json'));
    testing.reactFramework = pkg?.devDependencies?.vitest ? 'vitest'
      : pkg?.devDependencies?.jest ? 'jest'
      : 'unknown';
    testing.hasRTL = !!(pkg?.devDependencies?.['@testing-library/react']);
    testing.hasCypress = !!(pkg?.devDependencies?.cypress);
    testing.hasPlaywright = !!(pkg?.devDependencies?.['@playwright/test']);
    testing.reactTestFiles = await glob('src/**/*.{test,spec}.{ts,tsx,js,jsx}', { cwd }).then(f => f.length);
  }

  if (stack === 'java' || stack === 'fullstack') {
    const pom = readFileSafe(join(cwd, 'pom.xml'));
    testing.javaFramework = pom?.includes('junit-jupiter') ? 'junit5'
      : pom?.includes('junit') ? 'junit4'
      : 'unknown';
    testing.hasMockito = pom ? /mockito/.test(pom) : false;
    testing.hasTestContainers = pom ? /testcontainers/.test(pom) : false;
    testing.javaTestFiles = await glob('src/test/java/**/*Test.java', { cwd }).then(f => f.length);
  }

  if (stack === 'python') {
    const pyproject = readFileSafe(join(cwd, 'pyproject.toml'));
    const requirements = readFileSafe(join(cwd, 'requirements.txt'));
    const deps = `${pyproject || ''}\n${requirements || ''}`;
    testing.pythonFramework = /\bpytest\b/i.test(deps) ? 'pytest'
      : existsSync(join(cwd, 'tests')) ? 'unittest'
      : 'unknown';
    testing.hasConftest = existsSync(join(cwd, 'conftest.py')) || existsSync(join(cwd, 'tests', 'conftest.py'));
    testing.pythonTestFiles = await glob('**/test_*.py', { cwd, ignore: ['venv/**', '.venv/**'] }).then(f => f.length);
  }

  if (stack === 'salesforce') {
    const sfdxRoot = findSfdxRoot(cwd);
    testing.apexTestFiles = sfdxRoot ? await glob('classes/*Test.cls', { cwd: sfdxRoot }).then(f => f.length) : 0;
    const pkg = readJsonSafe(join(cwd, 'package.json'));
    testing.hasLwcJest = !!(pkg?.devDependencies?.['@salesforce/sfdx-lwc-jest']);
  }

  if (stack === 'node') {
    const pkg = readJsonSafe(join(cwd, 'package.json'));
    testing.nodeFramework = pkg?.devDependencies?.vitest ? 'vitest'
      : pkg?.devDependencies?.jest ? 'jest'
      : pkg?.devDependencies?.mocha ? 'mocha'
      : pkg?.scripts?.test?.includes('node --test') ? 'node:test'
      : 'unknown';
    testing.hasSupertest = !!(pkg?.devDependencies?.supertest);
  }

  if (stack === 'flutter') {
    const pubspec = readYamlSafe(join(cwd, 'pubspec.yaml'));
    testing.hasFlutterTest = !!(pubspec?.dev_dependencies?.flutter_test);
    testing.hasMockito = !!(pubspec?.dev_dependencies?.mockito) || !!(pubspec?.dev_dependencies?.mocktail);
    testing.flutterTestFiles = await glob('test/**/*_test.dart', { cwd }).then(f => f.length);
  }

  return testing;
}

async function scanCI(cwd) {
  const ci = {};
  ci.github = existsSync(join(cwd, '.github', 'workflows'));
  ci.gitlab = existsSync(join(cwd, '.gitlab-ci.yml'));
  ci.jenkins = existsSync(join(cwd, 'Jenkinsfile'));
  ci.docker = existsSync(join(cwd, 'Dockerfile'));
  ci.compose = existsSync(join(cwd, 'docker-compose.yml')) || existsSync(join(cwd, 'compose.yml'));
  return ci;
}

// Helpers
function readJsonSafe(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function readFileSafe(path) {
  try { return readFileSync(path, 'utf8'); } catch { return null; }
}

function readYamlSafe(path) {
  try { return yaml.load(readFileSync(path, 'utf8')); } catch { return null; }
}

function extractXml(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>([^<]+)</${tag}>`));
  return m ? m[1].trim() : null;
}

function extractToml(toml, key) {
  if (!toml) return null;
  const m = toml.match(new RegExp(`${key}\\s*=\\s*["']([^"']+)["']`));
  return m ? m[1].trim() : null;
}

function findSfdxRoot(cwd) {
  const sfdxProject = readJsonSafe(join(cwd, 'sfdx-project.json'));
  const candidates = (sfdxProject?.packageDirectories || []).map(p => join(cwd, p.path, 'main', 'default'));
  candidates.push(join(cwd, 'force-app', 'main', 'default'));
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

function findSfdxSubdir(cwd, name) {
  const root = findSfdxRoot(cwd);
  if (!root) return null;
  const dir = join(root, name);
  return existsSync(dir) ? dir : null;
}

function findJavaRoot(cwd) {
  const candidates = [
    join(cwd, 'src', 'main', 'java'),
    join(cwd, 'backend', 'src', 'main', 'java'),
    join(cwd, 'server', 'src', 'main', 'java'),
    join(cwd, 'api', 'src', 'main', 'java'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) {
      // Walk to first real package dir
      let current = c;
      for (let i = 0; i < 5; i++) {
        const entries = readdirSync(current);
        const next = entries.find(e => statSync(join(current, e)).isDirectory());
        if (!next) break;
        current = join(current, next);
      }
      return current;
    }
  }
  return null;
}
