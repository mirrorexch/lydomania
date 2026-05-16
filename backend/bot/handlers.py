"""Lydomania Telegram bot handlers (aiogram v3)."""

from __future__ import annotations

import os

from aiogram import F, Router
from aiogram.filters import Command, CommandObject, CommandStart
from aiogram.types import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
    WebAppInfo,
)

from bot import internal_client

router = Router(name="lydomania")


def _mini_app_url(extra_query: str = "") -> str:
    url = os.environ.get("MINI_APP_URL", "").strip()
    if not url:
        raise RuntimeError("MINI_APP_URL is not set")
    if extra_query:
        sep = "&" if "?" in url else "?"
        return f"{url}{sep}{extra_query}"
    return url


def play_keyboard(deep_link: str = "") -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="🎰 Open Lydomania",
                    web_app=WebAppInfo(url=_mini_app_url(deep_link)),
                )
            ]
        ]
    )


def deposit_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="📥 Deposit",
                    web_app=WebAppInfo(url=_mini_app_url("screen=deposit")),
                )
            ]
        ]
    )


def cases_keyboard(cases: list[dict]) -> InlineKeyboardMarkup:
    rows = []
    for c in cases:
        label = f"🎰 {c['name']} · {int(c['price_ton'])} TON"
        rows.append(
            [
                InlineKeyboardButton(
                    text=label,
                    web_app=WebAppInfo(
                        url=_mini_app_url(f"screen=case&case_id={c['id']}")
                    ),
                )
            ]
        )
    return InlineKeyboardMarkup(inline_keyboard=rows)


WELCOME_TEXT = (
    "🎰 <b>Добро пожаловать в Lydomania!</b>\n"
    "Открывай кейсы на TON — выигрывай Telegram-подарки 🎁\n"
    "\n"
    "🎰 <b>Welcome to Lydomania!</b>\n"
    "Open TON cases — win Telegram NFT gifts 🎁\n"
    "\n"
    "Tap the button below to play 👇"
)


REF_WELCOME_SUFFIX = (
    "\n\n🎁 You were invited by a friend. Your wager rewards are connected — "
    "they earn a small share when you play."
)


HELP_TEXT = (
    "🎮 <b>Lydomania · TON Casino</b>\n"
    "\n"
    "• 5 кейсов от 10 до 250 TON\n"
    "• Provably fair (commit-reveal)\n"
    "• Выигрыши — Telegram NFT-подарки\n"
    "• Сеть: TON Mainnet\n"
    "\n"
    "Команды:\n"
    "/start — open Mini App\n"
    "/balance — your TON balance\n"
    "/deposit — get a deposit memo\n"
    "/cases — pick a case\n"
    "/help — this message\n"
)


@router.message(CommandStart())
async def cmd_start(message: Message, command: CommandObject) -> None:
    """Handle /start, including ref deep-link payloads /start ref_CODE."""
    text = WELCOME_TEXT
    if command and command.args:
        arg = command.args.strip()
        if arg.startswith("ref_"):
            code = arg[4:].upper()
            try:
                await internal_client.tag_referral(message.from_user.id, code)
            except Exception:  # noqa: BLE001
                pass
            text = WELCOME_TEXT + REF_WELCOME_SUFFIX

    await message.answer(
        text,
        parse_mode="HTML",
        reply_markup=play_keyboard(),
        disable_web_page_preview=True,
    )


@router.message(Command("help"))
async def cmd_help(message: Message) -> None:
    await message.answer(
        HELP_TEXT,
        parse_mode="HTML",
        reply_markup=play_keyboard(),
        disable_web_page_preview=True,
    )


@router.message(Command("balance"))
async def cmd_balance(message: Message) -> None:
    try:
        info = await internal_client.get_balance(message.from_user.id)
    except Exception as e:  # noqa: BLE001
        await message.answer(
            "⚠️ Couldn't fetch balance right now. Try again in a moment.",
            reply_markup=play_keyboard(),
        )
        return
    if not info.get("exists"):
        await message.answer(
            "👋 You don't have an account yet. Open the Mini App below to play.",
            reply_markup=play_keyboard(),
        )
        return
    bal = float(info.get("balance_ton", 0))
    ref = float(info.get("referral_balance_ton", 0))
    text = (
        f"💰 <b>Balance:</b> {bal:.2f} TON\n"
        f"🎁 <b>Referral pot:</b> {ref:.2f} TON"
    )
    await message.answer(text, parse_mode="HTML", reply_markup=deposit_keyboard())


@router.message(Command("deposit"))
async def cmd_deposit(message: Message) -> None:
    try:
        intent = await internal_client.deposit_intent(message.from_user.id)
    except Exception:  # noqa: BLE001
        await message.answer(
            "⚠️ Couldn't generate a deposit memo. Open the Mini App for instructions.",
            reply_markup=play_keyboard(),
        )
        return
    address = intent["address"]
    memo = intent["memo"]
    text = (
        "📥 <b>Deposit TON</b>\n\n"
        f"<b>Vault address:</b>\n<code>{address}</code>\n\n"
        f"<b>Memo (comment, required):</b>\n<code>{memo}</code>\n\n"
        "⚠️ Send any TON to that address with this exact memo. "
        "Auto-credited within ~30 seconds of confirmation."
    )
    await message.answer(
        text,
        parse_mode="HTML",
        reply_markup=play_keyboard("screen=deposit"),
        disable_web_page_preview=True,
    )


@router.message(Command("cases"))
async def cmd_cases(message: Message) -> None:
    try:
        cases = await internal_client.list_cases()
    except Exception:  # noqa: BLE001
        await message.answer(
            "⚠️ Couldn't fetch cases. Open the Mini App.",
            reply_markup=play_keyboard(),
        )
        return
    if not cases:
        await message.answer("No cases enabled yet.", reply_markup=play_keyboard())
        return
    await message.answer(
        "🎰 <b>Cases</b> — pick a tier:",
        parse_mode="HTML",
        reply_markup=cases_keyboard(cases),
    )


@router.message(F.text)
async def fallback_text(message: Message) -> None:
    """Any other text message — gently nudge user to the WebApp."""
    await message.answer(
        "🎰 Открой Lydomania кнопкой ниже / Tap to play 👇",
        reply_markup=play_keyboard(),
        disable_web_page_preview=True,
    )
