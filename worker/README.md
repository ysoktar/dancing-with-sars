# NISAR proxy (Cloudflare Worker)

Lets the website read **calibrated NISAR GCOV data (γ⁰ in dB, 20 m)** for any area, live, without putting an Earthdata
token in the browser. The Worker keeps the token as a secret, adds it to requests to NASA's ASF archive and returns only
the byte ranges the browser asks for (the browser decodes the HDF5 file itself with h5wasm). It stores nothing.

Cost: free. Cloudflare's free plan allows 100,000 requests per day; one area of 12 passes needs a few hundred.

## Deploy (about 5 minutes)

1. Create a free account at <https://dash.cloudflare.com/sign-up>.
2. Make an Earthdata Login token: <https://urs.earthdata.nasa.gov> → *Generate Token* (valid 60 days).
3. In this folder:

```bash
npx wrangler login
```

```bash
npx wrangler secret put EARTHDATA_TOKEN
```

```bash
npx wrangler deploy
```

4. Wrangler prints the Worker address, e.g. `https://nisar-proxy.<your-name>.workers.dev`. Check it:
   `https://nisar-proxy.<your-name>.workers.dev/health` should answer `{"ok":true,"token":true}`.
5. Put the address in `web/public/config.json` (`"nisarProxy": "https://nisar-proxy.<your-name>.workers.dev"`) and
   push, or paste it on the site under *Calibrated data* (kept in your browser only).

To renew the token later, run `npx wrangler secret put EARTHDATA_TOKEN` again.

## What it accepts

`GET` / `HEAD /h5?url=<product URL>` with an optional `Range` header. Only `https://nisar.asf.earthdatacloud.nasa.gov/NISAR/…/*.h5`
is accepted, and only the origins in `ALLOWED_ORIGINS` (wrangler.toml) get CORS headers.
