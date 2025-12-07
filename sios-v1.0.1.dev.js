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
    console.log('🚀 Sios HTTP Client initialized');
    
    this.defaults = {
      baseURL: '',
      timeout: 10000,
      headers: {
        'Accept': 'application/json'
      },
      validateStatus: (status) => status >= 200 && status < 300,
      responseType: 'json',
      withCredentials: false,
      maxRedirects: 5,
      ...config
    };
    
    this.interceptors = {
      request: [],
      response: []
    };
    
    this.activeRequests = new Map();
    
    console.log('⚙️  Default config:', this.defaults);
  }
  
  // 🎯 CORE REQUEST METHOD
  async request(method, url, data = null, config = {}) {
    const requestId = `sios_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const controller = new AbortController();
    
    console.log(`🔗 Request ${requestId}: ${method} ${url}`);
    
    try {
      // Merge configurations
      const mergedConfig = {
        ...this.defaults,
        ...config,
        method,
        url,
        data,
        headers: {
          ...this.defaults.headers,
          ...config.headers
        }
      };
      
      mergedConfig.signal = controller.signal;
      this.activeRequests.set(requestId, { controller, config: mergedConfig });
      
      // Request interceptors
      console.log(`🔄 Running ${this.interceptors.request.length} request interceptors`);
      let requestConfig = mergedConfig;
      for (const interceptor of this.interceptors.request) {
        requestConfig = await interceptor(requestConfig);
      }
      
      // Build request
      const fullUrl = requestConfig.baseURL ? `${requestConfig.baseURL}${url}` : url;
      const requestInit = this._buildRequestInit(requestConfig);
      
      console.log(`📤 Sending: ${method} ${fullUrl}`, requestInit);
      
      // Execute with timeout
      const response = await this._fetchWithTimeout(fullUrl, requestInit, requestConfig);
      
      // Process response
      const processed = await this._processResponse(response, requestConfig);
      
      // Response interceptors
      console.log(`🔄 Running ${this.interceptors.response.length} response interceptors`);
      let finalResponse = {
        ...processed,
        config: requestConfig,
        requestId
      };
      
      for (const interceptor of this.interceptors.response) {
        finalResponse = await interceptor(finalResponse);
      }
      
      this.activeRequests.delete(requestId);
      console.log(`✅ Request ${requestId} completed: ${response.status}`);
      
      return finalResponse;
      
    } catch (error) {
      this.activeRequests.delete(requestId);
      console.error(`❌ Request ${requestId} failed:`, error);
      throw this._enhanceError(error, config);
    }
  }
  
  // 🚀 HTTP METHODS (Shortcuts)
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
  
  // 📤 UPLOAD METHODS
  async upload(url, file, config = {}) {
    console.log(`📤 Uploading: ${file.name} (${this._formatBytes(file.size)})`);
    
    const formData = new FormData();
    formData.append('file', file);
    
    if (config.data && typeof config.data === 'object') {
      Object.entries(config.data).forEach(([key, value]) => {
        formData.append(key, value);
        console.log(`   + Form field: ${key}=${value}`);
      });
    }
    
    const uploadConfig = {
      ...config,
      headers: {
        ...config.headers
      }
    };
    
    return this.request('POST', url, formData, uploadConfig);
  }
  
  async multiupload(url, files, config = {}) {
    console.log(`📦 Multi upload: ${files.length} files`);
    
    const formData = new FormData();
    files.forEach((file, index) => {
      formData.append(`files[${index}]`, file);
      console.log(`   + File ${index}: ${file.name} (${this._formatBytes(file.size)})`);
    });
    
    if (config.data) {
      Object.entries(config.data).forEach(([key, value]) => {
        formData.append(key, value);
      });
    }
    
    const uploadConfig = {
      ...config,
      headers: {
        ...config.headers
      }
    };
    
    return this.request('POST', url, formData, uploadConfig);
  }
  
  // 🔧 INTERCEPTORS
  intercept(type, handler) {
    if (!['request', 'response'].includes(type)) {
      throw new Error('Interceptor type must be "request" or "response"');
    }
    
    this.interceptors[type].push(handler);
    console.log(`➕ Added ${type} interceptor`);
    
    // Return unsubscribe function
    return () => {
      const index = this.interceptors[type].indexOf(handler);
      if (index > -1) {
        this.interceptors[type].splice(index, 1);
        console.log(`➖ Removed ${type} interceptor`);
      }
    };
  }
  
  // ⚡ UTILITY METHODS
  cancel(requestId) {
    const request = this.activeRequests.get(requestId);
    if (request) {
      request.controller.abort();
      this.activeRequests.delete(requestId);
      console.log(`⏹️ Cancelled request: ${requestId}`);
      return true;
    }
    
    console.warn(`⚠️ Request ID not found: ${requestId}`);
    return false;
  }
  
  cancelAll() {
    const count = this.activeRequests.size;
    for (const [id, request] of this.activeRequests) {
      request.controller.abort();
    }
    this.activeRequests.clear();
    console.log(`⏹️ Cancelled all ${count} active requests`);
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
    console.log('🆕 Creating new Sios instance');
    return new Sios({ ...this.defaults, ...config });
  }
  
  // 🔒 PRIVATE METHODS
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
        console.log('   📝 Body: FormData');
      } else if (typeof config.data === 'object') {
        init.body = JSON.stringify(config.data);
        if (!init.headers['Content-Type']) {
          init.headers['Content-Type'] = 'application/json';
        }
        console.log('   📝 Body: JSON', config.data);
      } else {
        init.body = config.data;
        console.log('   📝 Body:', typeof config.data);
      }
    }
    
    return init;
  }
  
  async _fetchWithTimeout(url, init, config) {
    const controller = init.signal || new AbortController();
    const timeoutId = setTimeout(() => {
      console.log(`⏰ Timeout after ${config.timeout}ms`);
      controller.abort();
    }, config.timeout);
    
    try {
      console.log(`⏳ Fetching: ${url}`);
      const response = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timeoutId);
      
      console.log(`📥 Response: ${response.status} ${response.statusText}`);
      
      if (!config.validateStatus(response.status)) {
        console.warn(`⚠️ Status validation failed: ${response.status}`);
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
          console.log('   📦 Parsed: JSON');
          break;
        case 'text':
          data = await response.text();
          console.log('   📦 Parsed: Text');
          break;
        case 'blob':
          data = await response.blob();
          console.log('   📦 Parsed: Blob');
          break;
        case 'arraybuffer':
          data = await response.arrayBuffer();
          console.log('   📦 Parsed: ArrayBuffer');
          break;
        default:
          const contentType = response.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            data = await response.json();
            console.log('   📦 Auto-parsed: JSON (from content-type)');
          } else {
            data = await response.text();
            console.log('   📦 Auto-parsed: Text');
          }
      }
    } catch (error) {
      console.warn('⚠️ Failed to parse response:', error);
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
    console.error('🔧 Enhancing error:', error);
    
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
      console.log('   ⏰ Error type: Timeout');
    } else if (error.name === 'TypeError' && error.message.includes('fetch')) {
      enhanced.code = 'NETWORK';
      enhanced.message = 'Network error or CORS issue';
      console.log('   🌐 Error type: Network');
    } else if (error.name === 'HTTPError') {
      enhanced.code = `HTTP_${error.response.status}`;
      enhanced.response = error.response;
      console.log(`   🚨 Error type: HTTP ${error.response.status}`);
    } else {
      enhanced.code = 'UNKNOWN';
      console.log('   ❓ Error type: Unknown');
    }
    
    return enhanced;
  }
  
  _formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }
}

// 🌐 GLOBAL INSTANCE
const sios = new Sios();

// 📦 EXPORT
if (typeof window !== 'undefined') {
  window.Sios = Sios;
  window.sios = sios;
  console.log('🌍 Sios available globally as window.sios');
}

export default sios;
export { Sios };
