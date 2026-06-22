# Python Rules

**Applies to:** `*.py`

## No Bare Except
Never use a bare `except:`. Catch a specific exception type.
**Why:** A bare except also swallows `KeyboardInterrupt` and `SystemExit`, making the program impossible to stop cleanly and hiding real bugs.

## No Mutable Default Arguments
Never default a parameter to `[]`, `{}`, or `set()`. Default to `None` and create the value inside the function body.
**Why:** Mutable defaults are evaluated once at function definition time and shared across every call, causing state to leak between unrelated calls.

## No print() In Production Code
Use the `logging` module, not `print()`, outside of scripts and tests.
Add `# kinet:allow` to suppress the warning for intentional CLI output.

## Type Hints On Public Functions
Public functions (no leading underscore) should declare parameter and return type hints.
**Why:** Type hints make intent explicit and let static analysis (mypy/pyright) catch bugs before runtime.

## No Raw SQL String Concatenation
Never build a SQL query with an f-string, `%` formatting, or `+` concatenation passed to `execute()`.
Use parameterized queries: `cursor.execute(query, (param,))`.
**Why:** String-built SQL is the canonical SQL injection vector.

## Virtual Environments Required
Dependencies are managed via `requirements.txt`/`pyproject.toml` inside a virtual environment (`venv`, `poetry`, or `pipenv`) — never installed globally.
