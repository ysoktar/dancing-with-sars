"""Read NISAR HDF5 products over HTTPS with range requests: only the blocks that are touched are downloaded.

ASF answers the product URL with a redirect to a signed CloudFront URL; the redirect is resolved once and the
signed URL is read in 4 MB blocks with an LRU cache. Authentication: an Earthdata Login token for
nisar.asf.earthdatacloud.nasa.gov, either injected by a proxy (cloud sessions) or given as EARTHDATA_TOKEN.
"""
import io
import os
import urllib.request
from collections import OrderedDict

BLOCK = 4 * 1024 * 1024


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def resolve(url):
    """Follow ASF's 303 to the signed download URL (the Authorization header must not go to CloudFront)."""
    hdr = {"User-Agent": "dancing-with-sars"}
    if os.environ.get("EARTHDATA_TOKEN"):
        hdr["Authorization"] = "Bearer " + os.environ["EARTHDATA_TOKEN"]
    op = urllib.request.build_opener(_NoRedirect)
    try:
        r = op.open(urllib.request.Request(url, headers={**hdr, "Range": "bytes=0-0"}), timeout=60)
        return url, int(r.headers.get("Content-Range", "/0").split("/")[-1])
    except urllib.error.HTTPError as e:
        if e.code in (301, 302, 303, 307, 308):
            loc = e.headers["Location"]
            r = urllib.request.urlopen(urllib.request.Request(loc, headers={"Range": "bytes=0-0"}), timeout=60)
            return loc, int(r.headers.get("Content-Range", "/0").split("/")[-1])
        raise


class RangeFile(io.RawIOBase):
    def __init__(self, url, cache_blocks=96):
        self.url, self.size = resolve(url)
        self.pos, self.cache, self.cap, self.fetched = 0, OrderedDict(), cache_blocks, 0

    def readable(self): return True
    def seekable(self): return True
    def tell(self): return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos

    def _block(self, i):
        if i in self.cache:
            self.cache.move_to_end(i)
            return self.cache[i]
        a, b = i * BLOCK, min(self.size, (i + 1) * BLOCK) - 1
        for k in range(4):
            try:
                d = urllib.request.urlopen(urllib.request.Request(self.url, headers={"Range": f"bytes={a}-{b}"}), timeout=120).read()
                break
            except Exception:  # noqa: BLE001
                if k == 3:
                    raise
        self.fetched += len(d)
        self.cache[i] = d
        if len(self.cache) > self.cap:
            self.cache.popitem(last=False)
        return d

    def readinto(self, buf):
        n = min(len(buf), self.size - self.pos)
        if n <= 0:
            return 0
        out, p = 0, self.pos
        while out < n:
            i = p // BLOCK
            blk = self._block(i)
            o = p - i * BLOCK
            k = min(n - out, len(blk) - o)
            buf[out:out + k] = blk[o:o + k]
            out += k; p += k
        self.pos = p
        return n
