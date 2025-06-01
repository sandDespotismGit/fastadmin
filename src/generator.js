const mysql = require('mysql2/promise');
const express = require('express');
const pool = require('./db');
const config = require('../config/admin.json');
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const searchFuse = require("./utils/search");
const { serialize } = require('v8');

const uploadDir = '/home/alex/Desktop/ProjectsAtlas/IPANELlanding/admin/static/images';

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = `${crypto.randomUUID()}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
    }
});

const upload = multer({ storage });

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
        console.log("SASASS", req.query)
        const sortField = req.query.sort || 'id';
        const sortOrder = req.query.order === 'desc' ? 'DESC' : 'ASC';

        let [rows] = await pool.execute(
            `SELECT * FROM \`${tableName}\` ORDER BY \`${sortField}\` ${sortOrder}`
        );

        const [tables] = await pool.execute('SHOW TABLES');
        const tableNames = tables.map(t => Object.values(t)[0]);
        // Получение внешних ключей
        const [relations] = await pool.execute(`SELECT * FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND CONSTRAINT_NAME != 'PRIMARY'`, [config.database.database]);
        const displayFields = schema.map(col => { return [col.Field, col.Type] }).filter((elem) => config.tables[tableName].display.includes(elem[0]));
        if (req.query?.searchStr) {
            if (req.query?.searchStr != null || req.query?.searchStr != "") {
                rows = searchFuse(rows, displayFields, req.query.searchStr).map((elem) => elem.item)
            }
        }

        let relatedRows = [];

        let relatedData = {};

        try {
            if (config.tables[tableName].keys.length > 0) {
                const filteredRelations = relations.filter(
                    (elem) =>
                        elem.TABLE_NAME === tableName &&
                        config.tables[tableName].keys.includes(elem.COLUMN_NAME) &&
                        elem.REFERENCED_TABLE_NAME &&
                        elem.REFERENCED_COLUMN_NAME
                );

                const relatedRowsArray = await Promise.all(
                    filteredRelations.map(async (related) => {
                        const [rows] = await pool.execute(
                            `SELECT * FROM \`${related.REFERENCED_TABLE_NAME}\``
                        );
                        return {
                            table: related.REFERENCED_TABLE_NAME,
                            rows
                        };
                    })
                );

                // Собираем в объект: { tableName1: [...], tableName2: [...] }
                relatedRowsArray.forEach(({ table, rows }) => {
                    relatedData[table] = rows;
                });

                console.log('🧩 relatedData:', relatedData);
            }
        } catch (err) {
            console.error('❌ Ошибка при загрузке связанных таблиц:', err.message);
        }

        const getNiceType = t => ({ int: 'Число', bigint: 'Большое число', varchar: 'Текст', text: 'Текст', tinyint: 'Да/Нет', datetime: 'Дата и время', date: 'Дата', float: 'Число с запятой', double: 'Точное число', json: 'JSON', blob: 'Файл', enum: 'Выбор', boolean: 'Да/Нет' })[(t || '').toLowerCase().match(/^[a-z]+/)?.[0]] || t;


        res.render('table', {
            title: `Таблица: ${tableName}`,
            tableName,
            displayFields,
            allTables: Object.keys(config.tables),
            data: rows,
            relations: relations,
            editable: config.tables[tableName].editable,
            config: config,
            fileFields: config.tables[tableName].fileFields,
            getNiceType: getNiceType,
            sortOrder: sortOrder,
            sortField: sortField,
            relatedData: relatedData,
            schema
        });
    });
    // Форма редактирования записи
    app.get('/admin/:table/edit/:id', async (req, res) => {
        const table = req.params.table;
        const id = req.params.id;
        const configTable = config.tables[table];

        // Получаем данные строки по ID
        const [rows] = await pool.execute(`SELECT * FROM \`${table}\` WHERE id = ?`, [id]);
        const rowData = rows[0];

        if (!rowData) {
            return res.status(404).send("Запись не найдена");
        }

        res.render('edit', {
            title: configTable.title || `Редактирование ${table}`,
            tableName: table,
            id,
            data: rowData,
            fields: configTable.display,
            editable: configTable.editable,
            config: config,
            fileFields: configTable.fileFields || []
        });
    });


    // Добавление записи
    app.post('/admin/:table/add', express.urlencoded({ extended: true }), upload.any(), async (req, res) => {
        try {
            const table = req.params.table;
            const configTable = config.tables[table];
            console.log("asdasd")
            const data = {};
            for (const field of configTable.display) {
                if (field === "id") continue;

                const isFile = (configTable.fileFields || []).includes(field);
                if (isFile) {
                    console.log(req)
                    const uploadedFile = req.files.find(f => f.fieldname === field);
                    if (uploadedFile) {
                        data[field] = path.join("static/images", uploadedFile.filename);
                    }
                } else {
                    data[field] = req.body[field];
                }
            }
            const tableName = req.params.table;
            console.log("asdasd")
            console.log(req.params)


            const fields = Object.keys(req.body).concat(req.files.map((file) => file.fieldname));
            const values = Object.values(req.body).concat(req.files.map((file) => file.path.split('/').slice(file.path.split('/').findIndex((elem) => elem == config.database.staticDirName)).join("/")));
            const placeholders = fields.map(() => '?').join(', ');
            const sql = `INSERT INTO \`${tableName}\` (${fields.join(', ')}) VALUES (${placeholders})`;

            await pool.execute(sql, values);
            res.redirect(`/admin/${tableName}`);
        } catch (error) {
            console.log(error)
            if (error.code == 'ER_NO_REFERENCED_ROW_2') {
                const tableName = req.params.table;
                // Получаем все внешние ключи, ссылающиеся на эту таблицу
                const [relations] = await pool.execute(`
                    SELECT TABLE_NAME, COLUMN_NAME, CONSTRAINT_NAME
                    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
                    WHERE REFERENCED_TABLE_NAME = ? AND TABLE_SCHEMA = ?
                  `, [tableName, config.database.database]);

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
                    title: 'Ошибка создания',
                    message: `
                        Невозможно создать запись для таблицы ${tableName}, 
                        так как она связана с другими данными:${relatedInfo}
                        Пожалуйста, сначала удалите связанные записи.
                      `,
                    returnLink: `/admin/${tableName}`
                });

            }
        }
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
                `, [tableName, config.database.database]);

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


    app.post('/admin/:table/edit/:id', express.urlencoded({ extended: true }), upload.any(), async (req, res) => {
        const table = req.params.table;
        const id = req.params.id;
        const configTable = config.tables[table];

        const data = {};
        const fields = [];

        for (const field of configTable.editable) {
            const isFile = (configTable.fileFields || []).includes(field);

            if (isFile) {
                const uploadedFile = req.files.find(f => f.fieldname === field);
                if (uploadedFile) {
                    data[field] = path.join("static/images", uploadedFile.filename);
                    fields.push(field);
                }
                // если файл не загружен — оставляем старое значение (ничего не делаем)
            } else {
                data[field] = req.body[field];
                fields.push(field);
            }
        }

        // Формируем запрос UPDATE
        const setClause = fields.map(f => `\`${f}\` = ?`).join(', ');
        const values = fields.map(f => data[f]);

        const sql = `UPDATE \`${table}\` SET ${setClause} WHERE id = ?`;
        values.push(id);

        await pool.execute(sql, values);
        res.redirect(`/admin/${table}`);
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

