from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Dict, Any
import json, os, io
import httpx

# Optional parsers
from pypdf import PdfReader
from docx import Document

# ---------------------- App & CORS ----------------------
app = FastAPI(title="AI Resume Reviewer API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------- Env ----------------------
PROVIDER = os.getenv("PROVIDER", "MOCK").upper()   # OPENAI | OLLAMA | MOCK
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_MODEL   = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:3b")
OLLAMA_URL   = os.getenv("OLLAMA_URL", "http://localhost:11434")

# ---------------------- Models ----------------------
class ReviewRequest(BaseModel):
    resume_text: str
    job_description: str
    target_role: Optional[str] = None

class RefineRequest(BaseModel):
    prior: Dict[str, Any]
    user_feedback: str
    resume_text: str
    job_description: str
    target_role: Optional[str] = None

# ---------------------- Prompts ----------------------
PROMPT_SYSTEM = (
    "You are a Senior Tech Recruiter and ATS evaluator at a global tech company. "
    "Return STRICT JSON only with keys: ats_score, missing_keywords, improved_bullets, "
    "positioning_summary, short_cover_letter, notes. No prose outside JSON."
)

FEW_SHOT = (
    "Bullet Transform Examples:\n"
    "OLD: Improved app performance.\n"
    "NEW: Boosted Android cold-start by 42% via lazy-loading and Retrofit caching.\n\n"
    "OLD: Worked on backend APIs.\n"
    "NEW: Designed 6 REST endpoints (FastAPI) serving 15k DAU; cut P95 latency 35% using async IO and caching.\n\n"
    "OLD: Helped migrate database.\n"
    "NEW: Led PostgreSQL migration (v12→v14) with zero-downtime; reduced ETL 2 days→2 hours via bulk ops + index tuning.\n\n"
    "JSON Example:\n"
    "{\n"
    "  \"ats_score\": 82,\n"
    "  \"missing_keywords\": [\"Kotlin\", \"RxJava\"],\n"
    "  \"improved_bullets\": [\"Scaled search throughput 10x ...\"],\n"
    "  \"positioning_summary\": \"...\",\n"
    "  \"short_cover_letter\": \"...\",\n"
    "  \"notes\": [\"...\"]\n"
    "}"
)

def build_user_prompt(
    resume_text: str,
    jd: str,
    role: Optional[str],
    is_refine: bool = False,
    feedback: str = "",
    prior_json: str = "",
) -> str:
    if not is_refine:
        return (
            "Task: Evaluate RESUME vs JD and return STRICT JSON per schema. "
            "Improve 3–6 bullets with quantified outcomes.\n"
            f"Target role: {role or 'N/A'}\n\n"
            "JD:\n```text\n" + jd + "\n```\n\n"
            "RESUME:\n```text\n" + resume_text + "\n```\n\n"
            "Requirements:\n"
            "- Follow the System Prompt and Few-shot above.\n"
            "- Do NOT output anything except the JSON object."
        )
    else:
        return (
            "You will refine the prior JSON output based on user feedback. "
            "Keep the same JSON schema and constraints.\n\n"
            "User feedback:\n```text\n" + feedback + "\n```\n\n"
            "Prior Output JSON:\n```json\n" + prior_json + "\n```\n\n"
            "JD:\n```text\n" + jd + "\n```\n\n"
            "RESUME:\n```text\n" + resume_text + "\n```\n\n"
            "Return STRICT JSON only (same keys)."
        )

# ---------------------- LLM Calls ----------------------
async def call_openai(system: str, fewshot: str, user: str) -> str:
    if not OPENAI_API_KEY:
        raise RuntimeError("Missing OPENAI_API_KEY")
    url = "https://api.openai.com/v1/chat/completions"
    headers = {"Authorization": f"Bearer {OPENAI_API_KEY}", "Content-Type": "application/json"}
    payload = {
        "model": OPENAI_MODEL,
        "temperature": 0.3,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": fewshot + "\n\n" + user},
        ],
    }
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(url, headers=headers, json=payload)
        r.raise_for_status()
        data = r.json()
        return data["choices"][0]["message"]["content"].strip()

# 🔴 Quan trọng: dùng chat API của Ollama + ép JSON-only
async def call_ollama(system: str, fewshot: str, user: str) -> str:
    payload = {
        "model": OLLAMA_MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user",   "content": fewshot + "\n\n" + user},
        ],
        "options": {"temperature": 0.2},
        "format": "json",   # force JSON only
        "stream": False
    }
    async with httpx.AsyncClient(timeout=180) as client:
        r = await client.post(f"{OLLAMA_URL}/api/chat", json=payload)
        r.raise_for_status()
        data = r.json()
        return data.get("message", {}).get("content", "{}").strip()

# ---------------------- Fallback & JSON guard ----------------------
MOCK_OUTPUT = {
    "ats_score": 84,
    "missing_keywords": ["Kotlin", "RxJava", "ATS"],
    "improved_bullets": [
        "Boosted Android cold-start by 42% via lazy-loading and Retrofit caching.",
        "Designed 6 REST endpoints (FastAPI) serving 15k DAU; cut P95 latency 35% using async IO and caching.",
        "Optimized PostgreSQL ETL: 2 days→2 hours via bulk ops + index tuning."
    ],
    "positioning_summary": "Android/Backend engineer focused on performance; collaborative across teams.",
    "short_cover_letter": "Dear Hiring Team, I’m excited to apply for ...",
    "notes": ["Align with JD keywords", "Quantify outcomes", "Keep bullets ≤ 2 lines"]
}

def safe_parse_json(text: str) -> Dict[str, Any]:
    raw = (text or "").strip()
    try:
        # strip code fences if any
        if raw.startswith("```") and raw.endswith("```"):
            raw = raw.strip("`").lstrip("json").lstrip("JSON").strip()
        return json.loads(raw)
    except Exception:
        try:
            s, e = raw.find("{"), raw.rfind("}")
            if s != -1 and e > s:
                return json.loads(raw[s:e+1])
        except Exception:
            pass
    out = dict(MOCK_OUTPUT)
    out["notes"] = out.get("notes", []) + ["LLM returned non-JSON; using fallback."]
    return out

# ---------------------- File parsing ----------------------
def _extract_text_from_pdf(data: bytes) -> str:
    reader = PdfReader(io.BytesIO(data))
    chunks = []
    for page in reader.pages:
        try:
            chunks.append(page.extract_text() or "")
        except Exception:
            pass
    return "\n".join(chunks).strip()

def _extract_text_from_docx(data: bytes) -> str:
    doc = Document(io.BytesIO(data))
    return "\n".join(p.text for p in doc.paragraphs).strip()

def _extract_text_from_text(data: bytes) -> str:
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return data.decode("latin-1", errors="ignore")

def extract_resume_text(filename: str, data: bytes) -> str:
    name = (filename or "").lower()
    if name.endswith(".pdf"):
        return _extract_text_from_pdf(data)
    if name.endswith(".docx"):
        return _extract_text_from_docx(data)
    if name.endswith((".txt", ".md", ".tex")):
        return _extract_text_from_text(data)
    raise HTTPException(status_code=415, detail="Unsupported file type. Allowed: PDF, DOCX, TXT, MD, TEX.")

# ---------------------- Routes ----------------------
@app.get("/")
def root():
    model = OPENAI_MODEL if PROVIDER == "OPENAI" else OLLAMA_MODEL
    return {"ok": True, "provider": PROVIDER, "model": model}

@app.post("/api/review")
async def review(req: ReviewRequest):
    user_prompt = build_user_prompt(req.resume_text, req.job_description, req.target_role)
    try:
        if PROVIDER == "OPENAI":
            content = await call_openai(PROMPT_SYSTEM, FEW_SHOT, user_prompt)
        elif PROVIDER == "OLLAMA":
            content = await call_ollama(PROMPT_SYSTEM, FEW_SHOT, user_prompt)
        else:
            return MOCK_OUTPUT
        return safe_parse_json(content)
    except httpx.HTTPStatusError as e:
        detail = f"{PROVIDER} HTTP {e.response.status_code}: {e.response.text[:300]}"
        print(detail)
        out = dict(MOCK_OUTPUT); out["notes"] = out.get("notes", []) + [detail]; return out
    except Exception as e:
        detail = f"{PROVIDER} error: {type(e).__name__}: {str(e)[:200]}"
        print(detail)
        out = dict(MOCK_OUTPUT); out["notes"] = out.get("notes", []) + [detail]; return out

@app.post("/api/refine")
async def refine(req: RefineRequest):
    prior_json = json.dumps(req.prior, ensure_ascii=False)
    user_prompt = build_user_prompt(req.resume_text, req.job_description, req.target_role, is_refine=True, feedback=req.user_feedback, prior_json=prior_json)
    try:
        if PROVIDER == "OPENAI":
            content = await call_openai(PROMPT_SYSTEM, FEW_SHOT, user_prompt)
        elif PROVIDER == "OLLAMA":
            content = await call_ollama(PROMPT_SYSTEM, FEW_SHOT, user_prompt)
        else:
            return MOCK_OUTPUT
        return safe_parse_json(content)
    except httpx.HTTPStatusError as e:
        detail = f"{PROVIDER} HTTP {e.response.status_code}: {e.response.text[:300]}"
        print(detail)
        out = dict(MOCK_OUTPUT); out["notes"] = out.get("notes", []) + [detail]; return out
    except Exception as e:
        detail = f"{PROVIDER} error: {type(e).__name__}: {str(e)[:200]}"
        print(detail)
        out = dict(MOCK_OUTPUT); out["notes"] = out.get("notes", []) + [detail]; return out

@app.post("/api/parse_resume")
async def parse_resume(file: UploadFile = File(...)):
    data = await file.read()
    text = extract_resume_text(file.filename, data)
    return {"text": text}

@app.post("/api/review_file")
async def review_file(
    file: UploadFile = File(...),
    job_description: str = Form(...),
    target_role: Optional[str] = Form(None),
):
    data = await file.read()
    resume_text = extract_resume_text(file.filename, data)
    user_prompt = build_user_prompt(resume_text, job_description, target_role)
    try:
        if PROVIDER == "OPENAI":
            content = await call_openai(PROMPT_SYSTEM, FEW_SHOT, user_prompt)
        elif PROVIDER == "OLLAMA":
            content = await call_ollama(PROMPT_SYSTEM, FEW_SHOT, user_prompt)
        else:
            return MOCK_OUTPUT
        return safe_parse_json(content)
    except httpx.HTTPStatusError as e:
        detail = f"{PROVIDER} HTTP {e.response.status_code}: {e.response.text[:300]}"
        print(detail)
        out = dict(MOCK_OUTPUT); out["notes"] = out.get("notes", []) + [detail]; return out
    except Exception as e:
        detail = f"{PROVIDER} error: {type(e).__name__}: {str(e)[:200]}"
        print(detail)
        out = dict(MOCK_OUTPUT); out["notes"] = out.get("notes", []) + [detail]; return out
