# Surface-only suggestion algorithms

This subtree owns the calculator UI's substat-priority and random-Echo
algorithms. They are intentionally outside the shared suggestion engine so the
surfaces can be replaced or removed without leaving algorithm contracts in the
engine.

Code outside this feature must not import from this subtree. If another system
needs a small concept that happens to exist here, that system should own its
own implementation.
