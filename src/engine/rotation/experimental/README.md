# Experimental rotation replay

Tape recording and replay are intentionally isolated from the production
rotation evaluator. They have parity coverage, but no page, saved-rotation, or
suggestion path may depend on them until a consumer owns worker lifecycle and
cache invalidation explicitly.
