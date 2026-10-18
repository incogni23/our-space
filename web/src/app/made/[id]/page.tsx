"use client";
/* eslint-disable @next/next/no-img-element -- images come from our authenticated API */

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { StatusChip } from "@/components/creation-status";
import { Button, ErrorText, Loading, Screen, cx } from "@/components/ui";
import { api, errorMessage, photoUrl, uploadRender, type Creation, type Memory } from "@/lib/api";
import { useLiveTick } from "@/lib/live";
import { BACKGROUNDS, SIZES, render, toJpeg, type Background, type CaptionStyle, type Layout, type Reveal, type Size, type Spec } from "@/lib/render";
import { useSpace } from "@/lib/use-space";

type Step = "photos" | "look" | "details" | "who";
const STEPS: Step[] = ["photos", "look", "details", "who"];

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium">{label}</span>
      <div role="radiogroup" aria-label={label} className="grid rounded-(--radius-control) bg-sunken p-[3px]" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map(([v, l]) => (
          <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)} className={cx("min-h-10 rounded-[9px] text-[13px] text-ink", value === v ? "bg-surface font-semibold" : "font-medium")}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

// Made by Us: E1 pick · E2 look · E3 details · E4 who sees it · E5 approvals and links
export default function CreationPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const { ready, me, partner, readOnly } = useSpace();
  const tick = useLiveTick(["creation."], ready);
  const [c, setC] = useState<Creation | null>(null);
  const [memory, setMemory] = useState<Memory | null>(null);
  const [spec, setSpec] = useState<Spec | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [audience, setAudience] = useState<Creation["audience"]>("ask_export");
  const [comment, setComment] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [linkDays, setLinkDays] = useState(7);
  const [newLink, setNewLink] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const mine = !!c && !!me && c.createdBy === me.user.id;
  const pName = partner?.displayName || "your person";

  useEffect(() => {
    if (!ready) return;
    api<{ creation: Creation }>(`/creations/${id}`)
      .then((r) => {
        setC(r.creation);
        setSpec((s) => s ?? r.creation.spec);
        setStep((cur) => {
          if (cur !== null) return cur;
          const isMine = r.creation.createdBy === me?.user.id;
          if (!isMine || r.creation.status !== "draft" || readOnly) return null;
          return r.creation.version === 0 ? "photos" : "who";
        });
      })
      .catch((e) => setError(errorMessage(e)));
  }, [ready, id, tick, me?.user.id, readOnly]);

  useEffect(() => {
    if (!ready || !c?.memoryId || memory) return;
    api<{ memory: Memory }>(`/memories/${c.memoryId}`)
      .then((r) => setMemory(r.memory))
      .catch(() => {});
  }, [ready, c?.memoryId, memory]);

  // Live preview: the same renderer that makes the export.
  useEffect(() => {
    if (!spec || !canvasRef.current || step === "photos" || step === null) return;
    const t = setTimeout(() => void render(canvasRef.current!, spec).catch(() => {}), 120);
    return () => clearTimeout(t);
  }, [spec, step]);

  const update = useCallback((patch: Partial<Spec>) => setSpec((s) => (s ? { ...s, ...patch } : s)), []);

  async function saveSpec() {
    if (!spec) return;
    const r = await api<{ creation: Creation }>(`/creations/${id}`, { method: "PATCH", body: { spec } });
    setC(r.creation);
  }

  async function go(next: Step | null) {
    setError(null);
    try {
      if (next === "who" && spec && canvasRef.current) {
        setBusy("render");
        await saveSpec();
        await render(canvasRef.current, spec);
        const blob = await toJpeg(canvasRef.current);
        setC(await uploadRender(id, blob));
      } else if (step && next) {
        await saveSpec();
      }
      setStep(next);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function act(path: string, body: unknown, key: string) {
    setBusy(key);
    setError(null);
    try {
      const r = await api<{ creation: Creation }>(`/creations/${id}/${path}`, { body });
      setC(r.creation);
      return r.creation;
    } catch (err) {
      setError(errorMessage(err));
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function makeLink() {
    setBusy("link");
    setError(null);
    try {
      const r = await api<{ url: string }>(`/creations/${id}/links`, { body: { days: linkDays } });
      setNewLink(r.url);
      const fresh = await api<{ creation: Creation }>(`/creations/${id}`);
      setC(fresh.creation);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function revoke(linkId: string) {
    setBusy("revoke");
    try {
      await api(`/creations/${id}/links/${linkId}/revoke`, { body: {} });
      const fresh = await api<{ creation: Creation }>(`/creations/${id}`);
      setC(fresh.creation);
      setNewLink(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    try {
      await api(`/creations/${id}`, { method: "DELETE" });
      router.replace("/made");
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function setFocus(e: MouseEvent<HTMLCanvasElement>) {
    if (!spec || spec.layout !== "softlaunch" || spec.reveal === "full") return;
    const r = e.currentTarget.getBoundingClientRect();
    const zoom = spec.reveal === "faceless" ? 2.4 : 1.35;
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    update({ focus: { x: Math.min(1, Math.max(0, spec.focus.x + px / zoom)), y: Math.min(1, Math.max(0, spec.focus.y + py / zoom)) } });
  }

  if (!ready || !me || (!c && !error)) return <Loading />;
  if (!c || !spec) {
    return (
      <Screen className="px-4">
        <ErrorText>{error}</ErrorText>
        <Link href="/made">Back to Made by Us</Link>
      </Screen>
    );
  }

  // ---------- Editor (maker, before sending) ----------
  if (mine && step && !readOnly) {
    const idx = STEPS.indexOf(step);
    const soft = c.format === "softlaunch";
    const pool = memory?.photos ?? [];
    return (
      <main className="flex min-h-dvh flex-col bg-sunken text-ink">
        <div className="mx-auto flex w-full max-w-[440px] flex-1 flex-col">
          <div className="flex items-center justify-between px-4 pt-[52px]">
            <button type="button" aria-label="Back" onClick={() => (idx === 0 ? router.push("/made") : void go(STEPS[idx - 1]))} className="-ml-2.5 flex size-11 items-center justify-center text-ink">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M15 6l-6 6 6 6" />
              </svg>
            </button>
            <span className="font-stamp text-[11px] uppercase tracking-[0.1em] text-muted">
              Made by Us · {idx + 1} of 4
            </span>
            <span className="w-8" />
          </div>

          {step === "photos" ? (
            <div className="flex flex-1 flex-col gap-4 px-4 pb-32 pt-2">
              <h1 className="m-0 font-display text-[30px] font-normal leading-[1.05]">{soft ? "Pick a photo" : "Pick photos"}</h1>
              <span className="text-[13px] text-muted">
                From <strong className="font-semibold text-ink">{memory?.title ?? "…"}</strong>
              </span>
              <div className="grid grid-cols-3 gap-1.5">
                {pool.map((p) => {
                  const pos = spec.photos.indexOf(p.id);
                  const on = pos >= 0;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      aria-pressed={on}
                      aria-label={on ? `Photo, chosen ${pos + 1}` : "Photo"}
                      onClick={() =>
                        update({ photos: soft ? [p.id] : on ? spec.photos.filter((x) => x !== p.id) : [...spec.photos, p.id].slice(0, 6) })
                      }
                      className={cx("relative aspect-square overflow-hidden rounded-md bg-surface", on && "shadow-[inset_0_0_0_3px_var(--text-primary)]")}
                    >
                      <img src={photoUrl(p.id)} alt="" className="size-full object-cover" />
                      <span className={cx("absolute right-1.5 top-1.5 flex size-[26px] items-center justify-center rounded-full border-2 text-[13px] font-semibold text-[#FFFCF7]", on ? "border-[#FFFCF7] bg-[#44353E]" : "border-[rgba(255,252,247,0.9)] bg-[rgba(46,35,41,0.25)]")}>
                        {on ? (soft ? "✓" : pos + 1) : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="m-0 text-[13px] leading-[1.5] text-muted">Tap in the order you want them. Photos only leave the space if you both say so later.</p>
              <div className="fixed inset-x-0 bottom-0 border-t border-line bg-surface px-4 pb-[max(env(safe-area-inset-bottom),24px)] pt-3">
                <div className="mx-auto flex max-w-[408px] items-center justify-between gap-3">
                  <span className="text-sm">
                    <strong className="font-semibold">{spec.photos.length} chosen</strong>
                  </span>
                  <Button className="w-auto px-5" onClick={() => go("look")} disabled={spec.photos.length === 0}>
                    {soft ? "Choose the look" : "Choose a layout"}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-1 items-center justify-center px-4 py-3">
                <canvas
                  ref={canvasRef}
                  onClick={setFocus}
                  tabIndex={soft && spec.reveal !== "full" && step === "look" ? 0 : -1}
                  onKeyDown={(e) => {
                    if (!soft || spec.reveal === "full") return;
                    const d = { ArrowLeft: [-0.03, 0], ArrowRight: [0.03, 0], ArrowUp: [0, -0.03], ArrowDown: [0, 0.03] }[e.key];
                    if (!d) return;
                    e.preventDefault();
                    update({ focus: { x: Math.min(1, Math.max(0, spec.focus.x + d[0])), y: Math.min(1, Math.max(0, spec.focus.y + d[1])) } });
                  }}
                  role="img"
                  aria-label={soft && spec.reveal !== "full" ? "Preview. Tap, or use the arrow keys, to choose what to crop in on." : "Preview of what you’re making"}
                  className={cx("max-h-[46vh] w-auto max-w-full bg-surface shadow-(--shadow-lift)", soft && spec.reveal !== "full" && step === "look" && "cursor-crosshair")}
                  style={{ aspectRatio: `${SIZES[spec.size].w} / ${SIZES[spec.size].h}` }}
                />
              </div>
              <div className="flex flex-col gap-3.5 rounded-t-(--radius-sheet) bg-surface px-4 pb-8 pt-4">
                {step === "look" ? (
                  soft ? (
                    <>
                      <Segmented<Reveal> label="How much to reveal" value={spec.reveal} onChange={(v) => update({ reveal: v })} options={[["faceless", "Faceless"], ["hint", "Hint"], ["full", "Full reveal"]]} />
                      <span className="text-xs leading-[1.45] text-muted">
                        {spec.reveal === "faceless" ? "No faces, no names. Tap the preview to choose what to crop in on." : spec.reveal === "hint" ? "Initials and a date, for people who know. Tap the preview to recentre." : `Faces and names shown. ${pName} approves before it leaves the space.`}
                      </span>
                    </>
                  ) : (
                    <Segmented<Layout> label="Layout" value={spec.layout} onChange={(v) => update({ layout: v })} options={[["grid", "Clean grid"], ["film", "Film strip"], ["loose", "Photo dump"]]} />
                  )
                ) : null}
                {step === "look" ? (
                  <Segmented<Size> label="Size" value={spec.size} onChange={(v) => update({ size: v })} options={[["post", "4:5 post"], ["story", "9:16 story"], ["square", "1:1 square"]]} />
                ) : null}

                {step === "details" ? (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="cap" className="text-[13px] font-medium">
                        Caption
                      </label>
                      <input id="cap" maxLength={60} value={spec.caption} onChange={(e) => update({ caption: e.target.value })} className="h-12 rounded-(--radius-control) border border-line-control bg-surface px-3.5 font-display text-lg italic text-ink focus:border-2 focus:border-ink focus:outline-none" />
                    </div>
                    {soft ? (
                      <div className="grid grid-cols-2 gap-2">
                        <label className="flex flex-col gap-1.5 text-[13px] font-medium">
                          Sticker
                          <input maxLength={14} value={spec.sticker} onChange={(e) => update({ sticker: e.target.value })} className="h-11 rounded-(--radius-control) border border-line-control bg-surface px-3 font-display text-base italic font-normal text-ink" />
                        </label>
                        <label className="flex flex-col gap-1.5 text-[13px] font-medium">
                          Date stamp
                          <input maxLength={16} value={spec.dateStamp} onChange={(e) => update({ dateStamp: e.target.value })} className="h-11 rounded-(--radius-control) border border-line-control bg-surface px-3 font-stamp text-sm font-normal text-ink" />
                        </label>
                      </div>
                    ) : (
                      <>
                        {spec.layout !== "film" ? <Segmented<CaptionStyle> label="Caption style" value={spec.captionStyle} onChange={(v) => update({ captionStyle: v })} options={[["serif", "Serif"], ["sans", "Sans"], ["stamp", "STAMP"]]} /> : null}
                        {spec.layout !== "film" ? (
                          <Segmented<Background> label="Background" value={spec.background} onChange={(v) => update({ background: v })} options={(Object.keys(BACKGROUNDS) as Background[]).map((b) => [b, BACKGROUNDS[b].label])} />
                        ) : null}
                        {spec.layout !== "loose" ? (
                          <label className="flex flex-col gap-1.5 text-[13px] font-medium">
                            <span className="flex justify-between">
                              Space between photos <span className="font-stamp text-muted">{spec.gap}</span>
                            </span>
                            <input type="range" min={0} max={20} value={spec.gap} onChange={(e) => update({ gap: Number(e.target.value) })} className="h-11 accent-[var(--action-primary)]" />
                          </label>
                        ) : null}
                      </>
                    )}
                  </>
                ) : null}

                {step === "who" ? (
                  <>
                    <h2 className="m-0 font-display text-2xl font-normal">Who sees it?</h2>
                    <div role="radiogroup" aria-label="Who sees it" className="flex flex-col gap-2">
                      {([
                        ["private", "Keep it between us", "Saved to Our Story › Made. Nothing leaves the space."],
                        ["ask_export", `Ask ${pName}, then export`, `${partner?.displayName || "They"} can approve, suggest a change, or say no. It’s “approved by both” only if they say yes.`],
                        ["ask_link", `Ask ${pName}, then share a link`, "A private link to just this image. You pick how long it lasts, and either of you can turn it off."],
                        ["solo", "Export just for me", `Not marked as approved by ${pName}. For yourself, not a post about you both.`],
                      ] as const).map(([v, t, d]) => (
                        <button key={v} type="button" role="radio" aria-checked={audience === v} onClick={() => setAudience(v)} className={cx("flex flex-col gap-0.5 rounded-(--radius-card) bg-surface p-3.5 text-left text-ink", audience === v ? "border-2 border-ink" : "border border-line")}>
                          <span className="text-[15px] font-semibold">{t}</span>
                          <span className="text-[13px] leading-[1.45] text-muted">{d}</span>
                        </button>
                      ))}
                    </div>
                    <div className="flex items-start gap-2.5 rounded-(--radius-control) bg-time-wash px-3.5 py-3 text-[13px] leading-[1.5]">
                      <span>
                        <strong className="font-semibold text-time-ink">Once it leaves the space, it can be copied.</strong> Files and screenshots can be reshared outside Between Us. Turning off a link stops the link, not the copies.
                      </span>
                    </div>
                    <span className="flex justify-between text-[13px] text-muted">
                      <span>Export as</span>
                      <span className="font-medium text-ink">
                        {SIZES[spec.size].w} × {SIZES[spec.size].h} JPG · no location
                      </span>
                    </span>
                  </>
                ) : null}

                <ErrorText>{error}</ErrorText>

                {step === "who" ? (
                  <Button
                    loading={busy === "audience"}
                    disabled={c.version === 0}
                    onClick={async () => {
                      const r = await act("audience", { audience }, "audience");
                      if (r) setStep(null);
                    }}
                  >
                    {audience === "private" ? "Save to Our Story" : audience === "solo" ? "Export for me" : `Approve and send to ${pName}`}
                  </Button>
                ) : (
                  <Button loading={busy === "render"} onClick={() => go(STEPS[idx + 1])}>
                    {step === "details" ? "Preview" : "Next"}
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </main>
    );
  }

  // ---------- Status, approvals and links (E5, F4) ----------
  const myLatest = c.decisions.find((d) => d.userId === me.user.id)?.decision;
  const partnerDecision = c.decisions.find((d) => d.userId !== me.user.id);
  const canDownload = (c.status === "solo" && mine) || c.status === "approved";
  const activeLinks = (c.links ?? []).filter((l) => !l.revokedAt && l.version === c.version && new Date(l.expiresAt) > new Date());
  const headline =
    c.status === "approved" ? "Ready to share" : c.status === "awaiting" ? (mine ? `Sent to ${pName}` : `${pName} made this`) : c.status === "declined" ? "Staying between you" : c.status === "change_requested" ? (mine ? `${pName} suggested a change` : "You suggested a change") : c.status === "private" ? "Saved to Made" : c.status === "solo" ? "Just for you" : "Draft";

  return (
    <Screen className="gap-4 px-4 pb-12 pt-[52px]">
      <div className="flex items-center justify-between">
        <Link href="/made" className="-ml-1.5 flex min-h-11 items-center gap-1 text-[15px] text-ink no-underline">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" />
          </svg>
          Made by Us
        </Link>
        {mine && !readOnly ? (
          <button type="button" onClick={() => setStep("look")} className="min-h-11 rounded-(--radius-control) border border-line bg-surface px-3.5 text-sm font-medium text-ink">
            Edit
          </button>
        ) : null}
      </div>

      <div className="flex items-center gap-4">
        <div className="w-[104px] flex-none overflow-hidden bg-surface shadow-(--shadow-lift)">
          {c.renderMediaId ? <img src={photoUrl(c.renderMediaId)} alt="What was made" className="block w-full" /> : <span className="block aspect-[4/5] bg-sunken" />}
        </div>
        <div className="flex flex-col gap-2">
          <h1 className="m-0 font-display text-[26px] font-normal leading-[1.1]">{headline}</h1>
          <span>
            <StatusChip status={c.status} partnerName={pName} mine={mine} />
          </span>
        </div>
      </div>

      {c.audience === "ask_export" || c.audience === "ask_link" ? (
        <div className="flex flex-col rounded-(--radius-card) border border-line bg-surface">
          {[me.user.id, partner?.id].filter(Boolean).map((uid, i) => {
            const d = c.decisions.find((x) => x.userId === uid);
            const isMe = uid === me.user.id;
            const name = isMe ? "You" : pName;
            const line = !d ? `${name} haven’t decided yet`.replace("You haven’t", "You haven’t").replace(`${pName} haven’t`, `${pName} hasn’t`) : d.decision === "approved" ? `${name} approved` : d.decision === "change" ? `${name} suggested a change` : d.decision === "declined" ? `${name} would rather not share this one` : `${name} took back approval`;
            return (
              <div key={uid} className={cx("flex flex-col gap-0.5 p-3.5", i > 0 && "border-t border-sunken")}>
                <span className="text-[15px] font-semibold">{line}</span>
                {d?.comment ? <span className="font-display text-[15px] italic text-muted">“{d.comment}”</span> : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {!mine && !readOnly && (c.status === "awaiting" || c.status === "approved" || c.status === "change_requested" || c.status === "declined") && myLatest !== "approved" ? (
        <div className="flex flex-col gap-3 rounded-2xl bg-surface p-4 shadow-(--shadow-paper)">
          <span className="font-display text-[19px] leading-[1.3]">{pName} made this from your photos. Okay to share it outside the space?</span>
          {suggesting ? (
            <>
              <label htmlFor="suggest" className="text-[13px] font-medium">
                What would you change?
              </label>
              <textarea id="suggest" rows={2} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} className="resize-none rounded-(--radius-control) border border-line-control bg-surface px-3 py-2.5 text-[15px] text-ink" />
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" className="min-h-12 text-sm" onClick={() => setSuggesting(false)}>
                  Back
                </Button>
                <Button className="min-h-12 text-sm" loading={busy === "change"} disabled={!comment.trim()} onClick={async () => { if (await act("respond", { decision: "change", comment }, "change")) setSuggesting(false); }}>
                  Send
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Button className="min-h-12 text-sm" loading={busy === "approve"} onClick={() => act("respond", { decision: "approved" }, "approve")}>
                  Approve
                </Button>
                <Button variant="secondary" className="min-h-12 text-sm" onClick={() => setSuggesting(true)}>
                  Suggest a change
                </Button>
              </div>
              <Button variant="text" className="min-h-10 text-sm" loading={busy === "decline"} onClick={() => act("respond", { decision: "declined" }, "decline")}>
                Not this one
              </Button>
            </>
          )}
        </div>
      ) : null}

      {canDownload ? (
        <a href={`/api/v1/creations/${c.id}/download`} className="flex min-h-[52px] items-center justify-center gap-2.5 rounded-(--radius-card) bg-action text-base font-medium text-action-text no-underline">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 4v11M7 10l5 5 5-5M5 19h14" />
          </svg>
          {c.status === "approved" ? "Export · approved by both" : "Export for me"}
        </a>
      ) : c.status === "awaiting" && mine ? (
        <p className="m-0 text-center text-[13px] text-muted">Export opens when {pName} approves. Editing asks again.</p>
      ) : null}

      {c.audience === "ask_link" && c.status === "approved" && !readOnly ? (
        <section className="flex flex-col gap-2.5 rounded-(--radius-card) border border-line bg-surface p-4" aria-labelledby="linkhead">
          <h2 id="linkhead" className="m-0 text-[15px] font-semibold">
            Preview link
          </h2>
          {activeLinks.map((l) => (
            <div key={l.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="text-muted">On · stops {new Date(l.expiresAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
              <button type="button" onClick={() => revoke(l.id)} className="min-h-11 px-2 font-medium text-danger">
                Turn off
              </button>
            </div>
          ))}
          {newLink ? (
            <div className="flex flex-col gap-1.5">
              <span className="break-all rounded-(--radius-control) bg-sunken px-3 py-2.5 font-stamp text-xs">{newLink}</span>
              <button type="button" onClick={() => navigator.clipboard.writeText(newLink).catch(() => {})} className="min-h-11 self-start text-sm font-medium underline underline-offset-[3px]">
                Copy link
              </button>
              <span className="text-xs text-muted">Shown once. Anyone with it can see this image, nothing else.</span>
            </div>
          ) : (
            <>
              <Segmented<string> label="Stops working after" value={String(linkDays)} onChange={(v) => setLinkDays(Number(v))} options={[["1", "24 hours"], ["7", "7 days"], ["30", "30 days"]]} />
              <Button variant="secondary" className="min-h-12 text-[15px]" loading={busy === "link"} onClick={makeLink}>
                Make a link
              </Button>
            </>
          )}
          <span className="text-xs leading-[1.5] text-muted">Turning it off stops the link, not copies. We don’t track who opens it.</span>
        </section>
      ) : null}

      <ErrorText>{error}</ErrorText>

      {!readOnly && (c.status === "approved" || c.status === "awaiting") && myLatest === "approved" ? (
        <button type="button" onClick={() => act("withdraw", {}, "withdraw")} className="min-h-11 text-sm font-medium text-danger">
          Withdraw my approval
        </button>
      ) : null}
      {partnerDecision && c.status === "change_requested" && mine ? (
        <Button variant="secondary" onClick={() => setStep("look")}>
          Make the change
        </Button>
      ) : null}
      {mine && !readOnly ? (
        <button type="button" onClick={remove} className="min-h-11 text-sm font-medium text-muted underline underline-offset-[3px]">
          Delete
        </button>
      ) : null}
    </Screen>
  );
}
