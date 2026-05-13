# Dijital Kütüphane Enterprise Sürüm

1000+ kütüphane ve her kütüphane için 1000+ etkinlik düşünülerek hazırlanmış PostgreSQL destekli sürümdür.

## Yerelde çalıştırma

```bash
npm install
node server.js
```

Adres:

```text
http://localhost:3000
```

## Demo girişler

```text
admin@ktb.gov.tr / 123456
yesilyurt@ktb.gov.tr / 123456
serik@ktb.gov.tr / 123456
```

## Render

Servis tipi: Web Service

```text
Build Command: npm install
Start Command: npm start
```

Environment Variables:

```text
DATABASE_URL=Render PostgreSQL Internal Database URL
SESSION_SECRET=uzun-guvenli-bir-anahtar
NODE_ENV=production
```

Not: DATABASE_URL boşsa sistem yerelde demo memory modunda çalışır. Gerçek kullanımda PostgreSQL zorunludur.
