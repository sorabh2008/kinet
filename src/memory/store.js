import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';

/**
 * Persistent memory store for AI assistants.
 * Memories are markdown files with YAML frontmatter — same format as Claude Code's memory system.
 * The MCP tool kinet_memory_recall queries this store.
 */
export class MemoryStore {
  constructor(kinetDir) {
    this.memDir = join(kinetDir, 'memory');
    this.indexPath = join(this.memDir, 'index.json');
  }

  async init(context) {
    mkdirSync(this.memDir, { recursive: true });
    // Seed initial memories from distilled context
    const seedMemories = buildSeedMemories(context);
    for (const mem of seedMemories) {
      this.save(mem.id, mem.type, mem.title, mem.body);
    }
    this.rebuildIndex();
  }

  save(id, type, title, body) {
    const content = `---\nid: ${id}\ntype: ${type}\ntitle: ${title}\ncreatedAt: ${new Date().toISOString()}\n---\n\n${body}\n`;
    writeFileSync(join(this.memDir, `${id}.md`), content);
    this.rebuildIndex();
    return id;
  }

  recall(query, { type, limit = 10 } = {}) {
    const index = this._loadIndex();
    const q = query.toLowerCase();
    return index
      .filter(m => (!type || m.type === type) && (m.title.toLowerCase().includes(q) || m.tags?.some(t => q.includes(t))))
      .slice(0, limit)
      .map(m => ({ ...m, body: this._readBody(m.id) }));
  }

  recallAll(type) {
    return this._loadIndex()
      .filter(m => !type || m.type === type)
      .map(m => ({ ...m, body: this._readBody(m.id) }));
  }

  async rebuild() {
    this.rebuildIndex();
  }

  rebuildIndex() {
    if (!existsSync(this.memDir)) return;
    const entries = readdirSync(this.memDir)
      .filter(f => f.endsWith('.md'))
      .map(f => {
        const content = readFileSync(join(this.memDir, f), 'utf8');
        const fm = parseFrontmatter(content);
        return fm ? { id: fm.id, type: fm.type, title: fm.title, createdAt: fm.createdAt } : null;
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    writeFileSync(this.indexPath, JSON.stringify({ memories: entries, updatedAt: new Date().toISOString() }, null, 2));
  }

  _loadIndex() {
    if (!existsSync(this.indexPath)) return [];
    try { return JSON.parse(readFileSync(this.indexPath, 'utf8')).memories || []; } catch { return []; }
  }

  _readBody(id) {
    const path = join(this.memDir, `${id}.md`);
    if (!existsSync(path)) return '';
    const content = readFileSync(path, 'utf8');
    return content.replace(/^---[\s\S]*?---\n\n?/, '').trim();
  }
}

function parseFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split('\n')) {
    const [key, ...rest] = line.split(': ');
    if (key && rest.length) fm[key.trim()] = rest.join(': ').trim();
  }
  return fm;
}

function buildSeedMemories(context) {
  const memories = [];
  const { tech, patterns, testing, stack } = context;

  if (stack === 'react' || stack === 'fullstack') {
    memories.push({
      id: 'stack-react',
      type: 'project',
      title: 'React stack and conventions',
      body: [
        `- React ${tech.react || 'latest'} with ${tech.typescript ? 'TypeScript' : 'JavaScript'}`,
        tech.bundler !== 'unknown' && `- Bundler: ${tech.bundler}`,
        tech.cssFramework !== 'unknown' && `- CSS: ${tech.cssFramework}`,
        tech.stateManagement && `- State: ${tech.stateManagement}`,
        patterns.componentStyle && `- Component style: ${patterns.componentStyle}`,
        patterns.fetchStrategy !== 'unknown' && `- Fetch strategy: ${patterns.fetchStrategy}`,
      ].filter(Boolean).join('\n'),
    });
  }

  if (stack === 'java' || stack === 'fullstack') {
    memories.push({
      id: 'stack-java',
      type: 'project',
      title: 'Java/Spring stack and conventions',
      body: [
        tech.buildTool && `- Build: ${tech.buildTool}`,
        tech.javaVersion && `- Java: ${tech.javaVersion}`,
        tech.springBoot && `- Framework: Spring Boot`,
        tech.lombok && `- Lombok enabled (@RequiredArgsConstructor, @Data, etc.)`,
        patterns.exceptionStyle === 'global-handler' && `- Exception handling via @ControllerAdvice — no try/catch in controllers`,
        patterns.validationStyle === 'bean-validation' && `- Bean Validation on DTOs`,
        patterns.usesOptional && `- Services never return null — use Optional<T>`,
      ].filter(Boolean).join('\n'),
    });
  }

  if (testing.reactFramework && testing.reactFramework !== 'unknown') {
    memories.push({
      id: 'testing-conventions',
      type: 'feedback',
      title: 'Testing conventions',
      body: [
        testing.reactFramework !== 'unknown' && `- Frontend: ${testing.reactFramework}`,
        testing.hasRTL && `- Use @testing-library/react — test behaviour not implementation`,
        testing.javaFramework !== 'unknown' && `- Backend: ${testing.javaFramework}`,
        testing.hasTestContainers && `- Use Testcontainers for DB integration tests — no mocking the database`,
      ].filter(Boolean).join('\n'),
    });
  }

  return memories;
}
