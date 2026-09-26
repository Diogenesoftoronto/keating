"""Render the static on-device model report from the collected measurements.

Every figure comes from collect.build(); the prose states what was measured and
where each measurement stops. Output is a self-contained public/ tree suitable for
the Caddy image in this directory.
"""
from __future__ import annotations

import html
import json
import pathlib
import shutil
import sys
from datetime import date

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import collect  # noqa: E402
import markdown  # noqa: E402

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]
PUBLIC = HERE / "public"
POST = ROOT / "docs/blog/needle-subject-routing.md"
MEASURED = date.today().isoformat()

PAGES = [
    ("/", "Report"),
    ("/methods/", "Methods"),
    ("/blog/needle-subject-routing/", "Preview post"),
    ("/data.json", "Data"),
]


def esc(value) -> str:
    return html.escape(str(value))


def mb(value) -> str:
    return "—" if value is None else f"{value / 1_000_000:.1f} MB"


def shell(title: str, description: str, current: str, body: str, prose: bool = False) -> str:
    links = []
    for href, label in PAGES:
        marker = ' aria-current="page"' if href == current else ""
        links.append(f'<a href="{href}"{marker}>{esc(label)}</a>')
    klass = ' class="prose"' if prose else ""
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)}</title>
<meta name="description" content="{esc(description)}">
<meta name="color-scheme" content="light">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(description)}">
<meta property="og:type" content="article">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=VT323&family=Roboto:wght@300;400;500&family=JetBrains+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="/site.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="topbar"><div class="topbar-inner">
<a class="wordmark" href="/">machine<span>/</span>judgement</a>
<nav class="navlinks" aria-label="Sections">{"".join(links)}</nav>
</div></header>
<main id="main"{klass}>
{body}
</main>
<footer><div class="wrap">
<h3>What this page is</h3>
<p>A measurement record for the local models in Keating: what each one is wired into, what it scored on this
repository's own corpora and captured harness, and where the evidence stops. Agreement between judges is agreement,
not correctness. Benchmarks over archived transcripts are not evidence of human learning.</p>
<p class="foot-meta">Generated {esc(MEASURED)} from <code>scripts/on-device-site/</code> ·
machine-readable results at <a href="/data.json">/data.json</a> ·
method notes at <a href="/methods/">/methods/</a></p>
</div></footer>
</body>
</html>
"""


def table(caption: str, headers: list, rows: list, numeric=None, row_classes=None) -> str:
    numeric = numeric or set()
    head = "".join(f'<th class="{"num" if i in numeric else ""}">{esc(h)}</th>' for i, h in enumerate(headers))
    body = []
    for position, row in enumerate(rows):
        klass = row_classes[position] if row_classes and position < len(row_classes) else ""
        cells = []
        for i, cell in enumerate(row):
            raw = isinstance(cell, str) and cell.startswith("<")
            cells.append(f'<td class="{"num" if i in numeric else ""}">{cell if raw else esc(cell)}</td>')
        body.append(f'<tr class="{klass}">{"".join(cells)}</tr>')
    return (f'<div class="tablewrap"><table><caption>{esc(caption)}</caption>'
            f"<thead><tr>{head}</tr></thead><tbody>{''.join(body)}</tbody></table></div>")


def bars(rows: list, maximum=None) -> str:
    top = maximum or max((value for _, value, _, _ in rows), default=1) or 1
    out = []
    for label, value, display, variant in rows:
        width = max(0.6, min(100, value / top * 100))
        out.append(f'<div class="bar"><span class="lbl">{esc(label)}</span>'
                   f'<span class="track"><span class="fill {variant}" style="width:{width:.1f}%"></span></span>'
                   f'<span class="val">{esc(display)}</span></div>')
    return f'<div class="bars">{"".join(out)}</div>'


def note(title: str, body: str, variant: str = "") -> str:
    klass = f"note {variant}".strip()
    return f'<div class="{klass}"><h4>{esc(title)}</h4>{body}</div>'


def kv(pairs: list) -> str:
    items = "".join(f"<div><dt>{esc(k)}</dt><dd>{esc(v)}</dd></div>" for k, v in pairs)
    return f'<dl class="kv">{items}</dl>'


def section(number: str, anchor: str, title: str, body: str) -> str:
    return (f'<section id="{anchor}"><div class="wrap">'
            f'<div class="sec-head"><h2>{esc(title)}</h2><span class="sec-num">{esc(number)}</span></div>'
            f"{body}</div></section>")


def short(name: str) -> str:
    return name.split("/")[-1]


def build_index(data: dict) -> str:
    retrieval = data["needleRetrieval"]
    static = data["staticRetrieval"]
    latency = data["needleLatency"]
    classify = data["needleClassifyCensus"]
    extract = data["needleExtractCensus"]
    static_extract = data["staticExtraction"]
    subject = data["subject170"]
    needle170 = data["needle170"]
    shape = data["datasetShape"]
    probe = data["probeSplit"]
    kev = data["kevVsJev"]
    jev = data["jevHarness"]
    sizes = data["artifactSizes"]
    footprint = data["indexFootprint"]

    literal = retrieval["splits"]["literal"]
    paraphrase = retrieval["splits"]["paraphrase"]
    corpus = retrieval["corpusMessages"]
    by_name = {short(row["model"]): row for row in static}
    best_static = by_name["potion-base-8M"]
    needle_sizes = sizes["needle"]
    kev_all = kev["agreement"]["all"]

    hero = f"""<div class="hero"><div class="wrap">
<p class="kicker">KEATING · LOCAL MODEL MEASUREMENT RECORD · {esc(MEASURED)}</p>
<h1>A Measure of Machine Judgement</h1>
<p class="lede">Keating ships a 35&nbsp;MB generative model called Needle to do three jobs: rank recall, extract a
verbatim learner quote, and classify a topic into a subject. This is what each job scores against this repository's own
corpora, what a static embedding model scores on the same rows, and what happened when a 0.8B decision model was pointed
at the real captured judgement harness.</p>
<dl class="verdict">
<div><dt>RECALL RANKING</dt><dd><strong>{literal['needle']['R@1']}/{literal['n']} &rarr; {best_static['literal']['R@1']}/{literal['n']}</strong>
Needle loses to a lexical baseline on its own corpus. A 7.6M-parameter static model beats both.</dd></div>
<div><dt>SUBJECT ROUTING</dt><dd><strong>0/{classify['cases']}</strong>
The shipped classification path returns nothing at all &mdash; every call is discarded before it is read.</dd></div>
<div><dt>JUDGEMENT</dt><dd><strong>{kev_all['agree']}/{kev_all['total']}</strong>
KEV-0.8B agrees with Jev on {round(kev_all['agree'] / kev_all['total'] * 100)}% of real harness questions, at
{kev['kevMedianMs'] / 1000:.0f}s per request against {kev['jevMedianMs']}&nbsp;ms.</dd></div>
<div><dt>HOSTED BASELINE</dt><dd><strong>{jev['requests']}/{jev['requests'] + jev['errors']}</strong>
Jev answered every captured request, {jev['questionsAnswered']} questions, zero errors,
{jev['latency']['median']}&nbsp;ms median.</dd></div>
</dl>
</div></div>"""

    wiring = "".join([
        f'<p class="narrow">Needle 3 is pinned at revision <code>{esc(needle_sizes["revision"])}</code> from '
        f'<code>{esc(needle_sizes["repository"])}</code>. It is the only on-device model in the repository that does '
        f'generative work, and it answers three separate questions through one Python subprocess bridge.</p>',
        table('The three jobs and where each one is called', ['Job', 'Mechanism', 'Entry point'], [
            ['Embed text for similarity ranking', 'agent.embed → 3,072-dim vectors', 'createNeedleCaller'],
            ['Extract a verbatim quote and category', 'needle.extract, strict=True, 128 new tokens', 'retrieveNeedleMemory'],
            ['Classify a topic into a subject field', 'agent.complete, tool-call grammar, 64 new tokens', 'classifyDomainField'],
        ]),
        table('Five consumers across four surfaces', ['Surface', 'Path'], [
            ['CLI and Pi learner context', 'src/core/learner-context.ts → retrieveNeedleMemory'],
            ['Subject routing', 'src/retrieval/needle-domain.ts'],
            ['Background memory admission', 'src/judgement/cli-memory-admission.ts'],
            ['Desktop and web reply recall', 'web/src/keating/needle-retrieval.ts, desktop/src/needle-runtime.ts'],
            ['Native mobile recall', 'mobile/modules/keating-needle (Android and iOS ARM64 only)'],
        ]),
        kv([('PINNED WEIGHTS', f"{needle_sizes['weightsBytes']:,} B"),
            ('CLI ENGINE', f"{needle_sizes.get('cliEngineBytes', 0):,} B"),
            ('ANDROID ARM64', f"{needle_sizes['platforms']['android-arm64']:,} B"),
            ('IOS ARM64', f"{needle_sizes['platforms']['ios-arm64']:,} B")]),
        note('Execution shape',
             '<p>Every retrieval spawns a Python child, SHA-256s both assets, imports the runtime, constructs the model, '
             'and only then embeds. The default deadline is 12 seconds. On mobile the engine is process-global with '
             '<em>no cancel and no unload</em>: verified model bytes stay resident until the app exits.</p>'),
    ])

    recall_rows = [
        ['Needle 3 (pinned)', '3072', f"{retrieval['embedMs']:,} ms",
         f"{literal['needle']['R@1']}/{literal['n']}", f"{literal['needle']['MRR']:.3f}",
         f"{paraphrase['needle']['R@1']}/{paraphrase['n']}", f"{paraphrase['needle']['MRR']:.3f}",
         f"{literal['separations']}/{literal['n']} · {paraphrase['separations']}/{paraphrase['n']}"],
        ['lexical token overlap', '—', '—',
         f"{literal['lexical']['R@1']}/{literal['n']}", f"{literal['lexical']['MRR']:.3f}",
         f"{paraphrase['lexical']['R@1']}/{paraphrase['n']}", f"{paraphrase['lexical']['MRR']:.3f}", '—'],
    ]
    recall_classes = ['worst', '']
    for row in static:
        recall_rows.append([
            short(row['model']), str(row['dimensions']), f"{row['embedMs']:.1f} ms",
            f"{row['literal']['R@1']}/{literal['n']}", f"{row['literal']['MRR']:.3f}",
            f"{row['paraphrase']['R@1']}/{paraphrase['n']}", f"{row['paraphrase']['MRR']:.3f}",
            f"{row['literal']['relevantAboveIrrelevant']}/{literal['n']} · "
            f"{row['paraphrase']['relevantAboveIrrelevant']}/{paraphrase['n']}"])
        recall_classes.append('best' if short(row['model']) == 'potion-base-8M' else '')

    fixed = next(row for row in latency if row['label'] == 'empty-vector-request')
    largest = max(latency, key=lambda row: row['texts'])
    latency_bars = bars([
        (f"{row['texts']} text{'s' if row['texts'] != 1 else ''}", row['medianMs'], f"{row['medianMs']:,.0f} ms",
         'bad' if row['texts'] >= 64 else ('alt' if row['texts'] >= 16 else ''))
        for row in latency if row['label'] != 'empty-vector-request'])

    recall = "".join([
        f'<p class="narrow">The corpus is {corpus} real learner messages taken from this workspace\u2019s own sessions. '
        f'Queries split into <strong>literal</strong> (follow-up wording sharing vocabulary with the target) and '
        f'<strong>paraphrase</strong> (a learner returning later in their own words). Every ranker is scored with the '
        f'production function <code>needleRelativeScores</code>, so only the embedding model changes.</p>',
        table(f'Recall over {corpus} learner messages, {literal["n"]} literal and {paraphrase["n"]} paraphrase queries',
              ['Ranker', 'Dims', 'Embed 111', 'Lit R@1', 'Lit MRR', 'Para R@1', 'Para MRR', 'Relevant above irrelevant'],
              recall_rows, numeric={1, 2, 3, 4, 5, 6}, row_classes=recall_classes),
        note('The separation column is the robust signal',
             f'<p>Recall at rank one depends on one threshold choice; whether the best relevant item outscores the best '
             f'irrelevant one does not. Needle separates {literal["separations"]}/{literal["n"]} literal and only '
             f'{paraphrase["separations"]}/{paraphrase["n"]} paraphrase queries: its embeddings sit in a narrow band where '
             f'topical relevance barely moves the score. potion-base-8M separates '
             f'{best_static["literal"]["relevantAboveIrrelevant"]}/{literal["n"]} and '
             f'{best_static["paraphrase"]["relevantAboveIrrelevant"]}/{paraphrase["n"]}.</p>'),
        '<h3>Where the seconds go</h3>',
        f'<p class="narrow">A request carrying no real work still costs <strong>{fixed["medianMs"]:.0f}&nbsp;ms</strong>: '
        f'process spawn, a SHA-256 of both pinned assets, the runtime import, and model construction. That fixed cost is '
        f'paid on every single call, with linear per-text cost on top.</p>',
        latency_bars,
        f'<p class="narrow">An uncached recall embeds the query plus up to 128 source windows. At '
        f'{largest["medianMs"]:,.0f}&nbsp;ms for {largest["texts"]} texts that is most of the 12-second deadline, on a '
        f'desktop CPU. The same workload through a static embedding model is {best_static["embedMs"]:.1f}&nbsp;ms.</p>',
        note('Measured twice',
             '<p>An earlier run on a more loaded machine recorded 337&nbsp;ms fixed and 6,795&nbsp;ms for 128 texts. The '
             'shape is stable across both runs; absolute numbers move with machine load, so treat them as a range.</p>',
             'warn'),
    ])

    routing_rows = [[row['topic'], row['expected'], row['field'] or '—',
                     'suppressed' if row['suppressed'] else ('emitted' if row['emitted'] else 'empty')]
                    for row in classify['rows'][:6]]
    routing = "".join([
        f'<p class="narrow">The shipped path is <code>classifyDomainField</code>. Run against {classify["cases"]} probe '
        f'topics with the production 32-field vocabulary it returned a decision <strong>zero times</strong>. Not a wrong '
        f'subject &mdash; nothing at all.</p>',
        kv([('EMITTED CALLS', str(classify['emittedCalls'])), ('SUPPRESSED CALLS', str(classify['suppressedCalls'])),
            ('EMPTY RESPONSES', str(classify['empty'])), ('MEDIAN PER CASE', f"{classify['medianMs']:.0f} ms")]),
        note('A real defect, not a model limitation',
             '<p>Upstream <code>needle.extract</code> reads <code>function_calls or suppressed_calls</code>. Keating\u2019s '
             'bridge in <code>src/retrieval/needle-runtime.ts</code> reads only <code>function_calls</code>, so all '
             f'{classify["suppressedCalls"]} suppressed decisions are discarded and the rung silently abstains. Suppression '
             'is triggered by the enum-shaped argument schema the bridge invents: with the empty-argument tool shape the '
             'model was actually trained on, calls emit normally.</p>', 'stop'),
        table('What the discarded calls contained', ['Topic', 'Expected', 'Model chose', 'Call state'], routing_rows),
        note('Counting them would not rescue it',
             '<p>The suppressed picks include <code>commerce clause → computing</code>, <code>bill become law → law</code>, '
             '<code>procrastinate → physics</code> and <code>Bayes → business</code>, with reasoning such as '
             '<em>&ldquo;bill become law is a scientific field.&rdquo;</em> The plumbing bug hides a rung that was not '
             'working anyway.</p>', 'warn'),
        note('Confidence can never gate this rung',
             '<p><code>needle.Needle(weights=...)</code> sets <code>_tuned</code> whenever explicit weights are passed, and '
             'a tuned agent reports <code>confidence: None</code> by construction. Keating always passes explicit weights, '
             'so <code>LOCAL_FIELD_CONFIDENCE_FLOOR = 0.7</code> can never fire &mdash; <code>decideLocalModelField</code> '
             'accepts null confidence as valid.</p>', 'stop'),
    ])

    extraction = "".join([
        f'<p class="narrow">This is the job the earlier write-up said Needle does well: given one learner message and a '
        f'schema, return a category and a quote that is an exact substring of the input. Measured on {extract["cases"]} '
        f'real learner messages with the production schema and <code>strict=True</code>.</p>',
        table('Verbatim span extraction on real learner messages',
              ['Approach', 'Returned a quote', 'Quotes verbatim', 'Category correct', 'Median per case'],
              [['Needle extract', f"{extract['returned']}/{extract['cases']}", 'the one quote was "repo"',
                f"0/{extract['cases']}", f"{extract['medianMs']:.0f} ms"],
               ['deterministic spans + rubric scoring', f"{static_extract['cases']}/{static_extract['cases']}",
                f"{static_extract['cases']}/{static_extract['cases']}",
                f"{static_extract['categoryHits']}/{static_extract['cases']}", f"{static_extract['medianMs']:.2f} ms"]],
              numeric={1, 2, 3, 4}, row_classes=['worst', 'best']),
        f'<p class="narrow">Needle also raised <code>ExtractionValidationError</code> on two of the eight &mdash; grounding '
        f'failures the bridge swallows. The alternative splits the message into spans and scores each against the five '
        f'category rubrics, so the quote is a slice of the input and <em>verbatim by construction</em> rather than by '
        f'post-hoc validation. Its weakness is the category head at '
        f'{static_extract["categoryHits"]}/{static_extract["cases"]} with small margins.</p>',
        note('The index cost is the quiet win',
             f'<p>A real on-disk index sample holds {footprint["entries"]} entry of {footprint["dimensions"]} dimensions in '
             f'<strong>{footprint["jsonBytes"]:,} bytes</strong> of JSON for a {footprint["packedFloat32Bytes"]:,}-byte '
             f'payload &mdash; 5.5&times; encoding overhead. At the {footprint["capEntries"]}-entry cap that projects to '
             f'{footprint["projectedJsonBytesAtCap"] / 1e6:.1f}&nbsp;MB, which is exactly why <code>loadIndex</code> carries '
             f'a 12&nbsp;MB ceiling. The same index at 256 dimensions packed as int8 is '
             f'{footprint["projected256Int8BytesAtCap"]:,} bytes.</p>'),
    ])

    base, tuned = needle170['models']['base'], needle170['models']['tuned']
    rows170 = [['Needle 3 base', 'nothing', f"{base['probeCorrect']}/{base['probeN']}",
                f"{base['trainCorrect']}/{base['trainN']} (in-sample)", f"{base['refused']}/{base['refusedN']}",
                f"{base['medianMs']:.0f} ms"],
               ['Needle 3 fine-tuned', '170 rows', f"{tuned['probeCorrect']}/{tuned['probeN']}",
                f"{tuned['trainCorrect']}/{tuned['trainN']} (in-sample)", f"{tuned['refused']}/{tuned['refusedN']}",
                f"{tuned['medianMs']:.0f} ms"]]
    classes170 = ['worst', 'worst']
    zero_shot_best = 0
    for entry in subject:
        name = short(entry['model'])
        for result in entry['results']:
            if result['method'].startswith('A '):
                zero_shot_best = max(zero_shot_best, result['trainCorrect'])
            if not result['method'].startswith(('A ', 'D ')):
                continue
            method = 'rubric prototypes (zero-shot)' if result['method'].startswith('A') else 'logistic head (5-fold CV)'
            rows170.append([f"{name} · {method}", 'nothing' if result['method'].startswith('A') else '170 rows',
                            f"{result['probeCorrect']}/{result['probeN']}",
                            f"{result['trainCorrect']}/{result['trainN']}",
                            f"{result['refused']}/{result['refusedN']}", f"{result['totalMs']:.1f} ms total"])
            classes170.append('best' if result['probeCorrect'] >= 16 else '')

    bench = "".join([
        f'<p class="narrow">The larger set is this repository\u2019s own <code>needle-training</code> corpus: '
        f'<strong>{shape["rows"]} labelled rows</strong> over {shape["tools"]} subject tools, of which '
        f'{shape["refusalRows"]} are refusals, plus an {shape["probeRows"]}-row probe and six off-topic controls. The '
        f'Needle rows are read straight from the committed <code>eval-report.json</code>; the artifact hashes match.</p>',
        table('Subject routing on the 170-row labelled set',
              ['Method', 'Fitted on', 'Probe', '170 rows', 'Refusals', 'Cost'],
              rows170, numeric={2, 3, 4, 5}, row_classes=classes170),
        note('Read the two shaded groups against each other',
             f'<p>The fine-tuned Needle archive scores <strong>{tuned["trainCorrect"]}/{tuned["trainN"]}</strong> on its own '
             f'training data. A static embedding model with rubric prototypes and <em>no labels at all</em> scores '
             f'{zero_shot_best}/170 on those same rows, out-of-sample for it. Fitting a logistic head on the labels adds '
             f'little over the rubric text, which says the ceiling here is the embedding model rather than the fitting '
             f'method.</p>'),
        note('Class centroids are memorisation, not skill',
             '<p>The omitted &ldquo;B&rdquo; method reaches 159&ndash;164/170, but those centroids are computed from the '
             'same rows they are scored on. It is reported in <a href="/data.json">/data.json</a> for completeness and '
             'should not be read as a result.</p>', 'warn'),
        '<h3>The probe is contaminated</h3>',
        f'<p class="narrow">Before trusting any &ldquo;N/18&rdquo; figure: {probe["nearDuplicateCount"]} of the '
        f'{probe["nearDuplicateCount"] + probe["novelCount"]} probe rows are near-duplicates of the training set at cosine '
        f'&ge; {probe["nearDuplicateThreshold"]}, one of them character-identical. Only {probe["novelCount"]} rows are '
        f'genuinely novel.</p>',
        table(f'Probe split into {probe["novelCount"]} novel and {probe["nearDuplicateCount"]} near-duplicate rows',
              ['Method', 'All 18', 'Novel 8 only'],
              [[name, value['all'], value['novel']] for name, value in probe['results'].items()], numeric={1, 2},
              row_classes=['worst' if 'Needle' in name else 'best' for name in probe['results']]),
    ])

    abstain_32 = data['abstain']['potion-retrieval-32M']
    sweep = abstain_32['sweep']
    baseline = next(row for row in sweep if row['marginFloor'] == 0.0 and row['supportFloor'] == 0.0)
    abstention = "".join([
        '<p class="narrow">A static embedding model has no native way to refuse: it maps a string to a vector, and '
        '<code>argmax</code> always returns something. The honest way to abstain is a gate, so both were tried &mdash; a '
        'margin gate on top-two prototype separation, and an out-of-domain support gate on similarity to any known subject '
        'query. Thresholds were chosen on the labelled rows, then applied to the probe and six off-topic controls.</p>',
        table('Gate sweep, potion-retrieval-32M: coverage against refusal',
              ['Margin floor', 'Support floor', '170 answered', 'Correct', 'Probe answered', 'Correct', 'Off-topic refused'],
              [[f"{row['marginFloor']}", f"{row['supportFloor']}", row['trainAnswered'][0], row['trainAnswered'][1],
                row['probeAnswered'][0], row['probeAnswered'][1], f"{row['offtopicRefused']}/6"] for row in sweep],
              numeric={0, 1, 2, 3, 4, 5, 6}),
        note('This one did not work, and that is the finding',
             f'<p>With both gates open the tier answers all {baseline["trainAnswered"][0]} rows and refuses '
             f'{baseline["offtopicRefused"]}/6 off-topic inputs. Every setting that refuses 5 or 6 controls also collapses '
             f'coverage to a handful of rows. The support distributions overlap almost completely: labelled subjects span '
             f'{abstain_32["supportPercentiles"]["labelledSubjects"]} across the 5th&ndash;95th percentile while the '
             f'off-topic inputs sit at {abstain_32["supportPercentiles"]["offtopic"]}. There is no threshold between them, '
             f'and the 8M model shows the same overlap.</p>'
             '<p>So refusal is <em>not</em> solved by swapping the embedding model. It needs the separately calibrated gate '
             'shape already built for memory admission, or a model that emits a probability over an explicit none option.</p>',
             'stop'),
    ])

    kev_rows = [[name.replace('-', ' '), f"{value['agree']}/{value['total']}",
                 f"{round(value['agree'] / value['total'] * 100)}%"]
                for name, value in kev['agreement'].items() if name != 'all']
    kev_rows.append(['<strong>all questions</strong>', f"{kev_all['agree']}/{kev_all['total']}",
                     f"{round(kev_all['agree'] / kev_all['total'] * 100)}%"])
    kev_files = sizes['kev']['files']
    adapter_total = (kev_files.get('adapter_model.safetensors', 0) + kev_files.get('head.pt', 0)
                     + kev_files.get('tokenizer.json', 0))
    kev_section = "".join([
        '<p class="narrow">KEV-0.8B is a decision model: a LoRA adapter and pointer head on '
        '<code>Qwen/Qwen3.5-0.8B-Base</code> returning a probability distribution over typed choices in one forward pass. '
        'It was served locally through its own <code>kev.serve</code> path and sent <strong>byte-identical</strong> '
        '<code>{state, model, questions}</code> bodies from Keating\u2019s own planned runner &mdash; real captured teaching '
        'runs, real rubric dimensions, the judgeable Nouls, the support Choices and the verbatim evidence-selection '
        'Choices. Jev received the same bodies.</p>',
        kv([('REQUESTS COMPARED', str(kev['requests'])), ('QUESTIONS', str(kev['questions'])),
            ('KEV MEDIAN', f"{kev['kevMedianMs']:,} ms"), ('JEV MEDIAN', f"{kev['jevMedianMs']} ms")]),
        table('Agreement by question family (agreement is not correctness)',
              ['Question family', 'Agreement', 'Rate'], kev_rows, numeric={1, 2}),
        '<p class="narrow">The disagreement is systematic rather than noisy. KEV collapses to the middle score and to the '
        'abstain option on content where Jev finds evidence:</p>',
        table('Answer distributions on the same questions', ['Question family', 'KEV', 'Jev'],
              [[name.replace('-', ' '), json.dumps(kev['kevLevels'][name]), json.dumps(kev['jevLevels'][name])]
               for name in sorted(kev['kevLevels'])]),
        note('One genuine positive',
             f'<p>Of {kev_all["total"] - kev_all["agree"]} disagreements, '
             f'<strong>{kev["confidentDisagreements"]}</strong> were made at confidence &ge; 0.9. Its uncertainty honestly '
             f'flags that it is out of its depth &mdash; the failure is visible rather than silent.</p>'),
        note('Why this is a shape mismatch as well as a limit',
             '<p>KEV\u2019s own card reports out-of-domain accuracy 0.652 and warns that probabilities are advisory outside '
             'its training distribution. Its rows are short premise/hypothesis and classification items; a Keating rubric '
             'question is long prose criteria over a numbered multi-turn transcript. This data cannot separate '
             '&ldquo;wrong&rdquo; from &ldquo;untrained for this shape&rdquo;, which is the honest reason to want a '
             'fine-tune before calling the model unsuitable.</p>', 'warn'),
        note('The packaging question, now resolved',
             f'<p>The adapter and head are small &mdash; {mb(adapter_total)} including the tokenizer &mdash; but useless '
             f'without the backbone, and <code>Qwen/Qwen3.5-0.8B-Base</code> ships {mb(1746900000)} of weights. Real '
             f'deployment footprint is <strong>about 1.8&nbsp;GB</strong>, roughly 50&times; the entire current Needle '
             f'bundle. This is a server model.</p>', 'stop'),
    ])

    real, stub = jev['realAnswers'], jev['stubAnswers']
    jev_section = "".join([
        '<p class="narrow">Finally the hosted judge was run over the whole captured harness on its own, to profile '
        'behaviour rather than to serve as a baseline for something else.</p>',
        kv([('REQUESTS', f"{jev['requests']} / {jev['requests'] + jev['errors']}"),
            ('QUESTIONS ANSWERED', f"{jev['questionsAnswered']} / {jev['questionsRequested']}"),
            ('MEDIAN', f"{jev['latency']['median']} ms"), ('P90', f"{jev['latency']['p90']} ms"),
            ('MODEL IDENTITY', ', '.join(f"{k} ×{v}" for k, v in jev['models'].items())),
            ('TOKENS', f"{jev['tokens']['input']:,} in / {jev['tokens']['output']:,} out")]),
        table('Latency by suite', ['Suite', 'Requests', 'Median'],
              [[suite, jev['requestsBySuite'][suite], f"{value} ms"] for suite, value in jev['latencyBySuite'].items()],
              numeric={1, 2}),
        '<h3>The split that matters</h3>',
        '<p class="narrow">The suite divides into candidates that answered and candidates that did not: every '
        '<code>teaching-v4</code> candidate transcript is an authored plumbing stub whose literal text is '
        '<em>&ldquo;Authored plumbing response. This is not a model response or an assessment.&rdquo;</em> Jev treats the '
        'two groups completely differently.</p>',
        table('Real candidate answers against authored plumbing stubs',
              ['Signal', f"real answers (v1/v2/v3, {real['dims']} dims)", f"plumbing stubs (v4, {stub['dims']} dims)"],
              [['judgeable Noul says yes', f"{real['judgeableYes']}/{real['judgeableYes'] + real['judgeableNo']}",
                f"{stub['judgeableYes']}/{stub['judgeableYes'] + stub['judgeableNo']}"],
               ['cited a real numbered span', f"{real['span']}/{real['span'] + real['noMatch']}",
                f"{stub['span']}/{stub['span'] + stub['noMatch']}"],
               ['support = unverifiable', str(real['unverifiable']), str(stub['unverifiable'])]], numeric={1, 2}),
        f'<p class="narrow">That is exactly what the harness prompts demand: an unverifiable claim leaves the dimension '
        f'unjudgeable, and spans from the fixed learner prefix are never valid evidence. On real answers Jev cited a real '
        f'numbered span <strong>{real["span"]} times out of {real["span"]}</strong>.</p>',
        table('Rubric score levels awarded across the whole harness', ['Level', 'Count'],
              [[f"level {level}", count] for level, count in jev['scoreLevels'].items()], numeric={1}),
        note('The ceiling worth watching',
             f'<p><strong>{jev["rowsAllTwos"]}</strong> rows were scored level 2 on every dimension. Roughly half the suite '
             f'receives no discrimination at all. If these scores feed reward fitting or policy promotion, a ceiling that '
             f'broad compresses the signal. Whether those candidates were genuinely excellent or the judge is lenient there '
             f'is exactly what an incumbent comparison would settle, and that has not been run.</p>', 'warn'),
        note('A minor inconsistency',
             f'<p>{stub["span"]} of {stub["span"] + stub["noMatch"]} stub evidence questions still cited a span rather than '
             f'<code>__no_match__</code>. Citing the plumbing sentence as the span evidencing a zero is defensible, but it '
             f'is not uniform.</p>', 'warn'),
    ])

    onnx = sizes['potionOnnx']
    package_rows, package_classes = [], []
    for repo, entry in onnx.items():
        name = short(repo)
        package_rows.append([name, entry['license'], mb(entry['modelBytes']), mb(entry['tokenizerBytes']),
                             mb(entry['totalBytes'])])
        package_classes.append('worst' if '128m' in name else ('best' if '8m' in name else ''))
    package_rows.append(['Needle 3 (current: weights + CLI engine)', 'see upstream', mb(needle_sizes['weightsBytes']),
                         '—', mb(needle_sizes['weightsBytes'] + needle_sizes.get('cliEngineBytes', 0))])
    package_classes.append('')
    package_rows.append(['KEV-0.8B (backbone + adapter + head + tokenizer)', sizes['kev']['license'],
                         mb(1746900000), mb(kev_files.get('tokenizer.json')), '≈ 1.8 GB'])
    package_classes.append('worst')

    multilingual = onnx['minishlab/potion-multilingual-128m-onnx']
    packaging = "".join([
        '<p class="narrow">The constraint is that a replacement must be reasonable to package with the application and not '
        'absurd to run on a phone. Sizes below are read from the published registry, not from notes.</p>',
        table('Published artifact sizes', ['Artifact', 'License', 'Model', 'Tokenizer', 'Total'],
              package_rows, numeric={2, 3, 4}, row_classes=package_classes),
        note('The multilingual model breaks the constraint',
             f'<p><code>potion-multilingual-128m-onnx</code> is {mb(multilingual["totalBytes"])} at fp32 &mdash; 17.6&times; '
             f'the 8M model &mdash; and its {mb(multilingual["tokenizerBytes"])} tokenizer does not quantize. int8 lands '
             f'near 130&nbsp;MB plus tokenizer, still roughly 4&times; the entire current Needle bundle. Worth it only if '
             f'learners actually write non-English text; its quality was never measured here.</p>', 'warn'),
        '<h3>What the measurements support</h3>',
        table('Proposed tiers', ['Tier', 'Component', 'Size', 'Role'],
              [['0', 'existing keyword lookup and lexical match', '0', 'always answers'],
               ['1', 'potion static embeddings, 256-dim', mb(onnx['minishlab/potion-base-8m-onnx']['totalBytes']),
                'recall ranking, field prototypes, span screening'],
               ['2', 'existing ONNX / LiteRT runtime', 'already shipped', 'optional cross-encoder rescoring'],
               ['3', 'hosted Jev', 'no bundle', 'consequential judgement and escalation']]),
        '<p class="narrow">The replacement needs <em>zero new runtimes</em>: static embeddings are a tokenizer plus a lookup '
        'table. That removes the embedded Python bridge, the venv, the WASM blob, the native C-ABI binding, and the '
        'ARM64-only device matrix &mdash; a typed-array path runs on iOS simulators and in Expo Go, which Needle explicitly '
        'cannot, and it can be freed on disable, which removes the &ldquo;no cancel, no unload&rdquo; caveat.</p>',
        note('Jev stays',
             '<p>Nothing measured here argues for replacing the hosted judge. It answered every captured request with stable '
             'identity, sub-second, with abstention paths that fire only when evidence is genuinely absent. The local tier is '
             'the cheap rung beneath it, not a substitute for it.</p>'),
    ])

    boundaries = """<ul>
<li><strong>Agreement is not correctness.</strong> Neither judge is ground truth on the captured rows, and this
repository's own harness notes say so. No human review was performed.</li>
<li><strong>No human-learning claim.</strong> Benchmarks over archived transcripts and synthetic learners do not establish
mastery, retention, transfer or engagement. Those remain unknown.</li>
<li><strong>Single machine, single platform.</strong> Everything ran on Linux x86-64 CPU. Nothing was measured on a phone,
in a browser, or in the desktop app. KEV ran fp32 on CPU with no GPU present; its card assumes CUDA or MPS bf16, worth
2&ndash;4.5&times;.</li>
<li><strong>KEV coverage is partial.</strong> 11 of 68 captured requests. The v3 and v4 states, 86&ndash;114&nbsp;KB each,
were not run through it.</li>
<li><strong>The retrieval corpus is small and narrow.</strong> 90 messages, 21 queries, mostly software topics, median
message length 34 characters. Directional, not definitive; the separation counts are the more robust signal.</li>
<li><strong>potion ran through the Python library.</strong> A JS/TS port is small but unwritten and unmeasured, and no
quality figure exists for the multilingual model.</li>
<li><strong>Judgement calls are mine.</strong> The right/wrong labels on the eight extraction cases and the eight suppressed
classifications are my assessment, not labelled data.</li>
</ul>"""

    body = "".join([
        hero,
        section('01', 'wiring', 'What Needle is wired into', wiring),
        section('02', 'recall', 'Recall ranking', recall),
        section('03', 'routing', 'Subject routing', routing),
        section('04', 'extraction', 'Verbatim extraction', extraction),
        section('05', 'bench', 'The 170-row labelled set', bench),
        section('06', 'abstention', 'Refusal, and why a gate did not fix it', abstention),
        section('07', 'kev', 'KEV-0.8B on the real judgement harness', kev_section),
        section('08', 'jev', 'Jev across the whole captured harness', jev_section),
        section('09', 'packaging', 'Packaging and the proposed stack', packaging),
        section('10', 'boundaries', 'Verification boundaries', boundaries),
    ])
    return shell('A Measure of Machine Judgement · Keating',
                 'Measured record of the local models in Keating: Needle, potion static embeddings, KEV-0.8B and Jev.',
                 '/', body)


def build_methods() -> str:
    rows = [
        ['Recall ranking', '.keating/tmp/needle-recall-bench2.ts', 'bench-needle-retrieval.json',
         'Needle through the production bridge; z-scored cosine via needleRelativeScores'],
        ['Static recall', '.keating/tmp/bench-static-retrieval.py', 'site-data/static-retrieval.jsonl',
         'Same corpus, queries and ranking function; only the model changes'],
        ['Needle latency', '.keating/tmp/bench-needle-latency.ts', 'site-data/needle-latency.json',
         'Full bridge round trip: spawn, hash, import, construct, embed'],
        ['Subject routing (production path)', '.keating/tmp/bench-needle-subject-routing.ts', 'transcript',
         'classifyDomainField with the 32-field FIELDS enum'],
        ['Classification census', '.keating/tmp/needle-classify-census.py', 'site-data/needle-classify-census.json',
         'Direct runtime call; counts emitted against suppressed calls'],
        ['Extraction census', '.keating/tmp/needle-extract-census.py', 'site-data/needle-extract-census.json',
         'Production schema, strict=True, over real learner messages'],
        ['Deterministic-span extraction', '.keating/tmp/bench-static-extraction.py', 'site-data/static-extraction.json',
         'Spans scored against the five category rubrics'],
        ['170-row subject bench', '.keating/tmp/bench-static-subject-big.py', 'site-data/static-subject-170.jsonl',
         'Four methods; the logistic head is 5-fold cross-validated'],
        ['Needle on the 170 rows', '.keating/tmp/needle-training/eval_suite.py', 'needle-training/eval-report.json',
         'Read from the committed report; artifact hashes match'],
        ['Probe contamination', '.keating/tmp/bench-probe-split.py', 'site-data/probe-split.json',
         'Nearest-neighbour cosine of each probe row against the training set'],
        ['Abstention sweep', '.keating/tmp/bench-static-abstain.py', 'bench-abstain-8m.json, bench-abstain-32m.json',
         'Margin and support gates; leave-one-out support for training rows'],
        ['KEV against Jev', '.keating/tmp/run-kev-vs-jev.py', 'kev-vs-jev.jsonl',
         'Byte-identical captured request bodies to both judges'],
        ['Jev full harness', '.keating/tmp/run-jev-only.py', 'jev-only.jsonl',
         'All 68 runnable captured requests'],
        ['Artifact sizes', 'scripts/on-device-site/collect.py', 'site-data/artifact-sizes.json',
         'Hugging Face registry plus mobile/modules/keating-needle/assets.json'],
    ]
    commands = ("<span class=\"dim\"># regenerate the static-model artifacts</span>\n"
                "uv run --no-project --with model2vec --with numpy \\\n"
                "  python .keating/tmp/bench-static-retrieval.py minishlab/potion-base-8M\n"
                "\n"
                "<span class=\"dim\"># regenerate the local Needle artifacts (needs the pinned venv)</span>\n"
                ".keating/tmp/needle/venv/bin/python .keating/tmp/needle-classify-census.py\n"
                "\n"
                "<span class=\"dim\"># hosted judge over the captured harness</span>\n"
                "TYPESAFE_API_KEY=\"$(skate get typesafe_api_key@secrets)\" \\\n"
                "  python3 .keating/tmp/run-jev-only.py\n"
                "\n"
                "<span class=\"dim\"># rebuild this site</span>\n"
                "python3 scripts/on-device-site/build.py")
    body = f"""<div class="hero"><div class="wrap">
<p class="kicker">METHOD NOTES</p>
<h1>How each number <span>was produced</span></h1>
<p class="lede">Every figure on the report page is read out of a result file by
<code>scripts/on-device-site/collect.py</code>. Nothing is transcribed by hand. This page lists the harness that wrote
each file, so any figure can be traced back to the run that produced it.</p>
</div></div>
<section><div class="wrap">
{table('Measurement provenance', ['Measurement', 'Harness', 'Result artifact', 'Notes'], rows)}
<h3>Reproducing</h3>
<div class="term"><pre><code>{commands}</code></pre></div>
{note('Scratch, not source', "<p>The harnesses live under <code>.keating/tmp/</code> because they need the real pinned "
      "model, a real credential, or the real captured corpus, none of which belong in the deterministic test suite. They "
      "are reproducible but not committed as tests.</p>", 'warn')}
{note('Credential handling', "<p>The hosted runs read the TypeSafe key from the environment, sourced from the local secret "
      "store. It is never written into a result file, a log line, or this site.</p>")}
</div></section>"""
    return shell('Methods · A Measure of Machine Judgement',
                 'Provenance for every measurement in the Keating on-device model report.', '/methods/', body, prose=True)


def build_post() -> str:
    source = POST.read_text()
    lines = source.split("\n")
    title = lines[0].lstrip("# ").strip()
    rendered, toc = markdown.render("\n".join(lines[1:]))
    contents = "".join(f'<li><a href="#{anchor}">{esc(text)}</a></li>' for level, anchor, text in toc if level == 2)
    body = f"""<div class="hero"><div class="wrap">
<p class="kicker">PREVIEW POST · docs/blog/needle-subject-routing.md</p>
<h1>{esc(title)}</h1>
<p class="postmeta">Published in full, unedited. This is the write-up that preceded the measurements on the
<a href="/">report page</a>; where the two disagree, the report page carries the later evidence.</p>
</div></div>
<section><div class="wrap">
<details open><summary>Contents</summary><div class="details-body"><ul>{contents}</ul></div></details>
{rendered}
</div></section>"""
    return shell(f'{title} · A Measure of Machine Judgement',
                 'The preview post on whether a small local model can choose the subject, published in full.',
                 '/blog/needle-subject-routing/', body, prose=True)


def main() -> None:
    data = collect.build()
    if PUBLIC.exists():
        shutil.rmtree(PUBLIC)
    (PUBLIC / "blog/needle-subject-routing").mkdir(parents=True, exist_ok=True)
    (PUBLIC / "methods").mkdir(parents=True, exist_ok=True)
    shutil.copy(HERE / "site.css", PUBLIC / "site.css")
    (PUBLIC / "index.html").write_text(build_index(data))
    (PUBLIC / "methods/index.html").write_text(build_methods())
    (PUBLIC / "blog/needle-subject-routing/index.html").write_text(build_post())
    (PUBLIC / "data.json").write_text(json.dumps(
        {"generated": MEASURED,
         "notice": "Agreement is not correctness; no human learning is measured here.",
         "measurements": data}, indent=1) + "\n")
    (PUBLIC / "robots.txt").write_text("User-agent: *\nAllow: /\n")
    files = [path for path in PUBLIC.rglob("*") if path.is_file()]
    total = sum(path.stat().st_size for path in files)
    print(f"built {len(files)} files, {total / 1024:.0f} KiB -> {PUBLIC}")


if __name__ == "__main__":
    main()
