if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const fs        = require('fs');
const apiRouter = require('./routes/api');
const scheduler = require('./scheduler');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use('/api', apiRouter);

const distPath = path.join(__dirname, '../client/dist');
const indexHtml = path.join(distPath, 'index.html');
app.use(express.static(distPath));
app.get('*', (req, res) => {
  if (fs.existsSync(indexHtml)) {
    res.sendFile(indexHtml);
  } else {
    res.status(200).send('<h2>CSPredict API running. Frontend not built.</h2>');
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`CSPredict running on port ${PORT}`);
  console.log(`PandaScore: ${process.env.PANDASCORE_API_KEY ? 'conectado' : 'modo mock'}`);
  console.log(`TheOddsAPI: ${process.env.ODDS_API_KEY ? 'conectado' : 'modo mock'}`);
  scheduler.start();
});
