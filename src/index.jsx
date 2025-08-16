// src/index.jsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import Portfolio from './src/Containers/IndexContainer.tsx'; // <-- the modern file you pasted earlier

const root = createRoot(document.getElementById('app'));
root.render(<Portfolio />);
