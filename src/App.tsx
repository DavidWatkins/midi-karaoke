import { useEffect, useState } from 'react'
import LyricsDisplay from './displays/LyricsDisplay'
import MainControl from './components/MainControl'

function App() {
  const [route, setRoute] = useState<string>('/')

  useEffect(() => {
    // Simple hash-based routing for Electron windows
    const handleHashChange = () => {
      setRoute(window.location.hash.replace('#', '') || '/')
    }

    handleHashChange()
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  // Route to different views
  if (route === '/lyrics') {
    return <LyricsDisplay />
  }

  return <MainControl />
}

export default App
