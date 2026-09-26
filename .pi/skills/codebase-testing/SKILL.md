---
name: codebase-testing
description: Shared volcabulary for testing a codebase. Use this skill whenever work requires the addition, amendment or deletion of test in the codebase.
---

# Prerequisite Reading

**`codebase-design` skill** - Provides valuable context on the shared vocabulary to use and the goals of clean codebase design.

# Testing Philosophy

## Glossary

Use these terms exactly — don't substitute "framework," "test case". Consistent language is the whole point.

**test harness** - A piece of software that enables unit testing: the framework but also helper functions, defaults and testable mock objects.

**unit test** - A test that runs in less the 0.1 seconds, and does not access external resources.

**behaviour** - Something observable, discriminable, and implementation-agnostic a consumer can verify through the interface of a module.

**module under test** - The module that's interface a test is using to test a behaviour through.

**permanent test** - Tests that are designed to remain in the codebase after development is complete.

**ephemeral tests** - Tests that are used to guide development by providing a signal for verifying whether development has had the desired effect. They are removed from the codebase before development is considered complete.

**pin (a behaviour)** — to promote a behaviour from flexible to an obligation by testing it with a permanent test.

## Purpose of Tests

Tests serve distinct purposes:

**Tests Guide Design** - Good code reduces coupling. A function or method that is highly coupled is hard to test. Tests interact with the module through its interface, modules that are complex to test imply a complex interface which reduces leverage.

**Tests Provide a Signal For Development** -  Tests describe the desired behaviours of a module, they provide a measurable target for your development to know when you are done and give confidence in your implementation.

**Tests Warn Developer** - Test provide a warning to future developers if they break a pinned behaviour during development.

## Rejected Framings

- **Tests are for catching bugs**: this rarely works and often leads to too many test that constrain the flexibility of future development.
- **Tests should verify all the behaviours of a Module**: this leads to too many test that constrain the flexibility of future development.

## Classifying Tests

All development work involves adding, removing or adapting behaviours of modules in our application. Development work should be broken down into the set of behaviours modules should exhibit after after development is complete.

**By default tests are ephemeral** - By default tests for a module should be considered ephemeral. This is so they can be used to measure development progress but do not enforce unnecessary contraints on future development reducing flexibility.

**Permanent test are to pin behaviours consumers rely on** - A test for a module should only be made permanent if the behaviour it tests is a fixed requirement of some consumer of the module in the source code.



