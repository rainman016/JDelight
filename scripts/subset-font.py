"""Rebuild the page-only OFL webfont: python scripts/subset-font.py path/to/original.ttf.
Requires fonttools[woff] (fontTools + Brotli). Original font is NOT shipped.
"""
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont
import hashlib
import sys
import subprocess

root = Path(__file__).resolve().parents[1]
source = Path(sys.argv[1])
text = subprocess.run(['node', 'scripts/font-characters.mjs'], cwd=root,
                      capture_output=True, check=True, encoding='utf-8').stdout
# Literal page strings only: CJK, page punctuation, digits and Basic Latin.
chars = ''.join(sorted({c for c in text if '\u4e00' <= c <= '\u9fff' or '\u3000' <= c <= '\u303f' or '\uff00' <= c <= '\uffef'}))
chars += ''.join(chr(c) for c in range(32, 127)) + '←→↑↓·—…？↵'
font = TTFont(source)
options = subset.Options()
options.flavor = 'woff2'
options.name_IDs = ['*']
subsetter = subset.Subsetter(options=options)
subsetter.populate(text=chars)
subsetter.subset(font)
# New family/name avoids all reserved font names for this modified subset.
names = {1:'JDelight Notes', 2:'Regular', 3:'JDelight Notes Page Subset 1.530', 4:'JDelight Notes Regular', 6:'JDelightNotes-Regular', 16:'JDelight Notes', 17:'Regular'}
for record in font['name'].names:
    if record.nameID in names:
        record.string = names[record.nameID].encode(record.getEncoding())
font.flavor = 'woff2'
destination = root / 'public/fonts/jdelight-notes.woff2'
font.save(destination)
(root / 'public/fonts/subset-characters.txt').write_text(chars, encoding='utf-8')
print(f'{len(set(chars))} characters; {destination.stat().st_size} bytes')
print('Source SHA256:', hashlib.sha256(source.read_bytes()).hexdigest())
