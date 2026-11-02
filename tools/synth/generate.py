"""Fixture generator stub. CP0 only emits seeded filler; real statements come later."""

import random

VERSION = "0.0.0-stub"


def generate(seed, name):
    """Return the bytes of fixture `name` for `seed`. Pure and deterministic."""
    rng = random.Random(f"{seed}:{name}")
    lines = [f"synthetic stub {name}"]
    lines += [f"{rng.randrange(16**8):08x}" for _ in range(8)]
    return ("\n".join(lines) + "\n").encode("ascii")
