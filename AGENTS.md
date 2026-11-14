# DOCUMENTATION FOR AGENTS

## 1. Core Engineering Principles

All contributions must prioritize:

- Clean, readable, maintainable code.
- Scalability and long-term maintainability.
- Reusability over duplication.
- Consistency with existing architecture and conventions.
- Performance without sacrificing readability.
- Simplicity over unnecessary abstraction.
- Explicit, structured implementations over clever one-liners.

Always prioritize understanding the existing implementation before introducing changes.

Do not introduce unnecessary complexity, patterns, abstractions, or dependencies.

## 2. Project Architecture
- Respect the existing project architecture and folder structure.
- Follow established naming conventions and coding patterns.
- Keep responsibilities separated.
- Avoid mixing business logic, presentation, data access, and infrastructure concerns.
- Keep components and classes focused on a single responsibility.
- Avoid tightly coupled modules.
- Place shared functionality in appropriate shared modules.
- Do not move or reorganize existing files unless there is a clear architectural benefit.
- Avoid introducing new architectural patterns when an existing pattern already solves the problem.

Before implementing a feature, inspect the relevant modules and understand how they interact.

## 3. Code Quality and Maintainability
- Prioritize readability over reducing line count.
- Prefer structured functions, classes, and modules over excessively compact implementations.
- Keep functions and methods focused on a single responsibility.
- Avoid deeply nested conditionals.
- Avoid duplicated logic.
- Extract reusable functionality when it provides a clear benefit.
- Use descriptive names for variables, methods, classes, and files.
- Avoid magic numbers and unexplained string literals.
- Keep implementations explicit and predictable.
- Avoid unnecessary comments that simply repeat what the code does.
- Add comments when explaining complex logic, business rules, or important implementation decisions.
- Remove dead code, unused imports, and obsolete implementations when modifying related areas.
- Use credentials if needed directly from the .env file

Do not create abstractions solely to reduce the number of lines.

## 4. Component and Utility Reusability

Before creating a new component, utility, hook, class, or service:

- Search the repository for existing implementations.
- Check whether an existing component can be extended or composed.
- Review whether similar functionality already exists elsewhere.
- Reuse existing patterns whenever possible.

Rules:

- Never create duplicate components or utilities unnecessarily.
- Avoid multiple implementations of the same business logic.
- Keep shared components generic enough to be reused without making them unnecessarily configurable.
- Keep feature-specific logic inside the appropriate feature.
- Do not introduce abstractions that make simple functionality harder to understand.
- If an existing component needs improvement, prefer extending or refactoring it over creating another version.

## 5. Documentation Standards

All feature-specific documentation must be maintained inside:

**docs/feature_name.md**

#### Rules:

- Keep documentation aligned with the current implementation.
- Never document hypothetical, deprecated, or unimplemented functionality as if it already exists.
- Update documentation whenever a change affects architecture, behavior, APIs, configuration, components, or workflows.
- Review existing documentation before implementing significant changes.
- Update outdated documentation rather than creating overlapping documents.
- Document important implementation decisions and non-obvious constraints.
- Include examples when they help explain usage.
- Keep documentation concise, structured, and easy to navigate.
- Avoid duplicating information across multiple documents.

Documentation must describe the actual source code, not an intended or assumed implementation.

When modifying an existing feature, verify that its documentation still reflects the current code.

## 6. Performance and Scalability
- Avoid unnecessary computations and repeated operations.
- Avoid unnecessary component rendering or state updates.
- Use lazy loading, caching, pagination, or batching where appropriate.
- Avoid loading or processing data that is not needed.
- Be mindful of memory usage and resource cleanup.
- Avoid unnecessary network requests.
- Optimize expensive operations only when there is a measurable or reasonable performance benefit.
- Avoid premature optimization that reduces maintainability.
- Consider how implementations behave as data volume, users, and application complexity grow.

Performance improvements must not introduce unnecessary architectural complexity.

## 7. State and Data Management
- Keep state ownership clear and predictable.
- Avoid unnecessary global state.
- Keep local state close to the components or modules that consume it.
- Avoid duplicating derived state.
- Validate external inputs at appropriate boundaries.
- Keep data transformations explicit and reusable when appropriate.
- Avoid coupling components directly to unrelated data sources.
- Follow existing data-fetching, caching, and error-handling conventions.

## 8. Error Handling
- Handle expected failure scenarios explicitly.
- Avoid silently swallowing errors.
- Provide meaningful error messages and useful debugging context.
- Follow existing error-handling conventions.
- Avoid exposing sensitive implementation details to end users.
- Do not use empty catch blocks.
- Handle loading, success, empty, and error states where applicable.

## 9. Testing and Validation

Every change must be validated appropriately.

- Check for typescript compilation before finishing the change
- Verify no credential is exposed and the data consumed is from the .env file

## 10. Dependency Management
- Prefer existing project dependencies over introducing new packages.
- Search for existing functionality before installing another dependency.
- Avoid dependencies for trivial functionality that can be implemented cleanly with existing tools.
- Evaluate maintenance, security, compatibility, and bundle-size implications.
- Avoid unnecessary dependency upgrades.
- Never introduce an alternative library that duplicates an existing project's responsibility without a clear reason.

## 11. Refactoring Standards
- Refactor incrementally.
- Preserve existing behavior unless a behavior change is explicitly required.
- Avoid mixing unrelated refactoring with feature implementation.
- Remove obsolete code when it is safe and relevant.
- Avoid unnecessary file or folder restructuring.
- Keep changes scoped to the requested task.
- Verify affected functionality after refactoring.

Prefer small, understandable improvements over large, unnecessary rewrites.

## 12. Security Standards
- Never hardcode credentials, tokens, API keys, or secrets.
- Never expose sensitive information in logs or error messages.
- Validate and sanitize untrusted inputs where appropriate.
- Follow existing authentication and authorization mechanisms.
- Avoid unsafe data handling and insecure defaults.
- Do not weaken existing security controls to simplify implementation.

## 13. Agent Workflow

#### Before implementing a task:

- Inspect the relevant files and project structure.
- Identify existing components, utilities, services, and patterns.
- Understand the current implementation and dependencies.
- Review related documentation.
- Identify the smallest maintainable implementation that solves the problem.

#### During implementation:

- Follow existing architecture and conventions.
- Reuse existing components and utilities.
- Keep changes focused and organized.
- Avoid unnecessary dependencies and abstractions.
- Update relevant documentation.
- Add or update tests when necessary.

#### After implementation:

- Review all modified files.
- Remove unused code and imports.
- Verify consistency with existing architecture.
- Run relevant tests and quality checks.
- Verify documentation accuracy.
- Summarize the changes and any remaining limitations.

## 14. Final Quality Requirements

Before considering a task complete, ensure:

- Existing functionality has been preserved where required.
- No unnecessary duplicate components or utilities were introduced.
- Code follows established architecture and conventions.
- Implementations are readable and maintainable.
- No unnecessary dependencies were added.
- Relevant tests and validations were executed.
- Documentation reflects the actual implementation.
- No unrelated changes were introduced.
- No secrets or sensitive information were exposed.

When uncertain about an existing architectural decision, investigate the current implementation before introducing a different approach.