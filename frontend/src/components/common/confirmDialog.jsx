/**
 * Phase 10 / Fix-I extension — app-wide imperative confirm dialog backed
 * by shadcn <AlertDialog>. Replaces all remaining native window.confirm()
 * usages so the 14-point polish "no native popups" rule holds app-wide.
 *
 * Usage:
 *   import { confirmAsync } from "@/components/common/confirmDialog";
 *   if (!(await confirmAsync({ title: "Delete?", description: "..." }))) return;
 *
 * Mount <ConfirmRoot /> exactly once in App.js (already mounted).
 */
import React, { useEffect, useState } from "react";

import {
    AlertDialog, AlertDialogAction, AlertDialogCancel,
    AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
    AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

let _push = null;   // imperative entry-point bound by ConfirmRoot on mount

export function confirmAsync({
    title = "Are you sure?",
    description = "",
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    destructive = true,
} = {}) {
    return new Promise((resolve) => {
        if (!_push) {
            // ConfirmRoot not mounted — degrade gracefully but visibly.
            // eslint-disable-next-line no-console
            console.warn("[confirmAsync] ConfirmRoot is not mounted; resolving false.");
            resolve(false);
            return;
        }
        _push({ title, description, confirmLabel, cancelLabel, destructive, resolve });
    });
}

export const ConfirmRoot = () => {
    const [opts, setOpts] = useState(null);
    const open = !!opts;

    useEffect(() => {
        _push = setOpts;
        return () => { _push = null; };
    }, []);

    const close = (val) => {
        if (opts?.resolve) opts.resolve(val);
        setOpts(null);
    };

    return (
        <AlertDialog
            open={open}
            onOpenChange={(o) => { if (!o) close(false); }}
        >
            <AlertDialogContent
                data-testid="app-confirm-dialog"
                className="bg-zinc-900 border border-white/15 text-white max-w-[340px] sm:max-w-md"
            >
                <AlertDialogHeader>
                    <AlertDialogTitle
                        className="font-display text-base font-black tracking-tight"
                        data-testid="app-confirm-dialog-title"
                    >
                        {opts?.title}
                    </AlertDialogTitle>
                    {opts?.description ? (
                        <AlertDialogDescription
                            className="text-white/65 text-xs leading-relaxed"
                            data-testid="app-confirm-dialog-description"
                        >
                            {opts.description}
                        </AlertDialogDescription>
                    ) : null}
                </AlertDialogHeader>
                <AlertDialogFooter className="gap-2 sm:gap-2">
                    <AlertDialogCancel
                        data-testid="app-confirm-dialog-cancel"
                        className="bg-white/5 border border-white/15 text-white/70 hover:bg-white/10 hover:text-white"
                    >
                        {opts?.cancelLabel || "Cancel"}
                    </AlertDialogCancel>
                    <AlertDialogAction
                        data-testid="app-confirm-dialog-confirm"
                        onClick={() => close(true)}
                        className={
                            opts?.destructive
                                ? "bg-red-500 hover:bg-red-600 text-white border-0"
                                : "bg-cyber-cyan hover:bg-cyber-cyan/85 text-cyber-bg border-0 font-bold"
                        }
                    >
                        {opts?.confirmLabel || "Confirm"}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};

export default ConfirmRoot;
