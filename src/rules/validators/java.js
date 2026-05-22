// Java-specific rule validators

export const javaValidators = [
  {
    id: 'java/no-business-logic-in-controller',
    lang: 'java',
    check(content, file) {
      if (!file.includes('Controller')) return [];
      const violations = [];
      const lines = content.split('\n');
      let inMethod = false;
      let braceDepth = 0;
      let methodStartLine = 0;
      let methodLines = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/@(Get|Post|Put|Delete|Patch)Mapping/.test(line)) {
          inMethod = true;
          methodStartLine = i + 1;
          methodLines = 0;
          braceDepth = 0;
        }
        if (inMethod) {
          braceDepth += (line.match(/\{/g) || []).length;
          braceDepth -= (line.match(/\}/g) || []).length;
          methodLines++;
          if (braceDepth === 0 && methodLines > 3) {
            if (methodLines > 20) {
              violations.push({ rule: 'java/no-business-logic-in-controller', severity: 'warning', line: methodStartLine, message: `Controller method is ${methodLines} lines — business logic belongs in the service layer`, suggestion: 'Delegate to a @Service class; controllers should only map request/response' });
            }
            inMethod = false;
          }
        }
      }
      return violations;
    },
  },
  {
    id: 'java/use-dto-not-entity-in-api',
    lang: 'java',
    check(content, file) {
      if (!file.includes('Controller')) return [];
      const violations = [];
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/@(RequestBody|ResponseBody)/.test(lines[i])) {
          // Check surrounding lines for @Entity annotations or Entity class names
          const window = lines.slice(Math.max(0, i - 2), i + 3).join('\n');
          if (/\b\w+Entity\b/.test(window)) {
            violations.push({ rule: 'java/use-dto-not-entity-in-api', severity: 'error', line: i + 1, message: 'JPA Entity used directly in API request/response', suggestion: 'Create a DTO and use MapStruct or a mapper to convert' });
          }
        }
      }
      return violations;
    },
  },
  {
    id: 'java/no-field-injection',
    lang: 'java',
    check(content, file) {
      const violations = [];
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/@Autowired/.test(lines[i]) && i + 1 < lines.length && /private\s+/.test(lines[i + 1])) {
          violations.push({ rule: 'java/no-field-injection', severity: 'error', line: i + 1, message: '@Autowired field injection detected — use constructor injection', suggestion: 'Declare dependencies as final fields and inject via constructor (Lombok @RequiredArgsConstructor)' });
        }
      }
      return violations;
    },
  },
  {
    id: 'java/checked-exceptions-in-service',
    lang: 'java',
    check(content, file) {
      if (!file.includes('Service')) return [];
      const violations = [];
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/\bthrows\s+\w*Exception/.test(lines[i]) && !/Runtime|Unchecked/.test(lines[i])) {
          violations.push({ rule: 'java/checked-exceptions-in-service', severity: 'warning', line: i + 1, message: 'Checked exception in service signature', suggestion: 'Wrap in a RuntimeException subclass (e.g. ServiceException) and handle via @ControllerAdvice' });
        }
      }
      return violations;
    },
  },
  {
    id: 'java/transactional-on-service-not-repo',
    lang: 'java',
    check(content, file) {
      const violations = [];
      if (file.includes('Repository')) {
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (/@Transactional/.test(lines[i])) {
            violations.push({ rule: 'java/transactional-on-service-not-repo', severity: 'warning', line: i + 1, message: '@Transactional on repository — manage transactions at the service layer', suggestion: 'Move @Transactional to the service method that calls this repository' });
          }
        }
      }
      return violations;
    },
  },
  {
    id: 'java/no-system-out',
    lang: 'java',
    check(content, file) {
      if (file.includes('Test')) return [];
      const violations = [];
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/System\.(out|err)\.print/.test(lines[i]) && !/\/\/\s*kinet:allow/.test(lines[i])) {
          violations.push({ rule: 'java/no-system-out', severity: 'error', line: i + 1, message: 'System.out/err in production code', suggestion: 'Use SLF4J: private static final Logger log = LoggerFactory.getLogger(Foo.class)' });
        }
      }
      return violations;
    },
  },
];
