"""Stream revision archives into a single, directly extractable source package."""
import json
import re
import shutil
import stat
import sys
import zipfile
from pathlib import Path, PurePosixPath


def portable_path(name):
    path = PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts or '\\' in name:
        raise ValueError(f'Unsafe archive path: {name}')
    parts = []
    for part in path.parts:
        part = re.sub(r'[<>:"|?*\x00-\x1f]', '_', part)
        part = re.sub(r'[. ]+$', lambda match: '_' * len(match[0]), part)
        if re.match(r'^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)', part, re.I):
            part = '_' + part
        parts.append(part)
    return '/'.join(parts) + ('/' if name.endswith('/') else '')


def package(bundle, output, manifests):
    index = json.loads((bundle / 'bundle.json').read_text(encoding='utf-8'))
    index['layout'] = 'expanded-sources-v1'
    index['symlinkPolicy'] = 'link-target-text'
    for row in index['versions']:
        names = set()
        mappings = []
        with zipfile.ZipFile(bundle / row['archive']) as source:
            for entry in source.infolist():
                name = portable_path(entry.filename)
                key = name.rstrip('/').casefold()
                if key in names:
                    raise ValueError(f'Conflicting portable path: {name}')
                names.add(key)
                if name != entry.filename:
                    mappings.append({'original': entry.filename, 'extracted': name})
        row['windowsPathMappings'] = mappings
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=1, allowZip64=True) as target:
        target.writestr('workspaces/bundle.json', json.dumps(index, indent=2) + '\n')
        for manifest in manifests:
            target.write(bundle / manifest, 'workspaces/' + manifest)
        for number, row in enumerate(index['versions'], 1):
            prefix = f"workspaces/sources/{row['repoId']}/{row['baseSha']}/"
            with zipfile.ZipFile(bundle / row['archive']) as source:
                for entry in source.infolist():
                    name = portable_path(entry.filename)
                    info = zipfile.ZipInfo(prefix + name, entry.date_time)
                    info.compress_type = zipfile.ZIP_DEFLATED
                    info._compresslevel = 1
                    info.external_attr = entry.external_attr
                    info.create_system = 3
                    # Plain link-target files extract on Windows without elevated privileges.
                    if stat.S_ISLNK(entry.external_attr >> 16):
                        info.external_attr = (stat.S_IFREG | 0o644) << 16
                    with source.open(entry) as reader, target.open(info, 'w', force_zip64=True) as writer:
                        shutil.copyfileobj(reader, writer, 1024 * 1024)
            target.writestr(f"workspaces/receipts/{row['repoId']}/{row['baseSha']}.json", json.dumps(row, indent=2) + '\n')
            print(json.dumps({'stage': 'sources', 'completed': number, 'total': len(index['versions'])}), flush=True)


if __name__ == '__main__':
    package(Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3:])
