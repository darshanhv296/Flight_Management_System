// =========================
// Show / Hide Forms
// =========================
function showRegister() {
  document.getElementById("userForm").style.display = "none";
  document.getElementById("registerForm").style.display = "block";
}

function showLogin() {
  document.getElementById("registerForm").style.display = "none";
  document.getElementById("userForm").style.display = "block";
}

// =========================
// USER LOGIN
// =========================
async function userLogin() {
  const username = document.getElementById("loginUsername").value.trim();
  const password = document.getElementById("loginPassword").value.trim();

  if (!username || !password) return alert("Please fill all fields");

  try {
    const res = await fetch("/user/login", {
      method: "POST",
      credentials: 'include',
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    const data = await res.json();

    if (data.success) {
      // Store credentials for this tab's auto-login
      storeTabCredentials(username, password, false);
      
      localStorage.setItem("username", username);
      localStorage.setItem("userRole", "user");
      window.location.href = "user_dashboard.html";
    } else {
      alert(data.error || "Invalid credentials");
    }
  } catch (err) {
    alert("Error connecting to server");
    console.error(err);
  }
}

// =========================
// USER REGISTER
// =========================
async function userRegister() {
  let username = document.getElementById("regUsername").value.trim();
  let email = document.getElementById("regEmail").value.trim();
  const password = document.getElementById("regPassword").value.trim();

  if (!username || !password) return alert("Please fill all required fields");

  if (!email) email = username + "@gmail.com"; // auto-fill email

  try {
    // Send registration request and include credentials so that server can set the session cookie
    const res = await fetch("/user/register", {
      method: "POST",
      credentials: 'include',
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, email, password }),
    });

    const data = await res.json();

    if (data.success) {
      // Store minimal info locally for UI convenience
      localStorage.setItem("username", username);
      localStorage.setItem("userRole", "user");
      if (data.user_id) localStorage.setItem('user_id', data.user_id);

      // If the user was in the middle of booking (ticket details present), redirect back to payment
      if (localStorage.getItem('ticketDetails')) {
        // Redirect to payment page which will check /info for session user_id
        window.location.href = 'payment.html';
      } else {
        // Otherwise go to user dashboard
        window.location.href = 'user_dashboard.html';
      }
    } else {
      alert(data.error || "Registration failed");
    }
  } catch (err) {
    alert("Error connecting to server");
    console.error(err);
  }
}

// =========================
// ADMIN LOGIN
// =========================
async function adminLogin() {
  const username = document.getElementById("adminUser").value.trim();
  const password = document.getElementById("adminPass").value.trim();

  if (!username || !password) return alert("Please fill all fields");

  try {
    const res = await fetch("/admin/login", {
      method: "POST",
      credentials: 'include',
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    const data = await res.json();

    if (data.success) {
      // Store admin credentials for this tab's auto-login
      storeTabCredentials(username, password, true);
      
      localStorage.setItem("username", username);
      localStorage.setItem("userRole", "admin");
      window.location.href = "admin_dashboard.html";
    } else {
      alert(data.error || "Invalid admin credentials");
    }
  } catch (err) {
    alert("Error connecting to server");
    console.error(err);
  }
}

// =========================
// AUTO-LOGIN REDIRECT (if session exists)
// =========================
// =========================
// AUTO-LOGIN: Check and restore session for open tabs
// =========================
async function checkAutoLogin() {
  if (window.location.pathname.endsWith('index.html')) return; // Skip on login page
  
  try {
    // Check server session status
    const response = await fetch('/info', {
      credentials: 'include',
      headers: { 'Cache-Control': 'no-cache' }
    });
    const data = await response.json();

    // If we're already logged in via session, update UI and stay
    if (data.role === 'admin' || data.role === 'user') {
      const username = data.admin?.username || data.user?.username;
      if (username) {
        localStorage.setItem('username', username);
        localStorage.setItem('userRole', data.role);
        if (data.user?.user_id) {
          localStorage.setItem('user_id', data.user.user_id);
        }
        console.log(`✓ Session restored: ${username} (${data.role})`);
        return true; // Session valid
      }
    }

    // No valid session, but check if we have tab-specific credentials
    const tabId = sessionStorage.getItem('tabId') || generateTabId();
    const storedCreds = sessionStorage.getItem(`creds_${tabId}`);
    
    if (storedCreds) {
      const { username, password, isAdmin } = JSON.parse(storedCreds);
      
      // Attempt automatic re-login
      const loginUrl = isAdmin ? '/admin/login' : '/user/login';
      const loginResp = await fetch(loginUrl, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const loginData = await loginResp.json();
      if (loginData.success) {
        localStorage.setItem('username', username);
        localStorage.setItem('userRole', isAdmin ? 'admin' : 'user');
        if (loginData.user?.user_id) {
          localStorage.setItem('user_id', loginData.user.user_id);
        }
        console.log(`✓ Auto-login successful: ${username}`);
        return true;
      }
    }

    // No session and no stored credentials or login failed
    return false;
  } catch (err) {
    console.warn('Auto-login check failed:', err);
    return false;
  }
}

// Generate a unique ID for this browser tab
function generateTabId() {
  const tabId = Math.random().toString(36).substring(2) + Date.now();
  sessionStorage.setItem('tabId', tabId);
  return tabId;
}

// Store credentials for this tab (called after successful login)
function storeTabCredentials(username, password, isAdmin = false) {
  const tabId = sessionStorage.getItem('tabId') || generateTabId();
  sessionStorage.setItem(`creds_${tabId}`, JSON.stringify({ 
    username, password, isAdmin,
    stored: new Date().toISOString()
  }));
}

// =========================
// LOGOUT (Enhanced Role-specific)
// =========================
async function logout() {
  if (!confirm('Are you sure you want to logout?')) return;

  const userRole = localStorage.getItem("userRole");
  
  try {
    const response = await fetch(`/logout?role=${userRole}`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });

    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.message || 'Logout failed');
    }

    // Clear stored credentials and storage
    const tabId = sessionStorage.getItem('tabId');
    if (tabId) {
      sessionStorage.removeItem(`creds_${tabId}`);
    }
    localStorage.clear();
    sessionStorage.clear();
    
    // Attempt to clear any session cookie
    document.cookie = 'connect.sid=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/;';
    document.cookie = 'remember=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/;';
    
    window.location.replace('index.html');
  } catch (err) {
    console.error("Logout error:", err);
    alert("Error during logout. Please try again.");
    
    // Force redirect to login on critical errors
    if (err.message.includes('session')) {
      window.location.replace('index.html');
    }
  }
}

// =========================
// Cancel Booking
// =========================
async function cancelBooking(bookingId) {
  if (!confirm('Are you sure you want to cancel this booking?')) return;

  try {
    const response = await fetch(`/booking/cancel/${bookingId}`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();

    if (data.success) {
      alert('Booking cancelled successfully');
      // Refresh the bookings table
      location.reload();
    } else {
      alert(data.error || 'Failed to cancel booking');
    }
  } catch (err) {
    console.error('Error:', err);
    alert('Error cancelling booking');
  }
}
