/*!
 * Sios v1.3.0 - Sios JS
 * Production-ready HTTP client inspired by Axios
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
      maxRetries: 0,
      retryDelay: 1000,
      maxRetryDelay: 30000,
      strictInterceptors: false,
      retryOnJsonError: false,
      retryCondition: (error, attempt, config) => {
        const baseCondition = (
          error.code === 'NETWORK' || 
          error.code?.startsWith('HTTP_5')
        ) && attempt < config.maxRetries;
        
        if (config.retryOnJsonError && error.code === 'JSON_PARSE_ERROR') {
          console.log(`[JSON Error Retry] Attempt ${attempt + 1}/${config.maxRetries}`);
          return baseCondition;
        }
        
        return baseCondition && ![501, 505].includes(
          parseInt(error.code.split('_')[1] || 0)
        );
      },
      ...config
    };
    
    this.interceptors = { request: [], response: [] };
    this.activeRequests = new Map();
    this.requestCount = 0;
  }
  
  async request(method, url, data = null, config = {}) {
    const requestId = this._generateRequestId();
    
    const requestState = {
      id: requestId,
      controller: null,
      delayController: null,
      cancelledManually: false,
      timeoutId: null,
      timestamp: Date.now(),
      config: null,
      currentAttempt: 0,
      maxAttempts: 0,
      isTimedOut: false,
      state: 'pending',
      cleanupCallbacks: []
    };
    
    this.activeRequests.set(requestId, requestState);
    
    const promise = (async () => {
      try {
        const baseConfig = this._mergeConfig(method, url, data, config);
        requestState.config = baseConfig;
        requestState.maxAttempts = baseConfig.maxRetries + 1;
        
        const finalUrl = this._buildFinalUrl(baseConfig, requestId);
        const processedConfig = { 
          ...baseConfig, 
          url: finalUrl
        };
        
        let interceptorConfig = processedConfig;
        for (const interceptor of this.interceptors.request) {
          const result = this._executeInterceptor(
            interceptor,
            interceptorConfig,
            'request',
            interceptorConfig.strictInterceptors
          );
          
          if (!result || typeof result !== 'object' || Array.isArray(result)) {
            throw new SiosError(
              'Request interceptor must return config object',
              'INTERCEPTOR_ERROR',
              interceptorConfig
            );
          }
          
          if (!result.method || !result.url) {
            throw new SiosError(
              'Request interceptor must preserve method and url',
              'INTERCEPTOR_ERROR',
              result
            );
          }
          
          interceptorConfig = await result;
        }
        
        requestState.controller = new AbortController();
        interceptorConfig.signal = requestState.controller.signal;
        
        const clonedConfig = {
          ...interceptorConfig,
          headers: { ...interceptorConfig.headers }
        };
        
        const requestInit = this._buildRequestInit(clonedConfig);
        
        const response = await this._executeWithRetryManagement(
          clonedConfig.url,
          requestInit,
          clonedConfig,
          requestState
        );
        
        if (requestState.cancelledManually) {
          throw new SiosError('Request cancelled', 'CANCELLED', clonedConfig);
        }
        
        const processed = await this._safeProcessResponse(
          response, 
          clonedConfig,
          requestState
        );
        
        if (!clonedConfig.validateStatus(processed.status)) {
          const error = new SiosError(
            `Request failed with status ${processed.status}`,
            `HTTP_${processed.status}`,
            clonedConfig,
            processed
          );
          error.requestId = requestId;
          throw error;
        }
        
        let finalResponse = {
          ...processed,
          config: clonedConfig,
          requestId,
          status: response.status
        };
        
        for (const interceptor of this.interceptors.response) {
          const result = this._executeInterceptor(
            interceptor,
            finalResponse,
            'response',
            clonedConfig.strictInterceptors
          );
          
          if (result) {
            const resolvedResult = await result;
            if (resolvedResult && typeof resolvedResult === 'object' && !Array.isArray(resolvedResult)) {
              finalResponse = resolvedResult;
            } else if (clonedConfig.strictInterceptors) {
              throw new SiosError(
                'Response interceptor must return response object',
                'INTERCEPTOR_ERROR',
                clonedConfig
              );
            }
          }
        }
        
        requestState.state = 'finished';
        return finalResponse;
        
      } catch (error) {
        if (requestState.cancelledManually) {
          requestState.state = 'cancelled';
          const cancelledError = new SiosError(
            'Request cancelled manually',
            'CANCELLED',
            requestState.config
          );
          cancelledError.requestId = requestId;
          throw cancelledError;
        }
        
        if (requestState.isTimedOut) {
          const timeoutError = new SiosError(
            `Request timeout after ${requestState.config?.timeout || 10000}ms`,
            'TIMEOUT',
            requestState.config
          );
          timeoutError.requestId = requestId;
          throw timeoutError;
        }
        
        const enhanced = error instanceof SiosError 
          ? error 
          : this._createSiosError(error, requestState.config || config, requestId);
        
        enhanced.requestId = requestId;
        
        let finalError = enhanced;
        for (const interceptor of this.interceptors.response) {
          if (interceptor.onRejected) {
            try {
              const result = await this._executeInterceptor(
                { onFulfilled: interceptor.onRejected },
                finalError,
                'error',
                requestState.config?.strictInterceptors
              );
              
              if (result) {
                const resolvedResult = await result;
                if (resolvedResult && typeof resolvedResult === 'object' && !Array.isArray(resolvedResult)) {
                  finalError = resolvedResult;
                } else if (requestState.config?.strictInterceptors) {
                  throw new SiosError(
                    'Error interceptor must return error object',
                    'INTERCEPTOR_ERROR',
                    requestState.config
                  );
                }
              }
            } catch (interceptorError) {
              if (requestState.config?.strictInterceptors) {
                throw new SiosError(
                  `Error interceptor failed: ${interceptorError.message}`,
                  'INTERCEPTOR_ERROR',
                  requestState.config,
                  null,
                  interceptorError
                );
              }
            }
          }
        }
        
        throw finalError;
      } finally {
        this._cleanupRequest(requestId, requestState);
      }
    })();
    
    promise.requestId = requestId;
    return promise;
  }
  
  _executeInterceptor(interceptor, value, type, strictMode) {
    if (interceptor.onFulfilled) {
      const result = interceptor.onFulfilled(value);
      return Promise.resolve(result);
    } else if (typeof interceptor === 'function') {
      const result = interceptor(value);
      return Promise.resolve(result);
    }
    return Promise.resolve(value);
  }
  
  _generateRequestId() {
    this.requestCount++;
    return `sios_${Date.now()}_${this.requestCount}_${Math.random().toString(36).slice(2, 9)}`;
  }
  
  _buildFinalUrl(config, requestId) {
    let finalUrl = config.url;
    const isAbsolute = this._isAbsoluteUrl(finalUrl);
    
    if (config.baseURL && !isAbsolute) {
      const base = config.baseURL.endsWith('/') ? config.baseURL.slice(0, -1) : config.baseURL;
      const path = finalUrl.startsWith('/') ? finalUrl : `/${finalUrl}`;
      finalUrl = base + path;
    }
    
    if (config.params && Object.keys(config.params).length > 0) {
      const paramsResult = this._applyParamsWithEncoding(finalUrl, config.params, isAbsolute);
      if (paramsResult.success) {
        finalUrl = paramsResult.url;
      } else {
        console.warn(`[${requestId}] Using fallback params encoding`);
        finalUrl = paramsResult.url;
      }
    }
    
    return finalUrl;
  }
  
  _isAbsoluteUrl(url) {
    return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('//');
  }
  
  _applyParamsWithEncoding(url, params, isAbsolute = false) {
    const urlObj = new URL(url, isAbsolute ? undefined : 'http://dummy.com');
    
    Object.entries(params).forEach(([key, value]) => {
      if (value != null) {
        const encodedKey = encodeURIComponent(key);
        const encodedValue = encodeURIComponent(String(value));
        urlObj.searchParams.append(encodedKey, encodedValue);
      }
    });
    
    if (isAbsolute) {
      return { success: true, url: urlObj.toString() };
    } else {
      const pathAndQuery = urlObj.pathname + urlObj.search + urlObj.hash;
      return { success: true, url: pathAndQuery };
    }
  }
  
  _fallbackApplyParams(url, params) {
    const queryParams = [];
    
    Object.entries(params).forEach(([key, value]) => {
      if (value != null) {
        const encodedKey = encodeURIComponent(key);
        const encodedValue = encodeURIComponent(String(value));
        queryParams.push(`${encodedKey}=${encodedValue}`);
      }
    });
    
    if (queryParams.length === 0) return url;
    
    const separator = url.includes('?') ? '&' : '?';
    return url + separator + queryParams.join('&');
  }
  
  async _executeWithRetryManagement(url, init, config, requestState) {
    let lastError = null;
    
    for (requestState.currentAttempt = 0; 
         requestState.currentAttempt < requestState.maxAttempts; 
         requestState.currentAttempt++) {
      
      if (requestState.cancelledManually) {
        requestState.state = 'cancelled';
        throw new SiosError('Request cancelled', 'CANCELLED', config);
      }
      
      if (requestState.currentAttempt > 0) {
        requestState.state = 'retrying';
        
        const baseDelay = config.retryDelay * Math.pow(2, requestState.currentAttempt - 1);
        const delay = Math.min(baseDelay, config.maxRetryDelay);
        
        const cancelled = await this._efficientDelay(delay, requestState);
        if (cancelled) {
          requestState.state = 'cancelled';
          throw new SiosError('Request cancelled during retry delay', 'CANCELLED', config);
        }
        
        this._ensureCleanListeners(requestState);
        requestState.controller = new AbortController();
        init.signal = requestState.controller.signal;
      }
      
      try {
        const clonedInit = {
          ...init,
          headers: { ...init.headers },
          signal: requestState.controller.signal
        };
        
        const result = await this._executeSingleRequest(
          url, 
          clonedInit, 
          config, 
          requestState
        );
        return result;
      } catch (error) {
        lastError = error;
        
        if (error.code === 'CANCELLED' || error.code === 'TIMEOUT') {
          throw error;
        }
        
        const shouldRetry = requestState.currentAttempt < requestState.maxAttempts - 1 &&
          config.retryCondition(error, requestState.currentAttempt, config);
        
        if (!shouldRetry) {
          throw error;
        }
        
        continue;
      }
    }
    
    throw lastError;
  }
  
  _ensureCleanListeners(requestState) {
    if (requestState.controller && requestState.controller.signal) {
      const signal = requestState.controller.signal;
      signal.abort();
    }
    
    requestState.cleanupCallbacks.forEach(cb => cb());
    requestState.cleanupCallbacks = [];
  }
  
  _efficientDelay(ms, requestState) {
    return new Promise(resolve => {
      requestState.delayController = new AbortController();
      const delaySignal = requestState.delayController.signal;
      
      const timeoutId = setTimeout(() => {
        if (!delaySignal.aborted) {
          resolve(false);
        }
      }, ms);
      
      const abortHandler = () => {
        clearTimeout(timeoutId);
        resolve(true);
      };
      
      delaySignal.addEventListener('abort', abortHandler);
      
      if (requestState.controller && requestState.controller.signal) {
        requestState.controller.signal.addEventListener('abort', abortHandler);
      }
      
      requestState.cleanupCallbacks.push(() => {
        clearTimeout(timeoutId);
        delaySignal.removeEventListener('abort', abortHandler);
        
        if (requestState.controller && requestState.controller.signal) {
          requestState.controller.signal.removeEventListener('abort', abortHandler);
        }
        
        if (requestState.delayController && !requestState.delayController.signal.aborted) {
          requestState.delayController.abort();
        }
        requestState.delayController = null;
      });
    });
  }
  
  async _executeSingleRequest(url, init, config, requestState) {
    return new Promise((resolve, reject) => {
      requestState.timeoutId = setTimeout(() => {
        requestState.isTimedOut = true;
        requestState.controller.abort();
        
        const error = new SiosError(
          `Request timeout after ${config.timeout}ms`,
          'TIMEOUT',
          config
        );
        error.requestId = requestState.id;
        reject(error);
      }, config.timeout);
      
      requestState.cleanupCallbacks.push(() => {
        if (requestState.timeoutId) {
          clearTimeout(requestState.timeoutId);
          requestState.timeoutId = null;
        }
      });
      
      const fetchInit = {
        ...init,
        headers: { ...init.headers }
      };
      
      fetch(url, fetchInit)
        .then(response => {
          if (requestState.cancelledManually) {
            reject(new SiosError('Request cancelled', 'CANCELLED', config));
            return;
          }
          
          if (requestState.timeoutId) {
            clearTimeout(requestState.timeoutId);
            requestState.timeoutId = null;
          }
          
          requestState.isTimedOut = false;
          resolve(response);
        })
        .catch(error => {
          if (requestState.timeoutId) {
            clearTimeout(requestState.timeoutId);
            requestState.timeoutId = null;
          }
          
          if (error.name === 'AbortError') {
            if (requestState.isTimedOut) {
              const timeoutError = new SiosError(
                `Request timeout after ${config.timeout}ms`,
                'TIMEOUT',
                config
              );
              timeoutError.requestId = requestState.id;
              reject(timeoutError);
              return;
            }
            
            if (requestState.cancelledManually) {
              reject(new SiosError('Request cancelled', 'CANCELLED', config));
              return;
            }
            
            reject(new SiosError('Request aborted', 'ABORTED', config));
            return;
          }
          
          const isNetworkError = this._isNetworkError(error);
          reject(new SiosError(
            isNetworkError ? 'Network error' : error.message || 'Request failed',
            isNetworkError ? 'NETWORK' : 'UNKNOWN',
            config
          ));
        });
    });
  }
  
  cancel(requestId) {
    const requestState = this.activeRequests.get(requestId);
    if (requestState) {
      requestState.cancelledManually = true;
      requestState.state = 'cancelled';
      
      if (requestState.controller) {
        requestState.controller.abort();
      }
      
      if (requestState.delayController) {
        requestState.delayController.abort();
      }
      
      requestState.cleanupCallbacks.forEach(cb => cb());
      requestState.cleanupCallbacks = [];
      
      return true;
    }
    return false;
  }
  
  cancelAll() {
    const snapshot = Array.from(this.activeRequests.entries());
    snapshot.forEach(([id]) => this.cancel(id));
  }
  
  _cleanupRequest(requestId, requestState) {
    if (requestState) {
      if (requestState.delayController && !requestState.delayController.signal.aborted) {
        requestState.delayController.abort();
      }
      
      requestState.cleanupCallbacks.forEach(cb => cb());
      requestState.cleanupCallbacks = [];
      requestState.controller = null;
      requestState.delayController = null;
      requestState.timeoutId = null;
    }
    
    this.activeRequests.delete(requestId);
  }
  
  async _safeProcessResponse(response, config, requestState) {
    const headers = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    
    const result = {
      data: null,
      status: response.status,
      statusText: response.statusText,
      headers,
      config
    };
    
    let responseToParse = response;
    let cloned = false;
    
    if (response.body && !response.bodyUsed) {
      try {
        responseToParse = response.clone();
        cloned = true;
      } catch {
        cloned = false;
      }
    }
    
    switch (config.responseType) {
      case 'text':
        result.data = await responseToParse.text();
        break;
      case 'blob':
        result.data = await responseToParse.blob();
        break;
      case 'arraybuffer':
        result.data = await responseToParse.arrayBuffer();
        break;
      case 'json':
        try {
          const text = await responseToParse.text();
          if (text) {
            result.data = JSON.parse(text);
          } else {
            result.data = null;
          }
        } catch (parseError) {
          const jsonError = new SiosError(
            'Failed to parse JSON response',
            'JSON_PARSE_ERROR',
            config,
            result,
            parseError
          );
          
          if (config.retryOnJsonError && requestState) {
            console.log(`[JSON Parse Error] ${cloned ? 'Cloned' : 'Original'} response failed`);
            throw jsonError;
          }
          
          result.data = null;
        }
        break;
      default:
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          try {
            const text = await responseToParse.text();
            result.data = text ? JSON.parse(text) : null;
          } catch (parseError) {
            const jsonError = new SiosError(
              'Failed to parse JSON response',
              'JSON_PARSE_ERROR',
              config,
              result,
              parseError
            );
            
            if (config.retryOnJsonError && requestState) {
              console.log(`[JSON Parse Error] ${cloned ? 'Cloned' : 'Original'} response failed`);
              throw jsonError;
            }
            
            result.data = null;
          }
        } else {
          result.data = await responseToParse.text();
        }
    }
    
    return result;
  }
  
  _mergeConfig(method, url, data, config) {
    const { headers: configHeaders, params, ...restConfig } = config;
    const { headers: defaultHeaders, ...defaults } = this.defaults;
    
    const merged = {
      ...defaults,
      ...restConfig,
      method: method.toUpperCase(),
      url,
      data,
      params
    };
    
    merged.headers = { ...defaultHeaders, ...configHeaders };
    return merged;
  }
  
  _buildRequestInit(config) {
    const init = {
      method: config.method,
      headers: { ...config.headers },
      signal: config.signal,
      credentials: config.withCredentials ? 'include' : 'same-origin',
      redirect: 'follow'
    };
    
    if (config.data != null && !['GET', 'HEAD', 'OPTIONS'].includes(config.method)) {
      if (config.data instanceof FormData) {
        init.body = config.data;
        if (!config.headers['Content-Type']) {
          delete init.headers['Content-Type'];
        }
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
  
  _createSiosError(error, config, requestId) {
    let code = error.code || 'UNKNOWN';
    let message = error.message || 'Request failed';
    
    if (!error.code && error.message) {
      if (error.message.includes('timeout')) code = 'TIMEOUT';
      else if (error.message.includes('cancelled')) code = 'CANCELLED';
      else if (error.message.includes('aborted')) code = 'ABORTED';
    }
    
    return new SiosError(
      message,
      code,
      config,
      error.response,
      error
    );
  }
  
  _isNetworkError(error) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return true;
    }
    
    if (error.message && (
      error.message.includes('Failed to fetch') ||
      error.message.includes('NetworkError') ||
      error.message.includes('Network request failed')
    )) {
      return true;
    }
    
    return false;
  }
  
  _formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const dm = Math.max(0, decimals);
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    
    try {
      if (typeof bytes === 'bigint') {
        let index = 0;
        let temp = bytes;
        while (temp >= 1024n && index < sizes.length - 1) {
          temp /= 1024n;
          index++;
        }
        
        const divisor = BigInt(k) ** BigInt(index);
        const whole = bytes / divisor;
        const remainder = bytes % divisor;
        
        const value = Number(whole) + Number(remainder) / Number(divisor);
        return parseFloat(value.toFixed(dm)) + ' ' + sizes[index];
      } else {
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        const index = Math.min(i, sizes.length - 1);
        const value = bytes / Math.pow(k, index);
        return parseFloat(value.toFixed(dm)) + ' ' + sizes[index];
      }
    } catch {
      return bytes.toString() + ' Bytes';
    }
  }
  
  getActiveRequests() {
    return Array.from(this.activeRequests.entries())
      .filter(([_, info]) => info.config)
      .map(([id, info]) => ({
        id,
        url: info.config.url || '',
        method: info.config.method || 'GET',
        timestamp: info.timestamp,
        state: info.state,
        cancelled: info.cancelledManually,
        attempt: info.currentAttempt,
        maxAttempts: info.maxAttempts
      }));
  }
  
  get(url, config = {}) { 
    const promise = this.request('GET', url, null, config);
    promise.requestId = promise.requestId;
    return promise;
  }
  
  post(url, data = null, config = {}) { 
    const promise = this.request('POST', url, data, config);
    promise.requestId = promise.requestId;
    return promise;
  }
  
  put(url, data = null, config = {}) { 
    const promise = this.request('PUT', url, data, config);
    promise.requestId = promise.requestId;
    return promise;
  }
  
  patch(url, data = null, config = {}) { 
    const promise = this.request('PATCH', url, data, config);
    promise.requestId = promise.requestId;
    return promise;
  }
  
  delete(url, config = {}) { 
    const promise = this.request('DELETE', url, null, config);
    promise.requestId = promise.requestId;
    return promise;
  }
  
  head(url, config = {}) { 
    const promise = this.request('HEAD', url, null, config);
    promise.requestId = promise.requestId;
    return promise;
  }
  
  options(url, config = {}) { 
    const promise = this.request('OPTIONS', url, null, config);
    promise.requestId = promise.requestId;
    return promise;
  }
  
  async upload(url, file, config = {}) {
    const formData = new FormData();
    formData.append('file', file);
    
    if (config.data) {
      Object.entries(config.data).forEach(([key, value]) => {
        formData.append(key, value);
      });
    }
    
    const uploadConfig = {
      ...config,
      headers: { ...config.headers }
    };
    
    if (!uploadConfig.headers['Content-Type']) {
      delete uploadConfig.headers['Content-Type'];
    }
    
    const promise = this.request('POST', url, formData, uploadConfig);
    promise.requestId = promise.requestId;
    return promise;
  }
  
  async multiupload(url, files, config = {}) {
    const formData = new FormData();
    
    if (files instanceof FileList) {
      Array.from(files).forEach((file, index) => {
        formData.append(`files[${index}]`, file);
      });
    } else if (Array.isArray(files)) {
      files.forEach((file, index) => {
        formData.append(`files[${index}]`, file);
      });
    } else {
      throw new SiosError('Files must be Array or FileList', 'VALIDATION_ERROR');
    }
    
    if (config.data) {
      Object.entries(config.data).forEach(([key, value]) => {
        formData.append(key, value);
      });
    }
    
    const uploadConfig = {
      ...config,
      headers: { ...config.headers }
    };
    
    if (!uploadConfig.headers['Content-Type']) {
      delete uploadConfig.headers['Content-Type'];
    }
    
    const promise = this.request('POST', url, formData, uploadConfig);
    promise.requestId = promise.requestId;
    return promise;
  }
  
  intercept(type, onFulfilled, onRejected) {
    if (!['request', 'response'].includes(type)) {
      throw new SiosError('Invalid interceptor type', 'VALIDATION_ERROR');
    }
    
    const handler = onRejected ? { onFulfilled, onRejected } : onFulfilled;
    this.interceptors[type].push(handler);
    
    return () => {
      const index = this.interceptors[type].indexOf(handler);
      if (index > -1) this.interceptors[type].splice(index, 1);
    };
  }
  
  create(config = {}) {
    return new Sios({ ...this.defaults, ...config });
  }
}

class SiosError extends Error {
  constructor(message, code, config, response, originalError) {
    super(message);
    this.name = 'SiosError';
    this.code = code;
    this.config = config;
    this.response = response;
    this.originalError = originalError;
    this.isSiosError = true;
    this.timestamp = Date.now();
    
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, SiosError);
    }
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

if (typeof window !== 'undefined') {
  window.Sios = Sios;
  window.sios = sios;
  window.SiosError = SiosError;
}

export default sios;
export { Sios, SiosError };
