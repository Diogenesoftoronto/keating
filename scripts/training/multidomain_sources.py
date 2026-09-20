"""Fetch only pinned public educational text; keep raw files and attribution.

Run with an output directory under .keating/outputs. A changed source fails its
hash check instead of silently changing the generation experiment.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
from html.parser import HTMLParser
from pathlib import Path
import urllib.request
import xml.etree.ElementTree as ET
import multidomain_corpus as corpus


class SourceText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in {'script', 'style'}:
            self.skip += 1

    def handle_endtag(self, tag):
        if tag in {'script', 'style'}:
            self.skip = max(0, self.skip - 1)

    def handle_data(self, data):
        if not self.skip and data.strip():
            self.parts.append(data.strip())


def extract_text(body, kind):
    if kind == 'cnxml':
        root = ET.fromstring(body)
        content = root.find('{http://cnx.rice.edu/cnxml}content')
        corpus.require(content is not None, 'Missing CNXML content')
        return ' '.join(' '.join(content.itertext()).split())
    value = body.decode('utf-8', errors='replace')
    if kind == 'markdown':
        # Keep note spellings and literal musical notation; an HTML parser would
        # swallow angle-bracket chord notation as if it were an HTML element.
        return ' '.join(value.split())
    if kind == 'google-html':
        start = value.find('class="devsite-article-body')
        corpus.require(start >= 0, 'Missing Google article body')
        start = value.rfind('<div', 0, start)
        value = value[start:value.find('</article>', start)]
    parser = SourceText(); parser.feed(value)
    return ' '.join(' '.join(parser.parts).split())


def fetch_catalog(config, output):
    output = Path(output).resolve()
    corpus.require(output.is_relative_to(corpus.ROOT / '.keating/outputs'), 'Use research output directory')
    output.mkdir(parents=True, exist_ok=True)
    raw = output / 'raw'; raw.mkdir(exist_ok=True)

    def fetch(entry):
        destination = raw / (entry['id'] + '.source')
        if not destination.exists():
            request = urllib.request.Request(entry['url'], headers={'User-Agent': 'Mozilla/5.0'})
            body = urllib.request.urlopen(request, timeout=45).read()
            corpus.require(hashlib.sha256(body).hexdigest() == entry['raw_sha256'], 'Source changed: ' + entry['id'])
            destination.write_bytes(body)
        body = destination.read_bytes()
        corpus.require(hashlib.sha256(body).hexdigest() == entry['raw_sha256'], 'Cached source changed')
        content = extract_text(body, entry['format'])
        corpus.require(hashlib.sha256(content.encode()).hexdigest() == entry['text_sha256'], 'Extraction changed')
        return entry | {'text': content}

    with ThreadPoolExecutor(max_workers=4) as pool:
        cards = list(pool.map(fetch, corpus.read(config)['sources']))
    corpus.write(output / 'catalog.json', {'version': 'multidomain-sources/v1', 'sources': cards})
    return {'sources': len(cards), 'catalog': str(output / 'catalog.json')}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('config', type=Path); parser.add_argument('output', type=Path)
    args = parser.parse_args()
    print(fetch_catalog(args.config, args.output))
