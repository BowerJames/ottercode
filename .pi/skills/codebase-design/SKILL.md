---
name: codebase-design
description: Shared vocabulary for designing deep modules. Use when the user wants to design or improve a module's interface, find deepening opportunities, decide where a seam goes, make code more testable or AI-navigable, or when another skill needs the deep-module vocabulary.
---

# Codebase Design

Design **deep modules**: a lot of behaviour behind a small interface, placed at a clean seam, testable through that interface. Use this language and these principles wherever code is being designed or restructured. The aim is leverage for callers, locality for maintainers, and testability for everyone.

## Glossary

Use these terms exactly — don't substitute "component," "service," "API," or "boundary." Consistent language is the whole point.

**Module** — anything with an interface and an implementation. Deliberately scale-agnostic: a function, class, package, or tier-spanning slice. All of these count — scale doesn't change the vocabulary. 

_Avoid_: unit, component, service.

**Interface** — everything a caller must know to use a module correctly: the type signature, but also invariants, ordering constraints, error modes, required configuration, and performance characteristics. 

_Avoid_: API, signature (too narrow — they refer only to the type-level surface).

**Implementation** — what's inside a module. Distinct from Adapter: the same seam can be satisfied by adapters with very different implementation sizes — a Postgres-backed adapter (large implementation) or an in-memory fake (small one). Reach for "adapter" when the seam is the topic; "implementation" otherwise.

**Depth** — leverage at the interface: the amount of behaviour a caller (or test) can exercise per unit of interface they have to learn. A module is **deep** when a large amount of behaviour sits behind a small interface, **shallow** when the interface is nearly as complex as the implementation.

**Seam** _(Michael Feathers)_ — a place where you can alter the behaviour of a module without editing the implementation of the module. Where to put the seam is its own design decision, but it must be part of the interface of the module.

_Avoid_: boundary (overloaded with DDD's bounded context).

**Adapter** — a concrete thing that satisfies an interface at a seam. The interface the adapter satisfies can be a subset of the full interface of the thing.

**Leverage** — what callers get from depth: more capability per unit of interface they learn. One implementation pays back across N call sites and M tests.

**Locality** — what maintainers get from depth: change, bugs, knowledge, and verification concentrate in one place rather than spreading across callers. Fix once, fixed everywhere.

**Comments** — any non-executing, human-readable text embedded in the source code. Deliberately syntax-agnostic: this encompasses inline notes, block explanations, and structural entity documentation (like Python docstrings, Javadoc, or rustdoc). Comments serve two distinct architectural roles: at the **Interface**, they document everything a consumer needs to know to use the module (this should be implementation agnostic); within the **Implementation**, they explain the domain context and the "why" behind the code.

## Deep vs shallow

**Deep module** = small interface + lots of implementation:

```
┌─────────────────────┐
│   Small Interface   │  ← Few methods, simple params
├─────────────────────┤
│                     │
│  Deep Implementation│  ← Complex logic hidden
│                     │
└─────────────────────┘
```

**Shallow module** = large interface + little implementation (avoid):

```
┌─────────────────────────────────┐
│       Large Interface           │  ← Many methods, complex params
├─────────────────────────────────┤
│  Thin Implementation            │  ← Just passes through
└─────────────────────────────────┘
```

When designing an interface, ask:

- Can I reduce the number of methods?
- Can I simplify the parameters?
- Can I hide more complexity inside?

## Principles

- **Depth is measured at the interface.** A deep module can still be internally composed of small, mockable, swappable parts controlled via seams.
- **The deletion test.** Imagine deleting the module. If complexity vanishes, it was a pass-through. If complexity reappears across N callers, it was earning its keep.
- **A module's interface is the test surface.** Callers and tests cross the same seam. If you want to test *past* the interface, the module is probably the wrong shape and should be reconsidered.
- **One adapter means a hypothetical seam. Two adapters mean a real one — and a test double is an adapter.** A seam that nothing substitutes across, not even a test, doesn't earn its keep.

## Designing for testability

Good interfaces make testing natural:

1. **Accept dependencies, don't create them.**

    ```typescript
    // Testable
    function processOrder(order: Order, paymentGateway: PaymentGateway) {}

    // Hard to test
    function processOrder(order: Order) {
        const gateway = new StripeGateway();
    }
    ```

2. **Return results, don't produce side effects.**

    ```typescript
    // Testable
    function calculateDiscount(cart: Cart): Discount {}

    // Hard to test
    function applyDiscount(cart: Cart): void {
        cart.total -= computeDiscount(cart);
    }
    ```

3. **Resource acquisition requires seam dependencies.**

    ```typescript
    // Testable
    async function listUsers(
        httpFetcher: (url: string) => Promise<Response>,
        envVariableLoader: (name: string) => string | undefined,
    ): Promise<User[]> {
        const url = `${envVariableLoader("API_HOST")}/v1/users`;
        const response = await httpFetcher(url);
        return response.json();
    }

    // Hard to test
    async function listUsers(): Promise<User[]> {
        const url = `${process.env.API_HOST}/v1/users`;
        const response = await fetch(url);
        return response.json();
    }
    ```

4. **Seams should be injected through the interface.**

    ```typescript
    interface PaymentGateway {
        charge(amount: number): boolean;
    }

    const stripeGateway: PaymentGateway = {
        charge(amount: number): boolean { /* ... */ },
    };

    // Testable — any PaymentGateway, including a test double, is a drop-in
    function processOrder(order: Order, paymentGateway: PaymentGateway): void {
        const total = order.total();
        paymentGateway.charge(total);
    }
    ```

5. **Small surface area.** Fewer methods = fewer tests needed. Fewer params = simpler test setup.

## Adapters and seams

```typescript
interface PaymentGateway {
    charge(amount: number): boolean;
}

const stripeActions = {
    charge(amount: number): boolean { /* ... */ },
    refund(amount: number): boolean { /* ... */ },
};

function processOrder(order: Order, paymentGateway: PaymentGateway): void {
    const total = order.total();
    paymentGateway.charge(total);
}

const order: Order = /* ... */;
processOrder(order, stripeActions);
// stripeActions is an adapter: it satisfies the seam's interface even though
// it exposes more (refund) than the seam requires — the extra method is
// invisible through the seam
```

## Relationships

- A **Module** has exactly one **Interface** (the surface it presents to callers and tests).
- **Depth** is a property of a **Module**, measured against its **Interface**.
- A **Seam** is where an **Interface** lives.
- An **Adapter** sits at a **Seam** and satisfies an **Interface**.
- **Depth** produces **Leverage** for callers and **Locality** for maintainers.

## Rejected framings

- **Depth as ratio of implementation-lines to interface-lines** (Ousterhout): rewards padding the implementation. We use depth-as-leverage instead.
- **"Interface" as the TypeScript `interface` keyword or a class's public methods**: too narrow: interface here includes every fact a caller must know.
- **"Boundary"**: overloaded with DDD's bounded context. Say **seam** or **interface**.