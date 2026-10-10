import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import {Demo} from './Demo';
import './styles.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode>{location.pathname === '/demo' ? <Demo/> : <App/>}</React.StrictMode>);
