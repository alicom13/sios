/*!
 * Sios v1.0.0 - Lightweight HTTP Client
 * A minimal, modern HTTP client for browser applications
 * @copyright  2025 Sios JS Team
 * @author     Ali Musthofa
 * @link       https://github.com/alicom13/sios
 * @license    MIT
 */

class Sios {
  constructor(config = {}) {
    this.defaults = {
      baseURL: '',
      timeout: 5000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      transformRequest: [
        (data, headers) => {
          if (data && typeof data === 'object' && 
              !(data instanceof FormData) && 
              !(data instanceof URLSearchParams) &&
              headers['Content-Type']?.includes('application/json')) {
            return JSON.stringify(data);
          }
          return data;
        }
      ],
      transformResponse: [
        (data, headers) => {
          if (headers['content-type']?.includes('application/json') && 
              typeof data === 'string') {
            try {
              return JSON.parse(data);
            } catch {
              return data;
            }
          }
          return data;
        }
      ],
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
      },
      transformRequest: [
        ...(this.defaults.transformRequest || []),
        ...(config.transformRequest || [])
      ],
      transformResponse: [
        ...(this.defaults.transformResponse || []),
        ...(config.transformResponse || [])
      ]
    };

    const requestConfig = await this.interceptors.request.execute(finalConfig);
    const transformedRequest = await this._transformRequest(requestConfig);
    
    let response;
    if (transformedRequest.onUploadProgress || transformedRequest.onDownloadProgress) {
      response = await this._requestWithProgress(transformedRequest);
    } else {
      response = await this._executeRequest(transformedRequest);
    }
    
    const transformedResponse = await this._transformResponse(response);
    const finalResponse = await this.interceptors.response.execute(transformedResponse);
    
    return finalResponse;
  }

  async _executeRequest(config) {
    const url = this._buildURL(config);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeout);

    try {
      const options = {
        method: config.method || 'GET',
        headers: config.headers,
        signal: controller.signal
      };

      if (config.data) {
        options.body = this._prepareBody(config.data, config.headers);
      }

      const response = await fetch(url, options);
      clearTimeout(timeoutId);

      return await this._processResponse(response, config);
    } catch (error) {
      clearTimeout(timeoutId);
      throw this._createError(error, config);
    }
  }

  async _requestWithProgress(config) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const url = this._buildURL(config);
      
      xhr.open(config.method || 'GET', url);
      
      const headers = { ...config.headers };
      if (config.data instanceof FormData) {
        delete headers['Content-Type'];
      }
      
      Object.keys(headers).forEach(key => {
        if (headers[key]) {
          xhr.setRequestHeader(key, headers[key]);
        }
      });
      
      if (config.onUploadProgress) {
        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            config.onUploadProgress({
              loaded: event.loaded,
              total: event.total,
              percent: Math.round((event.loaded / event.total) * 100),
              lengthComputable: true,
              event
            });
          }
        });
      }
      
      if (config.onDownloadProgress) {
        xhr.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            config.onDownloadProgress({
              loaded: event.loaded,
              total: event.total,
              percent: Math.round((event.loaded / event.total) * 100),
              lengthComputable: true,
              event
            });
          }
        });
      }
      
      xhr.onload = async () => {
        try {
          const response = await this._processXHRResponse(xhr, config);
          const finalResponse = await this.interceptors.response.execute(response);
          resolve(finalResponse);
        } catch (error) {
          reject(error);
        }
      };
      
      xhr.onerror = () => {
        reject(this._createError(new Error('Network Error'), config));
      };
      
      xhr.ontimeout = () => {
        reject(this._createError(new Error(`Timeout after ${config.timeout}ms`), config));
      };
      
      xhr.timeout = config.timeout;
      
      this.interceptors.request.execute(config)
        .then(interceptedConfig => {
          xhr.send(this._prepareBody(interceptedConfig.data, interceptedConfig.headers));
        })
        .catch(reject);
    });
  }

  _prepareBody(data, headers) {
    if (!data) return undefined;
    
    if (data instanceof FormData) {
      return data;
    } else if (headers['Content-Type']?.includes('application/json')) {
      return JSON.stringify(data);
    } else if (data instanceof URLSearchParams) {
      return data.toString();
    } else {
      return data;
    }
  }

  async _transformRequest(config) {
    let data = config.data;
    const headers = config.headers;
    
    if (config.transformRequest && data !== undefined) {
      for (const transform of config.transformRequest) {
        data = await transform(data, headers);
      }
    }
    
    return { ...config, data };
  }

  async _transformResponse(response) {
    let data = response.data;
    const headers = response.headers;
    
    if (response.config.transformResponse) {
      for (const transform of response.config.transformResponse) {
        data = await transform(data, headers);
      }
    }
    
    return { ...response, data };
  }

  async _processResponse(response, config) {
    const contentType = response.headers.get('content-type');
    let data;
    
    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else if (contentType && contentType.includes('multipart/form-data')) {
      data = await response.formData();
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
  }

  async _processXHRResponse(xhr, config) {
    let data;
    const contentType = xhr.getResponseHeader('content-type');
    
    try {
      if (contentType && contentType.includes('application/json')) {
        data = JSON.parse(xhr.responseText);
      } else {
        data = xhr.responseText;
      }
    } catch {
      data = xhr.responseText;
    }

    return {
      data,
      status: xhr.status,
      statusText: xhr.statusText,
      headers: this._parseXHRHeaders(xhr),
      config
    };
  }

  _parseXHRHeaders(xhr) {
    const headers = {};
    const headerStr = xhr.getAllResponseHeaders();
    if (!headerStr) return headers;
    
    const headerPairs = headerStr.trim().split(/[\r\n]+/);
    
    headerPairs.forEach(line => {
      const parts = line.split(': ');
      const header = parts.shift();
      const value = parts.join(': ');
      if (header) headers[header.toLowerCase()] = value;
    });
    
    return headers;
  }

  _createError(error, config) {
    return {
      message: error.name === 'AbortError' 
        ? `Request timeout after ${config.timeout}ms` 
        : error.message,
      config,
      isSiosError: true,
      code: error.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR',
      response: error.response
    };
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

  upload(url, file, fieldName = 'file', additionalData = {}, config = {}) {
    const formData = new FormData();
    
    if (file instanceof File) {
      formData.append(fieldName, file);
    } else if (Array.isArray(file)) {
      file.forEach((f, index) => {
        formData.append(`${fieldName}[${index}]`, f);
      });
    }
    
    Object.keys(additionalData).forEach(key => {
      formData.append(key, additionalData[key]);
    });

    return this.post(url, formData, {
      ...config,
      headers: { ...config.headers }
    });
  }

  setBaseURL(baseURL) {
    this.defaults.baseURL = baseURL;
    return this;
  }

  setHeader(name, value) {
    this.defaults.headers[name] = value;
    return this;
  }

  setAuth(token) {
    this.defaults.headers['Authorization'] = `Bearer ${token}`;
    return this;
  }

  setBasicAuth(username, password) {
    const credentials = btoa(`${username}:${password}`);
    this.defaults.headers['Authorization'] = `Basic ${credentials}`;
    return this;
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

const sios = new Sios();
sios.create = (config) => new Sios(config);

if (typeof window !== 'undefined') {
  if (!window.Sios && !window.sios) {
    window.Sios = Sios;
    window.sios = sios;
  }
}

export default sios;
