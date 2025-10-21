# AI Resume Reviewer (JD-aware)

Evaluate a resume **against a Job Description (JD)** and generate:
- **ATS score (0–100)**
- **Missing keywords**
- **Quantified bullet rewrites (STAR style)**
- **Positioning summary**
- **Short cover letter**

Modern UI with **drag & drop resume**, **load JD from file**, **dark mode**, **history restore**, **JSON copy/download**, and **DOCX export**.

---

<p align="center">
  <a href="https://github.com/thanhdat3103/ai-resume-reviewer/actions">
    <img alt="CI" src="https://img.shields.io/github/actions/workflow/status/thanhdat3103/ai-resume-reviewer/ci.yml?branch=main">
  </a>
  <img alt="Stack" src="https://img.shields.io/badge/Stack-React%20%2B%20FastAPI%20%2B%20OpenAI%2FOllama-4a69ff">
  <img alt="License" src="https://img.shields.io/badge/License-MIT-green.svg">
</p>

---

## ✨ Features

- 📄 **Load JD from file** (PDF/DOCX/TXT/MD/TEX) or paste text
- 📎 **Resume upload** (PDF/DOCX/TXT/MD/TEX) with drag & drop
- 🧠 Works with **OpenAI** (cloud) or **Ollama** (local, free). Falls back to **mock** if provider is unavailable
- 🧮 **ATS Gauge** + **Missing Keywords** + **Improved Bullets (quantified)**
- 🔁 **Refine**: iterative improvements from your feedback
- 🕶️ **Dark mode**, 🔖 **History** (full restore of role/JD/resume snapshot + result)
- 🔁 **Copy / Download JSON**; 📝 **Export DOCX** (score, keywords, bullets, summary, cover letter)

---

## 🏗 Tech Stack

- **Frontend**: React (Vite)
- **Backend**: FastAPI (Python)
- **LLM**: OpenAI Chat Completions **or** Ollama (local models)
- **HTTP**: `fetch` + simple JSON/multipart
- **Styling**: Plain CSS (luxury light/dark theme)

---

## 📁 Project Structure

```
ai-resume-reviewer/
├─ backend/
│  ├─ main.py                 # FastAPI app (routes: /api/review, /api/review_file, /api/refine, /api/parse_resume, /health, /)
│  └─ requirements.txt
├─ frontend/
│  ├─ index.html
│  ├─ package.json
│  ├─ vite.config.js          # dev proxy to FastAPI
│  └─ src/
│     ├─ App.jsx              # polished UI (dark mode, history, JD highlight, gauge, DOCX export)
│     ├─ main.jsx
│     └─ styles.css
└─ .github/workflows/ci.yml   # optional CI (build FE, compile BE)
```

---

## 🚀 Quick Start (Local)

### Prerequisites
- **Python 3.12+**
- **Node.js 20+** and **npm**
- **Git**
- (Optional) **Ollama** running locally for a free LLM

### 1) Backend (FastAPI)
```bash
cd backend
python -m venv .venv
# Windows PowerShell
.\.venv\Scripts\Activate.ps1
# macOS/Linux
# source .venv/bin/activate

pip install -r requirements.txt

# Choose provider (one of the two blocks below)

# ---- Option A: OpenAI (cloud) ----
# Windows PowerShell:
$env:PROVIDER="OPENAI"
$env:OPENAI_API_KEY="sk-..."
$env:OPENAI_MODEL="gpt-4o-mini"

# macOS/Linux:
# export PROVIDER=OPENAI
# export OPENAI_API_KEY=sk-...
# export OPENAI_MODEL=gpt-4o-mini

# ---- Option B: Ollama (local, free) ----
# Windows PowerShell:
$env:PROVIDER="OLLAMA"
$env:OLLAMA_URL="http://localhost:11434"
$env:OLLAMA_MODEL="llama3.2:3b"

# macOS/Linux:
# export PROVIDER=OLLAMA
# export OLLAMA_URL=http://localhost:11434
# export OLLAMA_MODEL=llama3.2:3b

uvicorn main:app --reload --port 8000
```

### 2) Frontend (React + Vite)
```bash
cd ../frontend
npm i
npm run dev
```

Open **http://localhost:5173**  
The status bar shows **PROVIDER · MODEL** from backend.

---

## 🧭 Usage Flow

1. Enter **Target Role** (e.g., *Android Engineer*).
2. **Load JD from file** (or paste JD text).
3. **Drag & drop** a **resume** file (PDF/DOCX/TXT/MD/TEX).
4. Click **Review** → see ATS score, keywords, bullets, summary, cover letter.
5. Click **Refine** → type feedback (e.g., *Prioritize Kotlin, shorten by 15%*) → see updated result.
6. **History** keeps last 5 sessions. Click an item to **fully restore** role, JD, result and a **resume text snapshot** (browsers cannot auto-select the original file).
7. **Copy/Download JSON** or **Export DOCX**.

---

## 🔌 API Overview

### `GET /`
Returns provider & model:
```json
{ "provider": "OPENAI|OLLAMA|MOCK", "model": "gpt-4o-mini|llama3.2:3b|..." }
```

### `GET /health`
Simple health check:
```json
{ "ok": true }
```

### `POST /api/parse_resume` (multipart)
- **Form fields**: `file`
- **Response**: `{ "text": "..." }` (normalized text)

### `POST /api/review` (JSON)
```json
{
  "resume_text": "string",
  "job_description": "string",
  "target_role": "string | null"
}
```
**Response (strict JSON):**
```json
{
  "ats_score": 0,
  "missing_keywords": ["..."],
  "improved_bullets": ["..."],
  "positioning_summary": "...",
  "short_cover_letter": "...",
  "notes": ["..."]
}
```

### `POST /api/review_file` (multipart)
- **Form fields**: `file`, `job_description`, `target_role`
- **Response**: same schema as `/api/review`

### `POST /api/refine` (JSON)
```json
{
  "prior": { /* object above */ },
  "user_feedback": "string",
  "resume_text": "string",
  "job_description": "string",
  "target_role": "string | null"
}
```
**Response**: same schema.

---

## 🧠 Prompt Engineering

**Persona (System)**  
Model acts as **Senior Tech Recruiter & ATS evaluator**. Returns **strict JSON** only.

**Few-shot**  
Bullet rewrites show **quantification** and **STAR** flavor (e.g., “Reduced P95 latency 35%…”).

**Iterative Refinement**  
`/api/refine` applies minimal updates based on your feedback while keeping schema/constraints.

> Backend enforces JSON shape with a safe parser and optional repair notes in `notes`.

---

## 🧩 Architecture

```mermaid
flowchart LR
  UI[React (Vite)] -- fetch /api/* --> API[FastAPI]
  subgraph API Layer
    API --> Parse[/parse_resume/]
    API --> Review[/review, review_file/]
    API --> Refine[/refine/]
    API --> Health[/health/]
  end
  Review --> LLM[(OpenAI<br/>or Ollama)]
  Refine --> LLM
  Parse --> Extractor[(PDF/DOCX/TXT reader)]
  API -.-> Mock[(Fallback JSON)]:::dim

classDef dim fill:#eee,stroke:#bbb,color:#666;
```

- **Ollama** gives a **free local** path; **OpenAI** offers higher quality.
- **Fallback mock** ensures the demo works even if the provider fails.

---

## 🔐 Privacy Notes

- Resume/JD text is processed in memory for the demo; frontend does **not** expose API keys.
- You choose the LLM provider (OpenAI or local Ollama).
- Remove any sensitive data before recording demo videos.

---

## ✅ CI (Optional)

A simple CI is included to build FE and compile BE on every push.  
Badge: https://github.com/thanhdat3103/ai-resume-reviewer/actions

Workflow file: `.github/workflows/ci.yml`

---

## 🧪 Manual Test Checklist

- Review with **JD only** (no resume) → see keyword suggestions.
- Review with **resume + JD** (PDF/DOCX/TXT).
- **Refine** with a concrete instruction; confirm bullets/keywords update.
- **History**: run twice → click a history item → role/JD/result restored; see “Using resume snapshot…” banner.
- **Dark mode** toggle persists across reloads.
- **Export DOCX** opens correctly in Word/Google Docs.

---

## 🗺 Roadmap

- PDF annotations and in-file keyword highlights  
- Multi-JD comparison and ranking  
- Export Markdown / PDF  
- In-app refine presets (tone, brevity, seniority)  
- Basic test suite (pytest) and schema validator

---

## 🧾 License

MIT © 2025 [thanhdat3103](https://github.com/thanhdat3103)
