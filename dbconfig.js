const mysql = require('mysql2');

// Create a connection pool
const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'Chotu@0208',
    database: 'flight_management_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Get promise-based connection wrapper
const promisePool = pool.promise();

// Test the connection and create database if it doesn't exist
pool.getConnection((err, connection) => {
    if (err) {
        console.error('❌ MySQL Connection Error:', err);
        process.exit(1);
    }

    // Create database if it doesn't exist
    connection.query('CREATE DATABASE IF NOT EXISTS flight_management_db;', (err) => {
        if (err) {
            console.error('❌ Error creating database:', err);
            process.exit(1);
        }

        // Use the database
        connection.query('USE flight_management_db;', (err) => {
            if (err) {
                console.error('❌ Error using database:', err);
                process.exit(1);
            }

            console.log('✅ MySQL Connected Successfully...');
            connection.release();
        });
    });
});

// Create a wrapper that handles both promise and callback styles
const db = {
    pool,      // Regular connection pool for callback style
    promise: promisePool,  // Promise-based pool
    execute: (...args) => promisePool.execute(...args),  // For parameterized queries
    query: (...args) => {
        if (typeof args[args.length - 1] === 'function') {
            // Callback style
            return pool.query(...args);
        }
        // Promise style
        return promisePool.query(...args);
    }
};

module.exports = db;
