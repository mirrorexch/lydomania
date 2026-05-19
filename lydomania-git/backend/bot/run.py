"""
Lydomania Telegram bot worker — long-polling, aiogram v3.

Process: standalone (runs under supervisor as `lydomania_bot`).
Reads TELEGRAM_BOT_TOKEN + MINI_APP_URL from /app/backend/.env.
"""

from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.types import (
    BotCommand,
    BotCommandScopeDefault,
    MenuButtonWebApp,
    WebAppInfo,
)
from dotenv import load_dotenv

# Load /app/backend/.env regardless of CWD
ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / ".env")

from bot.handlers import router as lydo_router  # noqa: E402  (after dotenv)
from bot.notifications import outbox_loop  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
log = logging.getLogger("lydomania.bot")


async def _set_menu_button(bot: Bot, mini_app_url: str) -> None:
    await bot.set_chat_menu_button(
        menu_button=MenuButtonWebApp(
            text="🎰 Play",
            web_app=WebAppInfo(url=mini_app_url),
        )
    )
    log.info("set_chat_menu_button OK → %s", mini_app_url)


async def _set_commands(bot: Bot) -> None:
    await bot.set_my_commands(
        commands=[
            BotCommand(command="start", description="Open Lydomania"),
            BotCommand(command="help", description="Help / Помощь"),
        ],
        scope=BotCommandScopeDefault(),
    )
    log.info("set_my_commands OK")


async def _idle_forever(reason: str) -> None:
    """Park the process so supervisor sees RUNNING (not FATAL).

    We re-emit the reason every 30 minutes so operators can see WHY the bot
    is idle by tailing the log. The supervisor stop signal still terminates
    the process cleanly because asyncio.sleep is interruptible.
    """
    log.warning("[bot] entering idle loop — reason: %s", reason)
    while True:
        await asyncio.sleep(1800)
        log.warning("[bot] still idle — reason: %s", reason)


async def main() -> None:
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    mini_app_url = os.environ.get("MINI_APP_URL", "").strip()
    if not token:
        # Sandbox / dev: don't crash, just park the worker so supervisor stays green
        await _idle_forever("TELEGRAM_BOT_TOKEN not set")
        return
    if not mini_app_url:
        await _idle_forever("MINI_APP_URL not set")
        return

    bot = Bot(
        token=token,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML),
    )
    # Validate token BEFORE start_polling crashes us — if Telegram says 401
    # the token is junk (expired / revoked / sandbox copy). Park instead of crash.
    try:
        me = await bot.get_me()
        log.info("Authorized as @%s (id=%s)", me.username, me.id)
    except Exception as e:  # noqa: BLE001
        # Close the aiohttp session aiogram opened so we don't leak it.
        try:
            await bot.session.close()
        except Exception:  # noqa: BLE001
            pass
        await _idle_forever(f"get_me() failed: {type(e).__name__}: {e}")
        return

    # Configure UI once on every startup — idempotent calls
    try:
        await _set_menu_button(bot, mini_app_url)
    except Exception as e:  # noqa: BLE001
        log.warning("set_chat_menu_button failed: %s", e)
    try:
        await _set_commands(bot)
    except Exception as e:  # noqa: BLE001
        log.warning("set_my_commands failed: %s", e)

    dp = Dispatcher()
    dp.include_router(lydo_router)

    log.info("Bot started polling")
    await bot.delete_webhook(drop_pending_updates=False)

    # Run the outbox poller in parallel with long-polling
    outbox_task = asyncio.create_task(outbox_loop(bot))
    try:
        await dp.start_polling(bot)
    finally:
        outbox_task.cancel()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        log.info("Bot stopped")
