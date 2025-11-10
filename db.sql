-- ================================================
-- 🛫 FLIGHT MANAGEMENT SYSTEM vFinal (Fixed)
-- ================================================
 -- DROP DATABASE IF EXISTS flight_management_db;
CREATE DATABASE flight_management_db;
USE flight_management_db;

-- ================================================
-- USERS
-- ================================================
DROP TABLE users;
-- USERS TABLE
CREATE TABLE IF NOT EXISTS users (
  user_id VARCHAR(10) PRIMARY KEY,
  username VARCHAR(100) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  role ENUM('user','admin') DEFAULT 'user',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS support (
    support_id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100),
    email VARCHAR(150),
    message TEXT,
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);



-- Default admin
INSERT INTO users (user_id, username, email, password, role)
SELECT * FROM (SELECT 'U001','admin','admin@gmail.com','$2b$10$adminhashed','admin') AS tmp
WHERE NOT EXISTS (
    SELECT username FROM users WHERE username = 'admin'
) LIMIT 1;

-- Sample user for testing bookings
INSERT INTO users (user_id, username, email, password, role)
SELECT * FROM (SELECT 'U002','guest','guest@gmail.com','$2b$10$guesthashed','user') AS tmp
WHERE NOT EXISTS (
    SELECT username FROM users WHERE username = 'guest'
) LIMIT 1;

-- ================================================
-- USER PROFILES
-- ================================================
CREATE TABLE user_profiles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(10) NOT NULL UNIQUE,
  full_name VARCHAR(100),
  age INT,
  contact_no VARCHAR(15),
  address VARCHAR(255),
  city VARCHAR(100),
  nationality VARCHAR(100),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- ================================================
-- ADMINS (optional)
-- ================================================
CREATE TABLE admins (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ================================================
-- AIRCRAFT
-- ================================================
CREATE TABLE aircraft (
  aircraft_id VARCHAR(10) PRIMARY KEY,
  model VARCHAR(50) NOT NULL,
  manufacturer VARCHAR(50),
  total_capacity INT CHECK (total_capacity > 0),
  available_capacity INT CHECK (available_capacity >= 0)
);

-- ================================================
-- FLIGHTS
-- ================================================
CREATE TABLE flight (
  flight_id VARCHAR(10) PRIMARY KEY,
  flight_name VARCHAR(50) NOT NULL,
  source VARCHAR(50) NOT NULL,
  destination VARCHAR(50) NOT NULL,
  travel_time TIME,
  aircraft_id VARCHAR(10),
  FOREIGN KEY (aircraft_id) REFERENCES aircraft(aircraft_id)
);

-- ================================================
-- SCHEDULE
-- ================================================
CREATE TABLE schedule (
  schedule_id VARCHAR(10) PRIMARY KEY,
  flight_id VARCHAR(10),
  day_of_week ENUM('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'),
  departure_time TIME,
  arrival_time TIME,
  duration TIME,
  FOREIGN KEY (flight_id) REFERENCES flight(flight_id)
);

-- ================================================
-- PASSENGERS
-- ================================================
CREATE TABLE passenger (
  passenger_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(10),
  passenger_name VARCHAR(60) NOT NULL,
  gender CHAR(1) CHECK (gender IN ('M','F')),
  age INT CHECK (age > 0),
  contact_no VARCHAR(15),
  address VARCHAR(100),
  passport_no VARCHAR(20) UNIQUE,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- ================================================
-- SEATS
-- ================================================
CREATE TABLE seat (
  seat_id INT AUTO_INCREMENT PRIMARY KEY,
  aircraft_id VARCHAR(10),
  seat_no VARCHAR(10),
  position VARCHAR(10),
  category VARCHAR(20),
  FOREIGN KEY (aircraft_id) REFERENCES aircraft(aircraft_id)
);

-- ================================================
-- BOOKINGS


-- ================================================
-- BOOKINGS (Guest Tickets by Ticket ID)
-- ================================================
-- DROP TABLE IF EXISTS bookings;
ALTER TABLE bookings MODIFY date VARCHAR(10);
DESCRIBE bookings;
SELECT * FROM bookings ORDER BY id DESC LIMIT 5;
-- BOOKINGS TABLE

CREATE TABLE IF NOT EXISTS bookings (
  user_id VARCHAR(10),
  ticket_id VARCHAR(50) UNIQUE,
  flight_id VARCHAR(20),
  flight_name VARCHAR(100),
  source VARCHAR(100),
  destination VARCHAR(100),
  date DATE,
  duration VARCHAR(50),
  class_type VARCHAR(50),
  price DECIMAL(10,2),
  username VARCHAR(100),
  status VARCHAR(50) DEFAULT 'Confirmed',
  cancelled BOOLEAN DEFAULT 0,
  reason TEXT,
  old_data JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL
);



-- Track last guest user id
CREATE TABLE IF NOT EXISTS guest_user_tracker (
  id INT PRIMARY KEY DEFAULT 0,
  last_user_num INT DEFAULT 0
);

-- Initialize tracker
INSERT INTO guest_user_tracker (id, last_user_num)
SELECT 0, 0
WHERE NOT EXISTS (SELECT * FROM guest_user_tracker);


-- ================================================
-- TICKETS
-- ================================================
CREATE TABLE ticket (
  ticket_id INT AUTO_INCREMENT PRIMARY KEY,
  passenger_id INT,
  schedule_id VARCHAR(10),
  seat_id INT,
  booking_date DATE ,
  travel_date DATE,
  class VARCHAR(20),
  status ENUM('CONFIRMED','CANCELLED') DEFAULT 'CONFIRMED',
  FOREIGN KEY (passenger_id) REFERENCES passenger(passenger_id),
  FOREIGN KEY (schedule_id) REFERENCES schedule(schedule_id),
  FOREIGN KEY (seat_id) REFERENCES seat(seat_id)
);

-- ================================================
-- PAYMENT
-- ================================================
CREATE TABLE payments (
  payment_id INT AUTO_INCREMENT PRIMARY KEY,
  ticket_id VARCHAR(50),
  amount DECIMAL(10,2),
  mode VARCHAR(20) NOT NULL,
  payment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(20) DEFAULT 'Success',
  user_id VARCHAR(50),
  flight_id VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ticket_id) REFERENCES bookings(ticket_id) ON DELETE CASCADE
);

-- ================================================
-- TRIGGERS (AIRCRAFT CAPACITY UPDATE)
-- ================================================
DELIMITER //

CREATE TRIGGER trg_capacity_decrease
AFTER INSERT ON ticket
FOR EACH ROW
BEGIN
    UPDATE aircraft
    SET available_capacity = available_capacity - 1
    WHERE aircraft_id = (
        SELECT aircraft_id
        FROM flight
        WHERE flight_id = (
            SELECT flight_id FROM schedule WHERE schedule_id = NEW.schedule_id
        )
    ) AND available_capacity > 0;
END;
//

CREATE TRIGGER trg_capacity_increase
AFTER UPDATE ON ticket
FOR EACH ROW
BEGIN
    IF NEW.status = 'CANCELLED' AND OLD.status <> 'CANCELLED' THEN
        UPDATE aircraft
        SET available_capacity = available_capacity + 1
        WHERE aircraft_id = (
            SELECT aircraft_id
            FROM flight
            WHERE flight_id = (
                SELECT flight_id FROM schedule WHERE schedule_id = NEW.schedule_id
            )
        );
    END IF;
END;
//
DELIMITER ;

-- ================================================
-- PROCEDURE (BOOKING)
-- ================================================
DELIMITER //
CREATE PROCEDURE Book_Ticket(
    IN p_passenger INT,
    IN p_schedule VARCHAR(10),
    IN p_seat INT,
    IN p_class VARCHAR(20)
)
BEGIN
    INSERT INTO ticket (passenger_id, schedule_id, seat_id, class, travel_date)
    VALUES (p_passenger, p_schedule, p_seat, p_class, CURDATE() + INTERVAL 7 DAY);
END;
//
DELIMITER ;

-- ================================================
-- FUNCTION (AVAILABLE SEATS)
-- ================================================
DELIMITER //
CREATE FUNCTION Get_Available_Seats(a_id VARCHAR(10))
RETURNS INT
DETERMINISTIC
BEGIN
    DECLARE available INT;
    SELECT available_capacity INTO available FROM aircraft WHERE aircraft_id = a_id;
    RETURN available;
END;
//
DELIMITER ;

-- ================================================
-- VIEWS
-- ================================================
CREATE OR REPLACE VIEW admin_flight_status AS
SELECT 
    f.flight_id,
    f.flight_name,
    f.source,
    f.destination,
    a.model AS aircraft_model,
    a.total_capacity,
    a.available_capacity,
    (a.total_capacity - a.available_capacity) AS booked_seats
FROM flight f
JOIN aircraft a ON f.aircraft_id = a.aircraft_id;

CREATE OR REPLACE VIEW payment_summary AS
SELECT 
    mode AS payment_mode,
    COUNT(*) AS total_transactions,
    SUM(amount) AS total_amount
FROM payment
GROUP BY mode;
