# ADR-001: SQL Server as the Persistence Technology

## Status

Accepted (2026-06-15)

## Context

The application must integrate with the client's Workflow (WF) engine, which currently requires SQL Server as its persistence mechanism and does not support alternative database engines.

The application only persists and retrieves configuration data required for its operation. There is no current requirement to support multiple database engines or to provide database portability.

In addition, the project is subject to strict budget and delivery constraints. Given these limitations, the primary objective is to minimize architectural complexity and focus development effort on implementing the business logic.

## Decision

The application will use SQL Server directly as its persistence technology, accepting an explicit dependency on SQL Server within the infrastructure layer.

A Hexagonal Architecture (Ports and Adapters) abstraction will not be introduced for data persistence, as it would add development and maintenance complexity without providing sufficient value in the current project context.

The rules engine itself will remain a pure domain function, completely independent of persistence concerns. This ensures that the core business logic is isolated from infrastructure decisions and can be tested independently.

## Consequences

### Positive
* Reduced architectural complexity.
* Lower implementation and maintenance costs.
* Compliance with project budget and delivery constraints.
* Straightforward integration with the client's required infrastructure.
* The rules engine remains independent of the persistence technology.
### Negative
* The infrastructure layer is coupled to SQL Server.
* Migrating to a different database engine in the future would require changes to the persistence implementation.

## Alternatives Considered

### Hexagonal Architecture for Persistence

Introducing a persistence abstraction through Hexagonal Architecture was considered but rejected because it would increase the complexity of the solution without providing sufficient practical benefit. Specifically:

* SQL Server is already mandated by the client's WF engine.
* The application only stores and retrieves configuration data.
* There is no current requirement to support multiple database engines.
* The project's budget and timeline favor a simpler implementation.

This decision should be revisited if the dependency on the client's WF engine is removed or if support for multiple persistence technologies becomes a project requirement.