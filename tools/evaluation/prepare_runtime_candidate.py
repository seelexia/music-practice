"""Canonicalize source aliases only for the frozen evaluator.

Runtime v4 measures retain both portable sourceId and resolved sourcePage. The
frozen evaluator prefers sourceId for measures but sourcePage for notes; selecting
the resolved source consistently prevents counting one image as two pages.
No note, duration, pitch, lyric, order, tie or bar content is altered.
"""
import copy,hashlib,json
from pathlib import Path

def prepare(value):
    result=copy.deepcopy(value)
    if isinstance(result.get('draft'),dict):
        for m in result['draft'].get('measures',[]):
            if 'sourcePage' in m:
                m.pop('sourceId',None)
    return result

if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser();p.add_argument('input',type=Path);p.add_argument('output',type=Path)
    a=p.parse_args();raw=a.input.read_bytes();value=json.loads(raw.decode('utf-8-sig'))
    a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(prepare(value),ensure_ascii=False,indent=2),encoding='utf-8')
    a.output.with_suffix('.provenance.json').write_text(json.dumps({'input':str(a.input.resolve()),'sha256':hashlib.sha256(raw).hexdigest(),'operation':'Remove only measure.sourceId aliases when resolved sourcePage exists','scriptSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()},indent=2),encoding='utf-8')
