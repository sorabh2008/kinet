# Salesforce Rules

**Applies to:** `force-app/**/*.cls`, `force-app/**/*.trigger`, Lightning Web Components

## No SOQL In Loops
Never run a `[SELECT ...]` query inside a `for`/`while` loop.
**Why:** Apex governor limits cap a transaction at 101 SOQL queries — a query-in-loop fails as soon as the collection is large enough, often only in production.

## No DML In Loops
Never run `insert`/`update`/`upsert`/`delete`/`undelete` inside a `for`/`while` loop.
**Why:** Governor limits cap a transaction at 150 DML statements. Collect records and issue one bulk DML call.

## With Sharing By Default
Every Apex class should declare `with sharing` (or `inherited sharing`) unless there is a documented reason for `without sharing`.
**Why:** Without an explicit sharing declaration, class behaviour around record visibility is easy to get wrong and silently bypasses org sharing rules.

## No Hardcoded Record/Org IDs
Never hardcode a Salesforce ID (`Id` literal) in Apex. IDs differ between sandboxes, scratch orgs, and production.
**Why:** Code that works in a sandbox will silently fail or operate on the wrong record once deployed elsewhere.

## No System.debug In Production Code
Remove `System.debug()` calls before deploying outside of test classes.
Add `// kinet:allow` to suppress for an approved, temporary case.
**Why:** Debug logs consume org log storage limits and can leak sensitive field data into log files.

## Trigger Logic Lives In A Handler
Triggers should contain a single line delegating to a handler class (the "one trigger per object" pattern) — not inline business logic.
**Why:** Keeps triggers testable, makes execution order explicit, and avoids multiple triggers per object firing in an undefined order.

## Bulkify Everything
All trigger and batch logic must handle collections, not single records — Salesforce always invokes triggers with a `Trigger.new` list, which may contain 1 to 200 records.
