if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const express = require('express');
const cors = require('cors');
const path = require('path');
const apiRouter = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.use('/api', apiRouter);

// Servir el frontend en producción
const distPath = path.join(__dirname, '../client/dist');
app.use(express.static(distPath));
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`CSPredict running on port ${PORT}`);
  console.log(`PandaScore: ${process.env.PANDASCORE_API_KEY ? 'conectado' : 'modo mock'}`);
  console.log(`TheOddsAPI: ${process.env.ODDS_API_KEY ? 'conectado' : 'modo mock'}`);
});
