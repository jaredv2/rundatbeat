import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import App from './App.jsx';
import Admin from './pages/Admin';
import Battle from './pages/Battle';
import Cosmetics from './pages/Cosmetics';
import GuestRoute from './components/auth/GuestRoute';
import Home from './pages/Home';
import Host from './pages/Host';
import Landing from './pages/Landing';
import Lobby from './pages/Lobby';
import Leaderboard from './pages/Leaderboard';
import Login from './pages/Login';
import PrivateRoute from './components/auth/PrivateRoute';
import Profile from './pages/Profile';
import Setup from './pages/Setup';
import Settings from './pages/Settings';
import Shop from './pages/Shop';
import './index.css';

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <PrivateRoute><Home /></PrivateRoute> },
      { path: 'landing', element: <GuestRoute><Landing /></GuestRoute> },
      { path: 'battle/:id', element: <PrivateRoute><Battle /></PrivateRoute> },
      { path: 'lobby/:id', element: <PrivateRoute><Lobby /></PrivateRoute> },
      { path: 'leaderboard', element: <Leaderboard /> },
      { path: 'shop', element: <PrivateRoute><Shop /></PrivateRoute> },
      { path: 'cosmetics', element: <PrivateRoute><Cosmetics /></PrivateRoute> },
      { path: 'host', element: <PrivateRoute><Host /></PrivateRoute> },
      { path: 'profile/:username', element: <Profile /> },
      { path: 'settings', element: <PrivateRoute><Settings /></PrivateRoute> },
      { path: 'login', element: <GuestRoute><Login /></GuestRoute> },
      { path: 'setup', element: <PrivateRoute><Setup /></PrivateRoute> },
      { path: 'admin', element: <PrivateRoute><Admin /></PrivateRoute> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
