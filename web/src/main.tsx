import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router'
import '@fontsource/young-serif/latin-400.css'
import '@fontsource/young-serif/latin-ext-400.css'
import '@fontsource/hanken-grotesk/latin-400.css'
import '@fontsource/hanken-grotesk/latin-500.css'
import '@fontsource/hanken-grotesk/latin-600.css'
import '@fontsource/hanken-grotesk/latin-700.css'
import '@fontsource/hanken-grotesk/latin-ext-400.css'
import '@fontsource/hanken-grotesk/latin-ext-500.css'
import '@fontsource/hanken-grotesk/latin-ext-600.css'
import '@fontsource/hanken-grotesk/latin-ext-700.css'
import './styles/tokens.css'
import './styles/base.css'
import './styles/browse.css'
import './styles/recipe.css'
import './styles/history.css'
import './styles/editor.css'
import './styles/bar.css'
import App from './App.tsx'

// A data router, because the editor's useBlocker needs one. App keeps its own <Routes>.
const router = createBrowserRouter([{ path: '*', element: <App /> }])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
