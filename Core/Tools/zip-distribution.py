"""ZIP a completed distribution, preserving relative symlinks and Unix modes."""
import os, pathlib, stat, sys, zipfile
root = pathlib.Path(sys.argv[1]).resolve()
with zipfile.ZipFile(sys.argv[2], 'w', zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
    for base, dirs, files in os.walk(root, followlinks=False):
        for name in sorted(dirs + files):
            path = pathlib.Path(base) / name
            rel = path.relative_to(root.parent).as_posix()
            if path.is_symlink():
                info = zipfile.ZipInfo(rel)
                info.create_system = 3
                info.external_attr = (stat.S_IFLNK | 0o777) << 16
                archive.writestr(info, os.readlink(path))
            else:
                archive.write(path, rel)
