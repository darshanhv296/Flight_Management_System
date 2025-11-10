# Flight Management System 🛫

A comprehensive web-based flight management system that allows users to book flights, manage bookings, and administrators to oversee the entire system.

## Features 🌟

### User Features
- User registration and authentication
- Flight search and booking
- Ticket management
- Booking history
- Profile management
- Payment processing
- Booking cancellation
- Support ticket system

### Admin Features
- Flight management
- User management
- Booking oversight
- Payment tracking
- System monitoring
- Analytics and reporting

## Technology Stack 💻

- **Frontend**: HTML, CSS, JavaScript
- **Backend**: Node.js, Express.js
- **Database**: MySQL
- **Authentication**: Session-based authentication
- **Security**: CORS, Cookie Parser, Secure Sessions

## Project Structure 📁

```
Flight_Management_System/
├── public/
│   ├── admin_dashboard.html
│   ├── admin_flight.html
│   ├── admin_pay.html
│   ├── book.html
│   ├── bookings.html
│   ├── cancel.html
│   ├── confirm.html
│   ├── flights.html
│   ├── history.html
│   ├── index.html
│   ├── payment.html
│   ├── registration.html
│   ├── request.html
│   ├── support.html
│   ├── ticket.html
│   ├── user_dashboard.html
│   └── user_registration.html
├── dbconfig.js
├── server.js
├── payments_routes.js
└── init_db.js
```

## Setup Requirements 🔧

1. **Node.js**: v12.0 or higher
2. **MySQL**: v5.7 or higher
3. **Web Browser**: Modern browser with JavaScript enabled

## Installation Steps 🚀

1. Clone the repository:
   ```bash
   git clone <repository-url>
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure database:
   - Create a MySQL database named 'flight_management_db'
   - Update dbconfig.js with your MySQL credentials

4. Initialize the database:
   ```bash
   node init_db.js
   ```

5. Start the server:
   ```bash
   node server.js
   ```

6. Access the application:
   ```
   http://localhost:3000
   ```

## Database Configuration 🗄️

The system uses MySQL with the following configuration:
- Host: localhost
- Database: flight_management_db
- Default Port: 3306

Update the database configuration in `dbconfig.js` as needed.

## API Endpoints 🛣️

### Authentication
- POST `/user/register` - User registration
- POST `/user/login` - User login
- POST `/admin/login` - Admin login
- POST `/logout` - Logout

### Flights
- GET `/flights` - List all flights
- POST `/flights/search` - Search flights
- POST `/flights/add` - Add new flight (admin)

### Bookings
- POST `/bookings/save` - Save booking
- GET `/bookings/latest/:user_id` - Get latest booking
- POST `/bookings/cancel/:ticketId` - Cancel booking
- GET `/admin/bookings` - Get all bookings (admin)

### Payments
- POST `/api/payments/add` - Process payment
- GET `/api/payments` - Get payment history

## Security Features 🔐

1. Session Management
   - Separate session stores for users and admins
   - Secure cookie configuration
   - Session expiration handling

2. Authentication
   - Password hashing
   - Role-based access control
   - Session verification

3. Data Protection
   - Input validation
   - SQL injection prevention
   - CORS protection

## Error Handling ⚠️

The system includes comprehensive error handling for:
- Database connections
- Authentication failures
- Invalid inputs
- Server errors
- Session management