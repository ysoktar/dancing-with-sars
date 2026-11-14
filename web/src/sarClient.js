// Promise wrapper around the SAR Web Worker (one worker for the whole app).
let worker = null, rid = 0;
const pending = new Map();

function w() {
  if (!worker) {
    worker = new Worker(new URL('./sarWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const p = pending.get(e.data.rid);
      if (e.data.progress) { p?.onProgress?.(e.data.progress); return; }
      pending.delete(e.data.rid);
      if (p) e.data.ok ? p.res(e.data.out) : p.rej(new Error(e.data.error));
    };
  }
  return worker;
}

export function call(op, args, transfer = [], onProgress = null) {
  return new Promise((res, rej) => {
    const id = ++rid;
    pending.set(id, { res, rej, onProgress });
    w().postMessage({ rid: id, op, args }, transfer);
  });
}

export async function renderImage(id, t, mode, opts = {}) {
  const r = await call('render', { id, t, mode, ...opts });
  return new ImageData(new Uint8ClampedArray(r.data), r.w, r.h);
}
