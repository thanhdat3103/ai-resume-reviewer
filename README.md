# AI Resume Reviewer (JD‑aware)
Evaluate a resume against a Job Description (JD): ATS score, missing keywords, quantified bullet rewrites, positioning summary, and a short cover letter. Built for CS4680 Final Project.

**Repo owner:** `thanhdat3103`  
**Tech:** React (Vite) · FastAPI · OpenAI API or Ollama (local) · Strict JSON prompts · File parsing (PDF/DOCX/TXT/MD/TEX)

---

## 🔗 Demo Assets (fill in when ready)
- **Slides:** https://docs.google.com/presentation/…
- **Demo Video (YouTube, Unlisted):** https://youtu.be/…
- **GitHub Repo:** https://github.com/thanhdat3103/ai-resume-reviewer

> Tip: Keep video 3–5 minutes. Use the script in this README.

---

## 🧩 Problem & Market Need
- Candidates often submit generic resumes that don’t align with JDs.
- ATS filters screen out resumes lacking exact keywords/phrases.
- Tailoring manually is slow and subjective.

**Our solution:** An AI assistant that reads the JD and resume, returns an **ATS fit score**, **missing keywords**, **quantified bullet rewrites (STAR)**, a **positioning summary**, and a **short cover letter**. Supports **iterative refinement** and **file uploads**.

---

## ✨ Features
- **Upload resume** (drag & drop): PDF/DOCX/TXT/MD/TEX; **Load JD from file**.
- **ATS Gauge** + **Missing Keywords** list.
- **Improved Bullets** (3–6) with measurable outcomes (%, x, P95…).
- **Short Cover Letter** tailored to the JD.
- **Refine**: update results using your feedback.
- **History**: store the last 5 sessions and **restore full context** (role, JD, resume snapshot, result).
- **Dark mode**, **Copy/Download JSON**, **Export DOCX**.
- **LLM Providers**: OpenAI or **Ollama (free, local)** with a fallback mock for offline demo.

---

## 🏗 Architecture (High‑level)
**Vite/React UI** ⇄ **FastAPI** ⇄ **LLM Provider** (OpenAI or Ollama)

- `/api/parse_resume` → extracts text from uploaded PDF/DOCX/TXT/MD/TEX.
- `/api/review_file` → evaluates uploaded resume file against the JD.
- `/api/review` → evaluates raw resume text (used by History or JD‑only flow).
- `/api/refine` → iterative refinement with user feedback.
- `/` (optional) → provider & model info; `/health` (optional) → health check.

**Prompt Engineering**
- **Persona**: Senior Tech Recruiter & ATS evaluator.
- **Few‑shot**: bullet “before → after” examples + valid JSON example.
- **Iterative Refinement**: feed previous JSON + human feedback; keep schema stable.
- **Strict JSON**: the model is instructed to return JSON only; backend validates & repairs if needed.

---

## ⚙️ Getting Started (Local)

### Prerequisites
- **Python 3.12+**, **Node 20+**, **Git**
- Optional **Ollama** if you want a free local LLM (pull a model like `llama3.2:3b`).

### 1) Backend
```bash
cd backend
python -m venv .venv
# Windows PowerShell
.\.venv\Scripts\Activate.ps1
# macOS/Linux: source .venv/bin/activate

pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### 2) Frontend
```bash
cd ../frontend
npm i
npm run dev   # http://localhost:5173
```

### 3) Choose your provider (one of)
**OpenAI (cloud):**
```powershell
# PowerShell
$env:PROVIDER="OPENAI"
$env:OPENAI_API_KEY="sk-..."
$env:OPENAI_MODEL="gpt-4o-mini"
```
**Ollama (local, free):**
```powershell
$env:PROVIDER="OLLAMA"
$env:OLLAMA_URL="http://localhost:11434"
$env:OLLAMA_MODEL="llama3.2:3b"   # or any model you pulled
```

> The frontend proxies `/api/*` to `http://localhost:8000`. Open `http://localhost:5173` to use the app.

---

## 🔌 API Reference (Backend)
### `POST /api/parse_resume` (multipart)
- **Form:** `file` = resume/JD file (pdf/docx/txt/md/tex)  
- **Resp:** `{ "text": "..." }`

### `POST /api/review_file` (multipart)
- **Form:** `file`, `job_description`, `target_role`  
- **Resp:** Strict JSON
```json
{
  "ats_score": 84,
  "missing_keywords": ["Kotlin","RxJava","ATS"],
  "improved_bullets": ["..."],
  "positioning_summary": "...",
  "short_cover_letter": "...",
  "notes": ["..."]
}
```

### `POST /api/review` (json)
```json
{ "resume_text": "...", "job_description": "...", "target_role": "..." }
```

### `POST /api/refine` (json)
```json
{
  "prior": { /* previous JSON output */ },
  "user_feedback": "shorten 15%, prioritize Kotlin",
  "resume_text": "...",                  
  "job_description": "...",
  "target_role": "..."
}
```

### `GET /` (optional)
Returns `{ "provider": "...", "model": "..." }` used by the UI badge.

### `GET /health` (optional)
Returns `{ "ok": true }`.

---

## 🖥 Frontend UX Notes
- **Review**: enabled when you have **any** of JD / resume file / resume snapshot.
- **Refine**: enabled after you have a result.
- **Clear**: resets current inputs; History remains intact.
- **History**: clicking an item restores **Role + JD + resume snapshot + result**. (Browsers block auto‑reselecting the original file; snapshot text is used instead.)

---

## 🧠 Prompt Pack (System, Few‑shot, Templates)
System persona enforces **ATS recruiter** behavior & **strict JSON**. Few‑shot shows bullet transforms and a valid JSON. User prompts supply **JD + Resume**; Refine prompt supplies **feedback + prior JSON**. See `backend/main.py` for exact strings.

Key rules:
- 3–6 improved bullets; quantify outcomes; JD‑aligned; no hallucinated employers/metrics.
- Output **must** be valid JSON (no backticks, no extra keys).

---

## 🧪 Testing & CI (optional but recommended)
Create `.github/workflows/ci.yml`:
```yaml
name: CI
on: [push, pull_request]
jobs:
  fe:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: frontend } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run build
  be:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: backend } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - run: pip install -r requirements.txt
      - run: python -m compileall .
```
You can add `pytest` later if you like.

---

## ☁️ Deployment (bonus)
**Frontend (Vercel/Netlify):**
- Build: `npm run build` (Vite).  
- Output: `dist/`.

**Backend (Render/Railway/Fly.io):**
- Set envs: `PROVIDER`, `OPENAI_API_KEY` or `OLLAMA_*`.  
- Start command: `uvicorn main:app --host 0.0.0.0 --port 8000`.

**CORS:** allow the FE origin (`http://localhost:5173` or your FE domain).

---

## 🔒 Privacy & Limits
- Files are parsed locally in your browser and sent to backend for text extraction (no FE key exposure).
- If using OpenAI, your text goes to OpenAI per their data policies. Ollama keeps everything local.
- No PII logging; logs are disabled by default except errors.

---

## 🧰 Troubleshooting
- **403 on git push**: you’re logged in as a different GitHub account; clear credentials and use PAT for `thanhdat3103`.
- **Model not responding**: check `PROVIDER` and corresponding env vars; use MOCK fallback to demo.
- **CORS/Proxy issues**: Vite proxies `/api` to `http://localhost:8000`. Ensure backend runs on port 8000.

---

## 🧪 Sample JD & Resume (for quick demo)
**JD (Android – short):**
- Kotlin, RxJava, Retrofit, Jetpack; REST APIs; Postgres; performance (startup, P95).

**JD (Backend – FastAPI):**
- Python 3.10+, FastAPI/Pydantic, PostgreSQL/Redis, JWT/OAuth2, Docker, CI/CD.

**JD (Data Analyst):**
- SQL + Python/R; dashboards; A/B testing; KPIs; Tableau/Power BI.

Use any public sample resume PDFs (Android/Backend/Data Analyst), or paste text snippets.

---

## 🎬 3–5 min Demo Script
1) Introduce problem & app (10–15s).  
2) **Load JD from file** → **Drag & drop resume** → click **Review** (60–80s).  
3) Walk through **ATS gauge**, **Missing Keywords**, **Bullets**, **Summary**, **Cover Letter** (60s).  
4) Click **Refine** → “Prioritize Kotlin, shorten 15%” → see updates (40s).  
5) Show **History restore**, **Dark mode**, **Export DOCX** (40s).

---

## 📜 License
MIT © 2025 `thanhdat3103`
