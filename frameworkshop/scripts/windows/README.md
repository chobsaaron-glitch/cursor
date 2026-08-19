# Windows-установщик FrameWorkshop

## Что получает пользователь

`FrameWorkshop-Setup.exe` копирует программу в `%LOCALAPPDATA%\FrameWorkshop`,
при необходимости ставит Node.js и PostgreSQL через winget, создаёт базу,
загружает демо-данные и ярлык на рабочий стол.

Запуск после установки: ярлык **FrameWorkshop** → http://localhost:3000  
Вход: `admin@ramaisvet.ru` / `demo12345`

## Сборка Setup.exe

Нужен [NSIS](https://nsis.sourceforge.io/).

Linux:

```bash
sudo apt-get install -y nsis rsync
cd frameworkshop
npm run installer:windows
```

Windows (после установки NSIS):

```bat
cd frameworkshop
bash scripts\windows\build-installer.sh
```

или вручную: скопируйте исходники в `dist\windows\payload` без `node_modules`
и выполните `makensis scripts\windows\FrameWorkshop.nsi`.

Готовый файл: `dist/FrameWorkshop-Setup.exe`.

## Без NSIS

На целевом ПК в папке `frameworkshop` запустите `Установить.bat`.
