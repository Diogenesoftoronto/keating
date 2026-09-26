"""A small deterministic Markdown renderer for the published posts.

Only the constructs the posts actually use are supported: ATX headings, tables,
fenced code, block quotes, ordered and unordered lists, horizontal rules, and the
inline run of code, bold, italic and links. Anything else is escaped and emitted as
a paragraph, so an unsupported construct degrades to visible text rather than to
silently dropped content.
"""
from __future__ import annotations

import html
import re

INLINE_CODE = re.compile(r"`([^`]+)`")
BOLD = re.compile(r"\*\*([^*]+)\*\*")
ITALIC = re.compile(r"(?<![*\w])\*([^*\n]+)\*(?!\*)")
LINK = re.compile(r"\[([^\]]+)\]\(([^)\s]+)\)")
HEADING = re.compile(r"^(#{1,6})\s+(.*)$")
ORDERED = re.compile(r"^(\d+)\.\s+(.*)$")
UNORDERED = re.compile(r"^[-*]\s+(.*)$")
TABLE_DIVIDER = re.compile(r"^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$")


def slugify(text: str) -> str:
    cleaned = re.sub(r"[^a-z0-9\s-]", "", text.lower())
    return re.sub(r"[\s-]+", "-", cleaned).strip("-") or "section"


def inline(text: str) -> str:
    """Escape first, then re-introduce only the markup we recognise."""
    placeholders: list[str] = []

    def stash(markup: str) -> str:
        placeholders.append(markup)
        return f"\x00{len(placeholders) - 1}\x00"

    def code_sub(match: re.Match[str]) -> str:
        return stash(f"<code>{html.escape(match.group(1))}</code>")

    working = INLINE_CODE.sub(code_sub, text)
    working = html.escape(working)

    def link_sub(match: re.Match[str]) -> str:
        label, href = match.group(1), match.group(2)
        if not href.startswith(("https://", "http://", "/", "#")):
            return match.group(0)
        external = href.startswith("http")
        attrs = ' target="_blank" rel="noopener noreferrer"' if external else ""
        return f'<a href="{href}"{attrs}>{label}</a>'

    working = LINK.sub(link_sub, working)
    working = BOLD.sub(r"<strong>\1</strong>", working)
    working = ITALIC.sub(r"<em>\1</em>", working)
    for index, markup in enumerate(placeholders):
        working = working.replace(f"\x00{index}\x00", markup)
    return working


def split_row(line: str) -> list[str]:
    stripped = line.strip()
    if stripped.startswith("|"):
        stripped = stripped[1:]
    if stripped.endswith("|"):
        stripped = stripped[:-1]
    return [cell.strip() for cell in stripped.split("|")]


def render(source: str) -> tuple[str, list[tuple[int, str, str]]]:
    """Return (html, table-of-contents) where each entry is (level, id, title)."""
    lines = source.replace("\r\n", "\n").split("\n")
    out: list[str] = []
    toc: list[tuple[int, str, str]] = []
    index = 0
    seen: dict[str, int] = {}

    while index < len(lines):
        line = lines[index]
        stripped = line.strip()

        if not stripped:
            index += 1
            continue

        if stripped.startswith("```"):
            language = stripped[3:].strip()
            index += 1
            body: list[str] = []
            while index < len(lines) and not lines[index].strip().startswith("```"):
                body.append(lines[index])
                index += 1
            index += 1
            klass = f' data-language="{html.escape(language)}"' if language else ""
            out.append(f'<div class="term"{klass}><pre><code>{html.escape(chr(10).join(body))}</code></pre></div>')
            continue

        heading = HEADING.match(stripped)
        if heading:
            level = len(heading.group(1))
            title = heading.group(2).strip()
            base = slugify(title)
            seen[base] = seen.get(base, 0) + 1
            anchor = base if seen[base] == 1 else f"{base}-{seen[base]}"
            tag = min(level + 1, 6) if level == 1 else min(level, 6)
            out.append(f'<h{tag} id="{anchor}">{inline(title)}</h{tag}>')
            if level in (2, 3):
                toc.append((level, anchor, title))
            index += 1
            continue

        if stripped in ("---", "***", "___"):
            out.append("<hr>")
            index += 1
            continue

        if stripped.startswith(">"):
            body = []
            while index < len(lines) and lines[index].strip().startswith(">"):
                body.append(lines[index].strip().lstrip(">").strip())
                index += 1
            out.append(f"<blockquote><p>{inline(' '.join(body))}</p></blockquote>")
            continue

        if "|" in stripped and index + 1 < len(lines) and TABLE_DIVIDER.match(lines[index + 1].strip()):
            header = split_row(stripped)
            alignments = []
            for cell in split_row(lines[index + 1]):
                alignments.append("num" if cell.endswith(":") and not cell.startswith(":") else "")
            index += 2
            rows: list[list[str]] = []
            while index < len(lines) and "|" in lines[index] and lines[index].strip():
                rows.append(split_row(lines[index]))
                index += 1
            head = "".join(
                f'<th class="{alignments[position] if position < len(alignments) else ""}">{inline(cell)}</th>'
                for position, cell in enumerate(header))
            body_html = []
            for row in rows:
                cells = "".join(
                    f'<td class="{alignments[position] if position < len(alignments) else ""}">{inline(cell)}</td>'
                    for position, cell in enumerate(row))
                body_html.append(f"<tr>{cells}</tr>")
            out.append('<div class="tablewrap"><table><thead><tr>' + head + "</tr></thead><tbody>"
                        + "".join(body_html) + "</tbody></table></div>")
            continue

        if UNORDERED.match(stripped) or ORDERED.match(stripped):
            ordered = bool(ORDERED.match(stripped))
            items: list[str] = []
            while index < len(lines):
                current = lines[index].strip()
                match = ORDERED.match(current) if ordered else UNORDERED.match(current)
                if not match:
                    if current and not UNORDERED.match(current) and not ORDERED.match(current) and items \
                            and lines[index].startswith(("  ", "\t")):
                        items[-1] += " " + inline(current)
                        index += 1
                        continue
                    break
                items.append(inline(match.group(2) if ordered else match.group(1)))
                index += 1
            tag = "ol" if ordered else "ul"
            out.append(f"<{tag}>" + "".join(f"<li>{item}</li>" for item in items) + f"</{tag}>")
            continue

        paragraph = [stripped]
        index += 1
        while index < len(lines) and lines[index].strip() and not lines[index].strip().startswith(("#", "```", ">", "-", "*")) \
                and not ORDERED.match(lines[index].strip()) and "|" not in lines[index]:
            paragraph.append(lines[index].strip())
            index += 1
        out.append(f"<p>{inline(' '.join(paragraph))}</p>")

    return "\n".join(out), toc
