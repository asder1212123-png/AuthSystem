# Authentication System

Облачная система аутентификации с админ-панелью для управления пользователями.

## Функции

✅ Администраторская панель (в браузере)
✅ Создание аккаунтов
✅ Бан/разбан пользователей
✅ Удаление аккаунтов
✅ История действий админов
✅ API для клиента (login/register)
✅ JWT токены для безопасности

## Установка локально (для тестирования)

```bash
cd AuthSystem
npm install
npm start
```

Откройте http://localhost:5000 в браузере

**Пароль администратора по умолчанию:** `admin123`
(измените в `.env` файле!)

## API для вашего Java клиента

### Регистрация

```
POST http://localhost:5000/api/auth/register
Content-Type: application/json

{
  "username": "player1",
  "password": "password123",
  "email": "player1@example.com"
}

Response:
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "username": "player1"
}
```

### Вход

```
POST http://localhost:5000/api/auth/login
Content-Type: application/json

{
  "username": "player1",
  "password": "password123"
}

Response:
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "username": "player1"
}
```

### Проверка токена

```
GET http://localhost:5000/api/auth/verify
Authorization: Bearer YOUR_TOKEN

Response:
{
  "valid": true,
  "username": "player1"
}
```

## Развёртывание в облаке

### Вариант 1: Railway (рекомендуется)

1. Зарегистрируйтесь на https://railway.app
2. Создайте новый проект
3. Подключите репозиторий GitHub
4. Railway автоматически установит зависимости и запустит сервер

### Вариант 2: Render

1. Зарегистрируйтесь на https://render.com
2. Создайте Web Service
3. Подключите GitHub репозиторий
4. Build command: `npm install`
5. Start command: `npm start`

> Важно: по умолчанию файловая система контейнера у большинства хостов временная (ephemeral). Чтобы аккаунты сохранялись между перезапусками, необходимо использовать persistent disk (монтируемый диск) или managed базу данных.

#### Пример с Persistent Disk на Render
1. В панели Render откройте ваш сервис → **Disks** → **Add Persistent Disk**.
2. Выберите размер и укажите точку монтирования, например `/data`.
3. В Settings → Environment → добавьте переменную окружения:
   - `DB_PATH = /data/auth.db`
4. Перезапустите сервис — `auth.db` будет сохраняться на постоянном диске.

### Вариант 3: Vercel

1. Зарегистрируйтесь на https://vercel.com
2. Импортируйте проект
3. Настройте переменные окружения в Settings

### Docker / Docker Compose

Если вы запускаете контейнеры Docker, можно примонтировать папку хоста как volume, чтобы хранить `auth.db` вне контейнера:

- Docker run пример:

```bash
# Примонтировать папку C:\data на Windows в /data контейнера
docker run -v C:\data:/data -e DB_PATH=/data/auth.db your-image
```

- docker-compose пример:

```yaml
services:
  authsystem:
    image: your-image
    volumes:
      - ./data:/data
    environment:
      - DB_PATH=/data/auth.db
    ports:
      - "5000:5000"
```

Этот подход гарантирует, что `auth.db` останется между перезапусками контейнера.

### Быстрый старт с Docker

1. Собрать образ и запустить через docker-compose:

```bash
docker-compose up --build -d
```

2. Проверить логи и наличие файла БД в папке `./data`:

```bash
docker-compose logs -f authsystem
ls -la ./data
```

3. Перезапустить контейнер (данные сохранятся):

```bash
docker-compose down
docker-compose up -d
```

## Конфигурация

В файле `.env` можно изменить:

```
PORT=5000                              # Порт сервера
JWT_SECRET=your-secret-key             # Секретный ключ (измените!)
ADMIN_PASSWORD=admin123                # Пароль администратора
```

⚠️ **Важно:** В production измените `JWT_SECRET` и `ADMIN_PASSWORD` на сложные значения!

## Структура файлов

```
AuthSystem/
├── server.js              # Backend API
├── package.json           # Зависимости
├── .env                   # Переменные окружения
├── auth.db               # База данных (создаётся автоматически)
└── public/
    └── index.html        # Админ-панель
```

## Для Java клиента

Используйте endpoints:
- `POST /api/auth/register` - регистрация
- `POST /api/auth/login` - вход
- `GET /api/auth/verify` - проверка токена

Сохраняйте токен и передавайте его в заголовке: `Authorization: Bearer TOKEN`

## Безопасность

- Пароли хешируются (bcrypt)
- JWT токены для аутентификации
- CORS настроен для кроссдоменных запросов
- Admin операции защищены токеном

Готово к развёртыванию! 🚀
