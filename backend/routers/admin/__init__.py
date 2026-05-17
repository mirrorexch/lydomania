"""Admin router package. All sub-routers require is_admin via Depends(get_admin_user)."""
from fastapi import APIRouter, Depends

from core.auth import get_admin_user

admin = APIRouter(prefix="/api/admin", dependencies=[Depends(get_admin_user)])

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

__all__ = ["admin"]
