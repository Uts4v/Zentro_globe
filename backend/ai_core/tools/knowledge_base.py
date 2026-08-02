# ai_core/tools/knowledge_base.py
"""
Knowledge-base lookup for the Zentro merchant AI assistant.

Serves verified product answers from `docs/zentro-ai-knowledge-base.md` — the
single source of truth for the assistant. Content is split into markdown
sections and searched by keyword so the model can ground its replies in the
document instead of guessing.
"""
import re
from pathlib import Path

from django.conf import settings

from .registry import tool_registry

# ── Tuning ────────────────────────────────────────────────────────────────────

_MAX_CHARS = 8000
_MAX_CHUNKS = 3
_MAX_GENERAL_CHARS = 12000

_STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "can", "could",
    "did", "do", "does", "for", "from", "has", "have", "how", "i", "in",
    "is", "it", "me", "my", "of", "on", "or", "so", "the", "to", "was",
    "we", "what", "when", "where", "which", "who", "why", "will", "with",
    "you", "your", "please", "tell", "about", "want", "get", "make",
}

# Heading substrings shown when the tool is called without a usable query.
_GENERAL_KEYWORDS = (
    "faq",
    "troubleshooting guide",
    "known limitations",
    "glossary",
    "what is zentro",
)

_cached = {}  # {(path, mtime): sections}


def knowledge_base_path() -> Path:
    configured = getattr(settings, "ZENTRO_KNOWLEDGE_BASE_PATH", None)
    if configured:
        return Path(configured)
    return settings.BASE_DIR.parent / "docs" / "zentro-ai-knowledge-base.md"


def _tokenize(text: str) -> list[str]:
    words = re.findall(r"[a-zA-Z0-9]+", text.lower())
    return [w for w in words if w not in _STOPWORDS and len(w) > 1]


def _load_sections() -> list[dict]:
    """Parse the markdown into level-2/3 heading chunks, cached by mtime."""
    path = knowledge_base_path()
    try:
        mtime = path.stat().st_mtime
    except FileNotFoundError:
        return []
    key = (str(path), mtime)
    if key in _cached:
        return _cached[key]

    content = path.read_text(encoding="utf-8")

    chunks = []
    current_level = 0
    current_heading = ""
    current_body: list[str] = []

    def flush():
        if current_heading or current_body:
            chunks.append({
                "heading": current_heading.strip(),
                "level": current_level,
                "text": "\n".join(current_body).strip(),
            })

    for line in content.splitlines():
        m = re.match(r"^(#{2,3})\s+(.*)$", line)
        if m:
            flush()
            current_level = len(m.group(1))
            current_heading = m.group(2)
            current_body = []
        else:
            current_body.append(line)
    flush()

    sections = [c for c in chunks if c["level"] in (2, 3) and c["text"]]
    _cached[key] = sections
    return sections


def _score(query_tokens: list[str], chunk: dict, is_question: bool = False) -> int:
    heading = chunk["heading"].lower()
    body = chunk["text"].lower()
    score = 0
    for tok in query_tokens:
        hits = heading.count(tok) * 3 + body.count(tok)
        if hits:
            score += hits
    # Boost when query tokens appear close together (matches FAQ phrasing).
    for i in range(len(query_tokens) - 1):
        a = re.escape(query_tokens[i])
        b = re.escape(query_tokens[i + 1])
        pattern = rf"\b{a}\b(?:\s+\w+){0,3}\s+\b{b}\b"
        score += len(re.findall(pattern, body, re.IGNORECASE)) * 20
    # FAQ/troubleshooting chunks answer question-style queries directly.
    if is_question and (
        "faq" in heading or "troubleshooting" in heading
    ):
        score += 15
    return score


def _is_question(query: str) -> bool:
    q = query.strip().lower()
    if q.endswith("?"):
        return True
    return bool(re.match(
        r"^(how|why|what|when|where|who|which|can|could|do|does|is|are|should)\b", q
    ))


def _format_chunks(chunks: list[dict], max_chars: int = _MAX_CHARS) -> str:
    parts = []
    budget = max_chars
    for c in chunks:
        snippet = f"## {c['heading']}\n\n{c['text']}"
        if sum(len(p) for p in parts) + len(snippet) > budget:
            break
        parts.append(snippet)
    return "\n\n".join(parts)


def get_knowledge_base(*, merchant, query: str = "", **kwargs):
    """Search the Zentro knowledge base and return the most relevant sections."""
    sections = _load_sections()
    if not sections:
        return {
            "error": "The Zentro knowledge base could not be loaded. Please try again later.",
        }

    tokens = _tokenize(query)

    if not tokens:
        general = [
            c for c in sections
            if any(k in c["heading"].lower() for k in _GENERAL_KEYWORDS)
        ]
        content = (
            _format_chunks(general, _MAX_GENERAL_CHARS)
            if general else _format_chunks(sections[:_MAX_CHUNKS], _MAX_GENERAL_CHARS)
        )
        return {
            "query": query,
            "matched_sections": [c["heading"] for c in general],
            "content": content,
        }

    is_question = _is_question(query)
    ranked = sorted(
        sections,
        key=lambda c: _score(tokens, c, is_question),
        reverse=True,
    )
    matches = [
        c for c in ranked if _score(tokens, c, is_question) > 0
    ][:_MAX_CHUNKS]

    if not matches:
        return {
            "query": query,
            "matched_sections": [],
            "content": "",
            "message": "No matching content found in the knowledge base for this question.",
        }

    return {
        "query": query,
        "matched_sections": [c["heading"] for c in matches],
        "content": _format_chunks(matches),
    }


def register_knowledge_base_tools():
    tool_registry.register(
        get_knowledge_base,
        name="get_knowledge_base",
        description=(
            "Search the official Zentro knowledge base and return the most relevant sections "
            "for a question about how Zentro works: features, how-to steps, FAQs, troubleshooting, "
            "loyalty rules (points, streaks, punch cards, missions, tiers, transfers), ordering, "
            "QR codes, POS, offline behavior, known limitations, or anything else about the product. "
            "Use this for product/knowledge questions. Pass a query describing what the merchant "
            "wants to know."
        ),
        parameters={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "What the merchant wants to know about Zentro, e.g. 'how do customers earn points' or 'why is my store not appearing publicly'.",
                },
            },
            "required": ["query"],
        },
    )
