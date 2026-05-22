import { join, relative, extname } from 'path';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { glob } from 'glob';

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

function extractXml(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>([^<]+)</${tag}>`));
  return m ? m[1].trim() : null;
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
