import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";

import { BottomSheet } from "@/components/ui/sheet";
import { ActionPopover } from "@/components/ui/popover";
import { useDesktop } from "@/lib/desktop";
import { ActionRow, RenameView } from "@/components/action-sheet-rows";
import * as api from "@/lib/api";
import { setStatus } from "@/lib/status";
import type { WorkspaceView } from "@/lib/types";

interface SpaceActionsSheetProps {
  open: boolean;
  onClose: () => void;
  /** The space these actions target. Null while nothing is selected (sheet closed). */
  workspace: WorkspaceView | null;
  /** Session scope for the rename write (undefined = primary). */
  session?: string;
  /** This device isn't authorised to write — show a read-only note instead of the actions. */
  readOnly?: boolean;
  /** Fired after a successful rename so the parent can revalidate. */
  onRenamed: () => void;
  anchor?: { x: number; y: number } | null;
}

type Mode = "actions" | "rename";

// Long-press actions for a single space — the tab actions sheet minus the destructive row (Collie
// deliberately offers no space close/delete): opens on an action-list view (Rename), with rename
// tucked behind its own tap so opening the sheet never shoves a keyboard-triggering input at you.
// Shares the action row + rename view (action-sheet-rows) with the tab/pane sheets so they can't drift.
// Like a tab, a space has no "clear" (herdr requires a non-empty string), so a blank field can't be
// saved — Save disables. The label is user text rendered only into an <input> value / text node — never
// markup. Rename is a write, so under read-only it is replaced by a note.
export function SpaceActionsSheet({
  open,
  onClose,
  workspace,
  session,
  readOnly = false,
  onRenamed,
  anchor = null,
}: SpaceActionsSheetProps) {
  const desktop = useDesktop().on;
  const [mode, setMode] = useState<Mode>("actions");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset to the action list — and reprefill the label — whenever the sheet opens on a (new) space,
  // AND whenever it closes, so reopening never lands you mid-rename. Intentionally NOT keyed on the
  // live label, so a background poll landing while you type can't clobber your edit.
  useEffect(() => {
    setMode("actions");
    if (!open) return;
    setLabel(workspace?.label ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workspace?.workspaceId]);

  // Autofocus the label input when rename mode opens, so the phone keyboard pops without a second tap.
  useEffect(() => {
    if (mode === "rename") inputRef.current?.focus();
  }, [mode]);

  const trimmed = label.trim();

  async function save() {
    if (!workspace || saving || !trimmed) return;
    setSaving(true);
    try {
      const res = await api.renameSpace(workspace.workspaceId, trimmed, session);
      if (res.ok) {
        setStatus("Renamed", "success");
        onRenamed();
        onClose();
      } else {
        setStatus(res.error ?? "Rename failed", "error");
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSaving(false);
    }
  }

  const title = workspace ? `Space ${workspace.label}` : "Space";
  const body = readOnly ? (
        <p className="py-2 text-sm text-muted-foreground">
          Read-only — this device isn't authorised to rename spaces.
        </p>
      ) : mode === "actions" ? (
        <div className="flex flex-col gap-1">
          <ActionRow
            icon={<Pencil className="size-4 shrink-0 text-muted-foreground" />}
            label="Rename"
            onClick={() => setMode("rename")}
          />
        </div>
      ) : (
        <RenameView
          inputRef={inputRef}
          label={label}
          onLabelChange={setLabel}
          onSave={() => void save()}
          onBack={() => setMode("actions")}
          saving={saving}
          // A space has no "clear" (herdr requires a non-empty string), so a blank field can't be
          // saved — Save disables.
          canSave={!!trimmed}
          placeholder="name this space"
        />
      );
  return desktop ? (
    <ActionPopover open={open} onClose={onClose} anchor={anchor} title={title}>{body}</ActionPopover>
  ) : (
    <BottomSheet open={open} onClose={onClose} title={title}>{body}</BottomSheet>
  );
}
