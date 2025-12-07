// Untuk referensi - ini kode setelah di-minify tapi diformat ulang
class Sios {
  constructor(c = {}) {
    this.defaults = {
      baseURL: '',
      timeout: 5000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      ...c
    };
    this.interceptors = {
      request: new InterceptorManager(),
      response: new InterceptorManager()
    };
  }

  async request(c) {
    const mergedConfig = {
      ...this.defaults,
      ...c,
      headers: {
        ...this.defaults.headers,
        ...c.headers
      }
    };
    const requestConfig = await this.interceptors.request.execute(mergedConfig);
    const response = await this._executeRequest(requestConfig);
    const finalResponse = await this.interceptors.response.execute(response);
    return finalResponse;
  }

  async _executeRequest(c) {
    const url = this._buildURL(c);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), c.timeout);

    try {
      const response = await fetch(url, {
        method: c.method || 'GET',
        headers: c.headers,
        body: c.data ? JSON.stringify(c.data) : undefined,
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const contentType = response.headers.get('content-type');
      const data = contentType && contentType.includes('application/json') 
        ? await response.json() 
        : await response.text();

      return {
        data,
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        config: c
      };
    } catch (error) {
      clearTimeout(timeoutId);
      throw {
        message: error.name === 'AbortError' 
          ? `Request timeout after ${c.timeout}ms` 
          : error.message,
        config: c,
        isSiosError: true,
        code: error.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR'
      };
    }
  }

  _buildURL(c) {
    let url = c.baseURL ? c.baseURL + c.url : c.url;
    if (c.params) {
      url += (url.includes('?') ? '&' : '?') + new URLSearchParams(c.params);
    }
    return url;
  }

  get(url, config) { return this.request({ ...config, method: 'GET', url }); }
  post(url, data, config) { return this.request({ ...config, method: 'POST', url, data }); }
  put(url, data, config) { return this.request({ ...config, method: 'PUT', url, data }); }
  patch(url, data, config) { return this.request({ ...config, method: 'PATCH', url, data }); }
  delete(url, config) { return this.request({ ...config, method: 'DELETE', url }); }
  head(url, config) { return this.request({ ...config, method: 'HEAD', url }); }
  options(url, config) { return this.request({ ...config, method: 'OPTIONS', url }); }
}

class InterceptorManager {
  constructor() { this.handlers = []; }
  
  use(onFulfilled, onRejected = null) {
    const id = this.handlers.length;
    this.handlers.push({ id, onFulfilled, onRejected });
    return id;
  }
  
  eject(id) { this.handlers[id] && (this.handlers[id] = null); }
  
  async execute(value) {
    let current = value;
    for (const handler of this.handlers) {
      if (!handler) continue;
      try {
        current = await handler.onFulfilled(current);
      } catch (error) {
        if (handler.onRejected) {
          current = await handler.onRejected(error);
        } else {
          throw error;
        }
      }
    }
    return current;
  }
}

const sios = new Sios();
sios.create = (config) => new Sios(config);

if (typeof window !== 'undefined' && !window.Sios && !window.sios) {
  window.Sios = Sios;
  window.sios = sios;
}

export default sios;
