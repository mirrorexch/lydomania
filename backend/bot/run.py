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


async def main() -> None:
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    mini_app_url = os.environ.get("MINI_APP_URL", "").strip()
    if not token:
        raise RuntimeError("TELEGRAM_BOT_TOKEN is required")
    if not mini_app_url:
        raise RuntimeError("MINI_APP_URL is required")

    bot = Bot(
        token=token,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML),
    )
    me = await bot.get_me()
    log.info("Authorized as @%s (id=%s)", me.username, me.id)

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
