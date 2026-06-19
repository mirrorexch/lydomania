/**
 * Comprehensive admin user view — search a player and see EVERYTHING:
 * profile, money trail (deposits/withdrawals/credits), inventory + gift
 * deposits, game activity, referrals + season. Readable by admins and
 * read-only support staff. Crediting is admin-only (gated by isAdmin).
 */
import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
    Search, User, Coins, Gift, Gamepad2, Users as UsersIcon, Loader2, Plus,
} from "lucide-react";
import { adminSearchUsers, adminUserOverview, adminCreditUser, resolveImage } from "@/lib/api";
import { formatTON } from "@/lib/rarity";

const fmtDate = (iso) => {
    if (!iso) return "—";
    try { return new Date(iso).toLocaleString(); } catch { return String(iso); }
};
const net = (won, spent) => {
    const n = Number(won || 0) - Number(spent || 0);
    return { n, cls: n >= 0 ? "pos" : "neg", s: `${n >= 0 ? "+" : ""}${formatTON(n)}` };
};

const Stat = ({ k, v, tone }) => (
    <div className="v-adstat"><div className="k">{k}</div><div className={`v ${tone || ""}`}>{v}</div></div>
);

const Section = ({ icon: Icon, title, children }) => (
    <section className="v-adsec">
        <div className="hd"><Icon className="w-3.5 h-3.5" /> {title}</div>
        <div className="bd">{children}</div>
    </section>
);

// One game's roll-up: count, wagered, won, net.
function GameRow({ label, g, wagerKey, wonKey = "payout_ton" }) {
    if (!g || !g.count) return <div className="v-adli"><span className="l">{label}</span><span className="r">—</span></div>;
    const wagered = g.totals?.[wagerKey] || 0;
    const won = g.totals?.[wonKey] || 0;
    const { cls, s } = net(won, wagered);
    return (
        <div className="v-adli">
            <span className="l">{label} · {g.count}×</span>
            <span className="r">{formatTON(wagered)} → {formatTON(won)}</span>
            <span className={cls} style={{ width: 64, textAlign: "right" }}>{s}</span>
        </div>
    );
}

export default function AdminUserDetailPage({ isAdmin = true }) {
    const [q, setQ] = useState("");
    const [results, setResults] = useState(null);
    const [searching, setSearching] = useState(false);
    const [tid, setTid] = useState(null);
    const [ov, setOv] = useState(null);
    const [loading, setLoading] = useState(false);
    const [amount, setAmount] = useState("");
    const [crediting, setCrediting] = useState(false);

    const runSearch = useCallback(async () => {
        if (!q.trim()) return;
        setSearching(true);
        try { setResults((await adminSearchUsers(q.trim())).rows || []); }
        catch (e) { toast.error(e?.response?.data?.detail || "search failed"); }
        finally { setSearching(false); }
    }, [q]);

    const loadUser = useCallback(async (telegramId) => {
        setTid(telegramId); setResults(null); setQ(""); setLoading(true); setOv(null);
        try {
            const data = await adminUserOverview(telegramId);
            if (!data.found) { toast.error("user not found"); setOv(null); }
            else setOv(data);
        } catch (e) { toast.error(e?.response?.data?.detail || "load failed"); }
        finally { setLoading(false); }
    }, []);

    const credit = useCallback(async () => {
        const amt = parseFloat(amount);
        if (!amt || amt <= 0) { toast.error("Enter an amount"); return; }
        setCrediting(true);
        try {
            const r = await adminCreditUser(tid, amt, "admin_panel");
            toast.success(`+${formatTON(amt)} TON · new balance ${formatTON(r.balance_after)} TON`);
            setAmount("");
            loadUser(tid);
        } catch (e) { toast.error(e?.response?.data?.detail || "credit failed"); }
        finally { setCrediting(false); }
    }, [amount, tid, loadUser]);

    useEffect(() => {
        const id = setTimeout(() => { if (q.trim().length >= 2) runSearch(); }, 350);
        return () => clearTimeout(id);
    }, [q, runSearch]);

    const p = ov?.profile, m = ov?.money, inv = ov?.inventory, gm = ov?.games, rf = ov?.referrals;

    return (
        <div data-testid="admin-user-detail">
            <div className="flex items-center gap-2 mb-3">
                <h2 className="v-disp" style={{ font: "600 18px 'Space Grotesk'" }}>Players</h2>
                <span className={`v-adtag ${isAdmin ? "" : "support"}`}>{isAdmin ? "Admin" : "Support · read-only"}</span>
            </div>

            <div className="v-adsearch">
                <input
                    value={q} onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && runSearch()}
                    placeholder="Search telegram_id or @username"
                    data-testid="admin-user-search"
                />
                <button className="v-ghost" onClick={runSearch}>
                    {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                </button>
            </div>

            {results && results.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                    {results.map((r) => (
                        <div key={r.telegram_id} className="v-adresult" onClick={() => loadUser(r.telegram_id)} data-testid={`admin-user-result-${r.telegram_id}`}>
                            {r.photo_url ? <img className="av" src={r.photo_url} alt="" /> : <span className="av" />}
                            <span className="nm">{r.first_name || r.username || "Player"}<small>{r.username ? `@${r.username}` : ""} · {r.telegram_id}</small></span>
                            <span className="bal">{formatTON(r.balance_ton)} TON</span>
                        </div>
                    ))}
                </div>
            )}
            {results && results.length === 0 && <div className="v-adempty">No players match.</div>}

            {loading && <div className="flex justify-center py-10" style={{ color: "var(--v-muted-2)" }}><Loader2 className="w-5 h-5 animate-spin" /></div>}

            {ov && p && (
                <>
                    {/* Profile */}
                    <Section icon={User} title="Profile">
                        <div className="flex items-center gap-3 mb-2">
                            {p.photo_url ? <img src={p.photo_url} alt="" className="v-avatar" style={{ width: 44, height: 44 }} /> : <div className="v-avatar ph" style={{ width: 44, height: 44, font: "700 16px 'Space Grotesk'" }}>{(p.first_name || p.username || "L").slice(0, 1).toUpperCase()}</div>}
                            <div>
                                <div className="v-idname" style={{ font: "600 15px 'Space Grotesk'" }}>{p.first_name || p.username || "Player"}</div>
                                <div className="v-idhandle">{p.username ? `@${p.username}` : ""} · {p.telegram_id}</div>
                            </div>
                        </div>
                        <div className="v-admeta">
                            <div>joined <b>{fmtDate(p.created_at)}</b></div>
                            <div>last seen <b>{fmtDate(p.last_seen)}</b></div>
                            <div>VIP <b>{p.vip_tier || "—"}</b> · ref code <b>{p.ref_code || "—"}</b> · lang <b>{p.language_code || "—"}</b></div>
                        </div>
                    </Section>

                    {/* Money */}
                    <Section icon={Coins} title="Money">
                        <div className="v-adstats">
                            <Stat k="Balance" v={`${formatTON(m.balance_ton)} TON`} tone="gold" />
                            <Stat k="Lifetime wagered" v={`${formatTON(m.lifetime_wagered_ton)} TON`} />
                            <Stat k="Deposited" v={`${formatTON(m.deposits.totals?.amount_ton)} TON`} tone="em" />
                            <Stat k="Manual credits" v={`${formatTON(m.manual_credits.totals?.amount_ton)} TON`} />
                        </div>
                        <div className="v-adlist">
                            {(m.deposits.recent || []).slice(0, 5).map((d, i) => (
                                <div key={i} className="v-adli"><span className="l">deposit {d.credited ? "" : "(pending) "}{fmtDate(d.created_at)}</span><span className="r pos">+{formatTON(d.amount_ton)} TON</span></div>
                            ))}
                            {(m.withdrawals.recent || []).slice(0, 5).map((w, i) => (
                                <div key={`w${i}`} className="v-adli"><span className="l">withdraw {w.status} · {w.item_name || ""}</span><span className="r">{formatTON(w.payout_ton)} TON</span></div>
                            ))}
                            {(m.manual_credits.recent || []).slice(0, 4).map((c, i) => (
                                <div key={`c${i}`} className="v-adli"><span className="l">credit · {c.reason} · {fmtDate(c.created_at)}</span><span className="r pos">+{formatTON(c.amount_ton)}</span></div>
                            ))}
                            {!m.deposits.count && !m.withdrawals.count && !m.manual_credits.count && <div className="v-adempty">No money activity.</div>}
                        </div>
                        {isAdmin && (
                            <div className="v-adcredit">
                                <input type="number" placeholder="Credit TON…" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="admin-credit-amount" />
                                <button className="v-cta v-sm" onClick={credit} disabled={crediting} data-testid="admin-credit-btn">
                                    {crediting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Credit
                                </button>
                            </div>
                        )}
                    </Section>

                    {/* Inventory + gift deposits */}
                    <Section icon={Gift} title="Inventory & gift deposits">
                        <div className="v-adstats">
                            <Stat k="Items held" v={inv.held} />
                            <Stat k="Held value" v={`${formatTON(inv.held_value_ton)} TON`} tone="gold" />
                            <Stat k="Items ever" v={inv.count} />
                            <Stat k="Gift deposits" v={inv.gift_deposits.count} />
                        </div>
                        <div className="v-adlist">
                            {(inv.recent || []).slice(0, 8).map((it, i) => (
                                <div key={i} className="v-adli">
                                    {resolveImage(it.image_url || (it.image_path ? `/static/${it.image_path}` : "")) ? <img src={resolveImage(it.image_url || `/static/${it.image_path}`)} alt="" style={{ width: 20, height: 20, borderRadius: 5, objectFit: "cover" }} /> : null}
                                    <span className="l">{it.item_name || it.item_slug} · {it.status}</span>
                                    <span className="r">{formatTON(it.payout_ton)} TON</span>
                                </div>
                            ))}
                            {!inv.count && <div className="v-adempty">No inventory.</div>}
                        </div>
                    </Section>

                    {/* Games */}
                    <Section icon={Gamepad2} title="Game activity">
                        <div className="v-adlist">
                            <GameRow label="Cases" g={gm.case_opens} wagerKey="case_price_ton" />
                            <GameRow label="Crash" g={gm.crash} wagerKey="amount_ton" />
                            <GameRow label="Mines" g={gm.mines} wagerKey="bet_ton" />
                            <GameRow label="Wheel" g={gm.wheel} wagerKey="cost_ton" />
                            <GameRow label="Plinko" g={gm.plinko} wagerKey="bet_ton" />
                            <div className="v-adli"><span className="l">Battles · {gm.battles.count}×</span><span className="r">{formatTON(gm.battles.totals?.entry_ton)} TON entry</span></div>
                        </div>
                    </Section>

                    {/* Referrals + season */}
                    <Section icon={UsersIcon} title="Referrals & season">
                        <div className="v-admeta">
                            <div>referred by <b>{rf.referred_by ? (rf.referred_by.username ? `@${rf.referred_by.username}` : rf.referred_by.telegram_id) : "—"}</b></div>
                            <div>invited <b>{rf.invited_count}</b> players</div>
                            <div>season XP <b>{rf.season?.xp ?? 0}</b> · premium <b>{rf.season?.premium_unlocked ? "yes" : "no"}</b></div>
                        </div>
                    </Section>
                </>
            )}
        </div>
    );
}
