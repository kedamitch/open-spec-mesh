"""Render every real Mermaid block; generated SVGs stay outside repository docs."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]

def diagrams(root):
    for path in sorted(root.rglob('*.md')):
        if any(p in ('.git', 'node_modules', '.venv') for p in path.parts): continue
        fence = None
        content = []
        render = False
        number = 0
        for line in path.read_text(encoding='utf-8').splitlines():
            match = re.match(r'^ {0,3}(`{3,}|~{3,})(.*)$', line)
            if fence:
                if match and match[1][0] == fence[0] and len(match[1]) >= len(fence) and not match[2].strip():
                    if render:
                        number += 1
                        yield path, number, '\n'.join(content)
                    fence = None
                elif render: content.append(line)
            elif match:
                fence = match[1]; render = match[2].strip() == 'mermaid'; content = []
        if fence: raise ValueError(f'Unclosed fence: {path}')

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mmdc', default='mmdc');parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    items=list(diagrams(ROOT))
    if not items: raise SystemExit('No Mermaid diagrams found')
    with tempfile.TemporaryDirectory(prefix='sdd-mermaid-') as directory:
        tmp=Path(directory);config=tmp/'puppeteer.json'
        config.write_text(json.dumps({'args':['--no-sandbox']}))
        for path,number,body in items:
            name=str(path.relative_to(ROOT)).replace('/','__')+f'-{number}'
            source=tmp/(name+'.mmd');source.write_text(body)
            subprocess.run([args.mmdc,'-p',str(config),'-i',str(source),'-o',str(args.output/(name+'.svg'))],check=True,timeout=90)
    print(f'Mermaid rendered successfully: {len(items)}')
if __name__=='__main__':main()
