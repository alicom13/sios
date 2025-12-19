# Sios

Ultra-minimal HTTP client inspired by Axios. Built for modern JavaScript with zero dependencies.

## Features

- 🚀 **Zero dependencies** - Just native fetch API
- 🔄 **Automatic retries** - With exponential backoff
- ⏱️ **Timeout & cancellation** - Full AbortController support
- 🛡️ **Memory safe** - No leaks, guaranteed cleanup
- 🎯 **Axios-compatible API** - Easy migration
- 📦 **Tree-shakeable** - ES Modules + CommonJS support
- 🧪 **Built-in testing utilities** - For race condition testing

## Installation

```bash
npm install sios
```
## HTTP Methods
```javascript
sios.get(url, config)
sios.post(url, data, config)
sios.put(url, data, config)
sios.patch(url, data, config)
sios.delete(url, config)
sios.head(url, config)
sios.options(url, config)
sios.upload(url, file, config)
sios.multiupload(url, files, config)
sios.intercept(type, handler)
sios.cancel(requestId)
sios.cancelAll()
sios.create(config)
```
