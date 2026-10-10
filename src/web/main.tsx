import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { Inspector } from './Inspector';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode>{/^\/inspector\/?$/.test(window.location.pathname) ? <Inspector /> : <App />}</React.StrictMode>);
