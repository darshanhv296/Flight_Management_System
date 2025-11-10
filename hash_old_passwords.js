const mysql = require("mysql2");
const bcrypt = require("bcrypt");

const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "Chotu@0208", // your MySQL password
  database: "flight_management_db"
});

db.connect(async (err) => {
  if (err) throw err;
  console.log("✅ Connected to database. Hashing passwords...");

  db.query("SELECT Username, Password FROM users", async (err, users) => {
    if (err) throw err;

    for (const user of users) {
      if (!user.Password.startsWith("$2b$")) {
        const hashed = await bcrypt.hash(user.Password, 10);
        db.query("UPDATE users SET Password = ? WHERE Username = ?", [hashed, user.Username]);
        console.log(`🔒 Hashed password for user: ${user.Username}`);
      }
    }

    console.log("✅ All plain-text passwords hashed.");
    db.end();
  });
});
