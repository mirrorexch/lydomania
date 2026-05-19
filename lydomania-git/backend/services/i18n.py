"""
Lydomania bot i18n.

Resolves a user's preferred language (from users.language_code) and renders
DM templates in EN or RU. Used by every notification enqueue path and by the
bot handlers.

Public API:
    pick_lang(value) -> "en"|"ru"          # normalises any tg lang code
    BOT_TEMPLATES                          # dict[key, {"en": ..., "ru": ...}]
    bot_text(lang, key, **fmt)             # render a single template
    user_lang_code(user_doc | tg_user)     # extract a normalised code
"""
from __future__ import annotations

from typing import Mapping


def pick_lang(value: str | None) -> str:
    if not value:
        return "en"
    v = value.lower()
    if v == "ru" or v.startswith("ru-") or v.startswith("ru_"):
        return "ru"
    return "en"


def user_lang_code(obj: Mapping | None) -> str:
    if not obj:
        return "en"
    return pick_lang(obj.get("language_code") or obj.get("lang"))


BOT_TEMPLATES: dict[str, dict[str, str]] = {
    # ── /start welcome ──
    "welcome": {
        "en": (
            "🎰 <b>Welcome to Lydomania!</b>\n"
            "Open TON cases — win Telegram NFT gifts 🎁\n\n"
            "Tap the button below to play 👇"
        ),
        "ru": (
            "🎰 <b>Добро пожаловать в Lydomania!</b>\n"
            "Открывай кейсы за TON — выигрывай NFT-подарки Telegram 🎁\n\n"
            "Нажми на кнопку ниже, чтобы играть 👇"
        ),
    },
    "welcome_ref_suffix": {
        "en": (
            "\n\n🎁 You were invited by a friend. Your wager rewards are connected — "
            "they earn a small share when you play."
        ),
        "ru": (
            "\n\n🎁 Тебя пригласил друг. Когда ты играешь, он получает небольшую долю "
            "от твоих ставок — навсегда."
        ),
    },

    # ── /help ──
    "help": {
        "en": (
            "🎮 <b>Lydomania · TON Casino</b>\n\n"
            "• 5 cases from 10 to 250 TON\n"
            "• Provably fair (commit-reveal)\n"
            "• Wins are Telegram NFT gifts\n"
            "• Network: TON Mainnet\n\n"
            "Commands:\n"
            "/start — open Mini App\n"
            "/balance — your TON balance\n"
            "/deposit — get a deposit memo\n"
            "/cases — pick a case\n"
            "/lang — change language\n"
            "/help — this message\n"
        ),
        "ru": (
            "🎮 <b>Lydomania · TON Casino</b>\n\n"
            "• 5 кейсов от 10 до 250 TON\n"
            "• Доказуемо честно (commit-reveal)\n"
            "• Выигрыши — NFT-подарки Telegram\n"
            "• Сеть: TON Mainnet\n\n"
            "Команды:\n"
            "/start — открыть Mini App\n"
            "/balance — баланс TON\n"
            "/deposit — получить memo для пополнения\n"
            "/cases — выбрать кейс\n"
            "/lang — сменить язык\n"
            "/help — это сообщение\n"
        ),
    },

    # ── /balance ──
    "balance_fetch_error": {
        "en": "⚠️ Couldn't fetch balance right now. Try again in a moment.",
        "ru": "⚠️ Не удалось получить баланс. Попробуй ещё раз через пару секунд.",
    },
    "balance_no_account": {
        "en": "👋 You don't have an account yet. Open the Mini App below to play.",
        "ru": "👋 Аккаунта ещё нет. Открой Mini App ниже, чтобы играть.",
    },
    "balance_text": {
        "en": "💰 <b>Balance:</b> {bal:.2f} TON\n🎁 <b>Referral pot:</b> {ref:.2f} TON",
        "ru": "💰 <b>Баланс:</b> {bal:.2f} TON\n🎁 <b>Реферальный кошелёк:</b> {ref:.2f} TON",
    },

    # ── /deposit ──
    "deposit_intent_fail": {
        "en": "⚠️ Couldn't generate a deposit memo. Open the Mini App for instructions.",
        "ru": "⚠️ Не удалось создать memo. Открой Mini App для инструкций.",
    },
    "deposit_text": {
        "en": (
            "📥 <b>Deposit TON</b>\n\n"
            "<b>Vault address:</b>\n<code>{address}</code>\n\n"
            "<b>Memo (comment, required):</b>\n<code>{memo}</code>\n\n"
            "⚠️ Send any TON to that address with this exact memo. "
            "Auto-credited within ~30 seconds of confirmation."
        ),
        "ru": (
            "📥 <b>Пополнить TON</b>\n\n"
            "<b>Адрес волта:</b>\n<code>{address}</code>\n\n"
            "<b>Memo (комментарий, обязательно):</b>\n<code>{memo}</code>\n\n"
            "⚠️ Отправь любую сумму TON на этот адрес с указанным memo. "
            "Зачисление автоматически в ~30 секунд после подтверждения."
        ),
    },

    # ── /cases ──
    "cases_fetch_fail": {
        "en": "⚠️ Couldn't fetch cases. Open the Mini App.",
        "ru": "⚠️ Не удалось загрузить кейсы. Открой Mini App.",
    },
    "cases_none": {
        "en": "No cases enabled yet.",
        "ru": "Пока ни один кейс не включён.",
    },
    "cases_pick": {
        "en": "🎰 <b>Cases</b> — pick a tier:",
        "ru": "🎰 <b>Кейсы</b> — выбери уровень:",
    },

    # ── fallback text ──
    "fallback_tap_to_play": {
        "en": "🎰 Tap the button below to play 👇",
        "ru": "🎰 Открой Lydomania кнопкой ниже 👇",
    },

    # ── /lang ──
    "lang_picker_title": {
        "en": "🌐 Choose your language:",
        "ru": "🌐 Выбери язык:",
    },
    "lang_updated": {
        "en": "✅ Language set to <b>English</b>.",
        "ru": "✅ Язык переключён на <b>Русский</b>.",
    },

    # ── DMs (producers) ──
    "deposit_confirmed": {
        "en": (
            "✅ <b>Deposit confirmed</b>\n<b>+{amount:.4f} TON</b>\n"
            "New balance: <b>{new_balance:.4f} TON</b>\n"
            "<a href=\"{tonscan}\">View transaction</a>"
        ),
        "ru": (
            "✅ <b>Пополнение зачислено</b>\n<b>+{amount:.4f} TON</b>\n"
            "Новый баланс: <b>{new_balance:.4f} TON</b>\n"
            "<a href=\"{tonscan}\">Открыть транзакцию</a>"
        ),
    },
    "withdraw_queued": {
        "en": (
            "📤 <b>Withdrawal queued</b>\nItem: <b>{item}</b>\n"
            "Value: {value:.2f} TON\nTo: <code>{addr_short}</code>\n\n"
            "We'll deliver the NFT gift within 24 hours."
        ),
        "ru": (
            "📤 <b>Вывод поставлен в очередь</b>\nПодарок: <b>{item}</b>\n"
            "Стоимость: {value:.2f} TON\nАдрес: <code>{addr_short}</code>\n\n"
            "Доставим NFT-подарок в течение 24 часов."
        ),
    },
    "withdraw_cancelled": {
        "en": "↩️ Withdrawal cancelled for <b>{item}</b>. The item is back in your collection.",
        "ru": "↩️ Вывод подарка <b>{item}</b> отменён. Подарок вернулся в твою коллекцию.",
    },
    "withdraw_processing": {
        "en": "⏳ Your withdrawal for <b>{item}</b> is now being processed by our team.",
        "ru": "⏳ Команда взяла твой вывод <b>{item}</b> в работу.",
    },
    "withdraw_fulfilled": {
        "en": (
            "✅ <b>{item} delivered!</b>\n{variant_line}"
            "Sent to: <code>{addr_short}</code>\n"
            "<a href=\"{tx_url}\">View transaction on TonViewer</a>"
        ),
        "ru": (
            "✅ <b>{item} доставлен!</b>\n{variant_line}"
            "Отправлено на: <code>{addr_short}</code>\n"
            "<a href=\"{tx_url}\">Открыть транзакцию на TonViewer</a>"
        ),
    },
    "withdraw_fulfilled_variant_line_with": {
        "en": "Variant: <i>{info}</i>\n",
        "ru": "Вариант: <i>{info}</i>\n",
    },
    "withdraw_fulfilled_variant_line_floor": {
        "en": "Variant: <i>cheapest available (floor)</i>\n",
        "ru": "Вариант: <i>самый дешёвый (флор)</i>\n",
    },
    "withdraw_rejected": {
        "en": (
            "❌ Withdrawal for <b>{item}</b> was rejected.\n"
            "Reason: <i>{reason}</i>\n\n"
            "The item is back in your collection — you can keep it, sell it, or try again."
        ),
        "ru": (
            "❌ Вывод подарка <b>{item}</b> отклонён.\n"
            "Причина: <i>{reason}</i>\n\n"
            "Подарок вернулся в коллекцию — оставь, продай или попробуй вывести ещё раз."
        ),
    },
    "big_win": {
        "en": (
            "🎉 <b>Big win!</b>\n"
            "{item} · <b>{payout:.2f} TON</b> · ×{mult:.2f}\n"
            "From case: {case}"
        ),
        "ru": (
            "🎉 <b>Большой выигрыш!</b>\n"
            "{item} · <b>{payout:.2f} TON</b> · ×{mult:.2f}\n"
            "Из кейса: {case}"
        ),
    },
}


def bot_text(lang: str, key: str, **fmt) -> str:
    entry = BOT_TEMPLATES.get(key)
    if not entry:
        return key
    template = entry.get(pick_lang(lang)) or entry.get("en") or key
    if fmt:
        try:
            return template.format(**fmt)
        except Exception:
            return template
    return template
