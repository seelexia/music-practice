import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import './styles.css';
import './components/external-score.css';
import './components/notation.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
