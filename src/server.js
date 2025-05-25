const express = require('express');
const path = require('path');
const app = express();
const generateAdminRoutes = require('./generator');
const config = require('../config/admin.json');

// Настройки шаблонов
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'templates'));

// Статические файлы (если будут нужны)
app.use(express.static(path.join(__dirname, '..', 'public')));

// Генерация маршрутов
generateAdminRoutes(app);

// Редирект с корня на первую таблицу
const firstTable = Object.keys(config.tables)[0];
app.get('/', (req, res) => {
    res.redirect(`/admin/${firstTable}`);
});

app.listen(3000, () => {
    console.log('✅ Admin panel running on http://localhost:3000');
});
