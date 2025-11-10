// ============================================================
// ADMIN: Payment Routes
// ============================================================

// Create payments table if not exists
async function ensurePaymentsTable() {
  try {
    const sql = `
      CREATE TABLE IF NOT EXISTS payments (
        payment_id VARCHAR(50) PRIMARY KEY,
        booking_id INT,
        ticket_id VARCHAR(50),
        user_id VARCHAR(10),
        amount DECIMAL(10,2),
        payment_date DATETIME,
        payment_method VARCHAR(50),
        status VARCHAR(20),
        transaction_id VARCHAR(100),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(user_id),
        FOREIGN KEY (ticket_id) REFERENCES bookings(ticket_id)
      )
    `;
    await dbp.query(sql);
    console.log('✅ Payments table verified/created');
  } catch (err) {
    console.error('Error ensuring payments table:', err);
  }
}

// Generate payment ID
function generatePaymentId() {
  return 'PAY-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
}

// Save payment
app.post('/api/payments/save', async (req, res) => {
  try {
    // Session check
    if (!req.session?.user && !req.session?.admin) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const {
      booking_id,
      ticket_id,
      amount,
      payment_method,
      user_id,
      transaction_id
    } = req.body;

    if (!ticket_id || amount == null) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }

    // Normalize and prevent negative amounts — admin cancellations should not create negative payments
    const amountNum = Math.max(0, parseFloat(amount) || 0);

    const payment_id = generatePaymentId();
    const status = 'completed';

    const sql = `
      INSERT INTO payments (
        payment_id, booking_id, ticket_id, user_id,
        amount, payment_date, payment_method, status,
        transaction_id
      ) VALUES (?, ?, ?, ?, ?, NOW(), ?, ?, ?)
    `;

    const [result] = await dbp.query(sql, [
      payment_id,
      booking_id,
      ticket_id,
      user_id,
      amountNum,
      payment_method,
      status,
      transaction_id
    ]);

    console.log(`✅ Payment saved: ${payment_id}`);
    res.json({
      success: true,
      message: 'Payment saved successfully',
      payment_id
    });

  } catch (err) {
    console.error('❌ Payment error:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Get all payments (admin only)
app.get('/api/admin/payments', async (req, res) => {
  try {
    if (!req.session?.admin) {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }

    const sql = `
      SELECT p.*, 
             u.username,
             b.flight_name,
             b.source,
             b.destination,
             b.class_type
      FROM payments p
      LEFT JOIN users u ON p.user_id = u.user_id
      LEFT JOIN bookings b ON p.ticket_id = b.ticket_id
      ORDER BY p.payment_date DESC
    `;

    const [rows] = await dbp.query(sql);

    res.json({
      success: true,
      payments: rows.map(row => ({
        ...row,
        amount: parseFloat(row.amount),
        payment_date: row.payment_date.toISOString(),
        created_at: row.created_at.toISOString(),
        updated_at: row.updated_at.toISOString()
      }))
    });

  } catch (err) {
    console.error('❌ Error fetching payments:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Get payments by user
app.get('/api/payments/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Security check
    if (!req.session?.admin && req.session?.user?.user_id !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized access'
      });
    }

    const sql = `
      SELECT p.*, b.flight_name, b.source, b.destination, b.class_type
      FROM payments p
      LEFT JOIN bookings b ON p.ticket_id = b.ticket_id
      WHERE p.user_id = ?
      ORDER BY p.payment_date DESC
    `;

    const [rows] = await dbp.query(sql, [userId]);

    res.json({
      success: true,
      payments: rows.map(row => ({
        ...row,
        amount: parseFloat(row.amount),
        payment_date: row.payment_date.toISOString()
      }))
    });

  } catch (err) {
    console.error('Error fetching user payments:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Get payment by ticket ID
app.get('/api/payments/ticket/:ticketId', async (req, res) => {
  try {
    const { ticketId } = req.params;

    const sql = `
      SELECT p.*, u.username, b.flight_name
      FROM payments p
      LEFT JOIN users u ON p.user_id = u.user_id
      LEFT JOIN bookings b ON p.ticket_id = b.ticket_id
      WHERE p.ticket_id = ?
      LIMIT 1
    `;

    const [rows] = await dbp.query(sql, [ticketId]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Payment not found'
      });
    }

    res.json({
      success: true,
      payment: {
        ...rows[0],
        amount: parseFloat(rows[0].amount),
        payment_date: rows[0].payment_date.toISOString()
      }
    });

  } catch (err) {
    console.error('Error fetching payment:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});