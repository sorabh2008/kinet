# Flutter Rules

**Applies to:** `*.dart`

## No print() In Production Code
Use `debugPrint()` or a logging package instead of `print()`.
Add `// kinet:allow` to suppress for intentional CLI/script output.

## No Business Logic Or HTTP Calls In Widgets
`StatelessWidget`/`StatefulWidget` classes should not call `http`/`Dio` directly.
**Why:** Couples UI to network concerns, makes widgets untestable without a live network, and breaks separation of concerns.
Move network calls into a repository/service class, exposed via Provider/Riverpod/Bloc.

## Check `mounted` After An Async Gap
Never use `BuildContext` (`Navigator.of(context)`, `ScaffoldMessenger.of(context)`, etc.) immediately after an `await` without first checking `if (!mounted) return;`.
**Why:** The widget can be disposed while the future is pending; using a stale `BuildContext` throws or silently no-ops.

## No Empty Catch Blocks
Never write `catch (e) {}`. Log the error or rethrow.
**Why:** Silently swallowed exceptions are one of the hardest classes of bug to track down in production.

## State Management Consistency
Pick one state management approach (Provider, Riverpod, Bloc, or plain `setState` for local-only state) and use it consistently — don't mix patterns within the same feature.
