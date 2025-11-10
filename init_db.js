const db = require('./dbconfig').promise;

async function initializeDatabase() {
  try {
    // Create users table if it doesn't exist
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id VARCHAR(10) UNIQUE NOT NULL,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(100) NOT NULL,
        role ENUM('user', 'admin') DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Users table ready');

    // Create flights table if it doesn't exist
    await db.query(`
      CREATE TABLE IF NOT EXISTS flights (
        id INT AUTO_INCREMENT PRIMARY KEY,
        flight_id VARCHAR(20) UNIQUE NOT NULL,
        flight_name VARCHAR(100) NOT NULL,
        source VARCHAR(100) NOT NULL,
        destination VARCHAR(100) NOT NULL,
        price DECIMAL(10, 2) NOT NULL,
        date DATE NOT NULL,
        duration VARCHAR(50),
        aircraft_id VARCHAR(20),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Flights table ready');

    // Create bookings table if it doesn't exist
    await db.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id VARCHAR(10) NOT NULL,
        ticket_id VARCHAR(50) UNIQUE NOT NULL,
        flight_id VARCHAR(20) NOT NULL,
        flight_name VARCHAR(100) NOT NULL,
        source VARCHAR(100) NOT NULL,
        destination VARCHAR(100) NOT NULL,
        date DATE NOT NULL,
        duration VARCHAR(50),
        class_type VARCHAR(20) DEFAULT 'Economy',
        price DECIMAL(10, 2) NOT NULL,
        username VARCHAR(50),
        status VARCHAR(20) DEFAULT 'Confirmed',
        cancelled BOOLEAN DEFAULT FALSE,
        reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(user_id),
        FOREIGN KEY (flight_id) REFERENCES flights(flight_id)
      )
    `);
    console.log('✅ Bookings table ready');

    // Create user_profiles table if it doesn't exist
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_profiles (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id VARCHAR(10) UNIQUE NOT NULL,
        full_name VARCHAR(100),
        age INT,
        contact_no VARCHAR(20),
        address TEXT,
        city VARCHAR(50),
        nationality VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(user_id)
      )
    `);
    console.log('✅ User profiles table ready');

    // Create support table if it doesn't exist
    await db.query(`
      CREATE TABLE IF NOT EXISTS support (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(50) NOT NULL,
        email VARCHAR(100) NOT NULL,
        message TEXT NOT NULL,
        status ENUM('pending', 'resolved', 'in-progress') DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Support table ready');

    console.log('✅ Database initialization completed successfully');
    process.exit(0);
  } catch (err) {
    console.error('❌ Database initialization error:', err);
    process.exit(1);
  }
}

initializeDatabase();