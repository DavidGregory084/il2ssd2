import React from 'react';
import ReactDOM from 'react-dom';
import App from './src/app';

import './src/app.css';
import 'mini.css/dist/mini-dark.css';
import '@fortawesome/fontawesome-free/css/fontawesome.css';
import '@fortawesome/fontawesome-free/css/solid.css';
import '@fortawesome/fontawesome-free/css/regular.css';

function main() {
  ReactDOM.render(<App />, document.getElementById('app'));
}

// HMR stuff
// For more info see: https://parceljs.org/hmr.html
if (module.hot) {
  module.hot.accept(function () {
    console.log('Reloaded, running main again');
    main();
  });
}

console.log('Starting app');
main();
