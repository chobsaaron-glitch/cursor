# А-рама

В репозитории два продукта для багетной мастерской.

## FrameWorkshop ERP

Полный контур: клиенты, заказы, конструктор оформления, склад, закупки,
производство, оплаты и отчёты. Каталог [`frameworkshop`](./frameworkshop),
документация — [`frameworkshop/README.md`](./frameworkshop/README.md).

```bash
cd frameworkshop
npm install
npx prisma migrate deploy
npm run seed
npm run dev
```

## Инвентаризация багета (PWA)

Приложение для инвентаризации багетных реек мастерской **«А-рама»**.

Исходный код: каталог [`arama-inventory`](./arama-inventory).

```bash
cd arama-inventory
npm install
npm run dev
```

**APK для Android:** [arama-inventory/releases/Arama-sklad-debug.apk](./arama-inventory/releases/Arama-sklad-debug.apk)

Подробности — в [arama-inventory/README.md](./arama-inventory/README.md).
