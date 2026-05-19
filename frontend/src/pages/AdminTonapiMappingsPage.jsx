import React, { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Plus, Trash2, Pencil, Database, Save, X, Loader2 } from "lucide-react";

import { http } from "@/lib/api";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel,
    AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
    AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const PRM = () =>
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const EMPTY_FORM = {
    collection_address: "",
    item_template_id: "",
    rarity_floor_ton: "",
    image_override_url: "",
    seeded_for_demo: false,
};

export const AdminTonapiMappingsPage = () => {
    const { t } = useTranslation();
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);
    const [formOpen, setFormOpen] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);
    const [busy, setBusy] = useState(false);
    // Fix-I: shadcn AlertDialog instead of native window.confirm()
    const [confirmRow, setConfirmRow] = useState(null);

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            const { data } = await http.get("/admin/tonapi-mappings");
            setRows(data?.rows || []);
        } catch (e) {
            toast.error(e?.response?.data?.detail || "Load failed");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        reload();
    }, [reload]);

    const openAdd = () => {
        setForm(EMPTY_FORM);
        setFormOpen(true);
    };
    const openEdit = (row) => {
        setForm({
            collection_address: row.collection_address || "",
            item_template_id: row.item_template_id || "",
            rarity_floor_ton: String(row.rarity_floor_ton ?? ""),
            image_override_url: row.image_override_url || "",
            seeded_for_demo: !!row.seeded_for_demo,
        });
        setFormOpen(true);
    };
    const closeForm = () => {
        setFormOpen(false);
        setForm(EMPTY_FORM);
    };

    const save = async () => {
        const payload = {
            collection_address: form.collection_address.trim(),
            item_template_id: form.item_template_id.trim(),
            rarity_floor_ton: parseFloat(form.rarity_floor_ton) || 0,
            image_override_url: form.image_override_url.trim() || null,
            seeded_for_demo: !!form.seeded_for_demo,
        };
        if (!payload.collection_address || !payload.item_template_id) {
            toast.error(t("admin_tonapi.form_collection"));
            return;
        }
        setBusy(true);
        try {
            await http.post("/admin/tonapi-mappings", payload);
            toast.success(t("admin_tonapi.saved"));
            closeForm();
            await reload();
        } catch (e) {
            toast.error(e?.response?.data?.detail || "Save failed");
        } finally {
            setBusy(false);
        }
    };

    const removeRow = async (row) => {
        // Fix-I: open shadcn AlertDialog instead of native window.confirm()
        setConfirmRow(row);
    };

    const confirmDelete = async () => {
        const row = confirmRow;
        if (!row) return;
        setBusy(true);
        try {
            await http.delete(`/admin/tonapi-mappings/${row.id}`);
            toast.success(t("admin_tonapi.deleted"));
            await reload();
        } catch (e) {
            toast.error(e?.response?.data?.detail || "Delete failed");
        } finally {
            setBusy(false);
            setConfirmRow(null);
        }
    };

    const seed = async () => {
        setBusy(true);
        try {
            const { data } = await http.post("/admin/tonapi-mappings/seed-demos");
            toast.success(t("admin_tonapi.seeded_n", { n: data?.seeded ?? 0 }));
            await reload();
        } catch (e) {
            toast.error(e?.response?.data?.detail || "Seed failed");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div data-testid="admin-tonapi-page" className="space-y-3">
            <div className="flex items-center justify-between gap-2">
                <div>
                    <h2 className="font-display text-lg font-black tracking-tight text-white">
                        {t("admin_tonapi.title")}
                    </h2>
                    <p className="text-[11px] text-white/45 leading-snug max-w-md">
                        {t("admin_tonapi.subtitle")}
                    </p>
                </div>
                <div className="flex flex-col gap-1.5 flex-shrink-0">
                    <button
                        data-testid="admin-tonapi-add"
                        onClick={openAdd}
                        className="text-[10px] font-black uppercase tracking-wider bg-cyber-cyan/15 border border-cyber-cyan/45 hover:border-cyber-cyan/80 text-cyber-cyan rounded-lg px-3 py-1.5 inline-flex items-center gap-1"
                    >
                        <Plus className="w-3 h-3" /> {t("admin_tonapi.add_btn")}
                    </button>
                    <button
                        data-testid="admin-tonapi-seed"
                        onClick={seed}
                        disabled={busy}
                        className="text-[10px] font-bold uppercase tracking-wider bg-white/5 border border-white/15 hover:bg-white/10 text-white/70 rounded-lg px-3 py-1.5 inline-flex items-center gap-1 disabled:opacity-50"
                    >
                        <Database className="w-3 h-3" /> {t("admin_tonapi.seed_demos")}
                    </button>
                </div>
            </div>

            <div className="rounded-xl bg-cyber-surface/60 border border-white/10 overflow-hidden">
                {loading ? (
                    <div className="p-6 text-center text-white/40 text-sm inline-flex items-center justify-center gap-2 w-full">
                        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                    </div>
                ) : rows.length === 0 ? (
                    <div className="p-6 text-center text-xs text-white/45" data-testid="admin-tonapi-empty">
                        {t("admin_tonapi.empty")}
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-[11px]">
                            <thead className="bg-black/30 text-white/45 uppercase tracking-wider">
                                <tr>
                                    <th className="text-left px-2 py-2 font-bold">{t("admin_tonapi.th_collection")}</th>
                                    <th className="text-left px-2 py-2 font-bold">{t("admin_tonapi.th_template")}</th>
                                    <th className="text-right px-2 py-2 font-bold">{t("admin_tonapi.th_floor")}</th>
                                    <th className="text-center px-2 py-2 font-bold">{t("admin_tonapi.th_demo")}</th>
                                    <th className="text-right px-2 py-2 font-bold w-20"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row) => (
                                    <tr key={row.id} data-testid={`admin-tonapi-row-${row.id}`} className="border-t border-white/5 hover:bg-white/3">
                                        <td className="px-2 py-2 font-mono text-white/80 truncate max-w-[140px]" title={row.collection_address}>
                                            {row.collection_address}
                                        </td>
                                        <td className="px-2 py-2 font-mono text-cyber-cyan">{row.item_template_id}</td>
                                        <td className="px-2 py-2 text-right font-mono tabular-nums">{Number(row.rarity_floor_ton).toFixed(2)}</td>
                                        <td className="px-2 py-2 text-center">{row.seeded_for_demo ? "·" : ""}</td>
                                        <td className="px-2 py-2 text-right">
                                            <div className="inline-flex gap-1">
                                                <button
                                                    data-testid={`admin-tonapi-edit-${row.id}`}
                                                    onClick={() => openEdit(row)}
                                                    aria-label={t("admin_tonapi.edit")}
                                                    className="p-1.5 rounded-md text-white/60 hover:text-cyber-cyan hover:bg-white/5"
                                                >
                                                    <Pencil className="w-3 h-3" />
                                                </button>
                                                <button
                                                    data-testid={`admin-tonapi-delete-${row.id}`}
                                                    onClick={() => removeRow(row)}
                                                    aria-label={t("admin_tonapi.delete")}
                                                    className="p-1.5 rounded-md text-white/60 hover:text-red-400 hover:bg-white/5"
                                                >
                                                    <Trash2 className="w-3 h-3" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <AnimatePresence>
                {formOpen && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: PRM() ? 0 : 0.16 }}
                        onClick={closeForm}
                        className="fixed inset-0 z-[60] bg-zinc-950/85 backdrop-blur-sm flex items-end sm:items-center justify-center p-3"
                        data-testid="admin-tonapi-modal"
                    >
                        <motion.div
                            initial={PRM() ? false : { y: 28, opacity: 0, scale: 0.97 }}
                            animate={{ y: 0, opacity: 1, scale: 1 }}
                            exit={PRM() ? { opacity: 0 } : { y: 16, opacity: 0 }}
                            transition={{ type: "spring", damping: 26, stiffness: 280 }}
                            onClick={(e) => e.stopPropagation()}
                            className="relative w-full max-w-md rounded-2xl bg-zinc-900 border border-cyber-cyan/25 overflow-hidden"
                        >
                            <button
                                onClick={closeForm}
                                aria-label="Close"
                                className="absolute top-3 right-3 p-1.5 rounded-md text-white/55 hover:text-white"
                                data-testid="admin-tonapi-modal-close"
                            >
                                <X className="w-4 h-4" />
                            </button>
                            <div className="px-5 pt-5 pb-3 border-b border-white/8">
                                <h2 className="text-base font-bold text-white">{t("admin_tonapi.title")}</h2>
                            </div>
                            <div className="px-5 py-4 space-y-3">
                                <Field label={t("admin_tonapi.form_collection")} testid="admin-tonapi-form-collection">
                                    <input
                                        type="text"
                                        value={form.collection_address}
                                        onChange={(e) => setForm({ ...form, collection_address: e.target.value })}
                                        className="w-full px-3 py-2 rounded-md bg-black/40 border border-white/10 text-white font-mono text-xs"
                                        autoFocus
                                    />
                                </Field>
                                <Field label={t("admin_tonapi.form_template")} testid="admin-tonapi-form-template">
                                    <input
                                        type="text"
                                        value={form.item_template_id}
                                        onChange={(e) => setForm({ ...form, item_template_id: e.target.value })}
                                        className="w-full px-3 py-2 rounded-md bg-black/40 border border-white/10 text-white font-mono text-xs"
                                    />
                                </Field>
                                <Field label={t("admin_tonapi.form_floor")} testid="admin-tonapi-form-floor">
                                    <input
                                        type="number"
                                        step="0.1"
                                        min="0"
                                        value={form.rarity_floor_ton}
                                        onChange={(e) => setForm({ ...form, rarity_floor_ton: e.target.value })}
                                        className="w-full px-3 py-2 rounded-md bg-black/40 border border-white/10 text-white font-mono text-sm"
                                    />
                                </Field>
                                <Field label={t("admin_tonapi.form_image")} testid="admin-tonapi-form-image">
                                    <input
                                        type="text"
                                        value={form.image_override_url}
                                        onChange={(e) => setForm({ ...form, image_override_url: e.target.value })}
                                        className="w-full px-3 py-2 rounded-md bg-black/40 border border-white/10 text-white font-mono text-xs"
                                    />
                                </Field>
                                <label className="flex items-center gap-2 text-xs text-white/65 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={form.seeded_for_demo}
                                        onChange={(e) => setForm({ ...form, seeded_for_demo: e.target.checked })}
                                        data-testid="admin-tonapi-form-demo"
                                    />
                                    {t("admin_tonapi.form_demo")}
                                </label>
                            </div>
                            <div className="px-5 pb-5 flex gap-2">
                                <button
                                    onClick={closeForm}
                                    className="flex-1 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white/70 text-sm font-bold hover:text-white"
                                    data-testid="admin-tonapi-form-cancel"
                                >
                                    {t("common.cancel")}
                                </button>
                                <button
                                    onClick={save}
                                    disabled={busy}
                                    className="flex-1 py-2.5 rounded-lg bg-gradient-to-r from-cyber-cyan to-cyber-purple text-cyber-bg font-bold text-sm disabled:opacity-40 inline-flex items-center justify-center gap-1.5"
                                    data-testid="admin-tonapi-form-save"
                                >
                                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                                    {t("admin_tonapi.save")}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Fix-I: shadcn confirm dialog replaces native window.confirm() */}
            <AlertDialog
                open={!!confirmRow}
                onOpenChange={(o) => !o && setConfirmRow(null)}
            >
                <AlertDialogContent
                    data-testid="admin-tonapi-confirm-delete"
                    className="bg-zinc-900 border border-red-500/40 text-white max-w-[340px] sm:max-w-md"
                >
                    <AlertDialogHeader>
                        <AlertDialogTitle className="font-display text-base font-black tracking-tight">
                            {t("admin_tonapi.confirm_delete")}
                        </AlertDialogTitle>
                        <AlertDialogDescription className="text-white/60 font-mono text-[11px] break-all">
                            {confirmRow?.collection_address} → {confirmRow?.item_template_id}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="gap-2 sm:gap-2">
                        <AlertDialogCancel
                            data-testid="admin-tonapi-confirm-cancel"
                            className="bg-white/5 border border-white/15 text-white/70 hover:bg-white/10 hover:text-white"
                        >
                            {t("common.cancel")}
                        </AlertDialogCancel>
                        <AlertDialogAction
                            data-testid="admin-tonapi-confirm-yes"
                            onClick={confirmDelete}
                            disabled={busy}
                            className="bg-red-500 hover:bg-red-600 text-white border-0"
                        >
                            {t("admin_tonapi.delete")}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

const Field = ({ label, testid, children }) => (
    <div data-testid={testid}>
        <label className="text-[10px] uppercase tracking-widest text-white/45 font-bold block mb-1">
            {label}
        </label>
        {children}
    </div>
);

export default AdminTonapiMappingsPage;
