// sios.dev.js - Development version with console logs
class Sios {
  constructor(config = {}) {
    console.log('🔧 Sios initialized with config:', config);
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
      request: new InterceptorManager('request'),
      response: new InterceptorManager('response')
    };
    
    console.log('✅ Default configuration set:', this.defaults);
  }

  async request(config) {
    console.group('🚀 Sios Request Started');
    console.log('📦 Original config:', config);
    
    // Merge config dengan defaults
    const finalConfig = {
      ...this.defaults,
      ...config,
      headers: {
        ...this.defaults.headers,
        ...config.headers
      }
    };
    
    console.log('🔀 Merged config:', finalConfig);
    console.groupEnd();

    try {
      // Apply request interceptors
      console.group('🔄 Request Interceptors');
      const requestConfig = await this.interceptors.request.execute(finalConfig);
      console.log('✅ Request config after interceptors:', requestConfig);
      console.groupEnd();

      // Execute request
      console.group('🌐 HTTP Request Execution');
      const response = await this._executeRequest(requestConfig);
      console.log('📨 Raw response received:', response);
      console.groupEnd();

      // Apply response interceptors
      console.group('🔄 Response Interceptors');
      const finalResponse = await this.interceptors.response.execute(response);
      console.log('✅ Final response after interceptors:', finalResponse);
      console.groupEnd();

      console.log('🎉 Request completed successfully');
      return finalResponse;
    } catch (error) {
      console.error('💥 Request failed with error:', error);
      console.group('🐛 Error Details');
      console.error('Error name:', error.name);
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
      if (error.config) console.error('Failed config:', error.config);
      if (error.response) console.error('Error response:', error.response);
      console.groupEnd();
      throw error;
    }
  }

  async _executeRequest(config) {
    console.log('🔗 Building URL...');
    const url = this._buildURL(config);
    console.log('🌐 Request URL:', url);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.warn('⏰ Timeout reached, aborting request');
      controller.abort();
    }, config.timeout);

    console.log('⚙️ Request options:', {
      method: config.method || 'GET',
      headers: config.headers,
      body: config.data ? '(data present)' : 'undefined',
      timeout: config.timeout
    });

    try {
      console.log('📤 Sending request...');
      const startTime = performance.now();
      
      const response = await fetch(url, {
        method: config.method || 'GET',
        headers: config.headers,
        body: config.data ? JSON.stringify(config.data) : undefined,
        signal: controller.signal
      });

      const endTime = performance.now();
      const duration = endTime - startTime;
      console.log(`✅ Response received in ${duration.toFixed(2)}ms`);
      console.log('📊 Response status:', response.status, response.statusText);

      const contentType = response.headers.get('content-type');
      console.log('📄 Content-Type:', contentType);

      let data;
      if (contentType && contentType.includes('application/json')) {
        data = await response.json();
        console.log('📦 Parsed JSON data:', data);
      } else {
        data = await response.text();
        console.log('📝 Text response (first 500 chars):', data.substring(0, 500));
      }

      clearTimeout(timeoutId);

      return {
        data,
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        config,
        duration,
        request: { url }
      };
    } catch (error) {
      clearTimeout(timeoutId);
      console.error('❌ Fetch error:', error);
      
      const siosError = {
        message: error.name === 'AbortError' 
          ? `Request timeout after ${config.timeout}ms` 
          : error.message,
        config,
        isSiosError: true,
        code: error.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR',
        originalError: error
      };
      
      throw siosError;
    }
  }

  _buildURL(config) {
    console.log('🔗 Starting URL build...');
    console.log('📝 Base URL:', config.baseURL || '(none)');
    console.log('📝 Path:', config.url);
    
    let url = config.baseURL ? `${config.baseURL}${config.url}` : config.url;
    
    if (config.params) {
      console.log('🔍 Params to serialize:', config.params);
      const params = new URLSearchParams(config.params).toString();
      url += `${url.includes('?') ? '&' : '?'}${params}`;
      console.log('🔗 URL with params:', url);
    }
    
    console.log('✅ Final URL:', url);
    return url;
  }

  // HTTP Methods with logging
  get(url, config = {}) {
    console.log(`📨 GET request to: ${url}`);
    return this.request({ ...config, method: 'GET', url });
  }

  post(url, data = null, config = {}) {
    console.log(`📨 POST request to: ${url}`, data ? 'with data' : 'without data');
    return this.request({ ...config, method: 'POST', url, data });
  }

  put(url, data = null, config = {}) {
    console.log(`📨 PUT request to: ${url}`);
    return this.request({ ...config, method: 'PUT', url, data });
  }

  patch(url, data = null, config = {}) {
    console.log(`📨 PATCH request to: ${url}`);
    return this.request({ ...config, method: 'PATCH', url, data });
  }

  delete(url, config = {}) {
    console.log(`📨 DELETE request to: ${url}`);
    return this.request({ ...config, method: 'DELETE', url });
  }

  head(url, config = {}) {
    console.log(`📨 HEAD request to: ${url}`);
    return this.request({ ...config, method: 'HEAD', url });
  }

  options(url, config = {}) {
    console.log(`📨 OPTIONS request to: ${url}`);
    return this.request({ ...config, method: 'OPTIONS', url });
  }
}

class InterceptorManager {
  constructor(type) {
    this.type = type;
    this.handlers = [];
    console.log(`🛠️  ${type} interceptor manager created`);
  }

  use(onFulfilled, onRejected = null) {
    console.log(`➕ Adding ${this.type} interceptor`);
    const id = this.handlers.length;
    this.handlers.push({ id, onFulfilled, onRejected });
    return id;
  }

  eject(id) {
    console.log(`➖ Ejecting ${this.type} interceptor #${id}`);
    if (this.handlers[id]) {
      this.handlers[id] = null;
    }
  }

  async execute(value) {
    console.log(`🔄 Executing ${this.type} interceptors (${this.handlers.length} total)`);
    
    let currentValue = value;
    for (let i = 0; i < this.handlers.length; i++) {
      const handler = this.handlers[i];
      if (!handler) continue;
      
      console.log(`   ⟳ Running ${this.type} interceptor #${i}`);
      try {
        if (this.type === 'request') {
          currentValue = await handler.onFulfilled(currentValue);
        } else {
          currentValue = await handler.onFulfilled(currentValue);
        }
        console.log(`   ✓ ${this.type} interceptor #${i} completed`);
      } catch (error) {
        console.error(`   ✗ ${this.type} interceptor #${i} failed:`, error);
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

// Add static create method
sios.create = (config) => {
  console.log('🏭 Creating new Sios instance');
  return new Sios(config);
};

// Add utility methods for development
sios.debug = {
  getConfig: () => sios.defaults,
  getInterceptors: () => sios.interceptors,
  logRequest: (url, config) => {
    console.log('🔍 Debug request:', { url, config });
    return sios.request({ ...config, url, method: 'GET' });
  }
};

console.log('🚀 Sios Dev v1.0.0 loaded');
console.log('📚 Available methods: get, post, put, patch, delete, head, options');
console.log('🔧 Use sios.debug for debugging utilities');

export default sios;
