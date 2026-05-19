"""Lydomania Telegram bot handlers (aiogram v3)."""

from __future__ import annotations

import os

from aiogram import F, Router
from aiogram.filters import Command, CommandObject, CommandStart
from aiogram.types import (
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
    WebAppInfo,
)

from bot import internal_client
from services.i18n import bot_text, pick_lang

router = Router(name="lydomania")


def _mini_app_url(extra_query: str = "") -> str:
    url = os.environ.get("MINI_APP_URL", "").strip()
    if not url:
        raise RuntimeError("MINI_APP_URL is not set")
    if extra_query:
        sep = "&" if "?" in url else "?"
        return f"{url}{sep}{extra_query}"
    return url


def _lang_from_message(message: Message) -> str:
    """
    Pick the best language for a bot reply. Order:
      1. Persisted users.language_code (if we have an account)
      2. Telegram client's language_code
      3. en fallback
    """
    return pick_lang(getattr(message.from_user, "language_code", None))


def play_keyboard(deep_link: str = "", lang: str = "en") -> InlineKeyboardMarkup:
    label = "🎰 Открыть Lydomania" if lang == "ru" else "🎰 Open Lydomania"
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text=label,
                    web_app=WebAppInfo(url=_mini_app_url(deep_link)),
                )
            ]
        ]
    )


def deposit_keyboard(lang: str = "en") -> InlineKeyboardMarkup:
    label = "📥 Пополнить" if lang == "ru" else "📥 Deposit"
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text=label,
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


def lang_picker_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[[
            InlineKeyboardButton(text="🇷🇺 Русский", callback_data="set_lang:ru"),
            InlineKeyboardButton(text="🇬🇧 English", callback_data="set_lang:en"),
        ]]
    )


async def _persist_lang(tg_user) -> None:
    """Best-effort sync of the user's Telegram language_code to DB."""
    if not tg_user or not getattr(tg_user, "id", None):
        return
    code = pick_lang(getattr(tg_user, "language_code", None))
    try:
        await internal_client.set_user_language(tg_user.id, code)
    except Exception:  # noqa: BLE001
        pass


@router.message(CommandStart())
async def cmd_start(message: Message, command: CommandObject) -> None:
    """Handle /start, including ref deep-link payloads /start ref_CODE."""
    await _persist_lang(message.from_user)
    lang = _lang_from_message(message)
    text = bot_text(lang, "welcome")
    if command and command.args:
        arg = command.args.strip()
        if arg.startswith("ref_"):
            code = arg[4:].upper()
            try:
                await internal_client.tag_referral(message.from_user.id, code)
            except Exception:  # noqa: BLE001
                pass
            text = text + bot_text(lang, "welcome_ref_suffix")

    await message.answer(
        text,
        parse_mode="HTML",
        reply_markup=play_keyboard(lang=lang),
        disable_web_page_preview=True,
    )


@router.message(Command("help"))
async def cmd_help(message: Message) -> None:
    await _persist_lang(message.from_user)
    lang = _lang_from_message(message)
    await message.answer(
        bot_text(lang, "help"),
        parse_mode="HTML",
        reply_markup=play_keyboard(lang=lang),
        disable_web_page_preview=True,
    )


@router.message(Command("balance"))
async def cmd_balance(message: Message) -> None:
    await _persist_lang(message.from_user)
    lang = _lang_from_message(message)
    try:
        info = await internal_client.get_balance(message.from_user.id)
    except Exception:  # noqa: BLE001
        await message.answer(
            bot_text(lang, "balance_fetch_error"),
            reply_markup=play_keyboard(lang=lang),
        )
        return
    if not info.get("exists"):
        await message.answer(
            bot_text(lang, "balance_no_account"),
            reply_markup=play_keyboard(lang=lang),
        )
        return
    bal = float(info.get("balance_ton", 0))
    ref = float(info.get("referral_balance_ton", 0))
    await message.answer(
        bot_text(lang, "balance_text", bal=bal, ref=ref),
        parse_mode="HTML",
        reply_markup=deposit_keyboard(lang=lang),
    )


@router.message(Command("deposit"))
async def cmd_deposit(message: Message) -> None:
    await _persist_lang(message.from_user)
    lang = _lang_from_message(message)
    try:
        intent = await internal_client.deposit_intent(message.from_user.id)
    except Exception:  # noqa: BLE001
        await message.answer(
            bot_text(lang, "deposit_intent_fail"),
            reply_markup=play_keyboard(lang=lang),
        )
        return
    await message.answer(
        bot_text(lang, "deposit_text", address=intent["address"], memo=intent["memo"]),
        parse_mode="HTML",
        reply_markup=play_keyboard("screen=deposit", lang=lang),
        disable_web_page_preview=True,
    )


@router.message(Command("cases"))
async def cmd_cases(message: Message) -> None:
    await _persist_lang(message.from_user)
    lang = _lang_from_message(message)
    try:
        cases = await internal_client.list_cases()
    except Exception:  # noqa: BLE001
        await message.answer(
            bot_text(lang, "cases_fetch_fail"),
            reply_markup=play_keyboard(lang=lang),
        )
        return
    if not cases:
        await message.answer(bot_text(lang, "cases_none"), reply_markup=play_keyboard(lang=lang))
        return
    await message.answer(
        bot_text(lang, "cases_pick"),
        parse_mode="HTML",
        reply_markup=cases_keyboard(cases),
    )


@router.message(Command("lang"))
async def cmd_lang(message: Message) -> None:
    lang = _lang_from_message(message)
    await message.answer(
        bot_text(lang, "lang_picker_title"),
        reply_markup=lang_picker_keyboard(),
    )


@router.callback_query(F.data.startswith("set_lang:"))
async def cb_set_lang(cb: CallbackQuery) -> None:
    chosen = pick_lang(cb.data.split(":", 1)[1])
    try:
        await internal_client.set_user_language(cb.from_user.id, chosen)
    except Exception:  # noqa: BLE001
        pass
    await cb.message.answer(
        bot_text(chosen, "lang_updated"),
        parse_mode="HTML",
        reply_markup=play_keyboard(lang=chosen),
    )
    try:
        await cb.answer()
    except Exception:  # noqa: BLE001
        pass


@router.message(F.text)
async def fallback_text(message: Message) -> None:
    """Any other text message — gently nudge user to the WebApp."""
    await _persist_lang(message.from_user)
    lang = _lang_from_message(message)
    await message.answer(
        bot_text(lang, "fallback_tap_to_play"),
        reply_markup=play_keyboard(lang=lang),
        disable_web_page_preview=True,
    )
