"""Local Janus dashboard package.

Keep package import lightweight so live-worker utilities can be used by source
adapters and focused tests without importing the HTTP runtime.
"""

from typing import Any

__all__ = ["create_app", "run_server"]


def create_app(*args: Any, **kwargs: Any):
    from Server.app import create_app as _create_app

    return _create_app(*args, **kwargs)


def run_server(*args: Any, **kwargs: Any):
    from Server.app import run_server as _run_server

    return _run_server(*args, **kwargs)
