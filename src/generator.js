const mysql = require('mysql2/promise');
const express = require('express');
const pool = require('./db');
const config = require('../config/admin.json');

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
        const [tables] = await pool.execute('SHOW TABLES');
        const tableNames = tables.map(t => Object.values(t)[0]);
        // Получение внешних ключей
        const [relations] = await pool.execute(`SELECT * FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND CONSTRAINT_NAME != 'PRIMARY'`, [dbConfig.database]);

        const displayFields = schema.map(col => { return [col.Field, col.Type] }).filter((elem) => config.tables[tableName].display.includes(elem[0]));

        console.log(relations)

        res.render('table', {
            title: `Таблица: ${tableName}`,
            tableName,
            displayFields,
            allTables: Object.keys(config.tables),
            data: rows,
            relations: relations,
            editable: config.tables[tableName].editable,
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

        try {
            await pool.execute(`DELETE FROM \`${tableName}\` WHERE id = ?`, [id]);
            res.redirect(`/admin/${tableName}`);
        } catch (error) {
            if (error.code === 'ER_ROW_IS_REFERENCED_2' || error.errno === 1451) {
                // Получаем все внешние ключи, ссылающиеся на эту таблицу
                const [relations] = await pool.execute(`
                  SELECT TABLE_NAME, COLUMN_NAME, CONSTRAINT_NAME
                  FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
                  WHERE REFERENCED_TABLE_NAME = ? AND TABLE_SCHEMA = ?
                `, [tableName, dbConfig.database]);

                let relatedTables = [];

                for (const relation of relations) {
                    // Проверим, есть ли реально связанные строки в других таблицах
                    const [rows] = await pool.execute(`
                      SELECT * FROM \`${relation.TABLE_NAME}\` WHERE \`${relation.COLUMN_NAME}\` = ?
                    `, [id]);

                    if (rows.length > 0) {
                        relatedTables.push({
                            table: relation.TABLE_NAME,
                            column: relation.COLUMN_NAME,
                            count: rows.length
                        });
                    }
                }

                let relatedInfo = relatedTables.map(rt =>
                    `• В таблице ${rt.table} найдено ${rt.count} записей, ссылающихся на это значение через поле ${rt.column}`
                ).join('<br>');

                if (!relatedInfo) {
                    relatedInfo = '⚠️ Обнаружены связи, но записи не найдены. Возможно, причина в другой таблице.';
                }

                res.render('error', {
                    title: 'Ошибка удаления',
                    message: `
                      Невозможно удалить запись с id = ${id} из таблицы ${tableName}, 
                      так как она связана с другими данными:${relatedInfo}
                      Пожалуйста, сначала удалите связанные записи.
                    `,
                    returnLink: `/admin/${tableName}`
                });
            } else {
                console.error(error);
                res.status(500).send('Внутренняя ошибка сервера');
            }
        }
    });


    app.get('/admin/:table/edit/:id', async (req, res) => {
        const tableName = req.params.table;
        const id = req.params.id;

        const [schema] = await pool.execute(`DESCRIBE \`${tableName}\``);
        const [rows] = await pool.execute(`SELECT * FROM \`${tableName}\` WHERE id = ?`, [id]);

        if (rows.length === 0) {
            return res.status(404).send('Запись не найдена');
        }

        const row = rows[0];
        const displayFields = schema.map(col => col.Field).filter(field => config.tables[tableName].display.includes(field));

        res.render('edit', {
            title: `Редактировать запись в ${tableName}`,
            tableName,
            id,
            data: row,
            fields: displayFields,
            editable: config.tables[tableName].editable
        });
    });
    app.post('/admin/:table/edit/:id', express.urlencoded({ extended: true }), async (req, res) => {
        const tableName = req.params.table;
        const id = req.params.id;

        const fields = Object.keys(req.body);
        const values = Object.values(req.body);
        const updates = fields.map(f => `\`${f}\` = ?`).join(', ');

        const sql = `UPDATE \`${tableName}\` SET ${updates} WHERE id = ?`;
        await pool.execute(sql, [...values, id]);

        res.redirect(`/admin/${tableName}`);
    });


};

