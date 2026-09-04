const path = require('path');
const express = require('express');
const session = require('express-session');
const { router: authRouter, hasAdminUser } = require('./routes/auth');
const dashboardRouter = require('./routes/dashboard');
const deploymentsRouter = require('./routes/deployments');
const rolesRouter = require('./routes/roles');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: false }));
app.use('/public', express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax' },
}));

// Make the logged-in username available to every view (e.g. the navbar's
// user menu) without every route having to pass it explicitly.
app.use((req, res, next) => {
  res.locals.username = req.session.username;
  next();
});

// First-run gate: no admin account yet -> everything redirects to /register.
// Once an admin exists, /register is disabled and redirects to /login.
app.use((req, res, next) => {
  if (req.path.startsWith('/public')) return next();

  const adminExists = hasAdminUser();
  if (!adminExists && req.path !== '/register') return res.redirect('/register');
  if (adminExists && req.path === '/register') return res.redirect('/login');
  next();
});

app.use('/', authRouter);
app.use('/', dashboardRouter);
app.use('/', deploymentsRouter);
app.use('/', rolesRouter);

module.exports = app;
