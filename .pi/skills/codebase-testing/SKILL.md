---
name: codebase-testing
description: Shared vocabulary for testing a codebase. Use this skill whenever work requires the addition, amendment or deletion of tests in the codebase.
---

# Prerequisite Reading

**`codebase-design` skill** — Provides valuable context on the shared vocabulary to use and the goals of clean codebase design.

# Testing Philosophy

## Glossary

Use these terms exactly — don't substitute "framework" or "test case". Consistent language is the whole point.

**test harness** — A piece of software that enables unit testing: the test framework, plus helper functions, defaults, and test doubles.

**unit test** — A test that runs in less than 0.1 seconds and crosses no external seams: every adapter at the seams is an in-memory fake.

**behaviour** — Something observable, discriminable, and implementation-agnostic that a consumer can verify through the interface of a module.

**module under test** — The module whose interface a test exercises to verify a behaviour.

**permanent test** — A test designed to remain in the codebase after development is complete.

**ephemeral test** — A test used to guide development by providing a signal for verifying whether development has had the desired effect. It is removed from the codebase before development is considered complete.

**pin (a behaviour)** — to promote a behaviour from flexible to an obligation by testing it with a permanent test.

## Purpose of Tests

Tests serve distinct purposes:

**Tests Guide Design** — Tests cross the same seam as callers, so a module that is hard to test has a design problem, not a testing problem: a wide interface or a missing seam. Difficulty writing a test is a design signal.

**Tests Provide a Signal for Development** — Tests describe the desired behaviours of a module; they provide a measurable target that tells you when development is done, and confidence in the implementation.

**Tests Warn Developers** — Tests provide a warning to future developers if they break a pinned behaviour during development.

## What a Test Verifies

A test verifies that the module under test keeps its side of the contract. The contract's type-level clauses are already enforced by the compiler — never test them. Tests exist for the clauses types cannot express:

- **postconditions** — asserted in the ordinary test body
- **invariants** — asserted after arbitrary sequences of operations
- **error modes** — asserted via failure injection

Preconditions are the test's *setup*, not its subject: a test is a caller, and callers must satisfy preconditions before they may demand promises.

## Rejected Framings

- **Tests exist to catch bugs**: detection is a *consequence* of pinned behaviours, not the goal. Optimizing for detection produces suites that over-constrain future development.
- **Tests should verify all the behaviours of a module**: behaviours are flexible until a consumer relies on them; verifying them all freezes implementation detail into obligations.

## Classifying Tests

All development work involves adding, removing or adapting behaviours of modules in the application. Development work should be broken down into the set of behaviours modules should exhibit after development is complete.

**By default tests are ephemeral** — By default a test for a module is ephemeral: it measures development progress without enforcing unnecessary constraints that reduce future flexibility.

**Permanent tests protect consumers, not modules** — Make a test permanent only if changing the behaviour it covers would break a consumer in the source code. The counterfactual is the criterion: *if this behaviour changed and nothing broke, it deserves no permanent test.* The permanent suite should satisfy a biconditional: *a change breaks a consumer if and only if the permanent suite fails* — no false failures (tests that fail on safe refactors), no false passes (consumed behaviour that no test covers). When the first consumer arrives, promote its test to permanent; when the last consumer goes away, retire it. This assumes application code — published interfaces have invisible consumers and pin their whole documented contract.
