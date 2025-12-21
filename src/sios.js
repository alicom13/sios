/*!
 * Sios v1.3.3 - Sios JS
 * Production-ready HTTP client inspired by Axios
 * @copyright  2025 Sios JS Tim
 * @author    Ali Musthofa
 * @link      https://github.com/alicom13/sios
 * @license   MIT
 */
class Sios {
  constructor(cfg = {}) {
    if (cfg && typeof cfg !== 'object') {
      console.warn('Sios: config harus object');
    }

    this.def = {
      baseURL: '',
      timeout: 10000,
      headers: { 'Accept': 'application/json' },
      validateStatus: s => s >= 200 && s < 300,
      withCredentials: false,
      maxRetries: 0,
      retryDelay: 1000,
      maxRetryDelay: 30000,
      retryOnJsonError: false,
      retryCond: this._defRetryCond,
      ...cfg
    };
    
    this.icpt = { req: [], res: [] };
    this.activeReqs = new Map();
    this.cch = new Map();
    this.mtr = { tot: 0, ok: 0, fail: 0, ch: 0 };
  }

  _defRetryCond(err, att, cfg) {
    if (err.code === 'TIMEOUT' || err.code === 'NETWORK') return true;
    if (err.code && err.code.startsWith('HTTP_5')) {
      const s = parseInt(err.code.split('_')[1]);
      return ![501, 505].includes(s);
    }
    if (cfg.retryOnJsonError && err.code === 'JSON_PARSE_ERROR') return true;
    return false;
  }

  async req(method, url, dt = null, cfg = {}) {
    const rid = this._genId();
    this.mtr.tot++;
    
    const abortCtrls = new Map();
    const rState = { stop: false };
    const initCtrl = new AbortController();
    abortCtrls.set(0, initCtrl);
    
    this.activeReqs.set(rid, { abortCtrls, rState, curAtt: 0 });
    
    try {
      const mergedCfg = this._mergeCfg(method, url, dt, cfg);
      mergedCfg.signal = initCtrl.signal;
      
      if (method === 'GET' && cfg.cache) {
        const cKey = this._genCacheKey(method, url, cfg.params, dt);
        const cached = this.cch.get(cKey);
        if (cached && Date.now() < cached.exp) {
          this.mtr.ch++;
          this.mtr.ok++;
          return { ...cached.dt, cached: true, rid };
        }
      }
      
      let finalCfg = mergedCfg;
      for (const icp of this.icpt.req) {
        const fn = icp.onOk || icp;
        finalCfg = await Promise.resolve(fn(finalCfg));
      }
      
      const res = await this._exec(finalCfg, rid, rState, abortCtrls);
      const processed = await this._proc(res, finalCfg);
      
      if (method === 'GET' && cfg.cache) {
        const cKey = this._genCacheKey(method, url, cfg.params, dt);
        this.cch.set(cKey, { dt: processed, exp: Date.now() + (cfg.cacheTTL || 60000) });
      }
      
      let finalRes = { ...processed, rid, cfg: finalCfg };
      for (const icp of this.icpt.res) {
        if (icp.onOk) {
          finalRes = await Promise.resolve(icp.onOk(finalRes));
        }
      }
      
      this.mtr.ok++;
      return finalRes;
      
    } catch (err) {
      this.mtr.fail++;
      let finalErr = err;
      
      if (!err.isSiosError) {
        finalErr = new SiosError(
          err.message || 'Unknown error',
          err.name === 'AbortError' ? 'CANCELLED' : 
          err.name === 'TimeoutError' ? 'TIMEOUT' : 'UNKNOWN',
          cfg,
          null,
          err
        );
      }
      
      for (const icp of this.icpt.res) {
        if (icp.onFail) {
          try {
            finalErr = await Promise.resolve(icp.onFail(finalErr));
          } catch {}
        }
      }
      
      throw finalErr;
    } finally {
      this.activeReqs.delete(rid);
    }
  }

  _mergeCfg(method, url, dt, cfg) {
    let fUrl;
    try {
      if (this.def.baseURL) {
        fUrl = new URL(url, this.def.baseURL).href;
      } else {
        fUrl = url;
      }
    } catch (e) {
      console.warn(`Sios: Invalid URL (baseURL: "${this.def.baseURL}", url: "${url}")`);
      fUrl = url;
    }
    
    return {
      ...this.def,
      method: method.toUpperCase(),
      url: fUrl,
      dt,
      headers: { ...this.def.headers, ...cfg.headers },
      ...cfg
    };
  }

  async _exec(cfg, rid, rState, abortCtrls) {
    let lastErr;
    
    for (let att = 0; att <= cfg.maxRetries; att++) {
      const reqState = this.activeReqs.get(rid);
      if (reqState) reqState.curAtt = att;
      
      if (rState.stop) throw new SiosError('Cancelled', 'CANCELLED', cfg);
      
      if (att > 0) {
        if (rState.stop) throw new SiosError('Cancelled', 'CANCELLED', cfg);
        
        const delay = this._calcDelay(att, cfg.retryDelay, cfg.maxRetryDelay);
        await this._wait(delay);
        
        abortCtrls.forEach(ctrl => {
          if (!ctrl.signal.aborted) ctrl.abort();
        });
        
        const newCtrl = new AbortController();
        abortCtrls.set(att, newCtrl);
        cfg.signal = newCtrl.signal;
      }
      
      try {
        const tmo = new Promise((_, reject) =>
          setTimeout(() => reject(new SiosError(
            `Timeout ${cfg.timeout}ms`,
            'TIMEOUT',
            cfg
          )), cfg.timeout)
        );
        
        const opts = {
          method: cfg.method,
          headers: { ...cfg.headers },
          signal: cfg.signal,
          credentials: cfg.withCredentials ? 'include' : 'same-origin',
          redirect: 'follow'
        };
        
        if (cfg.dt && !['GET', 'HEAD'].includes(cfg.method)) {
          if (cfg.dt instanceof FormData) {
            opts.body = cfg.dt;
            if (opts.headers['Content-Type']) delete opts.headers['Content-Type'];
          } else if (typeof cfg.dt === 'object') {
            opts.body = JSON.stringify(cfg.dt);
            if (!opts.headers['Content-Type']) opts.headers['Content-Type'] = 'application/json';
          } else {
            opts.body = cfg.dt;
          }
        }
        
        const fetchProm = fetch(cfg.url, opts);
        const res = await Promise.race([fetchProm, tmo]);
        
        if (!cfg.validateStatus(res.status)) {
          const temp = {
            dt: null,
            status: res.status,
            statusText: res.statusText,
            headers: {},
            cfg
          };
          
          res.headers.forEach((v, k) => temp.headers[k] = v);
          throw new SiosError(`HTTP ${res.status}`, `HTTP_${res.status}`, cfg, temp);
        }
        
        return res;
        
      } catch (err) {
        lastErr = err;
        if (err.code === 'CANCELLED') throw err;
        
        const shouldRetry = cfg.retryCond(err, att, cfg);
        if (!shouldRetry) {
          if (!err.isSiosError) {
            throw new SiosError(err.message || 'Network error', 'NETWORK', cfg, null, err);
          }
          throw err;
        }
      }
    }
    
    throw lastErr;
  }

  _calcDelay(att, base, max = 30000) {
    const exp = base * Math.pow(2, att - 1);
    const jitter = exp * 0.1 * Math.random();
    return Math.min(exp + jitter, max);
  }

  async _proc(res, cfg) {
    const hdrs = {};
    res.headers.forEach((v, k) => hdrs[k] = v);
    
    const r = {
      dt: null,
      status: res.status,
      statusText: res.statusText,
      headers: hdrs,
      cfg
    };
    
    const ct = res.headers.get('content-type') || '';
    
    try {
      if (ct.includes('application/json')) {
        const txt = await res.text();
        r.dt = txt ? JSON.parse(txt) : null;
      } else if (ct.includes('text/')) {
        r.dt = await res.text();
      } else if (ct.includes('multipart/form-data')) {
        r.dt = await res.formData();
      } else {
        r.dt = await res.blob();
      }
    } catch (e) {
      throw new SiosError('Parse failed', 'JSON_PARSE_ERROR', cfg, r, e);
    }
    
    return r;
  }

  _genCacheKey(method, url, params = {}, dt = null) {
    const sorted = Object.keys(params)
      .sort()
      .map(k => `${k}=${JSON.stringify(params[k])}`)
      .join('&');
    
    let hash = '';
    if (dt && typeof dt === 'object') {
      try {
        hash = JSON.stringify(dt);
      } catch {
        hash = String(dt);
      }
    } else if (dt) hash = String(dt);
    
    return `${method}:${url}:${sorted}:${hash}`;
  }

  _wait(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  _genId() {
    return `s_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  get(url, cfg = {}) {
    return this.req('GET', url, null, cfg);
  }

  post(url, dt, cfg = {}) {
    return this.req('POST', url, dt, cfg);
  }

  put(url, dt, cfg = {}) {
    return this.req('PUT', url, dt, cfg);
  }

  patch(url, dt, cfg = {}) {
    return this.req('PATCH', url, dt, cfg);
  }

  delete(url, cfg = {}) {
    return this.req('DELETE', url, null, cfg);
  }

  head(url, cfg = {}) {
    return this.req('HEAD', url, null, cfg);
  }

  options(url, cfg = {}) {
    return this.req('OPTIONS', url, null, cfg);
  }

  upload(url, file, cfg = {}) {
    const fd = new FormData();
    fd.append('file', file);
    if (cfg.dt) Object.entries(cfg.dt).forEach(([k, v]) => fd.append(k, v));
    const upCfg = { ...cfg };
    delete upCfg.headers?.['Content-Type'];
    return this.post(url, fd, upCfg);
  }

  multiupload(url, files, cfg = {}) {
    const fd = new FormData();
    
    if (files instanceof FileList) {
      Array.from(files).forEach((f, i) => fd.append(`files[${i}]`, f));
    } else if (Array.isArray(files)) {
      files.forEach((f, i) => fd.append(`files[${i}]`, f));
    } else if (typeof files === 'object') {
      Object.entries(files).forEach(([field, f]) => {
        if (Array.isArray(f)) {
          f.forEach((item, i) => fd.append(`${field}[${i}]`, item));
        } else fd.append(field, f);
      });
    } else throw new Error('Files must be Array, FileList, or Object');
    
    if (cfg.dt) Object.entries(cfg.dt).forEach(([k, v]) => fd.append(k, v));
    
    const upCfg = { ...cfg };
    delete upCfg.headers?.['Content-Type'];
    return this.post(url, fd, upCfg);
  }

  intercept(type, onOk, onFail) {
    if (!['req', 'res'].includes(type)) throw new Error('Type must be "req" or "res"');
    const h = onFail ? { onOk, onFail } : onOk;
    this.icpt[type].push(h);
    return () => {
      const idx = this.icpt[type].indexOf(h);
      if (idx > -1) this.icpt[type].splice(idx, 1);
    };
  }

  cancel(rid) {
    const req = this.activeReqs.get(rid);
    if (req) {
      req.rState.stop = true;
      req.abortCtrls.forEach(ctrl => {
        if (!ctrl.signal.aborted) ctrl.abort();
      });
      return true;
    }
    return false;
  }

  cancelAll() {
    this.activeReqs.forEach(req => {
      req.rState.stop = true;
      req.abortCtrls.forEach(ctrl => {
        if (!ctrl.signal.aborted) ctrl.abort();
      });
    });
    this.activeReqs.clear();
  }

  clearCache(pattern = null) {
    if (!pattern) {
      this.cch.clear();
      return;
    }
    
    const delKeys = [];
    for (const k of this.cch.keys()) {
      let del = false;
      if (pattern instanceof RegExp) del = pattern.test(k);
      else del = k.includes(pattern);
      if (del) delKeys.push(k);
    }
    
    delKeys.forEach(k => this.cch.delete(k));
  }

  getMetrics() {
    return {
      ...this.mtr,
      active: this.activeReqs.size,
      cache: this.cch.size
    };
  }

  resetMetrics() {
    this.mtr = { tot: 0, ok: 0, fail: 0, ch: 0 };
  }

  create(cfg = {}) {
    return new Sios({ ...this.def, ...cfg });
  }

  destroy() {
    this.cancelAll();
    this.clearCache();
    this.icpt = { req: [], res: [] };
  }
}

class SiosError extends Error {
  constructor(msg, code, cfg, res, orig) {
    super(msg);
    this.name = 'SiosError';
    this.code = code;
    this.cfg = cfg;
    this.res = res;
    this.orig = orig;
    this.isSiosError = true;
    this.ts = Date.now();
    if (Error.captureStackTrace) Error.captureStackTrace(this, SiosError);
  }
  
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      ts: this.ts,
      stack: this.stack
    };
  }
}

const sios = new Sios();

if (typeof window !== 'undefined') {
  window.Sios = Sios;
  window.sios = sios;
  window.SiosError = SiosError;
}

if (typeof global !== 'undefined') {
  global.Sios = Sios;
  global.sios = sios;
  global.SiosError = SiosError;
}

if (typeof self !== 'undefined') {
  self.Sios = Sios;
  self.sios = sios;
  self.SiosError = SiosError;
}

export default sios;
export { Sios, SiosError };
