"""Download licensed media only; no downloaded code is executed."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import json
import requests

root = Path(__file__).resolve().parent.parent / 'public' / 'piano'
root.mkdir(parents=True, exist_ok=True)

def fetch(midi):
    name = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B'][midi % 12] + str(midi // 12 - 1)
    path = root / (name + '.mp3')
    if not path.exists() or path.stat().st_size < 1000:
        response = requests.get(f'https://tonejs.github.io/audio/salamander/{name}.mp3', timeout=30)
        response.raise_for_status()
        content = response.content
        if len(content) < 1000 or not (content[:3] == b'ID3' or (content[0] == 255 and content[1] & 224 == 224)):
            raise ValueError(f'{name}: unexpected audio format')
        path.write_bytes(content)
    return str(midi), '/piano/' + path.name

with ThreadPoolExecutor(max_workers=4) as pool:
    samples = dict(pool.map(fetch, range(36, 85, 3)))
manifest = dict(samples=samples, name='Salamander Grand Piano', license='CC BY 3.0', attribution='Salamander Grand Piano by Alexander Holm; samples hosted by Tone.js', source='https://github.com/Tonejs/audio/tree/master/salamander')
(root / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
(root / 'README.txt').write_text('Salamander Grand Piano by Alexander Holm\nYamaha C5 grand piano samples, distributed here as MP3 extracts from Tone.js audio.\nSource: https://github.com/Tonejs/audio/tree/master/salamander\nLicense: Creative Commons Attribution 3.0\nhttps://creativecommons.org/licenses/by/3.0/\nThis application pitch-shifts the closest sampled note for playback.\n', encoding='utf-8')
print(f'{len(samples)} local piano samples ready ({sum(p.stat().st_size for p in root.glob("*.mp3"))} bytes)')
