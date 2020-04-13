import React from 'react';
import ReactDOM from 'react-dom';
import App from './app';

import './app.css';
import 'mini.css/dist/mini-dark.css';

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