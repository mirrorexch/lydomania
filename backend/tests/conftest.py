"""Backend pytest config.

Phase 7c: pytest-asyncio session-scoped event loop so Motor's global client
(bound to the first event loop touched) remains valid across all tests in
a single run.

Phase 10: extended session-scoped loop coverage to every Phase 7+ async
test file (season, wheel, plinko, mines, missions, phase8_meta, phase9) so
the full pytest sweep doesn't hit "Task attached to a different loop"
when multiple Motor-using suites run back-to-back.

Older test files using `unittest.IsolatedAsyncioTestCase` are unaffected
because they manage their own loops.
"""
import pytest

_SESSION_LOOP_FILES = (
    "test_season",
    "test_wheel",
    "test_plinko",
    "test_mines",
    "test_missions",
    "test_phase8_meta",
    "test_phase9",
    "test_gift_deposits",
    "test_crash",
    "test_battles",
    "test_roulette",
    "test_roulette_gifts",
)


def pytest_collection_modifyitems(config, items):
    """Mark Motor-touching async tests with session-scoped event loop.

    Avoids 'Event loop is closed' / 'Task attached to a different loop'
    between successive tests sharing the module-level Motor client.
    Older tests with their own loops are untouched.
    """
    for item in items:
        path = str(item.fspath)
        for name in _SESSION_LOOP_FILES:
            if name in path:
                item.add_marker(pytest.mark.asyncio(loop_scope="session"))
                break
