import { Monitor } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { setDesktop, setTyping, useDesktop, type DesktopTyping } from "@/lib/desktop";

export function DesktopControl() {
  const prefs = useDesktop();
  return <Card className="gap-0 py-0">
    <div className="flex items-center justify-between gap-4 p-4"><div className="flex min-w-0 items-start gap-3"><Monitor className="mt-0.5 size-5 shrink-0 text-muted-foreground" /><div className="min-w-0"><div className="font-medium">Desktop mode</div><p className="text-sm text-muted-foreground">Sidebar layout and direct keyboard typing. For a computer, not a phone.</p></div></div><Switch checked={prefs.on} onCheckedChange={setDesktop} aria-label="Desktop mode" /></div>
    {prefs.on && <div className="border-t border-border/60"><div className="flex items-center justify-between px-4 py-3"><span className="text-sm font-medium">Typing surface</span><div className="flex gap-1">{(["composer", "direct"] as DesktopTyping[]).map((typing) => <button type="button" key={typing} onClick={() => setTyping(typing)} className={`rounded px-2 py-1 text-sm ${prefs.typing === typing ? "bg-accent font-medium" : "text-muted-foreground"}`}>{typing[0]!.toUpperCase() + typing.slice(1)}</button>)}</div></div><div className="border-t border-border/60 px-4 py-3"><div className="text-sm font-medium">Idle pause</div><p className="text-xs text-muted-foreground">2 h on desktop. Pauses polling; it does not lock the shell — use your OS screen lock.</p></div></div>}
  </Card>;
}
