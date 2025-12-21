/*!
 * Sios v1.3.2 - Sios JS
 * Production-ready HTTP client inspired by Axios
 * @copyright  2025 Sios JS Tim
 * @author    Ali Musthofa
 * @link      https://github.com/alicom13/sios
 * @license   MIT
 */
(function (global, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    global.Sios = factory().Sios;
    global.sios = factory().sios;
    global.SiosError = factory().SiosError;
  }
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  class Sios {
    constructor(cfg = {}) {
      if (cfg && typeof cfg !== 'object') {
        console.warn('Sios: konfigurasi harus berupa objek');
      }

      this.defaults = {
        baseURL: '',
        timeout: 10000,
        headers: { 'Accept': 'application/json' },
        validateStatus: status => status >= 200 && status < 300,
        withCredentials: false,
        maxRetries: 0,
        retryDelay: 1000,
        ...cfg
      };
      
      this.interceptors = { request: [], response: [] };
      this.activeRequests = new Map();
      this.cache = new Map();
      this.metrics = { total: 0, success: 0, failed: 0, cacheHits: 0 };
    }

    async request(method, url, data = null, cfg = {}) {
      const reqId = this._genId();
      this.metrics.total++;
      
      const abortCtrls = new Map();
      const rState = { dibatalkan: false };
      const initCtrl = new AbortController();
      abortCtrls.set(0, initCtrl);
      
      this.activeRequests.set(reqId, { abortCtrls, rState, currentAttempt: 0 });
      
      try {
        const mergedCfg = this._mergeCfg(method, url, data, cfg);
        mergedCfg.signal = initCtrl.signal;
        
        if (method === 'GET' && cfg.cache) {
          const cKey = this._genCacheKey(method, url, cfg.params, data);
          const cached = this.cache.get(cKey);
          if (cached && Date.now() < cached.expired) {
            this.metrics.cacheHits++;
            this.metrics.success++;
            return { ...cached.data, cached: true, reqId };
          }
        }
        
        let finalCfg = mergedCfg;
        for (const icp of this.interceptors.request) {
          const fn = icp.onFulfilled || icp;
          finalCfg = await Promise.resolve(fn(finalCfg));
        }
        
        const res = await this._execReq(finalCfg, reqId, rState, abortCtrls);
        const processed = await this._procRes(res, finalCfg);
        
        if (!finalCfg.validateStatus(processed.status)) {
          throw new SiosError(
            `HTTP ${processed.status}: ${processed.statusText}`,
            `HTTP_${processed.status}`,
            finalCfg,
            processed
          );
        }
        
        if (method === 'GET' && cfg.cache) {
          const cKey = this._genCacheKey(method, url, cfg.params, data);
          this.cache.set(cKey, {
            data: processed,
            expired: Date.now() + (cfg.cacheTTL || 60000)
          });
        }
        
        let finalRes = { ...processed, reqId, cfg: finalCfg };
        for (const icp of this.interceptors.response) {
          if (icp.onFulfilled) {
            finalRes = await Promise.resolve(icp.onFulfilled(finalRes));
          }
        }
        
        this.metrics.success++;
        return finalRes;
        
      } catch (err) {
        this.metrics.failed++;
        let finalErr = err;
        
        if (!err.isSiosError) {
          finalErr = new SiosError(
            err.message || 'Error tidak diketahui',
            err.name === 'AbortError' ? 'CANCELLED' : 
            err.name === 'TimeoutError' ? 'TIMEOUT' : 'UNKNOWN_ERROR',
            cfg,
            null,
            err
          );
        }
        
        for (const icp of this.interceptors.response) {
          if (icp.onRejected) {
            try {
              finalErr = await Promise.resolve(icp.onRejected(finalErr));
            } catch (icpErr) {
              console.warn('Interceptor error gagal:', icpErr);
            }
          }
        }
        
        throw finalErr;
      } finally {
        this.activeRequests.delete(reqId);
      }
    }

    _mergeCfg(method, url, data, cfg) {
      let fUrl;
      try {
        if (this.defaults.baseURL) {
          fUrl = new URL(url, this.defaults.baseURL).href;
        } else {
          fUrl = url;
        }
      } catch (e) {
        console.warn(`Sios: URL tidak valid (baseURL: "${this.defaults.baseURL}", url: "${url}")`);
        fUrl = url;
      }
      
      return {
        ...this.defaults,
        method: method.toUpperCase(),
        url: fUrl,
        data,
        headers: { ...this.defaults.headers, ...cfg.headers },
        ...cfg
      };
    }

    async _execReq(cfg, reqId, rState, abortCtrls) {
      let lastErr;
      
      for (let att = 0; att <= cfg.maxRetries; att++) {
        const reqState = this.activeRequests.get(reqId);
        if (reqState) reqState.currentAttempt = att;
        
        if (rState.dibatalkan) {
          throw new SiosError('Request dibatalkan', 'CANCELLED', cfg);
        }
        
        if (att > 0) {
          if (rState.dibatalkan) {
            throw new SiosError('Request dibatalkan', 'CANCELLED', cfg);
          }
          
          await this._delay(cfg.retryDelay * Math.pow(2, att - 1));
          
          abortCtrls.forEach(ctrl => {
            if (!ctrl.signal.aborted) ctrl.abort();
          });
          
          const newCtrl = new AbortController();
          abortCtrls.set(att, newCtrl);
          cfg.signal = newCtrl.signal;
        }
        
        try {
          const tmoPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new SiosError(
              `Timeout setelah ${cfg.timeout}ms`,
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
          
          if (cfg.data && !['GET', 'HEAD'].includes(cfg.method)) {
            if (cfg.data instanceof FormData) {
              opts.body = cfg.data;
              if (opts.headers['Content-Type']) delete opts.headers['Content-Type'];
            } else if (typeof cfg.data === 'object') {
              opts.body = JSON.stringify(cfg.data);
              if (!opts.headers['Content-Type']) opts.headers['Content-Type'] = 'application/json';
            } else {
              opts.body = cfg.data;
            }
          }
          
          const fetchProm = fetch(cfg.url, opts);
          return await Promise.race([fetchProm, tmoPromise]);
          
        } catch (err) {
          lastErr = err;
          
          if (err.code === 'TIMEOUT' || err.code === 'CANCELLED') throw err;
          
          const isNetErr = !err.code || err.code === 'NETWORK' || err.name === 'TypeError';
          const shouldRetry = att < cfg.maxRetries && isNetErr;
          
          if (!shouldRetry) {
            if (!err.isSiosError) {
              throw new SiosError(
                err.message || 'Error jaringan',
                'NETWORK',
                cfg,
                null,
                err
              );
            }
            throw err;
          }
        }
      }
      
      throw lastErr;
    }

    async _procRes(res, cfg) {
      const headers = {};
      res.headers.forEach((val, key) => headers[key] = val);
      
      const result = {
        data: null,
        status: res.status,
        statusText: res.statusText,
        headers,
        cfg
      };
      
      const ctType = res.headers.get('content-type') || '';
      
      if (ctType.includes('application/json')) {
        const text = await res.text();
        result.data = text ? JSON.parse(text) : null;
      } else if (ctType.includes('text/')) {
        result.data = await res.text();
      } else if (ctType.includes('multipart/form-data')) {
        result.data = await res.formData();
      } else {
        result.data = await res.blob();
      }
      
      return result;
    }

    _genCacheKey(method, url, params = {}, data = null) {
      const sortParams = Object.keys(params)
        .sort()
        .map(k => `${k}=${JSON.stringify(params[k])}`)
        .join('&');
      
      let dHash = '';
      if (data && typeof data === 'object') {
        try {
          dHash = JSON.stringify(data);
        } catch {
          dHash = String(data);
        }
      } else if (data) dHash = String(data);
      
      return `${method}:${url}:${sortParams}:${dHash}`;
    }

    _delay(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    _genId() {
      return `sios_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    }

    get(url, cfg = {}) {
      return this.request('GET', url, null, cfg);
    }

    post(url, data, cfg = {}) {
      return this.request('POST', url, data, cfg);
    }

    put(url, data, cfg = {}) {
      return this.request('PUT', url, data, cfg);
    }

    patch(url, data, cfg = {}) {
      return this.request('PATCH', url, data, cfg);
    }

    delete(url, cfg = {}) {
      return this.request('DELETE', url, null, cfg);
    }

    head(url, cfg = {}) {
      return this.request('HEAD', url, null, cfg);
    }

    options(url, cfg = {}) {
      return this.request('OPTIONS', url, null, cfg);
    }

    upload(url, file, cfg = {}) {
      const formData = new FormData();
      formData.append('file', file);
      
      if (cfg.data) {
        Object.entries(cfg.data).forEach(([k, v]) => formData.append(k, v));
      }
      
      const upCfg = { ...cfg };
      delete upCfg.headers?.['Content-Type'];
      return this.post(url, formData, upCfg);
    }

    multiupload(url, files, cfg = {}) {
      const formData = new FormData();
      
      if (files instanceof FileList) {
        Array.from(files).forEach((file, i) => formData.append(`files[${i}]`, file));
      } else if (Array.isArray(files)) {
        files.forEach((file, i) => formData.append(`files[${i}]`, file));
      } else if (typeof files === 'object') {
        Object.entries(files).forEach(([field, file]) => {
          if (Array.isArray(file)) {
            file.forEach((f, i) => formData.append(`${field}[${i}]`, f));
          } else formData.append(field, file);
        });
      } else throw new Error('Parameter files harus Array, FileList, atau Object');
      
      if (cfg.data) Object.entries(cfg.data).forEach(([k, v]) => formData.append(k, v));
      
      const upCfg = { ...cfg };
      delete upCfg.headers?.['Content-Type'];
      return this.post(url, formData, upCfg);
    }

    intercept(type, onFulfilled, onRejected) {
      if (!['request', 'response'].includes(type)) {
        throw new Error('Tipe interceptor harus "request" atau "response"');
      }
      
      const handler = onRejected ? { onFulfilled, onRejected } : onFulfilled;
      this.interceptors[type].push(handler);
      
      return () => {
        const idx = this.interceptors[type].indexOf(handler);
        if (idx > -1) this.interceptors[type].splice(idx, 1);
      };
    }

    cancel(reqId) {
      const req = this.activeRequests.get(reqId);
      if (req) {
        req.rState.dibatalkan = true;
        req.abortCtrls.forEach(ctrl => {
          if (!ctrl.signal.aborted) ctrl.abort();
        });
        return true;
      }
      return false;
    }

    cancelAll() {
      this.activeRequests.forEach(req => {
        req.rState.dibatalkan = true;
        req.abortCtrls.forEach(ctrl => {
          if (!ctrl.signal.aborted) ctrl.abort();
        });
      });
      this.activeRequests.clear();
    }

    clearCache(pattern = null) {
      if (!pattern) {
        this.cache.clear();
        return;
      }
      
      const delKeys = [];
      for (const k of this.cache.keys()) {
        let del = false;
        if (pattern instanceof RegExp) del = pattern.test(k);
        else del = k.includes(pattern);
        if (del) delKeys.push(k);
      }
      
      delKeys.forEach(k => this.cache.delete(k));
    }

    getMetrics() {
      return {
        ...this.metrics,
        activeRequests: this.activeRequests.size,
        cacheSize: this.cache.size
      };
    }

    resetMetrics() {
      this.metrics = { total: 0, success: 0, failed: 0, cacheHits: 0 };
    }

    create(cfg = {}) {
      return new Sios({ ...this.defaults, ...cfg });
    }

    destroy() {
      this.cancelAll();
      this.clearCache();
      this.interceptors = { request: [], response: [] };
    }
  }

  class SiosError extends Error {
    constructor(message, code, cfg, res, origErr) {
      super(message);
      this.name = 'SiosError';
      this.code = code;
      this.cfg = cfg;
      this.res = res;
      this.origErr = origErr;
      this.isSiosError = true;
      this.timestamp = Date.now();
      if (Error.captureStackTrace) Error.captureStackTrace(this, SiosError);
    }
    
    toJSON() {
      return {
        name: this.name,
        message: this.message,
        code: this.code,
        timestamp: this.timestamp,
        stack: this.stack
      };
    }
  }

  const sios = new Sios();

  return {
    Sios: Sios,
    sios: sios,
    SiosError: SiosError
  };
}));
