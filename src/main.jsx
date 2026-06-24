import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import App from './App.jsx';
import Spinner from './components/ui/Spinner';
import ErrorBoundary from './components/ui/ErrorBoundary';

const Admin = React.lazy(() => import('./pages/Admin'));
const Battle = React.lazy(() => import('./pages/Battle'));
const Cosmetics = React.lazy(() => import('./pages/Cosmetics'));
const Home = React.lazy(() => import('./pages/Home'));
const Host = React.lazy(() => import('./pages/Host'));
const Landing = React.lazy(() => import('./pages/Landing'));
const Lobby = React.lazy(() => import('./pages/Lobby'));
const Leaderboard = React.lazy(() => import('./pages/Leaderboard'));
const Login = React.lazy(() => import('./pages/Login'));
const Profile = React.lazy(() => import('./pages/Profile'));
const Setup = React.lazy(() => import('./pages/Setup'));
const Settings = React.lazy(() => import('./pages/Settings'));
const Shop = React.lazy(() => import('./pages/Shop'));
const Credits = React.lazy(() => import('./pages/Credits'));
const AuthCallback = React.lazy(() => import('./pages/AuthCallback'));

import GuestRoute from './components/auth/GuestRoute';
import PrivateRoute from './components/auth/PrivateRoute';
import './index.css';

function LazyPage({ children }) {
  return <Suspense fallback={<main className="grid min-h-[calc(100vh-88px)] place-items-center"><Spinner label="LOADING" /></main>}>{children}</Suspense>;
}

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <PrivateRoute><LazyPage><Home /></LazyPage></PrivateRoute> },
      { path: 'landing', element: <GuestRoute><LazyPage><Landing /></LazyPage></GuestRoute> },
      { path: 'battle/:id', element: <PrivateRoute><LazyPage><Battle /></LazyPage></PrivateRoute> },
      { path: 'lobby/:id', element: <PrivateRoute><LazyPage><Lobby /></LazyPage></PrivateRoute> },
      { path: 'leaderboard', element: <LazyPage><Leaderboard /></LazyPage> },
      { path: 'shop', element: <PrivateRoute><LazyPage><Shop /></LazyPage></PrivateRoute> },
      { path: 'cosmetics', element: <PrivateRoute><LazyPage><Cosmetics /></LazyPage></PrivateRoute> },
      { path: 'host', element: <PrivateRoute><LazyPage><Host /></LazyPage></PrivateRoute> },
      { path: 'profile/:userId', element: <LazyPage><Profile /></LazyPage> },
      { path: 'settings', element: <PrivateRoute><LazyPage><Settings /></LazyPage></PrivateRoute> },
      { path: 'login', element: <GuestRoute><LazyPage><Login /></LazyPage></GuestRoute> },
      { path: 'setup', element: <PrivateRoute><LazyPage><Setup /></LazyPage></PrivateRoute> },
      { path: 'admin', element: <PrivateRoute><LazyPage><Admin /></LazyPage></PrivateRoute> },
      { path: 'credits', element: <LazyPage><Credits /></LazyPage> },
      { path: 'auth/callback', element: <LazyPage><AuthCallback /></LazyPage> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <RouterProvider router={router} />
    </ErrorBoundary>
  </React.StrictMode>,
);
