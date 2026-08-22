import { File, Folder, Download, Copy, ChevronRight, ExternalLink } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLoaderData, useNavigate, useRouteLoaderData } from "react-router";
import { AppHeader } from "@/components/app-header";
import { filesPath, filePath } from "@/lib/nav";
import { downloadFileUrl, openFileUrl, searchFiles } from "@/lib/api";
import { ROOT_ROUTE_ID, type FilesData, type HomeData } from "@/lib/loaders";
import type { FileSearchResponse } from "@/lib/types";
import { baseName, timeAgo } from "@/lib/format";

export function FilesRoute() {
  const loaded = useLoaderData() as FilesData;
  const home = useRouteLoaderData(ROOT_ROUTE_ID) as HomeData;
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FileSearchResponse | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    if (query.trim().length < 2) { setResults(null); return; }
    const controller = new AbortController(); abort.current?.abort(); abort.current = controller;
    const timer = setTimeout(() => searchFiles(query, controller.signal).then(setResults).catch(() => {}), 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);
  const parts = loaded.rel ? loaded.rel.split("/") : [];
  const parent = parts.slice(0, -1).join("/");
  const back = loaded.rel ? () => navigate(parent ? filePath(parent, home.session) : filesPath(home.session)) : undefined;
  const title = loaded.rel ? baseName(loaded.rel) : "Files";
  if (loaded.error || !loaded.data) return <div className="flex flex-1 items-center justify-center p-6 text-muted-foreground">{loaded.rel ? "Not found" : "Files isn't turned on — set COLLIE_WORK_ROOT on the host"}</div>;
  const data = loaded.data;
  return <div className="mx-auto flex min-h-0 w-full max-w-screen-sm flex-1 flex-col"><AppHeader bridge={home.bridge} error={home.error} wordmark={false} onBack={back}><span className="truncate font-semibold">{title}</span></AppHeader>
    <div className="p-3"><input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find files" inputMode="search" autoCapitalize="off" autoCorrect="off" className="w-full rounded border bg-background px-3 py-2" /></div>
    {results ? <div className="flex-1 overflow-auto px-3">{results.truncated && <p className="p-2 text-xs text-muted-foreground">Showing first 200 matches</p>}{results.results.map((r) => <button className="flex w-full items-center gap-3 border-b p-3 text-left" key={r.path} onClick={() => navigate(filePath(r.path, home.session))}>{r.kind === "dir" ? <Folder /> : <File />}<span className="flex-1">{r.name}</span>{r.kind === "dir" && <ChevronRight className="size-4" />}</button>)}</div> : data.kind === "dir" ? <div className="flex-1 overflow-auto px-3">{data.entries.map((e) => { const p = loaded.rel ? `${loaded.rel}/${e.name}` : e.name; return <button className="flex w-full items-center gap-3 border-b p-3 text-left" key={e.name} onClick={() => navigate(filePath(p, home.session))}>{e.kind === "dir" ? <Folder /> : <File />}<span className="flex-1"><span className="block">{e.name}</span>{e.kind === "file" && <span className="text-xs text-muted-foreground">{e.size} bytes · {timeAgo(e.mtimeMs)}</span>}</span>{e.kind === "dir" && <ChevronRight className="size-4" />}</button>; })}</div> : <FileDetail data={data} />}
  </div>;
}
function FileDetail({ data }: { data: Extract<FilesData["data"], { kind: "file" }> }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(data.path); } catch { const t = document.createElement("textarea"); t.value = data.path; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove(); } setCopied(true); setTimeout(() => setCopied(false), 1500); };
  const src = openFileUrl(data.path);
  return <div className="flex-1 overflow-auto p-3"><div className="mb-3 flex flex-wrap gap-2">{data.openInBrowser && <a className="rounded bg-primary px-3 py-2 text-primary-foreground" href={src} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-1 inline size-4" />Open in browser</a>}<button className="rounded bg-primary px-3 py-2 text-primary-foreground" onClick={copy}><Copy className="mr-1 inline size-4" />{copied ? "Copied" : "Copy path"}</button><a className="rounded bg-primary px-3 py-2 text-primary-foreground" href={downloadFileUrl(data.path)} download={data.name}><Download className="mr-1 inline size-4" />Download</a></div><FilePreview data={data} src={src} /></div>;
}

function FilePreview({ data, src }: { data: Extract<FilesData["data"], { kind: "file" }>; src: string }) {
  if (data.embed === "image") return <img src={src} alt={data.name} className="max-h-[70dvh] max-w-full object-contain" />;
  if (data.embed === "video") return <video src={src} controls playsInline preload="metadata" className="max-h-[70dvh] w-full bg-black" />;
  if (data.embed === "audio") return <audio src={src} controls preload="metadata" className="w-full" />;
  if (data.binary) return <p className="text-muted-foreground">{data.openInBrowser ? "Can't preview this file here — open it in the browser or download it" : "Can't preview this file — download it instead"}</p>;
  return <><pre className="whitespace-pre-wrap break-words font-mono text-sm">{data.text}</pre>{data.truncated && <p className="text-xs text-muted-foreground">truncated at 512 KB</p>}</>;
}
