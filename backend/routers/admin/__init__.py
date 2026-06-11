"""Admin router package.

RBAC: full admins (ADMIN_TELEGRAM_IDS) get read+write; support staff
(SUPPORT_TELEGRAM_IDS) get READ-ONLY access — safe HTTP methods only, any
write is rejected. Enforced once at the router level so every sub-router
inherits it. See core.auth.get_admin_or_readonly_support.
"""
from fastapi import APIRouter, Depends

from core.auth import get_admin_or_readonly_support

admin = APIRouter(prefix="/api/admin", dependencies=[Depends(get_admin_or_readonly_support)])

from . import withdrawals as _wd        # noqa: F401,E402
from . import cases as _cases           # noqa: F401,E402
from . import items as _items           # noqa: F401,E402
from . import settings as _settings     # noqa: F401,E402
from . import portals as _portals       # noqa: F401,E402
from . import floor_prices as _fp       # noqa: F401,E402 — Phase 3b
from . import maintenance as _maint     # noqa: F401,E402 — Phase 3c
from . import promos as _promos         # noqa: F401,E402 — Phase 4b
from . import digest as _digest         # noqa: F401,E402 — Phase 4b
from . import users as _users           # noqa: F401,E402 — Phase 6a hotfix
from . import roulette as _roulette     # noqa: F401,E402 — Phase 6c
from . import battles as _battles       # noqa: F401,E402 — Phase 6d
from . import seasons as _seasons       # noqa: F401,E402 — Phase 7c
from . import tonapi_mappings as _tonapi_mappings  # noqa: F401,E402 — Phase 10

__all__ = ["admin"]
