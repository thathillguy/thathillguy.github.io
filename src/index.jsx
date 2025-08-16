// src/index.jsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import IndexContainer from './Containers/IndexContainer.jsx'; // default export above

const root = createRoot(document.getElementById('app'));
root.render(<IndexContainer />);
