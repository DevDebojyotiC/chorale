// Reference solution for the `framework` project — used only by projects-selftest.ts.
export function createApp() {
  const mws = [];
  const routes = [];
  function matchPath(pattern, path, req) {
    const pp = pattern.split("/");
    const ap = path.split("/");
    if (pp.length !== ap.length) return false;
    const params = {};
    for (let i = 0; i < pp.length; i++) {
      if (pp[i].startsWith(":")) params[pp[i].slice(1)] = decodeURIComponent(ap[i]);
      else if (pp[i] !== ap[i]) return false;
    }
    req.params = params;
    return true;
  }
  const app = {
    use(fn) { mws.push(fn); return app; },
    get(p, h) { routes.push({ method: "GET", p, h }); return app; },
    post(p, h) { routes.push({ method: "POST", p, h }); return app; },
    inject({ method = "GET", url = "/", body } = {}) {
      return new Promise((resolve) => {
        const [path, qs] = url.split("?");
        const query = Object.fromEntries(new URLSearchParams(qs || ""));
        let statusCode = 200;
        let ended = false;
        const done = (payload) => { if (!ended) { ended = true; resolve({ statusCode, body: payload }); } };
        const res = {
          status(c) { statusCode = c; return res; },
          json(o) { done(JSON.stringify(o)); return res; },
          send(s) { done(String(s)); return res; },
          end() { done(""); return res; },
        };
        const req = { method, path, url, query, body, params: {} };
        const match = routes.find((r) => r.method === method && matchPath(r.p, path, req));
        let i = 0;
        const next = () => {
          if (ended) return;
          if (i < mws.length) mws[i++](req, res, next);
          else if (match) match.h(req, res);
          else res.status(404).json({ error: "not found" });
        };
        next();
      });
    },
  };
  return app;
}
