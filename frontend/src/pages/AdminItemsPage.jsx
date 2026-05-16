import React, { useEffect, useState, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
    Plus, Loader2, Layers, Edit3, RefreshCcw, Upload, Trash2, X as XIcon,
    Check, Search, Download,
} from "lucide-react";
import {
    adminListItems, adminCreateItem, adminPatchItem, adminDeleteItem,
    adminRefetchItemFromFragment, adminUploadItemImage, resolveImage,
} from "@/lib/api";
import { RARITY_HEX, RARITY_LABEL } from "@/lib/rarity";

const RARITIES = ["common", "rare", "epic", "legendary", "mythic", "jackpot"];

const ItemEditor = ({ open, initial, onClose, onSaved }) => {
    const isCreate = !initial;
    const [slug, setSlug] = useState("");
    const [name, setName] = useState("");
    const [rarity, setRarity] = useState("common");
    const [floor, setFloor] = useState("");
    const [busy, setBusy] = useState(false);
    const [refetching, setRefetching] = useState(false);
    const [uploading, setUploading] = useState(false);
    const fileRef = useRef(null);

    useEffect(() => {
        if (!open) return;
        if (initial) {
            setSlug(initial.slug); setName(initial.name); setRarity(initial.rarity);
            setFloor(String(initial.floor_price_ton ?? 0));
        } else {
            setSlug(""); setName(""); setRarity("common"); setFloor("0");
        }
    }, [open, initial]);

    const handleSave = async () => {
        if (busy) return;
        setBusy(true);
        try {
            if (isCreate) {
                await adminCreateItem({ slug, name, rarity, floor_price_ton: Number(floor) });
                toast.success("Item created");
            } else {
                await adminPatchItem(initial.slug, {
                    name, rarity, floor_price_ton: Number(floor),
                });
                toast.success("Item saved");
            }
            onSaved?.();
            onClose?.();
        } catch (e) {
            toast.error("Save failed", { description: e?.response?.data?.detail || e?.message });
        } finally {
            setBusy(false);
        }
    };

    const handleRefetch = async () => {
        if (refetching || isCreate) return;
        setRefetching(true);
        try {
            const r = await adminRefetchItemFromFragment(initial.slug);
            toast.success("Refetched from Fragment", { description: `${r.size_bytes}b` });
            onSaved?.();
        } catch (e) {
            toast.error("Refetch failed", { description: e?.response?.data?.detail || e?.message });
        } finally {
            setRefetching(false);
        }
    };

    const handleUpload = async (e) => {
        const f = e.target.files?.[0];
        if (!f || isCreate) return;
        setUploading(true);
        try {
            await adminUploadItemImage(initial.slug, f);
            toast.success("Image uploaded");
            onSaved?.();
        } catch (err) {
            toast.error("Upload failed", { description: err?.response?.data?.detail || err?.message });
        } finally {
            setUploading(false);
        }
    };

    if (!open) return null;
    const color = RARITY_HEX[rarity] || RARITY_HEX.common;

    return (
        <div onClick={onClose} className="fixed inset-0 z-[80] bg-cyber-bg/90 backdrop-blur-md flex items-start justify-center p-2 overflow-y-auto" data-testid="item-editor-backdrop">
            <motion.div initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} onClick={(e) => e.stopPropagation()}
                className="w-full max-w-[440px] my-3 rounded-2xl bg-cyber-surface border border-cyber-cyan/30 p-4"
                data-testid="item-editor">
                <div className="flex items-center justify-between mb-2">
                    <div className="inline-flex items-center gap-1.5 text-xs uppercase font-black tracking-[0.2em] text-cyber-cyan">
                        <Layers className="w-4 h-4" /> {isCreate ? "New Item" : `Edit · ${initial?.slug}`}
                    </div>
                    <button onClick={onClose} className="text-white/40 hover:text-white p-1"><XIcon className="w-4 h-4" /></button>
                </div>

                {!isCreate && (
                    <div className="flex items-center gap-3 mb-3 p-2 bg-cyber-bg/60 rounded-lg border border-white/10">
                        <div className="w-14 h-14 rounded-lg bg-cyber-bg flex items-center justify-center"
                            style={{ boxShadow: `inset 0 0 14px ${color}33`, border: `1px solid ${color}44` }}>
                            <img src={resolveImage(initial.image_url)} alt="" className="w-10 h-10 object-contain"
                                style={{ filter: `drop-shadow(0 0 6px ${color}88)` }} />
                        </div>
                        <div className="flex-1">
                            <div className="text-[9px] font-black uppercase tracking-[0.15em]" style={{ color }}>
                                {RARITY_LABEL[initial.rarity]} · {initial.cases_using} case(s)
                            </div>
                            <div className="font-mono text-[11px] text-white/55 truncate">{initial.image_path}</div>
                        </div>
                    </div>
                )}

                <label className="text-[9.5px] uppercase font-bold tracking-[0.2em] text-white/50">Slug *</label>
                <input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))}
                    disabled={!isCreate} data-testid="item-edit-slug"
                    className="mt-1 w-full bg-cyber-bg/80 border border-white/10 focus:border-cyber-cyan rounded-lg px-3 py-2 text-xs font-mono outline-none mb-2 disabled:opacity-50" />

                <label className="text-[9.5px] uppercase font-bold tracking-[0.2em] text-white/50">Name *</label>
                <input value={name} onChange={(e) => setName(e.target.value)} data-testid="item-edit-name"
                    className="mt-1 w-full bg-cyber-bg/80 border border-white/10 focus:border-cyber-cyan rounded-lg px-3 py-2 text-xs outline-none mb-2" />

                <div className="grid grid-cols-2 gap-2 mb-2">
                    <div>
                        <label className="text-[9.5px] uppercase font-bold tracking-[0.2em] text-white/50">Rarity</label>
                        <select value={rarity} onChange={(e) => setRarity(e.target.value)} data-testid="item-edit-rarity"
                            className="mt-1 w-full bg-cyber-bg/80 border border-white/10 focus:border-cyber-cyan rounded-lg px-3 py-2 text-xs outline-none font-bold">
                            {RARITIES.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="text-[9.5px] uppercase font-bold tracking-[0.2em] text-white/50">Floor TON</label>
                        <input type="number" step="0.01" value={floor} onChange={(e) => setFloor(e.target.value)} data-testid="item-edit-floor"
                            className="mt-1 w-full bg-cyber-bg/80 border border-white/10 focus:border-cyber-cyan rounded-lg px-3 py-2 text-xs font-mono outline-none" />
                    </div>
                </div>

                {!isCreate && (
                    <div className="grid grid-cols-2 gap-2 mb-2">
                        <button onClick={handleRefetch} disabled={refetching}
                            data-testid="item-edit-refetch-btn"
                            className="inline-flex items-center justify-center gap-1 text-[10px] font-black uppercase tracking-wider px-3 py-2 rounded-lg bg-cyber-purple/15 border border-cyber-purple/40 text-cyber-purple hover:bg-cyber-purple/25 disabled:opacity-40">
                            {refetching ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                            Refetch Fragment
                        </button>
                        <label className="inline-flex items-center justify-center gap-1 text-[10px] font-black uppercase tracking-wider px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/20 cursor-pointer"
                            data-testid="item-edit-upload-btn">
                            {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                            Upload Image
                            <input ref={fileRef} onChange={handleUpload} type="file" accept="image/*" className="hidden" />
                        </label>
                    </div>
                )}

                <div className="flex gap-2 mt-3">
                    <button onClick={onClose} className="flex-1 text-xs font-black uppercase tracking-wider bg-white/5 border border-white/10 hover:bg-white/10 rounded-lg py-2.5">Cancel</button>
                    <button onClick={handleSave} disabled={busy || !slug || !name} data-testid="item-edit-save-btn"
                        className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-black uppercase tracking-wider rounded-lg py-2.5 disabled:opacity-40 bg-gradient-to-r from-cyber-cyan to-emerald-400 text-cyber-bg">
                        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                        {isCreate ? "Create" : "Save"}
                    </button>
                </div>
            </motion.div>
        </div>
    );
};

export const AdminItemsPage = () => {
    const [items, setItems] = useState([]);
    const [rarity, setRarity] = useState("all");
    const [search, setSearch] = useState("");
    const [loading, setLoading] = useState(false);
    const [editor, setEditor] = useState({ open: false, initial: null });

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            const r = await adminListItems({ rarity, search });
            setItems(r);
        } catch (e) {
            toast.error("Load failed", { description: e?.message });
        } finally {
            setLoading(false);
        }
    }, [rarity, search]);

    useEffect(() => { reload(); }, [reload]);

    const handleDelete = async (item) => {
        if (item.cases_using > 0) {
            toast.error("Cannot delete", { description: `Item is used in ${item.cases_using} case(s) — remove from baskets first.` });
            return;
        }
        if (!window.confirm(`Delete item ${item.name}?`)) return;
        try {
            await adminDeleteItem(item.slug);
            toast.success("Item deleted");
            await reload();
        } catch (e) {
            toast.error("Delete failed", { description: e?.response?.data?.detail || e?.message });
        }
    };

    return (
        <div data-testid="admin-items-page">
            <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] text-white/60">{items.length} item{items.length === 1 ? "" : "s"}</div>
                <div className="flex items-center gap-2">
                    <button onClick={reload} className="text-white/40 hover:text-cyber-cyan p-1" data-testid="admin-items-refresh"><RefreshCcw className="w-4 h-4" /></button>
                    <button onClick={() => setEditor({ open: true, initial: null })} data-testid="admin-items-new-btn"
                        className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-3 py-1.5 rounded-lg bg-gradient-to-r from-cyber-cyan to-cyber-purple text-cyber-bg hover:brightness-110">
                        <Plus className="w-3 h-3" /> New
                    </button>
                </div>
            </div>
            <div className="relative mb-2">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by slug or name" data-testid="admin-items-search"
                    className="w-full bg-cyber-surface border border-white/10 focus:border-cyber-cyan/40 rounded-lg pl-9 pr-3 py-2 text-xs outline-none" />
            </div>
            <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1">
                {["all", ...RARITIES].map((r) => (
                    <button key={r} onClick={() => setRarity(r)} data-testid={`admin-items-rarity-${r}`}
                        className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md border whitespace-nowrap transition ${
                            rarity === r ? "bg-cyber-cyan/15 border-cyber-cyan/50 text-cyber-cyan" : "bg-white/5 border-white/10 text-white/60"
                        }`}>{r}</button>
                ))}
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-16 text-white/40"><Loader2 className="w-5 h-5 animate-spin" /></div>
            ) : (
                <div className="grid grid-cols-2 gap-2" data-testid="admin-items-list">
                    {items.map((it) => {
                        const color = RARITY_HEX[it.rarity] || RARITY_HEX.common;
                        return (
                            <motion.div key={it.slug} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                                className="rounded-xl bg-cyber-surface border border-white/10 p-2.5"
                                data-testid={`admin-item-${it.slug}`}>
                                <div className="flex items-center gap-2">
                                    <div className="w-12 h-12 rounded-lg bg-cyber-bg flex items-center justify-center"
                                        style={{ boxShadow: `inset 0 0 12px ${color}33`, border: `1px solid ${color}44` }}>
                                        <img src={resolveImage(it.image_url)} alt="" className="w-9 h-9 object-contain"
                                            style={{ filter: `drop-shadow(0 0 6px ${color}88)` }} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-[8.5px] font-black uppercase tracking-[0.15em]" style={{ color }}>
                                            {RARITY_LABEL[it.rarity]}
                                        </div>
                                        <div className="font-bold text-[11px] truncate" title={it.name}>{it.name}</div>
                                        <div className="text-[9px] text-white/45 font-mono truncate">
                                            {it.floor_price_ton}t · {it.cases_using}c
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1 mt-1.5 pt-1.5 border-t border-white/8">
                                    <button onClick={() => setEditor({ open: true, initial: it })}
                                        data-testid={`admin-item-edit-${it.slug}`}
                                        className="flex-1 inline-flex items-center justify-center gap-1 text-[9.5px] font-bold uppercase tracking-wider px-2 py-1 rounded-md bg-cyber-cyan/10 border border-cyber-cyan/30 text-cyber-cyan hover:bg-cyber-cyan/20">
                                        <Edit3 className="w-2.5 h-2.5" /> Edit
                                    </button>
                                    <button onClick={() => handleDelete(it)} disabled={it.cases_using > 0}
                                        data-testid={`admin-item-delete-${it.slug}`}
                                        className="inline-flex items-center justify-center gap-1 text-[9.5px] font-bold uppercase tracking-wider px-2 py-1 rounded-md bg-red-500/10 border border-red-500/30 text-red-300 hover:bg-red-500/20 disabled:opacity-30">
                                        <Trash2 className="w-2.5 h-2.5" />
                                    </button>
                                </div>
                            </motion.div>
                        );
                    })}
                </div>
            )}

            <ItemEditor open={editor.open} initial={editor.initial}
                onClose={() => setEditor({ open: false, initial: null })}
                onSaved={reload} />
        </div>
    );
};

export default AdminItemsPage;
