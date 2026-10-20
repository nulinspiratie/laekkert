"""Atomic file writes: readers see the old file or the new one, never half of one."""

import contextlib
import os
import secrets
from pathlib import Path


def atomic_write(path: Path, data: bytes) -> None:
    """Write `data` to `path` through a `.tmp-<hex>` file in the same folder.

    The temp file is flushed to disk, then renamed over the target. If anything
    fails the temp file is removed, the target is untouched and the error
    propagates.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.parent / f".tmp-{secrets.token_hex(6)}"
    try:
        with open(tmp, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        with contextlib.suppress(OSError):
            tmp.unlink()
        raise
