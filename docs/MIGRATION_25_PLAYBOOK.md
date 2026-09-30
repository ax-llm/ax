# Playbook configuration in 25.0.0

In Python, Java, Go, Rust, and C++, `playbook.seed` is the optimizer's numeric random seed, matching TypeScript. To initialize an agent with a saved snapshot or bare playbook, pass it as `playbook.playbook`. Object values under `seed` no longer initialize saved state.

For example, change `{"playbook": {"seed": snapshot}}` to `{"playbook": {"playbook": snapshot, "seed": 7}}`. The numeric seed is optional. Loading a snapshot through the playbook handle remains supported.
