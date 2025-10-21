import { useEffect, useRef, useState } from "react";
import { Document, Packer, Paragraph, HeadingLevel, TextRun } from "docx";

/* ---------- Helpers ---------- */
function escapeHTML(s) {
  return s.replace(/[&<>"']/g, ch => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[ch]));
}
function highlightHTML(text, keywords = []) {
  if (!text) return "";
  const ks = (keywords || []).filter(Boolean).map(k => k.trim()).filter(Boolean);
  if (!ks.length) return escapeHTML(text);
  const escaped = ks.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts = text.split(re);
  return parts.map((part, i) =>
    i % 2 === 1 ? `<mark class="hl">${escapeHTML(part)}</mark>` : escapeHTML(part)
  ).join("");
}

/* ---------- Toasts ---------- */
function useToasts() {
  const [toasts, setToasts] = useState([]);
  function show(msg, ms = 2200) {
    const id = Math.random().toString(36).slice(2);
    setToasts(t => [...t, { id, msg }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), ms);
  }
  return { toasts, show };
}

/* ---------- History (localStorage) ---------- */
const HIST_KEY = "ai_resume_reviewer_history_v2"; // v2: store resume snapshot + env

function pushHistory(item) {
  const arr = JSON.parse(localStorage.getItem(HIST_KEY) || "[]");
  arr.unshift(item);
  localStorage.setItem(HIST_KEY, JSON.stringify(arr.slice(0, 5)));
}
function readHistory() {
  try { return JSON.parse(localStorage.getItem(HIST_KEY) || "[]"); }
  catch { return []; }
}
function clearHistory() { localStorage.removeItem(HIST_KEY); }

/* ---------- Theme ---------- */
const THEME_KEY = "ai_resume_reviewer_theme";
function getTheme() { return localStorage.getItem(THEME_KEY) || "light"; }

export default function App() {
  /* ---------- State ---------- */
  const [resumeFile, setResumeFile] = useState(null);            // real file (if user picks)
  const [resumeSnap, setResumeSnap] = useState("");              // text snapshot (from history or parsed)
  const [resumeSnapName, setResumeSnapName] = useState("");      // display name for snapshot

  const [jdText, setJdText] = useState("");
  const [role, setRole] = useState("");
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState(readHistory());

  // unified status: "idle" | "parsing" | "reviewing" | "refining"
  const [status, setStatus] = useState("idle");
  const [backendInfo, setBackendInfo] = useState(null);

  // theme
  const [theme, setTheme] = useState(getTheme());

  const jdFileInput = useRef(null);
  const resumeDrop = useRef(null);
  const { toasts, show } = useToasts();

  /* ---------- Derived flags ---------- */
  const loading = status !== "idle";
  const hasResumeFile = !!resumeFile;
  const hasResumeSnap = !!resumeSnap;
  const hasJD = jdText.trim().length > 0;
  const canReview = (hasResumeFile || hasResumeSnap || hasJD) && !loading;
  const canRefine = !!result && !loading;
  const canClear  = (hasResumeFile || hasResumeSnap || hasJD || !!result || role) && !loading;

  /* ---------- Init ---------- */
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    // backend info for badge (provider · model)
    fetch("/").then(r => r.json()).then(setBackendInfo).catch(()=>{});
  }, []);

  /* ---------- HTTP helpers ---------- */
  async function callJSON(path, body) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return await res.json();
  }
  async function callMultipart(path, fd) {
    const res = await fetch(path, { method: "POST", body: fd });
    return await res.json();
  }
  async function parseFileToText(file) {
    const fd = new FormData();
    fd.append("file", file);
    return await callMultipart("/api/parse_resume", fd);
  }

  /* ---------- Resume dropzone ---------- */
  function onResumeChange(e) {
    const f = e.target.files?.[0];
    if (f) {
      setResumeFile(f);
      setResumeSnap("");      // override any history snapshot when user picks a real file
      setResumeSnapName("");
    }
  }
  function onDrop(e) {
    if (loading) return;
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) {
      setResumeFile(f);
      setResumeSnap("");
      setResumeSnapName("");
    }
    resumeDrop.current?.classList.remove("dragging");
  }
  function onDragOver(e) {
    if (loading) return;
    e.preventDefault();
    resumeDrop.current?.classList.add("dragging");
  }
  function onDragLeave() {
    if (loading) return;
    resumeDrop.current?.classList.remove("dragging");
  }

  /* ---------- JD from file ---------- */
  async function onPickJdFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setStatus("parsing");
    try {
      const parsed = await parseFileToText(f);
      setJdText(parsed?.text || "");
      show("JD loaded from file");
    } finally {
      setStatus("idle");
      e.target.value = "";
    }
  }

  /* ---------- Actions ---------- */
  async function onReview() {
    if (!canReview) return;
    setStatus("reviewing");
    setResult(null);
    try {
      let data;
      let snapshotText = resumeSnap; // may pre-exist from history

      if (resumeFile) {
        // 1) Parse to get a text snapshot for History
        const parsed = await parseFileToText(resumeFile);
        snapshotText = parsed?.text || "";
        setResumeSnapName(resumeFile.name);

        // 2) Do the canonical review with file upload
        const fd = new FormData();
        fd.append("file", resumeFile);
        fd.append("job_description", jdText);
        fd.append("target_role", role);
        data = await callMultipart("/api/review_file", fd);
      } else if (hasResumeSnap) {
        // Re-run using snapshot text
        data = await callJSON("/api/review", {
          resume_text: resumeSnap,
          job_description: jdText,
          target_role: role,
        });
      } else {
        // JD-only review
        data = await callJSON("/api/review", {
          resume_text: "",
          job_description: jdText,
          target_role: role,
        });
      }

      setResult(data);

      // Save a full session snapshot (role, JD, resume text + name, env, result)
      pushHistory({
        ts: Date.now(),
        role,
        jd: jdText,
        resumeName: resumeFile?.name || resumeSnapName || "",
        resumeText: snapshotText || "",      // store text snapshot (not the file)
        env: backendInfo ? `${backendInfo.provider}·${backendInfo.model}` : "",
        res: data,
      });
      setHistory(readHistory());
      show("Review completed");
    } finally {
      setStatus("idle");
    }
  }

  async function onRefine() {
    if (!canRefine) return;
    const feedback = prompt("Enter refine feedback (e.g., prioritize Kotlin, shorten by 15%)");
    if (!feedback) return;

    setStatus("refining");
    try {
      let resumeText = "";
      if (resumeFile) {
        const parsed = await parseFileToText(resumeFile);
        resumeText = parsed?.text || "";
        setResumeSnapName(resumeFile.name);
      } else if (hasResumeSnap) {
        resumeText = resumeSnap;
      }
      const data = await callJSON("/api/refine", {
        prior: result,
        user_feedback: feedback,
        resume_text: resumeText,
        job_description: jdText,
        target_role: role,
      });
      setResult(data);

      pushHistory({
        ts: Date.now(),
        role,
        jd: jdText,
        resumeName: resumeFile?.name || resumeSnapName || "",
        resumeText: resumeText || "",
        env: backendInfo ? `${backendInfo.provider}·${backendInfo.model}` : "",
        res: data,
      });
      setHistory(readHistory());
      show("Refine applied");
    } finally {
      setStatus("idle");
    }
  }

  function onClear() {
    if (!canClear) return;
    setResumeFile(null);
    setResumeSnap("");
    setResumeSnapName("");
    setJdText("");
    setRole("");
    setResult(null);
    show("Cleared");
  }

  function onCopyJSON() {
    if (!result) return;
    navigator.clipboard.writeText(JSON.stringify(result, null, 2));
    show("Copied JSON");
  }
  function onDownloadJSON() {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "review.json"; a.click();
    URL.revokeObjectURL(url);
    show("Downloaded review.json");
  }

  async function onExportDocx() {
    if (!result) return;
    const children = [];

    children.push(new Paragraph({ text: "AI Resume Review", heading: HeadingLevel.HEADING_1 }));
    children.push(new Paragraph(" "));
    children.push(new Paragraph({ text: `Target Role: ${role || "-"}`, heading: HeadingLevel.HEADING_3 }));
    children.push(new Paragraph({ text: `ATS Score: ${result.ats_score}`, heading: HeadingLevel.HEADING_2 }));

    if (result.missing_keywords?.length) {
      children.push(new Paragraph({ text: "Missing Keywords", heading: HeadingLevel.HEADING_3 }));
      result.missing_keywords.forEach(k =>
        children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun(k)] }))
      );
    }

    if (result.improved_bullets?.length) {
      children.push(new Paragraph({ text: "Improved Bullets", heading: HeadingLevel.HEADING_3 }));
      result.improved_bullets.forEach(b =>
        children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun(b)] }))
      );
    }

    if (result.positioning_summary) {
      children.push(new Paragraph({ text: "Positioning Summary", heading: HeadingLevel.HEADING_3 }));
      children.push(new Paragraph(result.positioning_summary));
    }

    if (result.short_cover_letter) {
      children.push(new Paragraph({ text: "Short Cover Letter", heading: HeadingLevel.HEADING_3 }));
      result.short_cover_letter.split(/\n+/).forEach(line => children.push(new Paragraph(line)));
    }

    const doc = new Document({ sections: [{ children }] });
    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `AI-Resume-Review-${(role || "Result").replace(/\s+/g,"_")}.docx`;
    a.click();
    URL.revokeObjectURL(url);
    show("Exported DOCX");
  }

  /* ---------- History: load full session ---------- */
  function loadHistorySession(h) {
    setRole(h.role || "");
    setJdText(h.jd || "");
    setResult(h.res || null);
    setResumeFile(null); // browsers block programmatic file selection
    setResumeSnap(h.resumeText || "");
    setResumeSnapName(h.resumeName || "");
    show("Loaded session from History");
  }

  /* ---------- UI ---------- */
  const score = result?.ats_score ?? 0;
  const tier  = score >= 85 ? "good" : score >= 70 ? "ok" : "low";

  return (
    <div className="container">
      {/* Status + theme toggle */}
      <div className={`statusbar ${loading ? "busy" : ""}`} aria-live="polite">
        <div className="row gap8">
          {loading ? (
            <>
              <span className="spinner" aria-hidden />
              <span className="status-text">
                {status === "parsing" && "Parsing JD file..."}
                {status === "reviewing" && "Reviewing resume vs. JD..."}
                {status === "refining" && "Refining output with your feedback..."}
              </span>
            </>
          ) : (
            <span className="status-text">Ready</span>
          )}
          {backendInfo && (
            <span className="badge">{backendInfo.provider} · {backendInfo.model}</span>
          )}
        </div>
        <button
          className="btn xs"
          onClick={() => setTheme(t => (t === "light" ? "dark" : "light"))}
          title="Toggle theme"
        >
          {theme === "light" ? "🌙 Dark" : "☀️ Light"}
        </button>
      </div>

      <header className="header">
        <h1>AI Resume Reviewer</h1>
        <p className="subtitle">JD-aware · ATS score · quantified bullets · cover letter</p>
      </header>

      <section className="grid three">
        {/* Inputs */}
        <div className={`card ${loading ? "dim" : ""}`}>
          <h3>Target Role</h3>
          <input
            className="input"
            placeholder="e.g., Android Engineer"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            disabled={loading}
          />

          <div className="row between" style={{ marginTop: 12 }}>
            <h3 style={{ marginBottom: 8 }}>Job Description</h3>
            <div className="row gap8">
              <button
                className="btn ghost"
                onClick={() => jdFileInput.current?.click()}
                disabled={loading}
                title="Load JD from file"
              >
                Load from file
              </button>
              <input
                ref={jdFileInput}
                type="file"
                accept=".pdf,.docx,.txt,.md,.tex"
                onChange={onPickJdFile}
                hidden
              />
            </div>
          </div>

          <textarea
            className="textarea"
            placeholder="Paste the JD here, or click 'Load from file'..."
            value={jdText}
            onChange={(e) => setJdText(e.target.value)}
            disabled={loading}
          />

          {/* JD Preview highlight after first result */}
          {result && (
            <div className="preview">
              <div className="preview-head">JD Preview (highlighted by Missing Keywords)</div>
              <div
                className="preview-body"
                dangerouslySetInnerHTML={{ __html: highlightHTML(jdText, result.missing_keywords || []) }}
              />
            </div>
          )}

          <h3>Resume File</h3>
          <div
            ref={resumeDrop}
            className={`dropzone ${loading ? "disabled" : ""}`}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            aria-disabled={loading}
          >
            <p className="muted">Drag & drop your resume here, or click to select</p>
            <input type="file" accept=".pdf,.docx,.txt,.md,.tex" onChange={onResumeChange} disabled={loading} />
          </div>

          {/* Show selected file OR a snapshot from history */}
          {resumeFile && (
            <div className="row gap8 muted" style={{ marginTop: 6 }}>
              <span>Selected:</span>
              <strong>{resumeFile.name}</strong>
              <button className="btn xs" onClick={() => setResumeFile(null)} disabled={loading}>Remove</button>
            </div>
          )}
          {!resumeFile && hasResumeSnap && (
            <div className="callout">
              <div className="callout-title">Using resume snapshot from History</div>
              <div className="callout-sub">
                {resumeSnapName ? `Source: ${resumeSnapName}` : "Text snapshot loaded."}  
                When you click <b>Review</b>, we’ll reuse this snapshot text.
                (Browsers block auto-selecting the original file.)
              </div>
              <div className="row gap8" style={{ marginTop: 6 }}>
                <button className="btn xs" onClick={() => { setResumeSnap(""); setResumeSnapName(""); }}>Remove snapshot</button>
              </div>
            </div>
          )}

          <div className="row gap8" style={{ marginTop: 14 }}>
            <button className="btn primary" onClick={onReview} disabled={!canReview} aria-busy={status==="reviewing"}>
              {status==="reviewing" ? "Reviewing..." : "Review"}
            </button>
            <button className="btn" onClick={onRefine} disabled={!canRefine} aria-busy={status==="refining"}>
              {status==="refining" ? "Refining..." : "Refine"}
            </button>
            <button className="btn ghost" onClick={onClear} disabled={!canClear}>Clear</button>
          </div>

          <p className="help"><b>Tip:</b> You can run <i>Review</i> with just a JD (no resume) to see keyword suggestions.</p>
        </div>

        {/* Score & Keywords */}
        <div className="card">
          {!result && <p className="muted">Your results will appear here after you click <b>Review</b>.</p>}
          {result && (
            <>
              <div className="score-wrap">
                <div className={`gauge ${tier}`} style={{ background: `conic-gradient(var(--accent-hi) ${score*3.6}deg, var(--ring) 0)` }}>
                  <div className="gauge-hole">
                    <div className="gauge-num">{score}</div>
                    <div className="gauge-label">ATS Score</div>
                  </div>
                </div>
                <div className="keywords">
                  <h4>Missing Keywords</h4>
                  {result?.missing_keywords?.length
                    ? <ul className="list">{result.missing_keywords.map((k, i) => <li key={i}>{k}</li>)}</ul>
                    : <p className="muted">None</p>}
                </div>
              </div>

              <div className="pane">
                <h4>Improved Bullets</h4>
                <ul className="list bullets">
                  {result.improved_bullets?.map((b, i) => <li key={i}>{b}</li>)}
                </ul>
                <h4>Positioning Summary</h4>
                <p>{result.positioning_summary}</p>
                <h4>Short Cover Letter</h4>
                <p style={{ whiteSpace: "pre-wrap" }}>{result.short_cover_letter}</p>
              </div>

              <div className="row gap8" style={{ marginTop: 12 }}>
                <button className="btn ghost" onClick={onCopyJSON}>Copy JSON</button>
                <button className="btn ghost" onClick={onDownloadJSON}>Download JSON</button>
                <button className="btn" onClick={onExportDocx}>Export DOCX</button>
              </div>

              {result?.notes?.length > 0 && (
                <div className="alert">
                  <h4 style={{ marginTop: 0 }}>Debug Notes</h4>
                  <ul className="list">{result.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
                </div>
              )}
            </>
          )}
        </div>

        {/* History — loads FULL session (role, JD, resume snapshot, result) */}
        <div className="card">
          <div className="row between">
            <h3>History</h3>
            <button className="btn xs" onClick={() => { clearHistory(); setHistory([]); }}>Clear</button>
          </div>
          {!history.length && <p className="muted">No history yet. Your last 5 sessions will be stored locally here.</p>}
          <div className="hist-list">
            {history.map((h,i) => (
              <button key={i} className="hist-item" onClick={() => loadHistorySession(h)}>
                <div className="hist-title">{h.role || "Untitled Role"}</div>
                <div className="hist-sub">
                  <span>ATS {h.res?.ats_score ?? "-"}</span>
                  {h.env && <span>{h.env}</span>}
                </div>
                <div className="hist-sub" title={h.jd}>{(h.jd || "").slice(0,70)}{(h.jd||"").length>70?"…":""}</div>
                {h.resumeName && <div className="hist-sub">Resume: {h.resumeName}</div>}
              </button>
            ))}
          </div>
        </div>
      </section>

      <footer className="footer">
        <span>© {new Date().getFullYear()} AI Resume Reviewer — demo for CS4990</span>
      </footer>

      {/* Toasts */}
      <div className="toasts" aria-live="polite" aria-atomic="true">
        {toasts.map(t => <div key={t.id} className="toast">{t.msg}</div>)}
      </div>
    </div>
  );
}
