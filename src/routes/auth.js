const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');

const router = express.Router();

function hasAdminUser() {
  return db.prepare('SELECT COUNT(*) AS count FROM users').get().count > 0;
}

router.get('/register', (req, res) => {
  if (hasAdminUser()) return res.redirect('/login');
  res.render('register', { error: null });
});

router.post('/register', (req, res) => {
  if (hasAdminUser()) return res.redirect('/login');

  const { username, password, confirmPassword } = req.body;
  if (!username || !password) {
    return res.render('register', { error: 'Username and password are required.' });
  }
  if (password !== confirmPassword) {
    return res.render('register', { error: 'Passwords do not match.' });
  }

  const passwordHash = bcrypt.hashSync(password, 12);
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, passwordHash);
  res.redirect('/login');
});

router.get('/login', (req, res) => {
  if (!hasAdminUser()) return res.redirect('/register');
  res.render('login', { error: null });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.render('login', { error: 'Invalid username or password.' });
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  res.redirect('/');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = { router, hasAdminUser };
