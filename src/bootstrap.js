const { app, dialog } = require('electron');

process.on('uncaughtException', error => {
  console.error('[MAIN UNCAUGHT EXCEPTION]', error?.stack || error);
  if (app.isReady()) dialog.showErrorBox('PoB2 Comparitator – Fehler', String(error?.stack || error));
});

process.on('unhandledRejection', reason => {
  console.error('[MAIN UNHANDLED REJECTION]', reason?.stack || reason);
  if (app.isReady()) dialog.showErrorBox('PoB2 Comparitator – Fehler', String(reason?.stack || reason));
});

app.on('window-all-closed', event => {
  event.preventDefault();
});

require('./main');
