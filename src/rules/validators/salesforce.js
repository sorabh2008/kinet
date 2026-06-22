// Salesforce-specific rule validators (Apex classes/triggers, LWC)

export const salesforceValidators = [
  {
    id: 'salesforce/no-soql-in-loop',
    lang: 'apex',
    check(content, file) {
      if (!file.endsWith('.cls') && !file.endsWith('.trigger')) return [];
      const violations = [];
      const lines = content.split('\n');
      let loopDepth = 0;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/\b(for|while)\s*\(/.test(line)) loopDepth++;
        if (loopDepth > 0 && /\[\s*SELECT\b/i.test(line)) {
          violations.push({ rule: 'salesforce/no-soql-in-loop', severity: 'error', line: i + 1, message: 'SOQL query inside a loop — risk of hitting governor limits (101 SOQL queries)', suggestion: 'Move the query outside the loop; bulkify with a Map/Set lookup' });
        }
        loopDepth -= (line.match(/\}/g) || []).length;
        if (loopDepth < 0) loopDepth = 0;
      }
      return violations;
    },
  },
  {
    id: 'salesforce/no-dml-in-loop',
    lang: 'apex',
    check(content, file) {
      if (!file.endsWith('.cls') && !file.endsWith('.trigger')) return [];
      const violations = [];
      const lines = content.split('\n');
      let loopDepth = 0;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/\b(for|while)\s*\(/.test(line)) loopDepth++;
        if (loopDepth > 0 && /\b(insert|update|upsert|delete|undelete)\s+\w+\s*;/i.test(line)) {
          violations.push({ rule: 'salesforce/no-dml-in-loop', severity: 'error', line: i + 1, message: 'DML statement inside a loop — risk of hitting governor limits (150 DML statements)', suggestion: 'Collect records into a List and perform a single bulk DML call outside the loop' });
        }
        loopDepth -= (line.match(/\}/g) || []).length;
        if (loopDepth < 0) loopDepth = 0;
      }
      return violations;
    },
  },
  {
    id: 'salesforce/with-sharing-required',
    lang: 'apex',
    check(content, file) {
      if (!file.endsWith('.cls')) return [];
      if (!/\bclass\s+\w+/.test(content)) return [];
      if (/\b(with|without|inherited)\s+sharing\b/.test(content)) return [];
      if (/@isTest/.test(content) || file.includes('Test')) return [];
      const lines = content.split('\n');
      const classLine = lines.findIndex(l => /\bclass\s+\w+/.test(l));
      return [{ rule: 'salesforce/with-sharing-required', severity: 'warning', line: classLine + 1, message: 'Apex class has no sharing declaration', suggestion: 'Declare `with sharing` (or `inherited sharing`) explicitly so record access respects org sharing rules' }];
    },
  },
  {
    id: 'salesforce/no-hardcoded-ids',
    lang: 'apex',
    check(content, file) {
      if (!file.endsWith('.cls') && !file.endsWith('.trigger')) return [];
      const violations = [];
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/["'](?:001|003|005|006|00Q|00D)[a-zA-Z0-9]{12,15}["']/.test(lines[i])) {
          violations.push({ rule: 'salesforce/no-hardcoded-ids', severity: 'error', line: i + 1, message: 'Hardcoded Salesforce record/org ID — IDs differ between sandboxes and production', suggestion: 'Query by a stable field (Name, External_Id__c) or use Custom Metadata/Custom Settings' });
        }
      }
      return violations;
    },
  },
  {
    id: 'salesforce/no-system-debug',
    lang: 'apex',
    check(content, file) {
      if (!file.endsWith('.cls') && !file.endsWith('.trigger')) return [];
      if (file.includes('Test')) return [];
      const violations = [];
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/System\.debug\(/.test(lines[i]) && !/\/\/\s*kinet:allow/.test(lines[i])) {
          violations.push({ rule: 'salesforce/no-system-debug', severity: 'warning', line: i + 1, message: 'System.debug() left in production code — consumes log storage and can leak data', suggestion: 'Remove before deploying, or guard behind a custom logging framework' });
        }
      }
      return violations;
    },
  },
  {
    id: 'salesforce/trigger-logic-belongs-in-handler',
    lang: 'apex',
    check(content, file) {
      if (!file.endsWith('.trigger')) return [];
      const lines = content.split('\n');
      const bodyLines = lines.filter(l => l.trim() && !/^\s*(trigger|\}|\{)/.test(l.trim()));
      if (bodyLines.length > 5 && !/Handler/.test(content)) {
        return [{ rule: 'salesforce/trigger-logic-belongs-in-handler', severity: 'warning', line: 1, message: 'Trigger contains logic directly instead of delegating to a handler class', suggestion: 'Move logic to a TriggerHandler class; the trigger body should only call the handler' }];
      }
      return [];
    },
  },
];
