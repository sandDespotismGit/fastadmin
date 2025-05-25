const mysql = require('mysql2/promise');
const express = require('express');
const pool = require('./db')

const dbConfig = {
    host: 'localhost',
    user: "wordpress",
    password: "wordpress",
    database: "access_bot"
};

module.exports = async function generateAdminRoutes(app) {


    // Главная страница — список таблиц
    app.get('/admin', async (req, res) => {
        const [tables] = await pool.execute('SHOW TABLES');
        const tableNames = tables.map(t => Object.values(t)[0]);
        res.render('tables', { tableNames });
    });

    // Страница с данными конкретной таблицы
    app.get('/admin/:table', async (req, res) => {
        const tableName = req.params.table;
        const [schema] = await pool.execute(`DESCRIBE \`${tableName}\``);
        const [rows] = await pool.execute(`SELECT * FROM \`${tableName}\``);
        // Получение внешних ключей
        const [relations] = await pool.execute(`SELECT * FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND CONSTRAINT_NAME != 'PRIMARY'`, [dbConfig.database]);

        const displayFields = schema.map(col => col.Field);
        console.log(rows, displayFields, schema, relations)

        res.render('table', {
            title: `Таблица: ${tableName}`,
            tableName,
            displayFields,
            data: rows,
            schema
        });
    });

    // Добавление записи
    app.post('/admin/:table/add', express.urlencoded({ extended: true }), async (req, res) => {
        const tableName = req.params.table;
        const fields = Object.keys(req.body);
        const values = Object.values(req.body);

        const placeholders = fields.map(() => '?').join(', ');
        const sql = `INSERT INTO \`${tableName}\` (${fields.join(', ')}) VALUES (${placeholders})`;

        await pool.execute(sql, values);
        res.redirect(`/admin/${tableName}`);
    });

    // Удаление записи по id
    app.post('/admin/:table/delete/:id', async (req, res) => {
        const tableName = req.params.table;
        const id = req.params.id;

        await pool.execute(`DELETE FROM \`${tableName}\` WHERE id = ?`, [id]);
        res.redirect(`/admin/${tableName}`);
    });
};

