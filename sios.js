// sios.js - HTTP Client Minimalis & Production Ready
class Sios {
  constructor(config = {}) {
    this.defaults = {
      baseURL: '',
      timeout: 5000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      ...config
    };
    
    this.interceptors = {
      request: new InterceptorManager(),
      response: new InterceptorManager()
    };
  }

  async request(config) {
    const finalConfig = {
      ...this.defaults,
      ...config,
      headers: {
        ...this.defaults.headers,
        ...config.headers
      }
    };

    const requestConfig = await this.interceptors.request.execute(finalConfig);
    const response = await this._executeRequest(requestConfig);
    const finalResponse = await this.interceptors.response.execute(response);
    
    return finalResponse;
  }

  async _executeRequest(config) {
    const url = this._buildURL(config);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeout);

    try {
      const response = await fetch(url, {
        method: config.method || 'GET',
        headers: config.headers,
        body: config.data ? JSON.stringify(config.data) : undefined,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const contentType = response.headers.get('content-type');
      let data;
      
      if (contentType && contentType.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
      }

      return {
        data,
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        config
      };
    } catch (error) {
      clearTimeout(timeoutId);
      
      const siosError = {
        message: error.name === 'AbortError' 
          ? `Request timeout after ${config.timeout}ms` 
          : error.message,
        config,
        isSiosError: true,
        code: error.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR'
      };
      
      throw siosError;
    }
  }

  _buildURL(config) {
    let url = config.baseURL ? `${config.baseURL}${config.url}` : config.url;
    
    if (config.params) {
      const params = new URLSearchParams(config.params).toString();
      url += `${url.includes('?') ? '&' : '?'}${params}`;
    }
    
    return url;
  }

  get(url, config = {}) {
    return this.request({ ...config, method: 'GET', url });
  }

  post(url, data = null, config = {}) {
    return this.request({ ...config, method: 'POST', url, data });
  }

  put(url, data = null, config = {}) {
    return this.request({ ...config, method: 'PUT', url, data });
  }

  patch(url, data = null, config = {}) {
    return this.request({ ...config, method: 'PATCH', url, data });
  }

  delete(url, config = {}) {
    return this.request({ ...config, method: 'DELETE', url });
  }

  head(url, config = {}) {
    return this.request({ ...config, method: 'HEAD', url });
  }

  options(url, config = {}) {
    return this.request({ ...config, method: 'OPTIONS', url });
  }
}

class InterceptorManager {
  constructor() {
    this.handlers = [];
  }

  use(onFulfilled, onRejected = null) {
    const id = this.handlers.length;
    this.handlers.push({ id, onFulfilled, onRejected });
    return id;
  }

  eject(id) {
    if (this.handlers[id]) {
      this.handlers[id] = null;
    }
  }

  async execute(value) {
    let currentValue = value;
    for (const handler of this.handlers) {
      if (!handler) continue;
      
      try {
        currentValue = await handler.onFulfilled(currentValue);
      } catch (error) {
        if (handler.onRejected) {
          currentValue = await handler.onRejected(error);
        } else {
          throw error;
        }
      }
    }
    
    return currentValue;
  }
}

// Create default instance
const sios = new Sios();
sios.create = (config) => new Sios(config);

// ES Module Export
export default sios;

// UMD Export (untuk kompatibilitas)
if (typeof window !== 'undefined') {
  // Cek apakah Polos sudah ada, pastikan tidak ada konflik
  if (!window.Sios && !window.sios) {
    window.Sios = Sios;
    window.sios = sios;
  }
}
