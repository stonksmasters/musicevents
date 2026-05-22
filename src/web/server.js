'use strict';

const express = require('express');
const session = require('express-session');
const config = require('../config');
const { buildRouter } = require('./routes');

function startDashboard(client) {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(session({
    secret: config.dashboard.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 },
  }));

  app.use(buildRouter(client));

  app.use((err, req, res, next) => {
    console.error('Dashboard error:', err);
    res.status(500).send(`Server error: ${err.message}`);
  });

  return new Promise((resolve) => {
    const server = app.listen(config.dashboard.port, () => {
      const url = `http://localhost:${config.dashboard.port}`;
      console.log(`📊 Dashboard ready at ${url}` +
        (config.dashboard.devMode ? ' (DEV MODE — no auth required)' : ''));
      resolve(server);
    });
  });
}

module.exports = { startDashboard };
