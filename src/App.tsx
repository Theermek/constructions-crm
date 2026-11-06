import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { AppShell } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';
import { ObjectsPage } from './pages/ObjectsPage';
import { ObjectPage } from './pages/ObjectPage';
import { TaskPage } from './pages/TaskPage';
import { MyTasksPage } from './pages/MyTasksPage';

function PrivateRoute({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  if (!session) {
    return <Navigate to="/login" replace />;
  }
  return <AppShell>{children}</AppShell>;
}

function PublicOnlyRoute({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  if (session) {
    return <Navigate to="/objects" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicOnlyRoute>
            <LoginPage />
          </PublicOnlyRoute>
        }
      />
      <Route
        path="/objects"
        element={
          <PrivateRoute>
            <ObjectsPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/objects/:id"
        element={
          <PrivateRoute>
            <ObjectPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/tasks/:id"
        element={
          <PrivateRoute>
            <TaskPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/my-tasks"
        element={
          <PrivateRoute>
            <MyTasksPage />
          </PrivateRoute>
        }
      />
      <Route path="*" element={<Navigate to="/objects" replace />} />
    </Routes>
  );
}
