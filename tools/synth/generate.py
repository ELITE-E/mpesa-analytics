"""Fixture generator stub. CP0 only emits seeded filler; real statements come later."""

import random

VERSION = "0.0.0-stub"
FILLER_LINES = 8


def generate(seed, name):
    """Produce the bytes of one fixture.

    Args:
        seed: Manifest seed.
        name: Fixture path relative to the fixtures directory.

    Returns:
        The fixture's bytes; the same arguments always give the same bytes.

    Side Effects:
        None.
    """
    rng = random.Random(f"{seed}:{name}")
    lines = [f"synthetic stub {name}"]
    lines += [f"{rng.randrange(16**8):08x}" for _ in range(FILLER_LINES)]
    return ("\n".join(lines) + "\n").encode("ascii")
