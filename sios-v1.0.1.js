/*!
 * Sios v1.0.1 - Sios JS
 * Ultra-minimal HTTP client inspired by Axios
 * @copyright  2025 Sios JS Tim
 * @author    Ali Musthofa
 * @link      https://github.com/alicom13/sios
 * @license   MIT
 */

class Sios {
  constructor(config = {}) {
    this.defaults = {
      baseURL: '',
      timeout: 10000,
      headers: { 'Accept': 'application/json' },
      validateStatus: (status) => status >= 200 && status < 300,
      responseType: 'json',
      withCredentials: false,
      maxRedirects: 5,
      ...config
    };
    
    this.interceptors = { request: [], response: [] };
    this.activeRequests = new Map();
  }
  
  async request(method, url, data = null, config = {}) {
    const requestId = `sios_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const controller = new AbortController();
    
    try {
      const mergedConfig = {
        ...this.defaults,
        ...config,
        method,
        url,
        data,
        headers: { ...this.defaults.headers, ...config.headers }
      };
      
      mergedConfig.signal = controller.signal;
      this.activeRequests.set(requestId, { controller, config: mergedConfig });
      
      let requestConfig = mergedConfig;
      for (const interceptor of this.interceptors.request) {
        requestConfig = await interceptor(requestConfig);
      }
      
      const fullUrl = requestConfig.baseURL ? `${requestConfig.baseURL}${url}` : url;
      const requestInit = this._buildRequestInit(requestConfig);
      
      const response = await this._fetchWithTimeout(fullUrl, requestInit, requestConfig);
      const processed = await this._processResponse(response, requestConfig);
      
      let finalResponse = {
        ...processed,
        config: requestConfig,
        requestId
      };
      
      for (const interceptor of this.interceptors.response) {
        finalResponse = await interceptor(finalResponse);
      }
      
      this.activeRequests.delete(requestId);
      return finalResponse;
      
    } catch (error) {
      this.activeRequests.delete(requestId);
      throw this._enhanceError(error, config);
    }
  }
  
  get(url, config = {}) {
    return this.request('GET', url, null, config);
  }
  
  post(url, data = null, config = {}) {
    return this.request('POST', url, data, config);
  }
  
  put(url, data = null, config = {}) {
    return this.request('PUT', url, data, config);
  }
  
  patch(url, data = null, config = {}) {
    return this.request('PATCH', url, data, config);
  }
  
  delete(url, config = {}) {
    return this.request('DELETE', url, null, config);
  }
  
  head(url, config = {}) {
    return this.request('HEAD', url, null, config);
  }
  
  options(url, config = {}) {
    return this.request('OPTIONS', url, null, config);
  }
  
  async upload(url, file, config = {}) {
    const formData = new FormData();
    formData.append('file', file);
    
    if (config.data && typeof config.data === 'object') {
      Object.entries(config.data).forEach(([key, value]) => {
        formData.append(key, value);
      });
    }
    
    const uploadConfig = { ...config };
    return this.request('POST', url, formData, uploadConfig);
  }
  
  async multiupload(url, files, config = {}) {
    const formData = new FormData();
    files.forEach((file, index) => {
      formData.append(`files[${index}]`, file);
    });
    
    if (config.data) {
      Object.entries(config.data).forEach(([key, value]) => {
        formData.append(key, value);
      });
    }
    
    const uploadConfig = { ...config };
    return this.request('POST', url, formData, uploadConfig);
  }
  
  intercept(type, handler) {
    if (!['request', 'response'].includes(type)) {
      throw new Error('Interceptor type must be "request" or "response"');
    }
    
    this.interceptors[type].push(handler);
    
    return () => {
      const index = this.interceptors[type].indexOf(handler);
      if (index > -1) {
        this.interceptors[type].splice(index, 1);
      }
    };
  }
  
  cancel(requestId) {
    const request = this.activeRequests.get(requestId);
    if (request) {
      request.controller.abort();
      this.activeRequests.delete(requestId);
      return true;
    }
    return false;
  }
  
  cancelAll() {
    for (const [id, request] of this.activeRequests) {
      request.controller.abort();
    }
    this.activeRequests.clear();
  }
  
  getActiveRequests() {
    return Array.from(this.activeRequests.entries()).map(([id, req]) => ({
      id,
      url: req.config.url,
      method: req.config.method || 'GET',
      config: req.config
    }));
  }
  
  create(config = {}) {
    return new Sios({ ...this.defaults, ...config });
  }
  
  _buildRequestInit(config) {
    const init = {
      method: config.method || 'GET',
      headers: config.headers,
      signal: config.signal,
      credentials: config.withCredentials ? 'include' : 'same-origin'
    };
    
    if (config.data !== null && config.data !== undefined) {
      if (config.data instanceof FormData) {
        init.body = config.data;
      } else if (typeof config.data === 'object') {
        init.body = JSON.stringify(config.data);
        if (!init.headers['Content-Type']) {
          init.headers['Content-Type'] = 'application/json';
        }
      } else {
        init.body = config.data;
      }
    }
    
    return init;
  }
  
  async _fetchWithTimeout(url, init, config) {
    const controller = init.signal || new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeout);
    
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timeoutId);
      
      if (!config.validateStatus(response.status)) {
        throw {
          name: 'HTTPError',
          message: `Request failed with status ${response.status}`,
          response,
          config
        };
      }
      
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }
  
  async _processResponse(response, config) {
    let data;
    
    try {
      switch (config.responseType) {
        case 'json':
          data = await response.json();
          break;
        case 'text':
          data = await response.text();
          break;
        case 'blob':
          data = await response.blob();
          break;
        case 'arraybuffer':
          data = await response.arrayBuffer();
          break;
        default:
          const contentType = response.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            data = await response.json();
          } else {
            data = await response.text();
          }
      }
    } catch (error) {
      data = null;
    }
    
    const headers = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    
    return {
      data,
      status: response.status,
      statusText: response.statusText,
      headers,
      config
    };
  }
  
  _enhanceError(error, config) {
    const enhanced = {
      name: error.name || 'SiosError',
      message: error.message,
      config,
      isSiosError: true,
      timestamp: new Date().toISOString()
    };
    
    if (error.name === 'AbortError') {
      enhanced.code = 'TIMEOUT';
      enhanced.message = `Request timeout after ${config.timeout}ms`;
    } else if (error.name === 'TypeError' && error.message.includes('fetch')) {
      enhanced.code = 'NETWORK';
      enhanced.message = 'Network error or CORS issue';
    } else if (error.name === 'HTTPError') {
      enhanced.code = `HTTP_${error.response.status}`;
      enhanced.response = error.response;
    } else {
      enhanced.code = 'UNKNOWN';
    }
    
    return enhanced;
  }
}

const sios = new Sios();

if (typeof window !== 'undefined') {
  window.Sios = Sios;
  window.sios = sios;
}

export default sios;
export { Sios };
