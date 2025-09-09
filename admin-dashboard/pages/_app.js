import '../styles/globals.css'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Cookies from 'js-cookie'

function MyApp({ Component, pageProps }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    const token = Cookies.get('admin_token')
    const isLoginPage = router.pathname === '/login'
    
    if (token) {
      setIsAuthenticated(true)
      if (isLoginPage) {
        router.push('/')
      }
    } else {
      setIsAuthenticated(false)
      if (!isLoginPage) {
        router.push('/login')
      }
    }
    
    setIsLoading(false)
  }, [router.pathname])

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  if (!isAuthenticated && router.pathname !== '/login') {
    return null
  }

  return <Component {...pageProps} isAuthenticated={isAuthenticated} setIsAuthenticated={setIsAuthenticated} />
}

export default MyApp