# Sios Js

HTTP client sing **minimal banget**, terinspirasi soko Axios. Gampang dipake, cepet, lan ora nduwe dependencies.

## 📦 Carane Masang
### 🎯 CDN - Gampang Dipake

**Pilih salah siji:** 

```html
<!-- Versi stabil (latest) -->
<script src="https://cdn.jsdelivr.net/gh/alicom13/sios@main/src/sios.js"></script>
```
```html
<!-- Versi spesifik (v1.3.0) -->
<script src="https://cdn.jsdelivr.net/gh/alicom13/sios@v1.3.0/src/sios.js"></script>
```

**Contoh kode:**
```html
import sios from 'sios';

// Contoh 1: Njupuk data
const data = await sios.get('https://api.contoh.com/data');

// Contoh 2: Upload file
const fileInput = document.getElementById('file');
const file = fileInput.files[0];
await sios.upload('/api/upload', file);

// Contoh 3: Karo error handling
try {
  const response = await sios.get('/api/data');
  console.log('Sukses!', response.data);
} catch (error) {
  console.error('Waduh error:', error.message);
}
```

## Fitur-fitur
**1. HTTP Methods Lengkap**
```bash
sios.get()      // Njupuk
sios.post()     // Ngirim
sios.put()      // Ngganti
sios.patch()    // Nambahi
sios.delete()   // Mbusak
sios.head()     // Head
sios.options()  // Options
```
**2. Upload File**
```js
// Siji file
await sios.upload('/api/upload', file, {
  data: { keterangan: 'Fileku' }
});

// Akeh file
await sios.multiupload('/api/uploads', [file1, file2, file3]);
```

**3. Bisa Dibatalke**
```javascript
const promise = sios.get('/api/data');

// Batalke request
sios.cancel(promise.requestId);

// Batalke kabeh
sios.cancelAll();
```

**4. Auto Coba Maneh**
```javascript
const hasil = await sios.get('/api/ora-stabil', {
  maxRetries: 3,           // Coba 3x
  retryDelay: 1000,        // Tunggu 1 detik
  retryCondition: (error) => {
    return error.code === 'NETWORK';  // Coba maneh nek error network
  }
});
```

**5. Interceptor**
```javascript
// Tambah token nek arep request
sios.intercept('request', (config) => {
  config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Tangani error
sios.intercept('response', (response) => {
  console.log('Wes teko response:', response.status);
  return response;
}, (error) => {
  console.error('Waduh error:', error.message);
  throw error;
});
```

**🐛 Nangani Error**
```javascript
try {
  const response = await sios.get('/api/ora-ono');
} catch (error) {
  if (error.isSiosError) {
    console.log('Kode error:', error.code);  // 'HTTP_404', 'NETWORK', 'TIMEOUT'
    console.log('Pesan:', error.message);
    
    if (error.code === 'HTTP_401') {
      // Wong durung login, arahno menyang login
      window.location.href = '/login';
    }
  }
}
```

**⚙️ Konfigurasi**
```javascript
const config = {
  baseURL: 'https://api.contoh.com',
  timeout: 10000,           // 10 detik
  headers: { 'Content-Type': 'application/json' },
  maxRetries: 3,            // Coba 3x nek gagal
  retryDelay: 1000,         // Tunggu 1 detik
  retryOnJsonError: false,  // Coba maneh nek JSON rusak
  withCredentials: false,
  responseType: 'json',     // 'json', 'text', 'blob'
  validateStatus: (status) => status >= 200 && status < 300
};
```

**🧪 Testing**
```javascript
// Test race condition
await sios.testRaceCondition?.();

// Test JSON error
await sios.testJsonRetry?.();
```
## Kabeh Methods:
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
