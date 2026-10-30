"""Download the public sources of sources.csv into RAW/<source>/ and unpack their archives in place."""
import argparse
import fnmatch
import os
import re
import shutil
import subprocess
import tarfile
import urllib.parse
import zipfile
from pathlib import Path

import polars as pl
import requests
import zstandard
from huggingface_hub import snapshot_download

ARCHIVES = (".zip", ".tar", ".tar.gz", ".tgz", ".tar.bz2", ".tbz2", ".tar.xz", ".txz", ".tar.zst", ".7z", ".rar")
PARTS = re.compile(r"(.+\.(?:zip|7z|tar|tar\.gz|tgz))\.?(\d{3}|a[a-z])", re.I)
OPENSLR = ["*.tar.gz", "*.tgz", "*.zip", "*.tar", "*.tar.bz2", "*.txt", "*.tsv", "*.csv"]
LINKS = {"youtube", "commoncrawl", "web"}  # rebuilt by youtube.py, commoncrawl.py and ../web_youtube.py, ../web_links.py
S = requests.Session()
S.headers["User-Agent"] = "clap2-download (+https://github.com/LAION-AI/clap2)"


def get(url, **kw):
    """GET with status check."""
    r = S.get(url, timeout=120, **kw)
    r.raise_for_status()
    return r


def fetch(url, dest, **kw):
    """Stream url to dest atomically; skipped when dest or its unpacked marker exists."""
    if dest.exists() or Path(f"{dest}.unpacked").exists():
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"  {url}", flush=True)
    with get(url, stream=True, **kw) as r, open(f"{dest}.part", "wb") as f:
        for b in r.iter_content(1 << 20):
            f.write(b)
    os.replace(f"{dest}.part", dest)


def matches(name, globs):
    return any(fnmatch.fnmatch(name, g) for g in globs)


def wanted(name, globs):
    return not globs or matches(name, globs)


def hf(ref, globs, out):
    repo, _, rev = ref.partition("@")
    snapshot_download(repo, repo_type="dataset", revision=rev or None, local_dir=out, allow_patterns=globs or None)


def zenodo(ref, globs, out):
    for f in get(f"https://zenodo.org/api/records/{ref}").json()["files"]:
        if wanted(f["key"], globs):
            fetch(f["links"]["self"], out / f["key"])


def kaggle(ref, globs, out):
    name = ref.removeprefix("competitions/")
    api = f"competitions/data/download-all/{name}" if name != ref else f"datasets/download/{ref}"
    fetch(f"https://www.kaggle.com/api/v1/{api}", out / f"{name.split('/')[-1]}.zip",
          auth=(os.environ["KAGGLE_USERNAME"], os.environ["KAGGLE_KEY"]))


def openslr(ref, globs, out):
    base = f"https://www.openslr.org/resources/{ref}/"
    for name in re.findall(r'href="([^"?/][^"]*)"', get(base).text):
        if wanted(name, globs or OPENSLR):
            fetch(base + name, out / urllib.parse.unquote(name))


def github(ref, globs, out):
    if not globs:
        return fetch(f"https://codeload.github.com/{ref}/zip/HEAD", out / f"{ref.split('/')[1]}.zip")
    files = [(a["name"], a["browser_download_url"]) for rel in get(f"https://api.github.com/repos/{ref}/releases").json() for a in rel["assets"]]
    files += [(f["name"], f["download_url"]) for f in get(f"https://api.github.com/repos/{ref}/contents").json() if f["type"] == "file"]
    for name, u in files:
        if wanted(name, globs):
            fetch(u, out / name)


def archive(ref, globs, out):
    for f in get(f"https://archive.org/metadata/{ref}").json()["files"]:
        if wanted(f["name"], globs) if globs else f["source"] == "original" and not f["name"].startswith(ref + "_"):
            fetch(f"https://archive.org/download/{ref}/{urllib.parse.quote(f['name'])}", out / f["name"])


def figshare(ref, globs, out):
    for f in get(f"https://api.figshare.com/v2/articles/{ref}/files", params={"page_size": 1000}).json():
        if wanted(f["name"], globs):
            fetch(f["download_url"], out / f["name"])


def dataverse(ref, globs, out):
    host, doi = ref.split("/", 1)
    files = get(f"https://{host}/api/datasets/:persistentId/", params={"persistentId": doi}).json()["data"]["latestVersion"]["files"]
    for f in files:
        name = f"{f.get('directoryLabel', '.')}/{f['dataFile']['filename']}"
        if wanted(name, globs):
            fetch(f"https://{host}/api/access/datafile/{f['dataFile']['id']}?format=original", out / name)


def osf(ref, globs, out):
    def walk(url, rel):
        while url:
            page = get(url).json()
            for f in page["data"]:
                path = f"{rel}{f['attributes']['name']}"
                if f["attributes"]["kind"] == "folder":
                    walk(f["relationships"]["files"]["links"]["related"]["href"], path + "/")
                elif wanted(path, globs):
                    fetch(f["links"]["download"], out / path)
            url = page["links"]["next"]
    walk(f"https://api.osf.io/v2/nodes/{ref}/files/osfstorage/", "")


def url(ref, globs, out):
    """Plain URLs; `URL#path` saves to that path, a URL without a file name in its path is named by the server."""
    for u in [ref, *globs]:
        u, _, name = u.partition("#")
        name = name or urllib.parse.unquote(Path(urllib.parse.urlparse(u).path).name)
        if "." not in name:
            with get(u, stream=True) as r:
                cd = re.search(r"filename\*?=(?:UTF-8'')?\"?([^\";]+)", r.headers.get("Content-Disposition", ""))
                name = urllib.parse.unquote(cd[1] if cd else Path(urllib.parse.urlparse(r.url).path).name)
        fetch(u, out / name)


def manual(ref, globs, out):
    assert out.is_dir() and any(out.iterdir()), f"download manually from {ref} into {out}"


HANDLERS = {f.__name__: f for f in (hf, zenodo, kaggle, openslr, github, archive, figshare, dataverse, osf, url, manual)}


def done(p):
    Path(f"{p}.unpacked").touch()
    p.unlink()


def unpack(out, keep):
    """Join byte-split parts, then unpack every archive under out (nested ones too) next to itself, except `keep` globs."""
    parts = {}
    for p in sorted(out.rglob("*")):
        if p.is_file() and (m := PARTS.fullmatch(p.name)):
            parts.setdefault(p.with_name(m[1]), []).append(p)
    for dest, ps in parts.items():
        with open(f"{dest}.part", "wb") as f:
            for p in ps:
                with open(p, "rb") as src:
                    shutil.copyfileobj(src, f)
        os.replace(f"{dest}.part", dest)
        for p in ps:
            done(p)
    while todo := [p for p in sorted(out.rglob("*")) if p.is_file() and p.name.lower().endswith(ARCHIVES)
                   and not matches(p.relative_to(out).as_posix(), keep)]:
        for p in todo:
            print(f"  unpack {p.relative_to(out)}", flush=True)
            name, volumes = p.name.lower(), sorted(p.parent.glob(f"{p.stem}.z[0-9][0-9]"))
            if name.endswith((".7z", ".rar")) or name.endswith(".zip") and volumes:
                subprocess.run(["7z", "x", "-y", f"-o{p.parent}", str(p)], check=True, stdout=subprocess.DEVNULL)
            elif name.endswith(".zip"):
                with zipfile.ZipFile(p) as z:
                    z.extractall(p.parent)
            elif name.endswith(".tar.zst"):
                with zstandard.open(p, "rb") as f, tarfile.open(fileobj=f, mode="r|") as t:
                    t.extractall(p.parent, filter="data")
            else:
                with tarfile.open(p) as t:
                    t.extractall(p.parent, filter="data")
            for v in [p, *volumes]:
                done(v)


def download(r, out):
    """One source: its handler per id (several comma-separated ids go to <id>/ each), extra URL tokens, unpack."""
    h, (ref, *rest) = r["handler"], r["ref"].split()
    extra = [t for t in rest if "://" in t] if h != "url" else []
    ids = ref.split(",") if h not in ("url", "manual") else [ref]
    for i in ids:
        HANDLERS[h](i, [t for t in rest if t not in extra], out / i.split("/")[-1] if len(ids) > 1 else out)
    if extra:
        url(extra[0], extra[1:], out)
    assert out.is_dir() and any(out.iterdir()), "nothing downloaded"
    unpack(out, r["files"].split())
    (out / ".done").touch()


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("raw", type=Path, help="download root; each source goes to RAW/<source>/")
    ap.add_argument("--sources", help="comma-separated sources (default: all)")
    ap.add_argument("--csv", type=Path, default=Path(__file__).with_name("sources.csv"))
    a = ap.parse_args()
    rows = pl.read_csv(a.csv, infer_schema_length=0).fill_null("").filter(~pl.col("handler").is_in(LINKS))
    if a.sources:
        names = a.sources.split(",")
        assert set(names) <= set(rows["source"]), set(names) - set(rows["source"])
        rows = rows.filter(pl.col("source").is_in(names))
    failed = []
    for r in rows.iter_rows(named=True):
        if not (a.raw / r["source"] / ".done").exists():
            print(f"{r['source']}: {r['handler']} {r['ref'][:200]}", flush=True)
            try:
                download(r, a.raw / r["source"])
            except Exception as e:  # report every failing source, then exit non-zero
                print(f"{r['source']}: FAILED: {e!r}", flush=True)
                failed.append(r["source"])
    assert not failed, f"{len(failed)} sources failed (rerun to resume): {','.join(failed)}"


if __name__ == "__main__":
    main()
