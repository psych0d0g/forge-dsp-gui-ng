# Copies the built web app (../dist/index.html.gz) into web/ before the ESP32 build.
# Without a web build a small placeholder page is embedded so the firmware still builds.
import gzip
import os
import shutil

Import("env")  # noqa: F821  (PlatformIO SCons)

root = env.subst("$PROJECT_DIR")  # noqa: F821
src = os.path.join(root, "..", "dist", "index.html.gz")
dst_dir = os.path.join(root, "web")
dst = os.path.join(dst_dir, "index.html.gz")
os.makedirs(dst_dir, exist_ok=True)
if os.path.exists(src):
    shutil.copyfile(src, dst)
    print(f"web app: {os.path.getsize(dst)} B")
else:
    page = b"<!doctype html><meta charset=utf-8><title>Forge DSP</title>" \
           b"<p>Web-App nicht gebaut: im Repo <code>npm run build</code>, dann die Firmware neu bauen.</p>"
    with gzip.open(dst, "wb") as f:
        f.write(page)
    print("web app missing, placeholder embedded")
